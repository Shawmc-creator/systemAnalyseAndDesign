'use strict';
// The three business tables are defined in the current 69-table core model.
// Existing implementation tables remain intact; this is an additive upgrade.
const fs = require('node:fs');
const path = require('node:path');
const { utc } = require('./common');
const VERSION = 20261019;
const META = `created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0)`;
const SQL = `
CREATE TABLE clinical_equipment (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0), equipment_type TEXT NOT NULL,
 dental_chair_id INTEGER REFERENCES dental_chair(id), status TEXT NOT NULL CHECK(status IN ('可用','停用')),
 status_reason TEXT, ${META}
) STRICT;
CREATE TABLE resource_block (
 id INTEGER PRIMARY KEY, dental_chair_id INTEGER REFERENCES dental_chair(id), equipment_id INTEGER REFERENCES clinical_equipment(id),
 starts_at TEXT NOT NULL, ends_at TEXT, reason TEXT NOT NULL CHECK(length(trim(reason))>0), released_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('生效中','已解除')), operator_id INTEGER NOT NULL REFERENCES staff(id), ${META},
 CHECK((dental_chair_id IS NOT NULL)+(equipment_id IS NOT NULL)=1),
 CHECK(ends_at IS NULL OR ends_at>starts_at), CHECK(released_at IS NULL OR released_at>=starts_at),
 CHECK((status='已解除')=(released_at IS NOT NULL))
) STRICT;
CREATE TABLE equipment_occupancy (
 id INTEGER PRIMARY KEY, equipment_id INTEGER NOT NULL REFERENCES clinical_equipment(id),
 appointment_id INTEGER REFERENCES appointment(id), visit_id INTEGER REFERENCES visit(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
 actual_ended_at TEXT, status TEXT NOT NULL CHECK(status IN ('已预留','使用中','已释放')), release_reason TEXT, ${META},
 CHECK(appointment_id IS NOT NULL OR visit_id IS NOT NULL), CHECK(ends_at>starts_at),
 CHECK(status='已释放' OR actual_ended_at IS NULL), CHECK(status<>'已释放' OR length(trim(release_reason))>0)
) STRICT;
CREATE INDEX resource_block_chair ON resource_block(dental_chair_id,status,starts_at);
CREATE INDEX resource_block_equipment ON resource_block(equipment_id,status,starts_at);
CREATE INDEX equipment_occupancy_interval ON equipment_occupancy(equipment_id,status,starts_at,ends_at);
CREATE UNIQUE INDEX equipment_appointment_active ON equipment_occupancy(equipment_id,appointment_id) WHERE status<>'已释放';
CREATE UNIQUE INDEX equipment_visit_active ON equipment_occupancy(equipment_id,visit_id) WHERE status<>'已释放';
CREATE TRIGGER resource_block_frozen BEFORE UPDATE ON resource_block WHEN OLD.status='已解除'
 BEGIN SELECT RAISE(ABORT,'resource_history_frozen'); END;
CREATE TRIGGER equipment_occupancy_frozen BEFORE UPDATE ON equipment_occupancy WHEN OLD.status='已释放'
 BEGIN SELECT RAISE(ABORT,'resource_history_frozen'); END;
CREATE TRIGGER equipment_overlap_insert BEFORE INSERT ON equipment_occupancy
 WHEN NEW.status<>'已释放' AND EXISTS(SELECT 1 FROM equipment_occupancy o WHERE o.equipment_id=NEW.equipment_id
 AND o.status<>'已释放' AND o.starts_at<NEW.ends_at AND NEW.starts_at<o.ends_at)
 BEGIN SELECT RAISE(ABORT,'equipment_overlap'); END;
CREATE TRIGGER equipment_overlap_update BEFORE UPDATE ON equipment_occupancy
 WHEN NEW.status<>'已释放' AND EXISTS(SELECT 1 FROM equipment_occupancy o WHERE o.id<>NEW.id AND o.equipment_id=NEW.equipment_id
 AND o.status<>'已释放' AND o.starts_at<NEW.ends_at AND NEW.starts_at<o.ends_at)
 BEGIN SELECT RAISE(ABORT,'equipment_overlap'); END;
`;
function upgradeResources(db, filename) {
  const old = db.prepare('PRAGMA user_version').get().user_version;
  if (old === VERSION) return;
  if (old !== 20261018) throw new Error('不支持此数据库版本，未执行升级');
  if (filename !== ':memory:') {
    const folder = path.join(path.dirname(path.resolve(filename)), 'backups');
    fs.mkdirSync(folder, { recursive: true });
    const backup = path.join(folder, `before-resources-${Date.now()}-${require('node:crypto').randomUUID()}.db`);
    // SQLite produces a consistent snapshot including WAL content.
    db.prepare('VACUUM INTO ?').run(backup);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(SQL);
    const now = utc(new Date());
    for (const [code, name, kind, roles] of [
      ['resources.query', '查询接诊资源', '查询', ['frontdesk','dentist','assistant','manager']],
      ['resources.manage', '停用及核验恢复接诊资源', '业务写入', ['assistant','manager']],
      ['resources.equipment', '登记诊疗设备', '业务写入', ['manager']],
      ['resources.finish', '确认实际操作结束', '业务写入', ['dentist']]
    ]) {
      const id = Number(db.prepare(`INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES(?,?,?,?,?,1)`)
        .run(code, '现行UC-24', name, kind, '按当前岗位办理，不返回无关临床正文').lastInsertRowid);
      for (const role of roles) db.prepare(`INSERT INTO role_permission(role_id,permission_id,config_version,created_at)
        SELECT id,?,1,? FROM access_role WHERE code=?`).run(id,now,role);
    }
    db.exec(`PRAGMA user_version=${VERSION}; COMMIT`);
  } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; }
}
module.exports = { VERSION, upgradeResources };
