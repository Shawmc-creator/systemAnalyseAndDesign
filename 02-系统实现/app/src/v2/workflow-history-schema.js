'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION=2026102303;
const CONFIG={
  "followup_requirement": {
    "table": "followup_history",
    "ownerField": "followup_requirement_id",
    "fields": [
      "patient_id",
      "source_visit_id",
      "source_plan_version_id",
      "purpose",
      "followup_type",
      "target_start",
      "target_end",
      "requires_assessment",
      "responsible_frontdesk_id",
      "status",
      "next_contact_date",
      "published_by",
      "published_at",
      "closed_by",
      "closed_at",
      "closure_basis",
      "cancellation_reason"
    ]
  },
  "stock_count": {
    "table": "stock_count_history",
    "ownerField": "stock_count_id",
    "fields": [
      "batch_stock_id",
      "snapshot_quantity_scaled",
      "counted_quantity_scaled",
      "stock_revision",
      "counted_at",
      "reason",
      "review_note",
      "confirmed_by",
      "confirmed_at",
      "status"
    ]
  },
  "purchase_receipt_item": {
    "table": "receipt_item_history",
    "ownerField": "purchase_receipt_item_id",
    "fields": [
      "purchase_receipt_id",
      "purchase_order_item_id",
      "material_batch_id",
      "stock_location_id",
      "arrived_quantity_scaled",
      "accepted_quantity_scaled",
      "rejected_quantity_scaled",
      "pending_quantity_scaled",
      "inspection_note"
    ]
  },
  "insurance_case": {
    "table": "insurance_preestimate_history",
    "ownerField": "insurance_case_id",
    "fields": []
  },
  "document_version": {
    "table": "document_correction",
    "ownerField": "document_version_id",
    "fields": []
  },
  "prescription": {
    "table": "prescription_review_history",
    "ownerField": "prescription_id",
    "fields": [
      "review_status",
      "review_note"
    ]
  }
};
const SQL=String.raw`
ALTER TABLE followup_requirement ADD COLUMN published_by INTEGER REFERENCES staff(id);
ALTER TABLE followup_requirement ADD COLUMN published_at TEXT;
ALTER TABLE insurance_case ADD COLUMN current_preestimate_id INTEGER REFERENCES insurance_preestimate_history(id);
ALTER TABLE insurance_fee ADD COLUMN preestimate_request_id INTEGER REFERENCES insurance_preestimate_history(id);
ALTER TABLE insurance_settlement ADD COLUMN preestimate_request_id INTEGER REFERENCES insurance_preestimate_history(id);
CREATE TABLE followup_history (
 "id" INTEGER PRIMARY KEY AUTOINCREMENT,
 "followup_requirement_id" INTEGER NOT NULL REFERENCES "followup_requirement"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("followup_requirement_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "event_no" INTEGER NOT NULL CHECK ("event_no" BETWEEN -9007199254740991 AND 9007199254740991),
 "operation_no" TEXT NOT NULL UNIQUE CHECK (length(trim("operation_no"))>0),
 "event_type" TEXT NOT NULL CHECK (length(trim("event_type"))>0) CHECK ("event_type" IN ('发布','调整','转交','联系更新','继续跟进','完成','撤销')),
 "event_reason" TEXT NOT NULL CHECK (length(trim("event_reason"))>0),
 "actor_id" INTEGER NOT NULL REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("actor_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0),
 "patient_id" INTEGER NOT NULL REFERENCES "patient"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "source_visit_id" INTEGER REFERENCES "visit"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("source_visit_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "source_plan_version_id" INTEGER REFERENCES "plan_version"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("source_plan_version_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "purpose" TEXT NOT NULL CHECK (length(trim("purpose"))>0),
 "followup_type" TEXT NOT NULL CHECK (length(trim("followup_type"))>0),
 "target_start" TEXT NOT NULL CHECK (length(trim("target_start"))>0),
 "target_end" TEXT NOT NULL CHECK (length(trim("target_end"))>0),
 "requires_assessment" INTEGER NOT NULL CHECK ("requires_assessment" BETWEEN -9007199254740991 AND 9007199254740991),
 "responsible_frontdesk_id" INTEGER NOT NULL REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("responsible_frontdesk_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待发布','待联系','待到诊或评估','已完成','已撤销')),
 "next_contact_date" TEXT CHECK (length(trim("next_contact_date"))>0),
 "published_by" INTEGER REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("published_by" BETWEEN -9007199254740991 AND 9007199254740991),
 "published_at" TEXT CHECK (length(trim("published_at"))>0),
 "closed_by" INTEGER REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("closed_by" BETWEEN -9007199254740991 AND 9007199254740991),
 "closed_at" TEXT CHECK (length(trim("closed_at"))>0),
 "closure_basis" TEXT CHECK (length(trim("closure_basis"))>0),
 "cancellation_reason" TEXT CHECK (length(trim("cancellation_reason"))>0),
 UNIQUE("followup_requirement_id",event_no),
 CHECK(event_no>0)
) STRICT;
CREATE TRIGGER followup_history_no_update BEFORE UPDATE ON followup_history BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER followup_history_no_delete BEFORE DELETE ON followup_history BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER followup_history_context BEFORE INSERT ON followup_history WHEN (NEW.event_no<>(SELECT coalesce(max(event_no),0)+1 FROM followup_history WHERE followup_requirement_id=NEW.followup_requirement_id)) OR (NEW."patient_id" IS NOT (SELECT "patient_id" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."source_visit_id" IS NOT (SELECT "source_visit_id" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."source_plan_version_id" IS NOT (SELECT "source_plan_version_id" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."purpose" IS NOT (SELECT "purpose" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."followup_type" IS NOT (SELECT "followup_type" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."target_start" IS NOT (SELECT "target_start" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."target_end" IS NOT (SELECT "target_end" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."requires_assessment" IS NOT (SELECT "requires_assessment" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."responsible_frontdesk_id" IS NOT (SELECT "responsible_frontdesk_id" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."status" IS NOT (SELECT "status" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."next_contact_date" IS NOT (SELECT "next_contact_date" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."published_by" IS NOT (SELECT "published_by" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."published_at" IS NOT (SELECT "published_at" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."closed_by" IS NOT (SELECT "closed_by" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."closed_at" IS NOT (SELECT "closed_at" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."closure_basis" IS NOT (SELECT "closure_basis" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) OR (NEW."cancellation_reason" IS NOT (SELECT "cancellation_reason" FROM followup_requirement WHERE id=NEW.followup_requirement_id)) BEGIN SELECT RAISE(ABORT,'workflow_history_context'); END;
CREATE TABLE stock_count_history (
 "id" INTEGER PRIMARY KEY AUTOINCREMENT,
 "stock_count_id" INTEGER NOT NULL REFERENCES "stock_count"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("stock_count_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "event_no" INTEGER NOT NULL CHECK ("event_no" BETWEEN -9007199254740991 AND 9007199254740991),
 "operation_no" TEXT NOT NULL UNIQUE CHECK (length(trim("operation_no"))>0),
 "event_type" TEXT NOT NULL CHECK (length(trim("event_type"))>0) CHECK ("event_type" IN ('提交','版本不符','重新实点','同意','拒绝')),
 "event_reason" TEXT NOT NULL CHECK (length(trim("event_reason"))>0),
 "actor_id" INTEGER NOT NULL REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("actor_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0),
 "batch_stock_id" INTEGER NOT NULL REFERENCES "batch_stock"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("batch_stock_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "snapshot_quantity_scaled" INTEGER NOT NULL CHECK ("snapshot_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991),
 "counted_quantity_scaled" INTEGER NOT NULL CHECK ("counted_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991),
 "stock_revision" INTEGER NOT NULL CHECK ("stock_revision" BETWEEN -9007199254740991 AND 9007199254740991),
 "counted_at" TEXT NOT NULL CHECK (length(trim("counted_at"))>0),
 "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
 "review_note" TEXT CHECK (length(trim("review_note"))>0),
 "confirmed_by" INTEGER REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991),
 "confirmed_at" TEXT CHECK (length(trim("confirmed_at"))>0),
 "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待确认差异','待重新核对','差异已确认','不予调整')),
 UNIQUE("stock_count_id",event_no),
 CHECK(event_no>0)
) STRICT;
CREATE TRIGGER stock_count_history_no_update BEFORE UPDATE ON stock_count_history BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER stock_count_history_no_delete BEFORE DELETE ON stock_count_history BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER stock_count_history_context BEFORE INSERT ON stock_count_history WHEN (NEW.event_no<>(SELECT coalesce(max(event_no),0)+1 FROM stock_count_history WHERE stock_count_id=NEW.stock_count_id)) OR (NEW."batch_stock_id" IS NOT (SELECT "batch_stock_id" FROM stock_count WHERE id=NEW.stock_count_id)) OR (NEW."snapshot_quantity_scaled" IS NOT (SELECT "snapshot_quantity_scaled" FROM stock_count WHERE id=NEW.stock_count_id)) OR (NEW."counted_quantity_scaled" IS NOT (SELECT "counted_quantity_scaled" FROM stock_count WHERE id=NEW.stock_count_id)) OR (NEW."stock_revision" IS NOT (SELECT "stock_revision" FROM stock_count WHERE id=NEW.stock_count_id)) OR (NEW."counted_at" IS NOT (SELECT "counted_at" FROM stock_count WHERE id=NEW.stock_count_id)) OR (NEW."reason" IS NOT (SELECT "reason" FROM stock_count WHERE id=NEW.stock_count_id)) OR (NEW."review_note" IS NOT (SELECT "review_note" FROM stock_count WHERE id=NEW.stock_count_id)) OR (NEW."confirmed_by" IS NOT (SELECT "confirmed_by" FROM stock_count WHERE id=NEW.stock_count_id)) OR (NEW."confirmed_at" IS NOT (SELECT "confirmed_at" FROM stock_count WHERE id=NEW.stock_count_id)) OR (NEW."status" IS NOT (SELECT "status" FROM stock_count WHERE id=NEW.stock_count_id)) BEGIN SELECT RAISE(ABORT,'workflow_history_context'); END;
CREATE TABLE receipt_item_history (
 "id" INTEGER PRIMARY KEY AUTOINCREMENT,
 "purchase_receipt_item_id" INTEGER NOT NULL REFERENCES "purchase_receipt_item"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("purchase_receipt_item_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "event_no" INTEGER NOT NULL CHECK ("event_no" BETWEEN -9007199254740991 AND 9007199254740991),
 "operation_no" TEXT NOT NULL UNIQUE CHECK (length(trim("operation_no"))>0),
 "event_type" TEXT NOT NULL CHECK (length(trim("event_type"))>0) CHECK ("event_type" IN ('首次确认','待检后确认','差异更正')),
 "event_reason" TEXT NOT NULL CHECK (length(trim("event_reason"))>0),
 "actor_id" INTEGER NOT NULL REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("actor_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0),
 "purchase_receipt_id" INTEGER NOT NULL REFERENCES "purchase_receipt"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("purchase_receipt_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "purchase_order_item_id" INTEGER NOT NULL REFERENCES "purchase_order_item"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("purchase_order_item_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "material_batch_id" INTEGER REFERENCES "material_batch"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("material_batch_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "stock_location_id" INTEGER REFERENCES "stock_location"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("stock_location_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "arrived_quantity_scaled" INTEGER NOT NULL CHECK ("arrived_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991),
 "accepted_quantity_scaled" INTEGER NOT NULL CHECK ("accepted_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991),
 "rejected_quantity_scaled" INTEGER NOT NULL CHECK ("rejected_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991),
 "pending_quantity_scaled" INTEGER NOT NULL CHECK ("pending_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991),
 "inspection_note" TEXT NOT NULL CHECK (length(trim("inspection_note"))>0),
 "newly_accepted_scaled" INTEGER NOT NULL CHECK ("newly_accepted_scaled" BETWEEN -9007199254740991 AND 9007199254740991),
 "inventory_movement_id" INTEGER UNIQUE REFERENCES "inventory_movement"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("inventory_movement_id" BETWEEN -9007199254740991 AND 9007199254740991),
 UNIQUE("purchase_receipt_item_id",event_no),
 CHECK(event_no>0),
 CHECK(arrived_quantity_scaled=accepted_quantity_scaled+rejected_quantity_scaled+pending_quantity_scaled),
 CHECK(newly_accepted_scaled>=0),
 CHECK((newly_accepted_scaled=0 AND inventory_movement_id IS NULL) OR (newly_accepted_scaled>0 AND inventory_movement_id IS NOT NULL)),
 UNIQUE(inventory_movement_id)
) STRICT;
CREATE TRIGGER receipt_item_history_no_update BEFORE UPDATE ON receipt_item_history BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER receipt_item_history_no_delete BEFORE DELETE ON receipt_item_history BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER receipt_item_history_context BEFORE INSERT ON receipt_item_history WHEN (NEW.event_no<>(SELECT coalesce(max(event_no),0)+1 FROM receipt_item_history WHERE purchase_receipt_item_id=NEW.purchase_receipt_item_id)) OR (NEW."purchase_receipt_id" IS NOT (SELECT "purchase_receipt_id" FROM purchase_receipt_item WHERE id=NEW.purchase_receipt_item_id)) OR (NEW."purchase_order_item_id" IS NOT (SELECT "purchase_order_item_id" FROM purchase_receipt_item WHERE id=NEW.purchase_receipt_item_id)) OR (NEW."material_batch_id" IS NOT (SELECT "material_batch_id" FROM purchase_receipt_item WHERE id=NEW.purchase_receipt_item_id)) OR (NEW."stock_location_id" IS NOT (SELECT "stock_location_id" FROM purchase_receipt_item WHERE id=NEW.purchase_receipt_item_id)) OR (NEW."arrived_quantity_scaled" IS NOT (SELECT "arrived_quantity_scaled" FROM purchase_receipt_item WHERE id=NEW.purchase_receipt_item_id)) OR (NEW."accepted_quantity_scaled" IS NOT (SELECT "accepted_quantity_scaled" FROM purchase_receipt_item WHERE id=NEW.purchase_receipt_item_id)) OR (NEW."rejected_quantity_scaled" IS NOT (SELECT "rejected_quantity_scaled" FROM purchase_receipt_item WHERE id=NEW.purchase_receipt_item_id)) OR (NEW."pending_quantity_scaled" IS NOT (SELECT "pending_quantity_scaled" FROM purchase_receipt_item WHERE id=NEW.purchase_receipt_item_id)) OR (NEW."inspection_note" IS NOT (SELECT "inspection_note" FROM purchase_receipt_item WHERE id=NEW.purchase_receipt_item_id)) OR (NEW.newly_accepted_scaled<>NEW.accepted_quantity_scaled-coalesce((SELECT accepted_quantity_scaled FROM receipt_item_history WHERE purchase_receipt_item_id=NEW.purchase_receipt_item_id ORDER BY event_no DESC LIMIT 1),NEW.accepted_quantity_scaled-NEW.newly_accepted_scaled)) OR (NEW.inventory_movement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_movement m JOIN batch_stock s ON s.id=m.batch_stock_id WHERE m.id=NEW.inventory_movement_id AND m.purchase_receipt_item_id=NEW.purchase_receipt_item_id AND m.movement_type='验收入库' AND m.delta_scaled=NEW.newly_accepted_scaled AND s.material_batch_id=NEW.material_batch_id AND s.stock_location_id=NEW.stock_location_id)) BEGIN SELECT RAISE(ABORT,'workflow_history_context'); END;
CREATE TABLE insurance_preestimate_history (
 "id" INTEGER PRIMARY KEY AUTOINCREMENT,
 "insurance_case_id" INTEGER NOT NULL REFERENCES "insurance_case"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("insurance_case_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "event_no" INTEGER NOT NULL CHECK ("event_no" BETWEEN -9007199254740991 AND 9007199254740991),
 "operation_no" TEXT NOT NULL UNIQUE CHECK (length(trim("operation_no"))>0),
 "event_type" TEXT NOT NULL CHECK (length(trim("event_type"))>0) CHECK ("event_type" IN ('提交','结果','失效','患者选择')),
 "event_reason" TEXT NOT NULL CHECK (length(trim("event_reason"))>0),
 "actor_id" INTEGER NOT NULL REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("actor_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0),
 "request_id" INTEGER REFERENCES "insurance_preestimate_history"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("request_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "request_no" TEXT UNIQUE CHECK (length(trim("request_no"))>0),
 "bill_id" INTEGER NOT NULL REFERENCES "bill"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("bill_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "identity_id" INTEGER NOT NULL REFERENCES "insurance_identity"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("identity_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "fee_revision" INTEGER NOT NULL CHECK ("fee_revision" BETWEEN -9007199254740991 AND 9007199254740991),
 "diagnosis_code" TEXT NOT NULL CHECK (length(trim("diagnosis_code"))>0),
 "result_status" TEXT CHECK (length(trim("result_status"))>0) CHECK ("result_status" IN ('成功','明确失败','未知')),
 "estimated_fund_cents" INTEGER CHECK ("estimated_fund_cents" BETWEEN -9007199254740991 AND 9007199254740991),
 "estimated_account_cents" INTEGER CHECK ("estimated_account_cents" BETWEEN -9007199254740991 AND 9007199254740991),
 "estimated_patient_cents" INTEGER CHECK ("estimated_patient_cents" BETWEEN -9007199254740991 AND 9007199254740991),
 "patient_choice" TEXT CHECK (length(trim("patient_choice"))>0) CHECK ("patient_choice" IN ('待确认','医保','自费')),
 "patient_confirmed_at" TEXT CHECK (length(trim("patient_confirmed_at"))>0),
 "result_note" TEXT CHECK (length(trim("result_note"))>0),
 UNIQUE("insurance_case_id",event_no),
 CHECK(event_no>0),
 CHECK((event_type='提交' AND request_id IS NULL AND request_no IS NOT NULL) OR (event_type<>'提交' AND request_id IS NOT NULL AND request_no IS NULL)),
 CHECK(event_type<>'结果' OR (result_status IS NOT NULL AND result_note IS NOT NULL)),
 CHECK(result_status IS NOT '成功' OR (estimated_fund_cents>=0 AND estimated_account_cents>=0 AND estimated_patient_cents>=0 AND estimated_fund_cents IS NOT NULL AND estimated_account_cents IS NOT NULL AND estimated_patient_cents IS NOT NULL)),
 CHECK(event_type<>'患者选择' OR (patient_choice IN ('医保','自费') AND patient_confirmed_at IS NOT NULL AND result_note IS NOT NULL))
) STRICT;
CREATE TRIGGER insurance_preestimate_history_no_update BEFORE UPDATE ON insurance_preestimate_history BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER insurance_preestimate_history_no_delete BEFORE DELETE ON insurance_preestimate_history BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER insurance_preestimate_history_context BEFORE INSERT ON insurance_preestimate_history WHEN (NEW.event_no<>(SELECT coalesce(max(event_no),0)+1 FROM insurance_preestimate_history WHERE insurance_case_id=NEW.insurance_case_id)) OR (NEW.event_type<>'提交' AND NOT EXISTS(SELECT 1 FROM insurance_preestimate_history h WHERE h.id=NEW.request_id AND h.event_type='提交' AND h.insurance_case_id=NEW.insurance_case_id AND h.bill_id=NEW.bill_id AND h.identity_id=NEW.identity_id AND h.fee_revision=NEW.fee_revision AND h.diagnosis_code=NEW.diagnosis_code)) OR (NEW.event_type='结果' AND NEW.result_status='成功' AND NEW.estimated_fund_cents+NEW.estimated_account_cents+NEW.estimated_patient_cents<>coalesce((SELECT sum(amount_cents) FROM insurance_fee WHERE preestimate_request_id=NEW.request_id),-1)) BEGIN SELECT RAISE(ABORT,'workflow_history_context'); END;
CREATE TABLE document_correction (
 "id" INTEGER PRIMARY KEY AUTOINCREMENT,
 "document_version_id" INTEGER NOT NULL REFERENCES "document_version"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("document_version_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "event_no" INTEGER NOT NULL CHECK ("event_no" BETWEEN -9007199254740991 AND 9007199254740991),
 "operation_no" TEXT NOT NULL UNIQUE CHECK (length(trim("operation_no"))>0),
 "event_type" TEXT NOT NULL CHECK (length(trim("event_type"))>0) CHECK ("event_type" IN ('归属更正')),
 "event_reason" TEXT NOT NULL CHECK (length(trim("event_reason"))>0),
 "actor_id" INTEGER NOT NULL REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("actor_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0),
 "corrected_document_version_id" INTEGER NOT NULL REFERENCES "document_version"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("corrected_document_version_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "original_confirmed_by" INTEGER REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("original_confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991),
 "original_confirmed_at" TEXT CHECK (length(trim("original_confirmed_at"))>0),
 "original_confirmation_note" TEXT CHECK (length(trim("original_confirmation_note"))>0),
 UNIQUE("document_version_id",event_no),
 CHECK(event_no>0),
 CHECK(document_version_id<>corrected_document_version_id)
) STRICT;
CREATE TRIGGER document_correction_no_update BEFORE UPDATE ON document_correction BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER document_correction_no_delete BEFORE DELETE ON document_correction BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER document_correction_context BEFORE INSERT ON document_correction WHEN (NEW.event_no<>(SELECT coalesce(max(event_no),0)+1 FROM document_correction WHERE document_version_id=NEW.document_version_id)) OR (NOT EXISTS(SELECT 1 FROM document_version a JOIN document_version b ON b.id=NEW.corrected_document_version_id WHERE a.id=NEW.document_version_id AND a.sha256=b.sha256 AND a.size_bytes=b.size_bytes AND a.media_type=b.media_type AND a.status='退回核对')) BEGIN SELECT RAISE(ABORT,'workflow_history_context'); END;
CREATE TABLE prescription_review_history (
 "id" INTEGER PRIMARY KEY AUTOINCREMENT,
 "prescription_id" INTEGER NOT NULL REFERENCES "prescription"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("prescription_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "event_no" INTEGER NOT NULL CHECK ("event_no" BETWEEN -9007199254740991 AND 9007199254740991),
 "operation_no" TEXT NOT NULL UNIQUE CHECK (length(trim("operation_no"))>0),
 "event_type" TEXT NOT NULL CHECK (length(trim("event_type"))>0) CHECK ("event_type" IN ('审方')),
 "event_reason" TEXT NOT NULL CHECK (length(trim("event_reason"))>0),
 "actor_id" INTEGER NOT NULL REFERENCES "staff"(id) ON DELETE RESTRICT ON UPDATE RESTRICT CHECK ("actor_id" BETWEEN -9007199254740991 AND 9007199254740991),
 "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0),
 "review_status" TEXT NOT NULL CHECK (length(trim("review_status"))>0) CHECK ("review_status" IN ('院内待审','已通过','待医师处理','院外取药')),
 "review_note" TEXT CHECK (length(trim("review_note"))>0),
 UNIQUE("prescription_id",event_no),
 CHECK(event_no>0),
 CHECK(review_status IN ('已通过','待医师处理') AND review_note IS NOT NULL)
) STRICT;
CREATE TRIGGER prescription_review_history_no_update BEFORE UPDATE ON prescription_review_history BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER prescription_review_history_no_delete BEFORE DELETE ON prescription_review_history BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
CREATE TRIGGER prescription_review_history_context BEFORE INSERT ON prescription_review_history WHEN (NEW.event_no<>(SELECT coalesce(max(event_no),0)+1 FROM prescription_review_history WHERE prescription_id=NEW.prescription_id)) OR (NEW."review_status" IS NOT (SELECT "review_status" FROM prescription WHERE id=NEW.prescription_id)) OR (NEW."review_note" IS NOT (SELECT "review_note" FROM prescription WHERE id=NEW.prescription_id)) BEGIN SELECT RAISE(ABORT,'workflow_history_context'); END;
DROP TRIGGER tr_document_version_state_transition_update;
CREATE TRIGGER tr_document_version_state_transition_update BEFORE UPDATE ON document_version WHEN NEW.status<>OLD.status AND NOT ((OLD.status='原件待确认' AND NEW.status IN ('原件已确认','退回核对')) OR (OLD.status='原件已确认' AND NEW.status='缺失或不可读') OR (OLD.status='缺失或不可读' AND NEW.status='原件已确认') OR (OLD.status='原件已确认' AND NEW.status='退回核对' AND EXISTS(SELECT 1 FROM document_version v WHERE v.id<>OLD.id AND v.clinical_document_id<>OLD.clinical_document_id AND v.sha256=OLD.sha256 AND v.size_bytes=OLD.size_bytes AND v.media_type=OLD.media_type AND v.status='原件已确认' AND v.confirmed_by IS NOT NULL))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;
CREATE TRIGGER insurance_fee_original_request BEFORE INSERT ON insurance_fee WHEN NEW.preestimate_request_id IS NULL OR NOT EXISTS(SELECT 1 FROM insurance_preestimate_history r JOIN bill_item i ON i.id=NEW.bill_item_id WHERE r.id=NEW.preestimate_request_id AND r.event_type='提交' AND r.insurance_case_id=NEW.insurance_case_id AND i.bill_id=r.bill_id) BEGIN SELECT RAISE(ABORT,'workflow_history_context'); END;
CREATE TRIGGER insurance_settlement_original_request BEFORE INSERT ON insurance_settlement WHEN NEW.preestimate_request_id IS NULL OR NOT EXISTS(SELECT 1 FROM insurance_case c JOIN insurance_preestimate_history r ON r.id=NEW.preestimate_request_id WHERE c.id=NEW.insurance_case_id AND c.current_preestimate_id=r.id AND r.insurance_case_id=c.id AND r.event_type='提交' AND EXISTS(SELECT 1 FROM insurance_preestimate_history h WHERE h.request_id=r.id AND h.event_type='结果' AND h.result_status='成功') AND EXISTS(SELECT 1 FROM insurance_preestimate_history h WHERE h.request_id=r.id AND h.event_type='患者选择' AND h.patient_choice='医保') AND NOT EXISTS(SELECT 1 FROM insurance_preestimate_history h WHERE h.request_id=r.id AND h.event_type='失效')) BEGIN SELECT RAISE(ABORT,'workflow_history_context'); END;
CREATE TRIGGER insurance_settlement_request_frozen BEFORE UPDATE ON insurance_settlement WHEN NEW.preestimate_request_id IS NOT OLD.preestimate_request_id BEGIN SELECT RAISE(ABORT,'workflow_history_frozen'); END;
`;

function upgradeWorkflowHistory(db,filename,backupNeeded=true){
 const version=db.prepare('PRAGMA user_version').get().user_version;if(version===VERSION)return;
 if(version!==2026102302)throw new Error('不支持此数据库版本，未执行业务历史升级');
 if(filename!==':memory:'&&backupNeeded){const folder=path.join(path.dirname(path.resolve(filename)),'backups');fs.mkdirSync(folder,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(folder,'before-workflow-history-'+Date.now()+'-'+crypto.randomUUID()+'.db'));}
 db.exec('BEGIN IMMEDIATE');try{db.exec(SQL);if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('业务历史外键检查未通过');db.exec('PRAGMA user_version='+VERSION+'; COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
module.exports={VERSION,CONFIG,upgradeWorkflowHistory};
