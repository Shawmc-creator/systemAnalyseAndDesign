'use strict';
const crypto = require('node:crypto');
const { fail, hash, utc, day, insert, text } = require('./common');
function encodePassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:16384:8:1:${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function checkPassword(password, encoded) {
  const [algorithm, n, r, p, salt, digest] = String(encoded).split(':');
  if (algorithm !== 'scrypt' || n !== '16384' || r !== '8' || p !== '1' || !/^[a-f0-9]{128}$/.test(digest || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), crypto.scryptSync(password, salt, 64));
}
class Auth {
  constructor(db, clock = () => new Date()) {
    this.db = db; this.clock = clock; this.epoch = crypto.randomUUID(); this.secret = crypto.randomBytes(32);
    this.dummy = encodePassword(crypto.randomBytes(32).toString('hex'));
  }
  now() { return utc(this.clock()); }
  csrf(token) { return crypto.createHmac('sha256', this.secret).update(token).digest('hex'); }
  roles(accountId, at = this.now()) {
    return this.db.prepare(`SELECT r.code,r.name,g.id grant_id,q.id qualification_id FROM account_role g
      JOIN access_role r ON r.id=g.role_id JOIN staff_role_qualification q ON q.id=g.qualification_id
      JOIN user_account a ON a.id=g.account_id JOIN staff s ON s.id=a.staff_id
      WHERE a.id=? AND a.status='启用' AND s.employed_from<=? AND (s.employed_until IS NULL OR s.employed_until>=?)
      AND g.granted_at<=? AND (g.valid_until IS NULL OR g.valid_until>?) AND (g.revoked_at IS NULL OR g.revoked_at>?)
      AND q.staff_id=a.staff_id AND q.role_id=g.role_id AND q.valid_from<=? AND (q.valid_until IS NULL OR q.valid_until>?)
      AND (q.revoked_at IS NULL OR q.revoked_at>?)`).all(accountId, day(at), day(at), at, at, at, at, at, at);
  }
  authenticationEvent(accountId, sessionId, event, login, source, reason) {
    insert(this.db, 'authentication_event', { account_id: accountId, session_id: sessionId, event_type: event,
      occurred_at: this.now(), login_digest: hash(login), source_digest: hash(source), reason_code: reason, correlation_id: crypto.randomUUID() });
  }
  login(input, source = 'local') {
    const name = text(input.username, '账号', 64).toLowerCase();
    const password = typeof input.password === 'string' && input.password.length <= 1024 ? input.password : '';
    const since = utc(Date.parse(this.now()) - 15 * 60_000);
    const attempts = this.db.prepare("SELECT count(*) n FROM authentication_event WHERE occurred_at>=? AND event_type IN ('失败','限流') AND (login_digest=? OR source_digest=?)").get(since, hash(name), hash(source)).n;
    if (attempts >= 10) { this.authenticationEvent(null, null, '限流', name, source, 'LOGIN_THROTTLED'); fail(429, 'LOGIN_THROTTLED', '尝试次数过多，请15分钟后再试'); }
    const account = this.db.prepare('SELECT * FROM user_account WHERE login_name=?').get(name);
    const verified = checkPassword(password, account?.password_hash || this.dummy);
    if (!verified || !account || !this.roles(account.id).length) {
      this.authenticationEvent(account?.id || null, null, '失败', name, source, 'INVALID_CREDENTIALS');
      fail(401, 'INVALID_CREDENTIALS', '账号、密码或当前任职资格无效');
    }
    const token = crypto.randomBytes(32).toString('hex'), now = this.now();
    const csrf = this.csrf(token);
    const sid = insert(this.db, 'login_session', { account_id: account.id, token_hash: hash(token), csrf_hash: hash(csrf),
      auth_version: account.auth_version, runtime_epoch: this.epoch, created_at: now, last_seen_at: now,
      expires_at: utc(Date.parse(now) + 8 * 3600_000), revoked_at: null, revocation_reason: null });
    this.authenticationEvent(account.id, sid, '成功', name, source, 'LOGIN_OK');
    return { token, csrf, user: this.profile(this.session(token)) };
  }
  session(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail(401, 'SESSION_INVALID', '请登录');
    const s = this.db.prepare(`SELECT l.*,a.staff_id,a.login_name,a.status account_status,a.auth_version current_auth_version,s.name
      FROM login_session l JOIN user_account a ON a.id=l.account_id JOIN staff s ON s.id=a.staff_id WHERE l.token_hash=?`).get(hash(token));
    if (!s || s.revoked_at || s.expires_at <= this.now() || s.runtime_epoch !== this.epoch || s.account_status !== '启用' || s.auth_version !== s.current_auth_version || !this.roles(s.account_id).length) fail(401, 'SESSION_INVALID', '登录或岗位资格已失效，请重新登录');
    return s;
  }
  profile(session) {
    return { accountId: session.account_id, staffId: session.staff_id, name: session.name, username: session.login_name, roles: this.roles(session.account_id) };
  }
  authorize(token, role, permission, csrf) {
    const s = this.session(token);
    if (csrf !== undefined && hash(String(csrf)) !== s.csrf_hash) fail(403, 'CSRF_INVALID', '安全令牌已失效，请刷新后重试');
    const grant = this.roles(s.account_id).find(r => r.code === role);
    const p = this.db.prepare(`SELECT p.* FROM access_permission p JOIN role_permission rp ON rp.permission_id=p.id
      JOIN access_role r ON r.id=rp.role_id WHERE r.code=? AND p.code=? AND rp.config_version=p.config_version`).get(role || '', permission);
    if (!grant || !p) fail(403, 'FORBIDDEN', '当前岗位无权办理此操作');
    if(permission==='uc28.approve'||/^uc(29|30|31)\./.test(permission))fail(410,'FEATURE_REMOVED','该旧功能已移出当前需求范围');
    return { session: s, permission: p, authority: { role, grantId: grant.grant_id, qualificationId: grant.qualification_id, configVersion: p.config_version } };
  }
  logout(token) {
    const s = this.session(token);
    this.db.prepare("UPDATE login_session SET revoked_at=?,revocation_reason='主动退出' WHERE id=?").run(this.now(), s.id);
    this.authenticationEvent(s.account_id, s.id, '注销', s.login_name, 'local', 'LOGOUT');
  }
}
module.exports = { Auth, encodePassword };
