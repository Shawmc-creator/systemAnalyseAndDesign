-- UC-27目标物理设计补充：仅用于隔离设计核验；不是运行系统自动升级脚本。

-- 在2026102601结构之后应用；不得直接运行于现有业务数据库。

-- 患者归属、角色、价目适用、版本递增、出具完整性和决定效力仍须对应服务共同核对。

PRAGMA foreign_keys=ON;

BEGIN IMMEDIATE;

CREATE TABLE "treatment_quote" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "patient_id" INTEGER NOT NULL REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "treatment_plan_id" INTEGER REFERENCES "treatment_plan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "record_no" TEXT NOT NULL UNIQUE,
  "created_by" INTEGER NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK(revision>0),
  CHECK(length(trim(record_no))>0)
);

CREATE TABLE "quote_version" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "quote_id" INTEGER NOT NULL REFERENCES "treatment_quote"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "source_plan_version_id" INTEGER REFERENCES "plan_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "version_no" INTEGER NOT NULL,
  "previous_version_id" INTEGER REFERENCES "quote_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "valid_from" TEXT,
  "valid_until" TEXT,
  "status" TEXT NOT NULL,
  "issued_at" TEXT,
  "issued_by" INTEGER REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "change_reason" TEXT NOT NULL,
  "created_by" INTEGER NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK(revision>0),
  UNIQUE(quote_id,version_no),
  CHECK(version_no>0),
  CHECK(status IN ('草稿','已出具','已接受','部分接受','已拒绝','已撤回','已到期','已替代')),
  CHECK(valid_from IS NULL OR date(valid_from)=valid_from),
  CHECK(valid_until IS NULL OR date(valid_until)=valid_until),
  CHECK(valid_from IS NULL OR valid_until IS NULL OR valid_until>=valid_from),
  CHECK((status='草稿' AND issued_at IS NULL AND issued_by IS NULL) OR (status<>'草稿' AND issued_at IS NOT NULL AND issued_by IS NOT NULL AND valid_from IS NOT NULL AND valid_until IS NOT NULL)),
  CHECK(previous_version_id IS NULL OR previous_version_id<>id)
);

CREATE TABLE "quote_item" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "quote_version_id" INTEGER NOT NULL REFERENCES "quote_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "plan_item_id" INTEGER REFERENCES "plan_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "service_id" INTEGER NOT NULL REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "service_price_id" INTEGER REFERENCES "service_price"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "description_snapshot" TEXT NOT NULL,
  "tooth_code" TEXT,
  "surface_code" TEXT,
  "quantity" INTEGER NOT NULL,
  "billing_unit_snapshot" TEXT NOT NULL,
  "unit_price_cents" INTEGER,
  "amount_cents" INTEGER,
  "scope_note" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK(revision>0),
  UNIQUE(quote_version_id,sequence_no),
  CHECK(quantity>0 AND sequence_no>0),
  CHECK(unit_price_cents IS NULL OR unit_price_cents>=0),
  CHECK(amount_cents IS NULL OR amount_cents>=0),
  CHECK((unit_price_cents IS NULL AND amount_cents IS NULL) OR (unit_price_cents IS NOT NULL AND amount_cents=quantity*unit_price_cents)),
  CHECK(surface_code IS NULL OR tooth_code IS NOT NULL)
);

CREATE TABLE "quote_decision" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "quote_item_id" INTEGER NOT NULL REFERENCES "quote_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "decision_type" TEXT NOT NULL,
  "decided_at" TEXT NOT NULL,
  "confirmation_basis" TEXT NOT NULL,
  "recorded_by" INTEGER NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "created_at" TEXT NOT NULL,
  CHECK(decision_type IN ('接受','暂缓','拒绝','撤回')),
  CHECK(length(trim(confirmation_basis))>0)
);

ALTER TABLE patient_payment ADD COLUMN quote_id INTEGER REFERENCES treatment_quote(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE bill_item ADD COLUMN quote_item_id INTEGER REFERENCES quote_item(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX quote_patient_lookup ON treatment_quote(patient_id);

CREATE INDEX quote_plan_lookup ON treatment_quote(treatment_plan_id);

CREATE INDEX quote_item_plan_lookup ON quote_item(plan_item_id);

CREATE INDEX quote_decision_lookup ON quote_decision(quote_item_id,decided_at,id);

CREATE INDEX payment_quote_lookup ON patient_payment(quote_id);

CREATE INDEX bill_item_quote_lookup ON bill_item(quote_item_id);

CREATE TRIGGER quote_decision_no_update BEFORE UPDATE ON quote_decision BEGIN SELECT RAISE(ABORT,'quote_decision_frozen'); END;

CREATE TRIGGER quote_decision_no_delete BEFORE DELETE ON quote_decision BEGIN SELECT RAISE(ABORT,'quote_decision_frozen'); END;

CREATE TRIGGER quote_head_identity BEFORE UPDATE ON treatment_quote WHEN NEW.id IS NOT OLD.id OR NEW.patient_id IS NOT OLD.patient_id OR NEW.treatment_plan_id IS NOT OLD.treatment_plan_id OR NEW.record_no IS NOT OLD.record_no BEGIN SELECT RAISE(ABORT,'quote_identity_frozen'); END;

CREATE TRIGGER quote_item_no_update BEFORE UPDATE ON quote_item WHEN (SELECT status FROM quote_version WHERE id=OLD.quote_version_id)<>'草稿' OR NEW.quote_version_id<>OLD.quote_version_id BEGIN SELECT RAISE(ABORT,'quote_item_frozen'); END;

CREATE TRIGGER quote_item_no_insert BEFORE INSERT ON quote_item WHEN (SELECT status FROM quote_version WHERE id=NEW.quote_version_id)<>'草稿' BEGIN SELECT RAISE(ABORT,'quote_item_frozen'); END;

CREATE TRIGGER quote_item_no_delete BEFORE DELETE ON quote_item WHEN (SELECT status FROM quote_version WHERE id=OLD.quote_version_id)<>'草稿' BEGIN SELECT RAISE(ABORT,'quote_item_frozen'); END;

CREATE TRIGGER quote_version_no_reopen BEFORE UPDATE ON quote_version WHEN OLD.status<>'草稿' AND (NEW.status='草稿' OR NEW.quote_id IS NOT OLD.quote_id OR NEW.version_no IS NOT OLD.version_no OR NEW.previous_version_id IS NOT OLD.previous_version_id OR NEW.valid_from IS NOT OLD.valid_from OR NEW.valid_until IS NOT OLD.valid_until OR NEW.issued_at IS NOT OLD.issued_at OR NEW.issued_by IS NOT OLD.issued_by OR NEW.change_reason IS NOT OLD.change_reason) BEGIN SELECT RAISE(ABORT,'quote_version_frozen'); END;

COMMIT;
