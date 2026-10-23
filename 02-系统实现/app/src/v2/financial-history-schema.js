'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION=2026102302;
const CONFIG={
  "fee_request": {
    "table": "fee_request_history",
    "ownerField": "fee_request_id",
    "fields": [
      "patient_funds_id",
      "bill_id",
      "patient_payment_id",
      "submission_no",
      "reason",
      "proposed_adjustment_cents",
      "proposed_refund_cents",
      "evidence",
      "submitted_at",
      "status",
      "approved_adjustment_cents",
      "approved_refund_cents",
      "review_note",
      "reviewed_by",
      "reviewed_at"
    ]
  },
  "service_price": {
    "table": "service_price_history",
    "ownerField": "service_price_id",
    "fields": [
      "service_id",
      "unit_price_cents",
      "valid_from",
      "valid_until",
      "change_reason",
      "review_note",
      "status",
      "confirmed_by",
      "confirmed_at"
    ]
  }
};
const SQL=String.raw`
CREATE TABLE fee_request_history (
 "id" INTEGER PRIMARY KEY AUTOINCREMENT,
 "fee_request_id" INTEGER NOT NULL REFERENCES "fee_request"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("fee_request_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "event_no" INTEGER NOT NULL CHECK ("event_no" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("event_no">0),
 "operation_no" TEXT NOT NULL UNIQUE CHECK (length(trim("operation_no"))>0),
 "event_type" TEXT NOT NULL CHECK (length(trim("event_type"))>0) CHECK ("event_type" IN ('提交','退回','同意','拒绝','撤回')),
 "event_reason" TEXT NOT NULL CHECK (length(trim("event_reason"))>0),
 "actor_id" INTEGER NOT NULL REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("actor_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0) CHECK (length("occurred_at")=20 AND strftime('%Y-%m-%dT%H:%M:%SZ',"occurred_at",'+0 seconds') IS "occurred_at"),
 "patient_funds_id" INTEGER NOT NULL REFERENCES "patient_funds"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("patient_funds_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "bill_id" INTEGER REFERENCES "bill"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("bill_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "patient_payment_id" INTEGER REFERENCES "patient_payment"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("patient_payment_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "submission_no" INTEGER NOT NULL CHECK ("submission_no" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("submission_no">0),
 "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
 "proposed_adjustment_cents" INTEGER NOT NULL CHECK ("proposed_adjustment_cents" BETWEEN -9007199254740991 AND 9007199254740991),
 "proposed_refund_cents" INTEGER NOT NULL CHECK ("proposed_refund_cents" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("proposed_refund_cents">=0),
 "evidence" TEXT NOT NULL CHECK (length(trim("evidence"))>0),
 "submitted_at" TEXT NOT NULL CHECK (length(trim("submitted_at"))>0) CHECK (length("submitted_at")=20 AND strftime('%Y-%m-%dT%H:%M:%SZ',"submitted_at",'+0 seconds') IS "submitted_at"),
 "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待审核','已退回','已拒绝','已同意','已撤回')),
 "approved_adjustment_cents" INTEGER CHECK ("approved_adjustment_cents" BETWEEN -9007199254740991 AND 9007199254740991),
 "approved_refund_cents" INTEGER CHECK ("approved_refund_cents" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("approved_refund_cents">=0),
 "review_note" TEXT CHECK (length(trim("review_note"))>0),
 "reviewed_by" INTEGER REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("reviewed_by" BETWEEN -9007199254740991 AND 9007199254740991),
 "reviewed_at" TEXT CHECK (length(trim("reviewed_at"))>0) CHECK (length("reviewed_at")=20 AND strftime('%Y-%m-%dT%H:%M:%SZ',"reviewed_at",'+0 seconds') IS "reviewed_at"),
 UNIQUE("fee_request_id",event_no),
 CHECK(bill_id IS NOT NULL OR patient_payment_id IS NOT NULL),
 CHECK(event_type NOT IN ('同意','退回','拒绝') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL))
) STRICT;
CREATE TRIGGER fee_request_history_no_update BEFORE UPDATE ON fee_request_history BEGIN SELECT RAISE(ABORT,'financial_history_frozen'); END;
CREATE TRIGGER fee_request_history_no_delete BEFORE DELETE ON fee_request_history BEGIN SELECT RAISE(ABORT,'financial_history_frozen'); END;
CREATE TRIGGER fee_request_history_context BEFORE INSERT ON fee_request_history WHEN NEW."patient_funds_id" IS NOT (SELECT "patient_funds_id" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."bill_id" IS NOT (SELECT "bill_id" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."patient_payment_id" IS NOT (SELECT "patient_payment_id" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."submission_no" IS NOT (SELECT "submission_no" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."reason" IS NOT (SELECT "reason" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."proposed_adjustment_cents" IS NOT (SELECT "proposed_adjustment_cents" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."proposed_refund_cents" IS NOT (SELECT "proposed_refund_cents" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."evidence" IS NOT (SELECT "evidence" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."submitted_at" IS NOT (SELECT "submitted_at" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."status" IS NOT (SELECT "status" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."approved_adjustment_cents" IS NOT (SELECT "approved_adjustment_cents" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."approved_refund_cents" IS NOT (SELECT "approved_refund_cents" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."review_note" IS NOT (SELECT "review_note" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."reviewed_by" IS NOT (SELECT "reviewed_by" FROM fee_request WHERE id=NEW.fee_request_id) OR NEW."reviewed_at" IS NOT (SELECT "reviewed_at" FROM fee_request WHERE id=NEW.fee_request_id) OR (NEW.event_type='提交' AND NEW.status<>'待审核') OR (NEW.event_type='退回' AND NEW.status<>'已退回') OR (NEW.event_type='同意' AND NEW.status<>'已同意') OR (NEW.event_type='拒绝' AND NEW.status<>'已拒绝') OR (NEW.event_type='撤回' AND NEW.status<>'已撤回') OR NEW.event_no<>(SELECT coalesce(max(event_no),0)+1 FROM fee_request_history WHERE fee_request_id=NEW.fee_request_id) BEGIN SELECT RAISE(ABORT,'financial_history_context'); END;
CREATE TABLE service_price_history (
 "id" INTEGER PRIMARY KEY AUTOINCREMENT,
 "service_price_id" INTEGER NOT NULL REFERENCES "service_price"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("service_price_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "event_no" INTEGER NOT NULL CHECK ("event_no" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("event_no">0),
 "operation_no" TEXT NOT NULL UNIQUE CHECK (length(trim("operation_no"))>0),
 "event_type" TEXT NOT NULL CHECK (length(trim("event_type"))>0) CHECK ("event_type" IN ('提交','退回','确认','停止适用')),
 "event_reason" TEXT NOT NULL CHECK (length(trim("event_reason"))>0),
 "actor_id" INTEGER NOT NULL REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("actor_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0) CHECK (length("occurred_at")=20 AND strftime('%Y-%m-%dT%H:%M:%SZ',"occurred_at",'+0 seconds') IS "occurred_at"),
 "service_id" INTEGER NOT NULL REFERENCES "service"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("service_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "unit_price_cents" INTEGER NOT NULL CHECK ("unit_price_cents" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("unit_price_cents">=0),
 "valid_from" TEXT NOT NULL CHECK (length(trim("valid_from"))>0) CHECK (length("valid_from")=20 AND strftime('%Y-%m-%dT%H:%M:%SZ',"valid_from",'+0 seconds') IS "valid_from"),
 "valid_until" TEXT CHECK (length(trim("valid_until"))>0) CHECK (length("valid_until")=20 AND strftime('%Y-%m-%dT%H:%M:%SZ',"valid_until",'+0 seconds') IS "valid_until"),
 "change_reason" TEXT NOT NULL CHECK (length(trim("change_reason"))>0),
 "review_note" TEXT CHECK (length(trim("review_note"))>0),
 "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('价目草稿','待负责人确认','已确认可适用','已退回','不再用于新计费')),
 "confirmed_by" INTEGER REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991),
 "confirmed_at" TEXT CHECK (length(trim("confirmed_at"))>0) CHECK (length("confirmed_at")=20 AND strftime('%Y-%m-%dT%H:%M:%SZ',"confirmed_at",'+0 seconds') IS "confirmed_at"),
 UNIQUE("service_price_id",event_no),
 CHECK(valid_until IS NULL OR valid_until>valid_from),
 CHECK(event_type<>'确认' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
) STRICT;
CREATE TRIGGER service_price_history_no_update BEFORE UPDATE ON service_price_history BEGIN SELECT RAISE(ABORT,'financial_history_frozen'); END;
CREATE TRIGGER service_price_history_no_delete BEFORE DELETE ON service_price_history BEGIN SELECT RAISE(ABORT,'financial_history_frozen'); END;
CREATE TRIGGER service_price_history_context BEFORE INSERT ON service_price_history WHEN NEW."service_id" IS NOT (SELECT "service_id" FROM service_price WHERE id=NEW.service_price_id) OR NEW."unit_price_cents" IS NOT (SELECT "unit_price_cents" FROM service_price WHERE id=NEW.service_price_id) OR NEW."valid_from" IS NOT (SELECT "valid_from" FROM service_price WHERE id=NEW.service_price_id) OR NEW."valid_until" IS NOT (SELECT "valid_until" FROM service_price WHERE id=NEW.service_price_id) OR NEW."change_reason" IS NOT (SELECT "change_reason" FROM service_price WHERE id=NEW.service_price_id) OR NEW."review_note" IS NOT (SELECT "review_note" FROM service_price WHERE id=NEW.service_price_id) OR NEW."status" IS NOT (SELECT "status" FROM service_price WHERE id=NEW.service_price_id) OR NEW."confirmed_by" IS NOT (SELECT "confirmed_by" FROM service_price WHERE id=NEW.service_price_id) OR NEW."confirmed_at" IS NOT (SELECT "confirmed_at" FROM service_price WHERE id=NEW.service_price_id) OR (NEW.event_type='提交' AND NEW.status<>'待负责人确认') OR (NEW.event_type='退回' AND NEW.status<>'已退回') OR (NEW.event_type='确认' AND NEW.status<>'已确认可适用') OR (NEW.event_type='停止适用' AND NEW.status<>'不再用于新计费') OR NEW.event_no<>(SELECT coalesce(max(event_no),0)+1 FROM service_price_history WHERE service_price_id=NEW.service_price_id) BEGIN SELECT RAISE(ABORT,'financial_history_context'); END;
`;

function upgradeFinancialHistory(db,filename,backupNeeded=true){
 const version=db.prepare('PRAGMA user_version').get().user_version;if(version===VERSION)return;
 if(version!==20261023)throw new Error('不支持此数据库版本，未执行费用历史升级');
 if(filename!==':memory:'&&backupNeeded){const folder=path.join(path.dirname(path.resolve(filename)),'backups');fs.mkdirSync(folder,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(folder,'before-financial-history-'+Date.now()+'-'+crypto.randomUUID()+'.db'));}
 db.exec('BEGIN IMMEDIATE');
 try{db.exec(SQL);if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('费用历史外键检查未通过');db.exec('PRAGMA user_version='+VERSION+'; COMMIT');}
 catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
module.exports={VERSION,CONFIG,upgradeFinancialHistory};
