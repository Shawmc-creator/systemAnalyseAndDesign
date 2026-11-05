-- 连锁设计验证稿；仅用于隔离数据库，不用于直接迁移现有系统。
-- 外键前提：staff(id)、patient(id) 和 visit(id,patient_id,branch_id) 已存在；
-- visit 的 (id,patient_id,branch_id) 需有 UNIQUE 索引以支持复合外键。
PRAGMA foreign_keys = ON;

CREATE TABLE clinic_chain (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);

CREATE TABLE clinic_branch (
  id INTEGER PRIMARY KEY,
  chain_id INTEGER NOT NULL REFERENCES clinic_chain(id) ON DELETE RESTRICT,
  branch_code TEXT NOT NULL CHECK (length(trim(branch_code)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  insurance_enabled INTEGER NOT NULL DEFAULT 0 CHECK (insurance_enabled IN (0,1)),
  dispensing_enabled INTEGER NOT NULL DEFAULT 0 CHECK (dispensing_enabled IN (0,1)),
  UNIQUE (chain_id, branch_code)
);

CREATE TABLE branch_staff_role (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES clinic_branch(id) ON DELETE RESTRICT,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  role_code TEXT NOT NULL CHECK (role_code IN
    ('frontdesk','dentist','assistant','cashier','branch_manager','chain_manager','pharmacist')),
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  granted_by INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  granted_at TEXT NOT NULL,
  evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
  revoked_at TEXT,
  revoked_by INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR
         (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE INDEX branch_staff_role_lookup ON branch_staff_role(staff_id,branch_id,role_code);

CREATE TABLE cross_branch_record_access (
  id INTEGER PRIMARY KEY,
  dentist_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  patient_id INTEGER NOT NULL REFERENCES patient(id) ON DELETE RESTRICT,
  visit_id INTEGER NOT NULL,
  source_branch_id INTEGER NOT NULL REFERENCES clinic_branch(id) ON DELETE RESTRICT,
  target_branch_id INTEGER NOT NULL REFERENCES clinic_branch(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL CHECK (scope IN ('health','record','plan','prescription','document','all')),
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  granted_by INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  granted_at TEXT NOT NULL,
  evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
  revoked_at TEXT,
  revoked_by INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
  CHECK (source_branch_id <> target_branch_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR
         (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)),
  FOREIGN KEY (visit_id, patient_id, source_branch_id)
    REFERENCES visit(id, patient_id, branch_id) ON DELETE RESTRICT
);
CREATE INDEX cross_branch_access_lookup
  ON cross_branch_record_access(dentist_id,patient_id,visit_id,target_branch_id,scope);

-- 所有时刻使用统一 UTC 格式；区间重叠、岗位资格、经办人权限及文件正文
-- 访问需服务端核验，本稿不声称 CHECK 或外键可替代授权判断；来源和目标
-- 须属于同一连锁，停用门店、授权撤销及人员资格应按实际办理时再次核实。
