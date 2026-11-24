const demo = require('./demo-booking');
const config = require('./local-trial-config');
const local = config.enabled && (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform === 'devtools';
const online = !local && Boolean(config.apiOrigin);
const connected = local || online;
const base = local ? 'http://127.0.0.1:3027/api/miniprogram-trial' : config.apiOrigin + '/api/miniprogram';
const modeLabel = local ? '本机联调 · 预约同步到前台网页' :
  online ? '联网体验 · 预约同步到演示前台' : '课程演示 · 使用虚构门店和预约时段';
let token = '';
let signedIn = false;
let pendingLogin;
let sequence = 0;

function request(path, method, data, bearer) {
  return new Promise((resolve, reject) => {
    if (online && !/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(config.apiOrigin)) {
      reject(new Error('请配置微信后台登记的 HTTPS API 域名。'));
      return;
    }
    const header = { 'content-type': 'application/json' };
    if (bearer) header.Authorization = 'Bearer ' + bearer;
    wx.request({
      url: base + path, method, data, header, timeout: 8000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
        } else {
          const error = new Error(response.data?.message || (online ? '联网体验服务暂不可用。' : '联调服务请求失败，请检查本机服务。'));
          error.status = response.statusCode;
          reject(error);
        }
      },
      fail() {
        reject(new Error(online ? '无法连接联网体验服务，请检查网络后重试。' : '无法连接本机联调服务，请确认服务已启动。'));
      }
    });
  });
}

function loginPayload() {
  if (!online) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        if (result.code) resolve({ code: result.code });
        else reject(new Error('没有取得微信登录凭证，请重试。'));
      },
      fail() { reject(new Error('微信登录失败，请重试。')); }
    });
  });
}

async function getToken() {
  if (token) return token;
  if (!pendingLogin) {
    pendingLogin = loginPayload().then(data => request('/session', 'POST', data)).then(result => {
      token = result.token;
      return token;
    }).finally(() => { pendingLogin = null; });
  }
  return pendingLogin;
}

async function signIn() {
  if (connected) await getToken();
  signedIn = true;
}

async function call(path, method = 'GET', data) {
  const current = await getToken();
  try {
    return await request(path, method, data, current);
  } catch (error) {
    if (error.status !== 401) throw error;
    if (token === current) token = '';
    return request(path, method, data, await getToken());
  }
}

function chinaTime(value) {
  return new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16);
}

async function getOptions() {
  if (!signedIn) throw new Error('请先登录。');
  if (!connected) {
    const now = Date.now(), dates = demo.bookableDates(now);
    const slots = demo.branches.flatMap(branch => dates.flatMap(date =>
      demo.availableSlots(branch.id, date, now).map(time => ({
        id: branch.id + '|' + date + '|' + time, branchId: branch.id, date, time, dentist: branch.dentist
      }))));
    return { branches: demo.branches, slots, patientName: demo.patientName, patientRecordNo: demo.patientRecordNo,
      reasons: demo.reasons, now: dates[0] };
  }
  const result = await call('/options');
  const slots = result.schedules.flatMap(schedule => schedule.slots.map(slot => {
    const [date, time] = chinaTime(slot.startsAt).split('T');
    return {
      ...slot, id: schedule.id + '|' + slot.startsAt, branchId: String(schedule.branch_id), date, time,
      dentist: schedule.dentist_name, scheduleId: schedule.id, scheduleRevision: schedule.revision
    };
  }));
  return {
    branches: result.branches.map(branch => ({ ...branch, id: String(branch.id) })),
    now: chinaTime(result.now).slice(0, 10), patientName: result.patientName, patientRecordNo: result.patientRecordNo || '',
    reasons: result.reasons || demo.reasons, slots
  };
}

async function listBookings() {
  if (!signedIn) return [];
  if (!connected) return demo.listBookings();
  const { bookings } = await call('/options');
  return bookings.map(item => {
    const [date, time] = chinaTime(item.planned_start).split('T');
    return {
      id: String(item.id), reference: item.record_no, branchId: item.branch_id,
      branchName: item.branch_name, patientName: item.patient_name, dentist: item.dentist_name,
      date, time, status: item.status, revision: item.revision
    };
  });
}

function requestKey() {
  return 'wx-' + Date.now() + '-' + (++sequence) + '-' + Math.random().toString(36).slice(2);
}

async function createBooking(slot, reason) {
  if (!signedIn) throw new Error('请先登录。');
  if (!connected) return demo.createBooking({ ...slot, reason });
  return call('/appointment', 'POST', {
    action: 'create', branchId: slot.branchId, scheduleId: slot.scheduleId,
    scheduleRevision: slot.scheduleRevision, startsAt: slot.startsAt, endsAt: slot.endsAt, reason, requestKey: requestKey()
  });
}

async function cancelBooking(record) {
  if (!signedIn) throw new Error('请先登录。');
  if (!connected) return demo.cancelBooking(record.id);
  return call('/appointment', 'POST', {
    action: 'cancel', branchId: record.branchId, appointmentId: record.id,
    expectedRevision: record.revision, requestKey: requestKey()
  });
}

module.exports = { getOptions, listBookings, createBooking, cancelBooking, signIn,
  signedIn: () => signedIn, modeLabel, online, local, connected };
