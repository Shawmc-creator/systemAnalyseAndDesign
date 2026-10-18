-- D1 85表空库建表设计 / 2026-10-18

-- 仅用于隔离设计验证；禁止在现有运行库执行；不是迁移脚本。

-- SQLite >= 3.38（STRICT、内置JSON）；连接须开启foreign_keys、recursive_triggers。

-- 时间、授权、集合完整性及外部凭据仍须服务事务门禁，见DDL实施边界.json。

PRAGMA foreign_keys=ON;

PRAGMA recursive_triggers=ON;

PRAGMA busy_timeout=3000;

BEGIN IMMEDIATE;

-- 患者
CREATE TABLE "patient" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "name" TEXT NOT NULL CHECK (length(trim("name"))>0),
  "birth_date" TEXT CHECK ("birth_date" IS NULL OR (length(trim("birth_date"))>0)) CHECK ("birth_date" IS NULL OR (length("birth_date")=10 AND date("birth_date",'+0 days') IS "birth_date")),
  "phone" TEXT CHECK ("phone" IS NULL OR (length(trim("phone"))>0)),
  "phone_owner" TEXT CHECK ("phone_owner" IS NULL OR (length(trim("phone_owner"))>0)),
  "address" TEXT CHECK ("address" IS NULL OR (length(trim("address"))>0)),
  "contact_preference" TEXT CHECK ("contact_preference" IS NULL OR (length(trim("contact_preference"))>0)),
  "contact_unavailable_reason" TEXT CHECK ("contact_unavailable_reason" IS NULL OR (length(trim("contact_unavailable_reason"))>0)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((phone IS NOT NULL AND phone_owner IS NOT NULL) OR (phone IS NULL AND contact_unavailable_reason IS NOT NULL))
) STRICT;

-- 职员
CREATE TABLE "staff" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "name" TEXT NOT NULL CHECK (length(trim("name"))>0),
  "employed_from" TEXT NOT NULL CHECK (length(trim("employed_from"))>0) CHECK (length("employed_from")=10 AND date("employed_from",'+0 days') IS "employed_from"),
  "employed_until" TEXT CHECK ("employed_until" IS NULL OR (length(trim("employed_until"))>0)) CHECK ("employed_until" IS NULL OR (length("employed_until")=10 AND date("employed_until",'+0 days') IS "employed_until")),
  "created_by" INTEGER CHECK ("created_by" IS NULL OR ("created_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("created_by" IS NULL OR ("created_by">0)),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (employed_until IS NULL OR employed_until >= employed_from)
) STRICT;

-- 患者资料变更
CREATE TABLE "patient_change" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_id" INTEGER NOT NULL CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_id">0),
  "old_value" TEXT CHECK ("old_value" IS NULL OR (length(trim("old_value"))>0)),
  "new_value" TEXT CHECK ("new_value" IS NULL OR (length(trim("new_value"))>0)),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0) CHECK (length("occurred_at")=20 AND "occurred_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"occurred_at",'+0 seconds') IS "occurred_at"),
  "field_name" TEXT NOT NULL CHECK (length(trim("field_name"))>0),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (old_value IS NOT new_value)
) STRICT;

-- 代理关系
CREATE TABLE "patient_proxy" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_id" INTEGER NOT NULL CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_id">0),
  "proxy_name" TEXT NOT NULL CHECK (length(trim("proxy_name"))>0),
  "relationship" TEXT NOT NULL CHECK (length(trim("relationship"))>0),
  "scope" TEXT NOT NULL CHECK (length(trim("scope"))>0),
  "valid_from" TEXT NOT NULL CHECK (length(trim("valid_from"))>0) CHECK (length("valid_from")=20 AND "valid_from" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"valid_from",'+0 seconds') IS "valid_from"),
  "valid_until" TEXT CHECK ("valid_until" IS NULL OR (length(trim("valid_until"))>0)) CHECK ("valid_until" IS NULL OR (length("valid_until")=20 AND "valid_until" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"valid_until",'+0 seconds') IS "valid_until")),
  "verification_basis" TEXT NOT NULL CHECK (length(trim("verification_basis"))>0),
  "verified_by" INTEGER NOT NULL CHECK ("verified_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("verified_by">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("verified_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
) STRICT;

-- 接诊交接
CREATE TABLE "clinical_handover" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_id" INTEGER NOT NULL CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_id">0),
  "receiving_dentist_id" INTEGER NOT NULL CHECK ("receiving_dentist_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("receiving_dentist_id">0),
  "handover_by" INTEGER NOT NULL CHECK ("handover_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("handover_by">0),
  "scope" TEXT NOT NULL CHECK (length(trim("scope"))>0),
  "valid_from" TEXT NOT NULL CHECK (length(trim("valid_from"))>0) CHECK (length("valid_from")=20 AND "valid_from" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"valid_from",'+0 seconds') IS "valid_from"),
  "valid_until" TEXT CHECK ("valid_until" IS NULL OR (length(trim("valid_until"))>0)) CHECK ("valid_until" IS NULL OR (length("valid_until")=20 AND "valid_until" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"valid_until",'+0 seconds') IS "valid_until")),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("receiving_dentist_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("handover_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
) STRICT;

-- 诊椅
CREATE TABLE "dental_chair" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "name" TEXT NOT NULL CHECK (length(trim("name"))>0),
  "available_from" TEXT NOT NULL CHECK (length(trim("available_from"))>0) CHECK (length("available_from")=20 AND "available_from" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"available_from",'+0 seconds') IS "available_from"),
  "available_until" TEXT CHECK ("available_until" IS NULL OR (length(trim("available_until"))>0)) CHECK ("available_until" IS NULL OR (length("available_until")=20 AND "available_until" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"available_until",'+0 seconds') IS "available_until")),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (available_until IS NULL OR available_until > available_from)
) STRICT;

-- 日期安排
CREATE TABLE "dated_schedule" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "dentist_id" INTEGER NOT NULL CHECK ("dentist_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("dentist_id">0),
  "dental_chair_id" INTEGER NOT NULL CHECK ("dental_chair_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("dental_chair_id">0),
  "business_date" TEXT NOT NULL CHECK (length(trim("business_date"))>0) CHECK (length("business_date")=10 AND date("business_date",'+0 days') IS "business_date"),
  "starts_at" TEXT NOT NULL CHECK (length(trim("starts_at"))>0) CHECK (length("starts_at")=20 AND "starts_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"starts_at",'+0 seconds') IS "starts_at"),
  "ends_at" TEXT NOT NULL CHECK (length(trim("ends_at"))>0) CHECK (length("ends_at")=20 AND "ends_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"ends_at",'+0 seconds') IS "ends_at"),
  "confirmed_at" TEXT CHECK ("confirmed_at" IS NULL OR (length(trim("confirmed_at"))>0)) CHECK ("confirmed_at" IS NULL OR (length("confirmed_at")=20 AND "confirmed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"confirmed_at",'+0 seconds') IS "confirmed_at")),
  "closure_reason" TEXT CHECK ("closure_reason" IS NULL OR (length(trim("closure_reason"))>0)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "confirmed_by" INTEGER CHECK ("confirmed_by" IS NULL OR ("confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("confirmed_by" IS NULL OR ("confirmed_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('草稿','已确认','已停诊')),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("dentist_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("dental_chair_id") REFERENCES "dental_chair"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("confirmed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (ends_at > starts_at),
  CHECK (NOT (status = '已确认') OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL)),
  CHECK (NOT (status = '已停诊') OR ("closure_reason" IS NOT NULL))
) STRICT;

-- 安排变更
CREATE TABLE "schedule_change" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "dated_schedule_id" INTEGER NOT NULL CHECK ("dated_schedule_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("dated_schedule_id">0),
  "old_business_date" TEXT NOT NULL CHECK (length(trim("old_business_date"))>0) CHECK (length("old_business_date")=10 AND date("old_business_date",'+0 days') IS "old_business_date"),
  "old_starts_at" TEXT NOT NULL CHECK (length(trim("old_starts_at"))>0) CHECK (length("old_starts_at")=20 AND "old_starts_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"old_starts_at",'+0 seconds') IS "old_starts_at"),
  "old_ends_at" TEXT NOT NULL CHECK (length(trim("old_ends_at"))>0) CHECK (length("old_ends_at")=20 AND "old_ends_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"old_ends_at",'+0 seconds') IS "old_ends_at"),
  "new_business_date" TEXT NOT NULL CHECK (length(trim("new_business_date"))>0) CHECK (length("new_business_date")=10 AND date("new_business_date",'+0 days') IS "new_business_date"),
  "new_starts_at" TEXT NOT NULL CHECK (length(trim("new_starts_at"))>0) CHECK (length("new_starts_at")=20 AND "new_starts_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"new_starts_at",'+0 seconds') IS "new_starts_at"),
  "new_ends_at" TEXT NOT NULL CHECK (length(trim("new_ends_at"))>0) CHECK (length("new_ends_at")=20 AND "new_ends_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"new_ends_at",'+0 seconds') IS "new_ends_at"),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0) CHECK (length("occurred_at")=20 AND "occurred_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"occurred_at",'+0 seconds') IS "occurred_at"),
  "change_kind" TEXT NOT NULL CHECK (length(trim("change_kind"))>0) CHECK ("change_kind" IN ('调整','停诊')),
  "affected_handling" TEXT NOT NULL CHECK (length(trim("affected_handling"))>0),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "old_dentist_id" INTEGER NOT NULL CHECK ("old_dentist_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("old_dentist_id">0),
  "new_dentist_id" INTEGER NOT NULL CHECK ("new_dentist_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("new_dentist_id">0),
  "old_chair_id" INTEGER NOT NULL CHECK ("old_chair_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("old_chair_id">0),
  "new_chair_id" INTEGER NOT NULL CHECK ("new_chair_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("new_chair_id">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("dated_schedule_id") REFERENCES "dated_schedule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("old_dentist_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("new_dentist_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("old_chair_id") REFERENCES "dental_chair"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("new_chair_id") REFERENCES "dental_chair"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 接诊占用
CREATE TABLE "resource_occupancy" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "dated_schedule_id" INTEGER NOT NULL CHECK ("dated_schedule_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("dated_schedule_id">0),
  "appointment_id" INTEGER CHECK ("appointment_id" IS NULL OR ("appointment_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("appointment_id" IS NULL OR ("appointment_id">0)),
  "visit_id" INTEGER CHECK ("visit_id" IS NULL OR ("visit_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("visit_id" IS NULL OR ("visit_id">0)),
  "starts_at" TEXT NOT NULL CHECK (length(trim("starts_at"))>0) CHECK (length("starts_at")=20 AND "starts_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"starts_at",'+0 seconds') IS "starts_at"),
  "ends_at" TEXT NOT NULL CHECK (length(trim("ends_at"))>0) CHECK (length("ends_at")=20 AND "ends_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"ends_at",'+0 seconds') IS "ends_at"),
  "released_at" TEXT CHECK ("released_at" IS NULL OR (length(trim("released_at"))>0)) CHECK ("released_at" IS NULL OR (length("released_at")=20 AND "released_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"released_at",'+0 seconds') IS "released_at")),
  "arrangement_revision" INTEGER NOT NULL CHECK ("arrangement_revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("arrangement_revision">0),
  "release_reason" TEXT CHECK ("release_reason" IS NULL OR (length(trim("release_reason"))>0)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "released_by" INTEGER CHECK ("released_by" IS NULL OR ("released_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("released_by" IS NULL OR ("released_by">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("dated_schedule_id") REFERENCES "dated_schedule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("released_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("visit_id","appointment_id") REFERENCES "visit"("id","appointment_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((appointment_id IS NOT NULL OR visit_id IS NOT NULL) AND ends_at > starts_at),
  CHECK ((released_at IS NULL AND released_by IS NULL AND release_reason IS NULL) OR (released_at IS NOT NULL AND released_by IS NOT NULL AND release_reason IS NOT NULL))
) STRICT;

-- 预约
CREATE TABLE "appointment" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_id" INTEGER NOT NULL CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_id">0),
  "planned_start" TEXT NOT NULL CHECK (length(trim("planned_start"))>0) CHECK (length("planned_start")=20 AND "planned_start" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"planned_start",'+0 seconds') IS "planned_start"),
  "planned_end" TEXT NOT NULL CHECK (length(trim("planned_end"))>0) CHECK (length("planned_end")=20 AND "planned_end" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"planned_end",'+0 seconds') IS "planned_end"),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "due_at" TEXT NOT NULL CHECK (length(trim("due_at"))>0) CHECK (length("due_at")=20 AND "due_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"due_at",'+0 seconds') IS "due_at"),
  "arrangement_revision" INTEGER NOT NULL CHECK ("arrangement_revision" BETWEEN -9007199254740991 AND 9007199254740991),
  "status_reason" TEXT CHECK ("status_reason" IS NULL OR (length(trim("status_reason"))>0)),
  "notified_at" TEXT CHECK ("notified_at" IS NULL OR (length(trim("notified_at"))>0)) CHECK ("notified_at" IS NULL OR (length("notified_at")=20 AND "notified_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"notified_at",'+0 seconds') IS "notified_at")),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "notified_by" INTEGER CHECK ("notified_by" IS NULL OR ("notified_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("notified_by" IS NULL OR ("notified_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('已预约','已取消','已到诊','未到')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  UNIQUE ("id","patient_id"),
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("notified_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (planned_end > planned_start),
  CHECK (NOT (status IN ('已取消','未到')) OR ("status_reason" IS NOT NULL)),
  CHECK (("notified_at" IS NULL) = ("notified_by" IS NULL))
) STRICT;

-- 预约变更
CREATE TABLE "appointment_change" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "appointment_id" INTEGER NOT NULL CHECK ("appointment_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("appointment_id">0),
  "old_start" TEXT NOT NULL CHECK (length(trim("old_start"))>0) CHECK (length("old_start")=20 AND "old_start" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"old_start",'+0 seconds') IS "old_start"),
  "old_end" TEXT NOT NULL CHECK (length(trim("old_end"))>0) CHECK (length("old_end")=20 AND "old_end" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"old_end",'+0 seconds') IS "old_end"),
  "old_revision" INTEGER NOT NULL CHECK ("old_revision" BETWEEN -9007199254740991 AND 9007199254740991),
  "new_start" TEXT CHECK ("new_start" IS NULL OR (length(trim("new_start"))>0)) CHECK ("new_start" IS NULL OR (length("new_start")=20 AND "new_start" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"new_start",'+0 seconds') IS "new_start")),
  "new_end" TEXT CHECK ("new_end" IS NULL OR (length(trim("new_end"))>0)) CHECK ("new_end" IS NULL OR (length("new_end")=20 AND "new_end" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"new_end",'+0 seconds') IS "new_end")),
  "new_revision" INTEGER NOT NULL CHECK ("new_revision" BETWEEN -9007199254740991 AND 9007199254740991),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0) CHECK (length("occurred_at")=20 AND "occurred_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"occurred_at",'+0 seconds') IS "occurred_at"),
  "change_kind" TEXT NOT NULL CHECK (length(trim("change_kind"))>0) CHECK ("change_kind" IN ('改约','取消','通知')),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "old_schedule_id" INTEGER NOT NULL CHECK ("old_schedule_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("old_schedule_id">0),
  "new_schedule_id" INTEGER CHECK ("new_schedule_id" IS NULL OR ("new_schedule_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("new_schedule_id" IS NULL OR ("new_schedule_id">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("old_schedule_id") REFERENCES "dated_schedule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("new_schedule_id") REFERENCES "dated_schedule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (("new_start" IS NULL) = ("new_end" IS NULL)),
  CHECK (new_end IS NULL OR new_end > new_start)
) STRICT;

-- 就诊
CREATE TABLE "visit" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_id" INTEGER NOT NULL CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_id">0),
  "appointment_id" INTEGER CHECK ("appointment_id" IS NULL OR ("appointment_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("appointment_id" IS NULL OR ("appointment_id">0)),
  "dentist_id" INTEGER NOT NULL CHECK ("dentist_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("dentist_id">0),
  "arrived_at" TEXT NOT NULL CHECK (length(trim("arrived_at"))>0) CHECK (length("arrived_at")=20 AND "arrived_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"arrived_at",'+0 seconds') IS "arrived_at"),
  "started_at" TEXT CHECK ("started_at" IS NULL OR (length(trim("started_at"))>0)) CHECK ("started_at" IS NULL OR (length("started_at")=20 AND "started_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"started_at",'+0 seconds') IS "started_at")),
  "ended_at" TEXT CHECK ("ended_at" IS NULL OR (length(trim("ended_at"))>0)) CHECK ("ended_at" IS NULL OR (length("ended_at")=20 AND "ended_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"ended_at",'+0 seconds') IS "ended_at")),
  "arrival_source" TEXT NOT NULL CHECK (length(trim("arrival_source"))>0) CHECK ("arrival_source" IN ('预约','现场')),
  "registered_by" INTEGER NOT NULL CHECK ("registered_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("registered_by">0),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('候诊','接诊中','诊疗结束')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("appointment_id"),
  UNIQUE ("record_no"),
  UNIQUE ("id","appointment_id"),
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("dentist_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("registered_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("appointment_id","patient_id") REFERENCES "appointment"("id","patient_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((started_at IS NULL OR started_at >= arrived_at) AND (ended_at IS NULL OR (started_at IS NOT NULL AND ended_at >= started_at))),
  CHECK ((arrival_source = '预约') = (appointment_id IS NOT NULL)),
  CHECK (NOT (status IN ('接诊中','诊疗结束')) OR ("started_at" IS NOT NULL)),
  CHECK (NOT (status = '诊疗结束') OR ("ended_at" IS NOT NULL))
) STRICT;

-- 健康版本
CREATE TABLE "health_version" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_id" INTEGER NOT NULL CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_id">0),
  "formed_at" TEXT NOT NULL CHECK (length(trim("formed_at"))>0) CHECK (length("formed_at")=20 AND "formed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"formed_at",'+0 seconds') IS "formed_at"),
  "change_reason" TEXT NOT NULL CHECK (length(trim("change_reason"))>0),
  "version_no" INTEGER NOT NULL CHECK ("version_no" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("version_no">0),
  "effective_at" TEXT NOT NULL CHECK (length(trim("effective_at"))>0) CHECK (length("effective_at")=20 AND "effective_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"effective_at",'+0 seconds') IS "effective_at"),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "previous_version_id" INTEGER CHECK ("previous_version_id" IS NULL OR ("previous_version_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("previous_version_id" IS NULL OR ("previous_version_id">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("patient_id","version_no"),
  UNIQUE ("id","patient_id"),
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("previous_version_id") REFERENCES "health_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("previous_version_id","patient_id") REFERENCES "health_version"("id","patient_id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 健康条目
CREATE TABLE "health_item" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "health_version_id" INTEGER NOT NULL CHECK ("health_version_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("health_version_id">0),
  "category" TEXT NOT NULL CHECK (length(trim("category"))>0) CHECK ("category" IN ('病史','过敏','用药')),
  "content" TEXT NOT NULL CHECK (length(trim("content"))>0),
  "certainty" TEXT NOT NULL CHECK (length(trim("certainty"))>0) CHECK ("certainty" IN ('有','无','未知')),
  "reported_at" TEXT NOT NULL CHECK (length(trim("reported_at"))>0) CHECK (length("reported_at")=20 AND "reported_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"reported_at",'+0 seconds') IS "reported_at"),
  "source" TEXT NOT NULL CHECK (length(trim("source"))>0),
  "occurred_at" TEXT CHECK ("occurred_at" IS NULL OR (length(trim("occurred_at"))>0)) CHECK ("occurred_at" IS NULL OR (length("occurred_at")=20 AND "occurred_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"occurred_at",'+0 seconds') IS "occurred_at")),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("health_version_id") REFERENCES "health_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 健康复核
CREATE TABLE "health_review" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "visit_id" INTEGER NOT NULL CHECK ("visit_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("visit_id">0),
  "health_version_id" INTEGER NOT NULL CHECK ("health_version_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("health_version_id">0),
  "reviewed_at" TEXT NOT NULL CHECK (length(trim("reviewed_at"))>0) CHECK (length("reviewed_at")=20 AND "reviewed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"reviewed_at",'+0 seconds') IS "reviewed_at"),
  "conclusion" TEXT NOT NULL CHECK (length(trim("conclusion"))>0),
  "reviewed_by" INTEGER NOT NULL CHECK ("reviewed_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("reviewed_by">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("health_version_id") REFERENCES "health_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("reviewed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 病历
CREATE TABLE "clinical_record" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "visit_id" INTEGER NOT NULL CHECK ("visit_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("visit_id">0),
  "chief_complaint" TEXT CHECK ("chief_complaint" IS NULL OR (length(trim("chief_complaint"))>0)),
  "diagnosis" TEXT CHECK ("diagnosis" IS NULL OR (length(trim("diagnosis"))>0)),
  "treatment_advice" TEXT CHECK ("treatment_advice" IS NULL OR (length(trim("treatment_advice"))>0)),
  "signed_at" TEXT CHECK ("signed_at" IS NULL OR (length(trim("signed_at"))>0)) CHECK ("signed_at" IS NULL OR (length("signed_at")=20 AND "signed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"signed_at",'+0 seconds') IS "signed_at")),
  "signed_revision" INTEGER CHECK ("signed_revision" IS NULL OR ("signed_revision" BETWEEN -9007199254740991 AND 9007199254740991)),
  "content_hash" TEXT CHECK ("content_hash" IS NULL OR (length(trim("content_hash"))>0)) CHECK ("content_hash" IS NULL OR (length("content_hash")=64 AND "content_hash" NOT GLOB '*[^0-9a-f]*')),
  "signed_by" INTEGER CHECK ("signed_by" IS NULL OR ("signed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("signed_by" IS NULL OR ("signed_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('草稿','已签署')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("visit_id"),
  UNIQUE ("record_no"),
  FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("signed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status = '已签署') OR ("chief_complaint" IS NOT NULL AND "diagnosis" IS NOT NULL AND "treatment_advice" IS NOT NULL AND "signed_at" IS NOT NULL AND "signed_by" IS NOT NULL AND "signed_revision" IS NOT NULL AND "content_hash" IS NOT NULL))
) STRICT;

-- 检查所见
CREATE TABLE "clinical_finding" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "clinical_record_id" INTEGER NOT NULL CHECK ("clinical_record_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("clinical_record_id">0),
  "tooth_code" TEXT CHECK ("tooth_code" IS NULL OR (length(trim("tooth_code"))>0)),
  "surface_code" TEXT CHECK ("surface_code" IS NULL OR (length(trim("surface_code"))>0)),
  "finding_text" TEXT NOT NULL CHECK (length(trim("finding_text"))>0),
  "sequence_no" INTEGER NOT NULL CHECK ("sequence_no" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("sequence_no">0),
  "recorded_by" INTEGER NOT NULL CHECK ("recorded_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("recorded_by">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("clinical_record_id","sequence_no"),
  FOREIGN KEY ("clinical_record_id") REFERENCES "clinical_record"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (surface_code IS NULL OR tooth_code IS NOT NULL)
) STRICT;

-- 病历补充
CREATE TABLE "record_addendum" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "clinical_record_id" INTEGER NOT NULL CHECK ("clinical_record_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("clinical_record_id">0),
  "content" TEXT NOT NULL CHECK (length(trim("content"))>0),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "added_at" TEXT NOT NULL CHECK (length(trim("added_at"))>0) CHECK (length("added_at")=20 AND "added_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"added_at",'+0 seconds') IS "added_at"),
  "content_hash" TEXT NOT NULL CHECK (length(trim("content_hash"))>0) CHECK (length("content_hash")=64 AND "content_hash" NOT GLOB '*[^0-9a-f]*'),
  "signed_by" INTEGER NOT NULL CHECK ("signed_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("signed_by">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("clinical_record_id") REFERENCES "clinical_record"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("signed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 诊疗文件
CREATE TABLE "clinical_document" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_id" INTEGER NOT NULL CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_id">0),
  "visit_id" INTEGER CHECK ("visit_id" IS NULL OR ("visit_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("visit_id" IS NULL OR ("visit_id">0)),
  "plan_version_id" INTEGER CHECK ("plan_version_id" IS NULL OR ("plan_version_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("plan_version_id" IS NULL OR ("plan_version_id">0)),
  "document_type" TEXT NOT NULL CHECK (length(trim("document_type"))>0) CHECK ("document_type" IN ('影像','同意文书','诊疗附件')),
  "source" TEXT NOT NULL CHECK (length(trim("source"))>0),
  "ownership_note" TEXT NOT NULL CHECK (length(trim("ownership_note"))>0),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("plan_version_id") REFERENCES "plan_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 文件版本
CREATE TABLE "document_version" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "clinical_document_id" INTEGER NOT NULL CHECK ("clinical_document_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("clinical_document_id">0),
  "original_name" TEXT NOT NULL CHECK (length(trim("original_name"))>0),
  "size_bytes" INTEGER NOT NULL CHECK ("size_bytes" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("size_bytes">0),
  "sha256" TEXT NOT NULL CHECK (length(trim("sha256"))>0) CHECK (length("sha256")=64 AND "sha256" NOT GLOB '*[^0-9a-f]*'),
  "captured_at" TEXT CHECK ("captured_at" IS NULL OR (length(trim("captured_at"))>0)) CHECK ("captured_at" IS NULL OR (length("captured_at")=20 AND "captured_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"captured_at",'+0 seconds') IS "captured_at")),
  "confirmed_at" TEXT CHECK ("confirmed_at" IS NULL OR (length(trim("confirmed_at"))>0)) CHECK ("confirmed_at" IS NULL OR (length("confirmed_at")=20 AND "confirmed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"confirmed_at",'+0 seconds') IS "confirmed_at")),
  "change_reason" TEXT NOT NULL CHECK (length(trim("change_reason"))>0),
  "version_no" INTEGER NOT NULL CHECK ("version_no" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("version_no">0),
  "storage_key" TEXT NOT NULL CHECK (length(trim("storage_key"))>0),
  "media_type" TEXT NOT NULL CHECK (length(trim("media_type"))>0),
  "verification_note" TEXT CHECK ("verification_note" IS NULL OR (length(trim("verification_note"))>0)),
  "uploaded_by" INTEGER NOT NULL CHECK ("uploaded_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("uploaded_by">0),
  "confirmed_by" INTEGER CHECK ("confirmed_by" IS NULL OR ("confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("confirmed_by" IS NULL OR ("confirmed_by">0)),
  "previous_version_id" INTEGER CHECK ("previous_version_id" IS NULL OR ("previous_version_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("previous_version_id" IS NULL OR ("previous_version_id">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('原件待确认','原件已确认','退回核对','缺失或不可读')),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("clinical_document_id","version_no"),
  UNIQUE ("storage_key"),
  UNIQUE ("id","clinical_document_id"),
  FOREIGN KEY ("clinical_document_id") REFERENCES "clinical_document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("uploaded_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("confirmed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("previous_version_id") REFERENCES "document_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("previous_version_id","clinical_document_id") REFERENCES "document_version"("id","clinical_document_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status = '原件已确认') OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL)),
  CHECK (size_bytes>0)
) STRICT;

-- 治疗方案
CREATE TABLE "treatment_plan" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_id" INTEGER NOT NULL CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_id">0),
  "goal" TEXT NOT NULL CHECK (length(trim("goal"))>0),
  "established_at" TEXT NOT NULL CHECK (length(trim("established_at"))>0) CHECK (length("established_at")=20 AND "established_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"established_at",'+0 seconds') IS "established_at"),
  "termination_reason" TEXT CHECK ("termination_reason" IS NULL OR (length(trim("termination_reason"))>0)),
  "closed_at" TEXT CHECK ("closed_at" IS NULL OR (length(trim("closed_at"))>0)) CHECK ("closed_at" IS NULL OR (length("closed_at")=20 AND "closed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"closed_at",'+0 seconds') IS "closed_at")),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "closed_by" INTEGER CHECK ("closed_by" IS NULL OR ("closed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("closed_by" IS NULL OR ("closed_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('进行中','已完成','已终止')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("closed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (("closed_at" IS NULL) = ("closed_by" IS NULL)),
  CHECK (NOT (status IN ('已完成','已终止')) OR ("closed_at" IS NOT NULL AND "closed_by" IS NOT NULL)),
  CHECK (NOT (status = '已终止') OR ("termination_reason" IS NOT NULL))
) STRICT;

-- 方案版本
CREATE TABLE "plan_version" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "treatment_plan_id" INTEGER NOT NULL CHECK ("treatment_plan_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("treatment_plan_id">0),
  "source_visit_id" INTEGER CHECK ("source_visit_id" IS NULL OR ("source_visit_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("source_visit_id" IS NULL OR ("source_visit_id">0)),
  "diagnostic_basis" TEXT NOT NULL CHECK (length(trim("diagnostic_basis"))>0),
  "explained_at" TEXT CHECK ("explained_at" IS NULL OR (length(trim("explained_at"))>0)) CHECK ("explained_at" IS NULL OR (length("explained_at")=20 AND "explained_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"explained_at",'+0 seconds') IS "explained_at")),
  "change_reason" TEXT NOT NULL CHECK (length(trim("change_reason"))>0),
  "planned_schedule" TEXT NOT NULL CHECK (length(trim("planned_schedule"))>0),
  "version_no" INTEGER NOT NULL CHECK ("version_no" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("version_no">0),
  "stopped_at" TEXT CHECK ("stopped_at" IS NULL OR (length(trim("stopped_at"))>0)) CHECK ("stopped_at" IS NULL OR (length("stopped_at")=20 AND "stopped_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"stopped_at",'+0 seconds') IS "stopped_at")),
  "stop_reason" TEXT CHECK ("stop_reason" IS NULL OR (length(trim("stop_reason"))>0)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "explained_by" INTEGER CHECK ("explained_by" IS NULL OR ("explained_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("explained_by" IS NULL OR ("explained_by">0)),
  "previous_version_id" INTEGER CHECK ("previous_version_id" IS NULL OR ("previous_version_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("previous_version_id" IS NULL OR ("previous_version_id">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('草稿','待确认','已确认','暂缓','已拒绝','停止后续执行','本版执行完成')),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("treatment_plan_id","version_no"),
  UNIQUE ("id","treatment_plan_id"),
  FOREIGN KEY ("treatment_plan_id") REFERENCES "treatment_plan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("source_visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("explained_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("previous_version_id") REFERENCES "plan_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("previous_version_id","treatment_plan_id") REFERENCES "plan_version"("id","treatment_plan_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (("explained_at" IS NULL) = ("explained_by" IS NULL)),
  CHECK (NOT (status = '停止后续执行') OR ("stopped_at" IS NOT NULL AND "stop_reason" IS NOT NULL))
) STRICT;

-- 方案项目
CREATE TABLE "plan_item" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "plan_version_id" INTEGER NOT NULL CHECK ("plan_version_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("plan_version_id">0),
  "item_description" TEXT NOT NULL CHECK (length(trim("item_description"))>0),
  "tooth_code" TEXT CHECK ("tooth_code" IS NULL OR (length(trim("tooth_code"))>0)),
  "surface_code" TEXT CHECK ("surface_code" IS NULL OR (length(trim("surface_code"))>0)),
  "planned_quantity" INTEGER NOT NULL CHECK ("planned_quantity" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("planned_quantity">0),
  "sequence_no" INTEGER NOT NULL CHECK ("sequence_no" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("sequence_no">0),
  "estimated_cents" INTEGER CHECK ("estimated_cents" IS NULL OR ("estimated_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("plan_version_id","sequence_no"),
  FOREIGN KEY ("plan_version_id") REFERENCES "plan_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (surface_code IS NULL OR tooth_code IS NOT NULL),
  CHECK (planned_quantity>0)
) STRICT;

-- 患者决定
CREATE TABLE "patient_decision" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "plan_version_id" INTEGER NOT NULL CHECK ("plan_version_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("plan_version_id">0),
  "patient_proxy_id" INTEGER CHECK ("patient_proxy_id" IS NULL OR ("patient_proxy_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("patient_proxy_id" IS NULL OR ("patient_proxy_id">0)),
  "decision" TEXT NOT NULL CHECK (length(trim("decision"))>0) CHECK ("decision" IN ('同意','暂缓','拒绝','撤回')),
  "decided_at" TEXT NOT NULL CHECK (length(trim("decided_at"))>0) CHECK (length("decided_at")=20 AND "decided_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"decided_at",'+0 seconds') IS "decided_at"),
  "explanation_basis" TEXT NOT NULL CHECK (length(trim("explanation_basis"))>0),
  "scope_note" TEXT NOT NULL CHECK (length(trim("scope_note"))>0),
  "explained_by" INTEGER NOT NULL CHECK ("explained_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("explained_by">0),
  "recorded_by" INTEGER NOT NULL CHECK ("recorded_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("recorded_by">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("plan_version_id") REFERENCES "plan_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("patient_proxy_id") REFERENCES "patient_proxy"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("explained_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 诊疗执行
CREATE TABLE "treatment_execution" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "visit_id" INTEGER NOT NULL CHECK ("visit_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("visit_id">0),
  "plan_item_id" INTEGER CHECK ("plan_item_id" IS NULL OR ("plan_item_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("plan_item_id" IS NULL OR ("plan_item_id">0)),
  "service_id" INTEGER NOT NULL CHECK ("service_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("service_id">0),
  "original_execution_id" INTEGER CHECK ("original_execution_id" IS NULL OR ("original_execution_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("original_execution_id" IS NULL OR ("original_execution_id">0)),
  "tooth_code" TEXT CHECK ("tooth_code" IS NULL OR (length(trim("tooth_code"))>0)),
  "surface_code" TEXT CHECK ("surface_code" IS NULL OR (length(trim("surface_code"))>0)),
  "completed_quantity" INTEGER NOT NULL CHECK ("completed_quantity" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("completed_quantity">0),
  "procedure_note" TEXT NOT NULL CHECK (length(trim("procedure_note"))>0),
  "completed_at" TEXT NOT NULL CHECK (length(trim("completed_at"))>0) CHECK (length("completed_at")=20 AND "completed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"completed_at",'+0 seconds') IS "completed_at"),
  "correction_reason" TEXT CHECK ("correction_reason" IS NULL OR (length(trim("correction_reason"))>0)),
  "execution_kind" TEXT NOT NULL CHECK (length(trim("execution_kind"))>0) CHECK ("execution_kind" IN ('首次记录','更正记录')),
  "performed_by" INTEGER NOT NULL CHECK ("performed_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("performed_by">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("plan_item_id") REFERENCES "plan_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("original_execution_id") REFERENCES "treatment_execution"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("performed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (surface_code IS NULL OR tooth_code IS NOT NULL),
  CHECK ((execution_kind='首次记录' AND original_execution_id IS NULL) OR (execution_kind='更正记录' AND original_execution_id IS NOT NULL AND correction_reason IS NOT NULL)),
  CHECK (completed_quantity>0)
) STRICT;

-- 收费项目
CREATE TABLE "service" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "name" TEXT NOT NULL CHECK (length(trim("name"))>0),
  "billing_unit" TEXT NOT NULL CHECK (length(trim("billing_unit"))>0),
  "is_active" INTEGER NOT NULL CHECK ("is_active" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("is_active" IN (0,1)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 价目
CREATE TABLE "service_price" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "service_id" INTEGER NOT NULL CHECK ("service_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("service_id">0),
  "unit_price_cents" INTEGER NOT NULL CHECK ("unit_price_cents" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("unit_price_cents">=0),
  "valid_from" TEXT NOT NULL CHECK (length(trim("valid_from"))>0) CHECK (length("valid_from")=20 AND "valid_from" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"valid_from",'+0 seconds') IS "valid_from"),
  "valid_until" TEXT CHECK ("valid_until" IS NULL OR (length(trim("valid_until"))>0)) CHECK ("valid_until" IS NULL OR (length("valid_until")=20 AND "valid_until" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"valid_until",'+0 seconds') IS "valid_until")),
  "change_reason" TEXT NOT NULL CHECK (length(trim("change_reason"))>0),
  "confirmed_at" TEXT CHECK ("confirmed_at" IS NULL OR (length(trim("confirmed_at"))>0)) CHECK ("confirmed_at" IS NULL OR (length("confirmed_at")=20 AND "confirmed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"confirmed_at",'+0 seconds') IS "confirmed_at")),
  "review_note" TEXT CHECK ("review_note" IS NULL OR (length(trim("review_note"))>0)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "confirmed_by" INTEGER CHECK ("confirmed_by" IS NULL OR ("confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("confirmed_by" IS NULL OR ("confirmed_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('价目草稿','待负责人确认','已确认可适用','已退回','不再用于新计费')),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("confirmed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (NOT (status = '已确认可适用') OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL))
) STRICT;

-- 应收账目
CREATE TABLE "bill" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_id" INTEGER NOT NULL CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_id">0),
  "patient_funds_id" INTEGER NOT NULL CHECK ("patient_funds_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_funds_id">0),
  "formed_at" TEXT NOT NULL CHECK (length(trim("formed_at"))>0) CHECK (length("formed_at")=20 AND "formed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"formed_at",'+0 seconds') IS "formed_at"),
  "period_start" TEXT NOT NULL CHECK (length(trim("period_start"))>0) CHECK (length("period_start")=20 AND "period_start" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"period_start",'+0 seconds') IS "period_start"),
  "period_end" TEXT NOT NULL CHECK (length(trim("period_end"))>0) CHECK (length("period_end")=20 AND "period_end" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"period_end",'+0 seconds') IS "period_end"),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  UNIQUE ("id","patient_funds_id"),
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("patient_funds_id") REFERENCES "patient_funds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("patient_funds_id","patient_id") REFERENCES "patient_funds"("id","patient_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (period_end > period_start)
) STRICT;

-- 应收项目
CREATE TABLE "bill_item" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "bill_id" INTEGER NOT NULL CHECK ("bill_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("bill_id">0),
  "treatment_execution_id" INTEGER NOT NULL CHECK ("treatment_execution_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("treatment_execution_id">0),
  "service_price_id" INTEGER CHECK ("service_price_id" IS NULL OR ("service_price_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("service_price_id" IS NULL OR ("service_price_id">0)),
  "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("quantity">0),
  "unit_price_cents" INTEGER CHECK ("unit_price_cents" IS NULL OR ("unit_price_cents" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("unit_price_cents" IS NULL OR ("unit_price_cents">=0)),
  "priced_at" TEXT NOT NULL CHECK (length(trim("priced_at"))>0) CHECK (length("priced_at")=20 AND "priced_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"priced_at",'+0 seconds') IS "priced_at"),
  "pricing_note" TEXT CHECK ("pricing_note" IS NULL OR (length(trim("pricing_note"))>0)),
  "pricing_status" TEXT NOT NULL CHECK (length(trim("pricing_status"))>0) CHECK ("pricing_status" IN ('待核价','已核价')),
  "priced_by" INTEGER CHECK ("priced_by" IS NULL OR ("priced_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("priced_by" IS NULL OR ("priced_by">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("treatment_execution_id"),
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("treatment_execution_id") REFERENCES "treatment_execution"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("service_price_id") REFERENCES "service_price"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("priced_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (pricing_status='已核价') OR ("unit_price_cents" IS NOT NULL AND "priced_by" IS NOT NULL AND "pricing_note" IS NOT NULL)),
  CHECK (quantity>0),
  CHECK (unit_price_cents IS NULL OR unit_price_cents<=9007199254740991/quantity)
) STRICT;

-- 患者资金
CREATE TABLE "patient_funds" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_id" INTEGER NOT NULL CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_id">0),
  "opened_at" TEXT NOT NULL CHECK (length(trim("opened_at"))>0) CHECK (length("opened_at")=20 AND "opened_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"opened_at",'+0 seconds') IS "opened_at"),
  "opened_by" INTEGER NOT NULL CHECK ("opened_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("opened_by">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("patient_id"),
  UNIQUE ("id","patient_id"),
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("opened_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 患者付款
CREATE TABLE "patient_payment" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_funds_id" INTEGER NOT NULL CHECK ("patient_funds_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_funds_id">0),
  "net_cents" INTEGER GENERATED ALWAYS AS (received_cents - change_cents) STORED NOT NULL CHECK ("net_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "received_cents" INTEGER NOT NULL CHECK ("received_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "change_cents" INTEGER NOT NULL CHECK ("change_cents" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("change_cents">=0),
  "channel" TEXT NOT NULL CHECK (length(trim("channel"))>0) CHECK ("channel" IN ('现金','银行卡','微信','支付宝')),
  "received_at" TEXT CHECK ("received_at" IS NULL OR (length(trim("received_at"))>0)) CHECK ("received_at" IS NULL OR (length("received_at")=20 AND "received_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"received_at",'+0 seconds') IS "received_at")),
  "transaction_evidence" TEXT NOT NULL CHECK (length(trim("transaction_evidence"))>0),
  "external_reference" TEXT CHECK ("external_reference" IS NULL OR (length(trim("external_reference"))>0)),
  "verified_at" TEXT CHECK ("verified_at" IS NULL OR (length(trim("verified_at"))>0)) CHECK ("verified_at" IS NULL OR (length("verified_at")=20 AND "verified_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"verified_at",'+0 seconds') IS "verified_at")),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "verified_by" INTEGER CHECK ("verified_by" IS NULL OR ("verified_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("verified_by" IS NULL OR ("verified_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待核实','到账已确认','未到账已核实')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  UNIQUE ("id","patient_funds_id"),
  FOREIGN KEY ("patient_funds_id") REFERENCES "patient_funds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("verified_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (received_cents > 0 AND change_cents >= 0 AND change_cents < received_cents),
  CHECK (channel='现金' OR change_cents=0),
  CHECK (NOT (status <> '待核实') OR ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL)),
  CHECK (NOT (status = '到账已确认') OR ("received_at" IS NOT NULL)),
  CHECK (NOT (status = '到账已确认' AND channel <> '现金') OR ("external_reference" IS NOT NULL))
) STRICT;

-- 付款分配
CREATE TABLE "payment_allocation" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_payment_id" INTEGER NOT NULL CHECK ("patient_payment_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_payment_id">0),
  "bill_id" INTEGER NOT NULL CHECK ("bill_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("bill_id">0),
  "amount_cents" INTEGER NOT NULL CHECK ("amount_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "effective_at" TEXT NOT NULL CHECK (length(trim("effective_at"))>0) CHECK (length("effective_at")=20 AND "effective_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"effective_at",'+0 seconds') IS "effective_at"),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "original_allocation_id" INTEGER CHECK ("original_allocation_id" IS NULL OR ("original_allocation_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("original_allocation_id" IS NULL OR ("original_allocation_id">0)),
  "fee_request_id" INTEGER CHECK ("fee_request_id" IS NULL OR ("fee_request_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("fee_request_id" IS NULL OR ("fee_request_id">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("id","patient_payment_id","bill_id"),
  FOREIGN KEY ("patient_payment_id") REFERENCES "patient_payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("original_allocation_id") REFERENCES "payment_allocation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("fee_request_id") REFERENCES "fee_request"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("original_allocation_id","patient_payment_id","bill_id") REFERENCES "payment_allocation"("id","patient_payment_id","bill_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((amount_cents > 0 AND original_allocation_id IS NULL) OR (amount_cents < 0 AND original_allocation_id IS NOT NULL AND fee_request_id IS NOT NULL))
) STRICT;

-- 预付抵扣
CREATE TABLE "prepayment_offset" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_payment_id" INTEGER NOT NULL CHECK ("patient_payment_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_payment_id">0),
  "bill_id" INTEGER NOT NULL CHECK ("bill_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("bill_id">0),
  "amount_cents" INTEGER NOT NULL CHECK ("amount_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "effective_at" TEXT NOT NULL CHECK (length(trim("effective_at"))>0) CHECK (length("effective_at")=20 AND "effective_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"effective_at",'+0 seconds') IS "effective_at"),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "original_offset_id" INTEGER CHECK ("original_offset_id" IS NULL OR ("original_offset_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("original_offset_id" IS NULL OR ("original_offset_id">0)),
  "fee_request_id" INTEGER CHECK ("fee_request_id" IS NULL OR ("fee_request_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("fee_request_id" IS NULL OR ("fee_request_id">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("id","patient_payment_id","bill_id"),
  FOREIGN KEY ("patient_payment_id") REFERENCES "patient_payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("original_offset_id") REFERENCES "prepayment_offset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("fee_request_id") REFERENCES "fee_request"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("original_offset_id","patient_payment_id","bill_id") REFERENCES "prepayment_offset"("id","patient_payment_id","bill_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((amount_cents > 0 AND original_offset_id IS NULL) OR (amount_cents < 0 AND original_offset_id IS NOT NULL AND fee_request_id IS NOT NULL))
) STRICT;

-- 费用申请
CREATE TABLE "fee_request" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_funds_id" INTEGER NOT NULL CHECK ("patient_funds_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_funds_id">0),
  "bill_id" INTEGER CHECK ("bill_id" IS NULL OR ("bill_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("bill_id" IS NULL OR ("bill_id">0)),
  "patient_payment_id" INTEGER CHECK ("patient_payment_id" IS NULL OR ("patient_payment_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("patient_payment_id" IS NULL OR ("patient_payment_id">0)),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "proposed_adjustment_cents" INTEGER NOT NULL CHECK ("proposed_adjustment_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "proposed_refund_cents" INTEGER NOT NULL CHECK ("proposed_refund_cents" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("proposed_refund_cents">=0),
  "evidence" TEXT NOT NULL CHECK (length(trim("evidence"))>0),
  "submitted_at" TEXT NOT NULL CHECK (length(trim("submitted_at"))>0) CHECK (length("submitted_at")=20 AND "submitted_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"submitted_at",'+0 seconds') IS "submitted_at"),
  "review_note" TEXT CHECK ("review_note" IS NULL OR (length(trim("review_note"))>0)),
  "submission_no" INTEGER NOT NULL CHECK ("submission_no" BETWEEN -9007199254740991 AND 9007199254740991),
  "approved_adjustment_cents" INTEGER CHECK ("approved_adjustment_cents" IS NULL OR ("approved_adjustment_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
  "approved_refund_cents" INTEGER CHECK ("approved_refund_cents" IS NULL OR ("approved_refund_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
  "reviewed_at" TEXT CHECK ("reviewed_at" IS NULL OR (length(trim("reviewed_at"))>0)) CHECK ("reviewed_at" IS NULL OR (length("reviewed_at")=20 AND "reviewed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"reviewed_at",'+0 seconds') IS "reviewed_at")),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "reviewed_by" INTEGER CHECK ("reviewed_by" IS NULL OR ("reviewed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("reviewed_by" IS NULL OR ("reviewed_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待审核','已退回','已拒绝','已同意','已撤回')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  UNIQUE ("id","bill_id"),
  UNIQUE ("id","patient_funds_id"),
  FOREIGN KEY ("patient_funds_id") REFERENCES "patient_funds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("patient_payment_id") REFERENCES "patient_payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("reviewed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("bill_id","patient_funds_id") REFERENCES "bill"("id","patient_funds_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("patient_payment_id","patient_funds_id") REFERENCES "patient_payment"("id","patient_funds_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((bill_id IS NOT NULL OR patient_payment_id IS NOT NULL) AND proposed_refund_cents >= 0 AND (proposed_adjustment_cents <> 0 OR proposed_refund_cents <> 0)),
  CHECK (proposed_adjustment_cents = 0 OR bill_id IS NOT NULL),
  CHECK (NOT (status IN ('已同意','已拒绝','已退回')) OR ("reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "review_note" IS NOT NULL)),
  CHECK (NOT (status='已同意') OR ("approved_adjustment_cents" IS NOT NULL AND "approved_refund_cents" IS NOT NULL)),
  CHECK (approved_refund_cents IS NULL OR approved_refund_cents>=0)
) STRICT;

-- 费用调整
CREATE TABLE "fee_adjustment" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "fee_request_id" INTEGER NOT NULL CHECK ("fee_request_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("fee_request_id">0),
  "bill_id" INTEGER NOT NULL CHECK ("bill_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("bill_id">0),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "effective_at" TEXT NOT NULL CHECK (length(trim("effective_at"))>0) CHECK (length("effective_at")=20 AND "effective_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"effective_at",'+0 seconds') IS "effective_at"),
  "approved_by" INTEGER NOT NULL CHECK ("approved_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("approved_by">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("fee_request_id"),
  FOREIGN KEY ("fee_request_id") REFERENCES "fee_request"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("approved_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("fee_request_id","bill_id") REFERENCES "fee_request"("id","bill_id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 调整项目
CREATE TABLE "fee_adjustment_item" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "fee_adjustment_id" INTEGER NOT NULL CHECK ("fee_adjustment_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("fee_adjustment_id">0),
  "bill_item_id" INTEGER NOT NULL CHECK ("bill_item_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("bill_item_id">0),
  "amount_cents" INTEGER NOT NULL CHECK ("amount_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "note" TEXT NOT NULL CHECK (length(trim("note"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("fee_adjustment_id","bill_item_id"),
  FOREIGN KEY ("fee_adjustment_id") REFERENCES "fee_adjustment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("bill_item_id") REFERENCES "bill_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 退款办理
CREATE TABLE "patient_refund" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "fee_request_id" INTEGER NOT NULL CHECK ("fee_request_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("fee_request_id">0),
  "patient_payment_id" INTEGER NOT NULL CHECK ("patient_payment_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_payment_id">0),
  "patient_funds_id" INTEGER NOT NULL CHECK ("patient_funds_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_funds_id">0),
  "requested_cents" INTEGER NOT NULL CHECK ("requested_cents" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("requested_cents">0),
  "actual_cents" INTEGER CHECK ("actual_cents" IS NULL OR ("actual_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
  "initiated_at" TEXT NOT NULL CHECK (length(trim("initiated_at"))>0) CHECK (length("initiated_at")=20 AND "initiated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"initiated_at",'+0 seconds') IS "initiated_at"),
  "channel" TEXT NOT NULL CHECK (length(trim("channel"))>0) CHECK ("channel" IN ('现金','银行卡','微信','支付宝')),
  "transaction_evidence" TEXT CHECK ("transaction_evidence" IS NULL OR (length(trim("transaction_evidence"))>0)),
  "verification_note" TEXT CHECK ("verification_note" IS NULL OR (length(trim("verification_note"))>0)),
  "external_reference" TEXT CHECK ("external_reference" IS NULL OR (length(trim("external_reference"))>0)),
  "verified_at" TEXT CHECK ("verified_at" IS NULL OR (length(trim("verified_at"))>0)) CHECK ("verified_at" IS NULL OR (length("verified_at")=20 AND "verified_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"verified_at",'+0 seconds') IS "verified_at")),
  "recipient_verification" TEXT NOT NULL CHECK (length(trim("recipient_verification"))>0),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "verified_by" INTEGER CHECK ("verified_by" IS NULL OR ("verified_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("verified_by" IS NULL OR ("verified_by">0)),
  "previous_attempt_id" INTEGER CHECK ("previous_attempt_id" IS NULL OR ("previous_attempt_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("previous_attempt_id" IS NULL OR ("previous_attempt_id">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待办理','待核实','已确认退款','已失败')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  UNIQUE ("id","patient_funds_id"),
  FOREIGN KEY ("fee_request_id") REFERENCES "fee_request"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("patient_payment_id") REFERENCES "patient_payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("patient_funds_id") REFERENCES "patient_funds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("verified_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("previous_attempt_id") REFERENCES "patient_refund"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("fee_request_id","patient_funds_id") REFERENCES "fee_request"("id","patient_funds_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("patient_payment_id","patient_funds_id") REFERENCES "patient_payment"("id","patient_funds_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("previous_attempt_id","patient_funds_id") REFERENCES "patient_refund"("id","patient_funds_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (requested_cents > 0 AND (actual_cents IS NULL OR (actual_cents > 0 AND actual_cents <= requested_cents))),
  CHECK (NOT (status IN ('已确认退款','已失败')) OR ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL AND "transaction_evidence" IS NOT NULL)),
  CHECK (NOT (status='已确认退款') OR ("actual_cents" IS NOT NULL)),
  CHECK (status='已确认退款' OR actual_cents IS NULL),
  CHECK (NOT (status='已确认退款' AND channel <> '现金') OR ("external_reference" IS NOT NULL)),
  CHECK (NOT (status IN ('已确认退款','已失败')) OR ("verification_note" IS NOT NULL))
) STRICT;

-- 诊后要求
CREATE TABLE "followup_requirement" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "patient_id" INTEGER NOT NULL CHECK ("patient_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("patient_id">0),
  "source_visit_id" INTEGER CHECK ("source_visit_id" IS NULL OR ("source_visit_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("source_visit_id" IS NULL OR ("source_visit_id">0)),
  "source_plan_version_id" INTEGER CHECK ("source_plan_version_id" IS NULL OR ("source_plan_version_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("source_plan_version_id" IS NULL OR ("source_plan_version_id">0)),
  "purpose" TEXT NOT NULL CHECK (length(trim("purpose"))>0),
  "followup_type" TEXT NOT NULL CHECK (length(trim("followup_type"))>0) CHECK ("followup_type" IN ('复诊','随访')),
  "target_start" TEXT NOT NULL CHECK (length(trim("target_start"))>0) CHECK (length("target_start")=10 AND date("target_start",'+0 days') IS "target_start"),
  "target_end" TEXT NOT NULL CHECK (length(trim("target_end"))>0) CHECK (length("target_end")=10 AND date("target_end",'+0 days') IS "target_end"),
  "requires_assessment" INTEGER NOT NULL CHECK ("requires_assessment" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("requires_assessment" IN (0,1)),
  "cancellation_reason" TEXT CHECK ("cancellation_reason" IS NULL OR (length(trim("cancellation_reason"))>0)),
  "next_contact_date" TEXT CHECK ("next_contact_date" IS NULL OR (length(trim("next_contact_date"))>0)) CHECK ("next_contact_date" IS NULL OR (length("next_contact_date")=10 AND date("next_contact_date",'+0 days') IS "next_contact_date")),
  "closed_at" TEXT CHECK ("closed_at" IS NULL OR (length(trim("closed_at"))>0)) CHECK ("closed_at" IS NULL OR (length("closed_at")=20 AND "closed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"closed_at",'+0 seconds') IS "closed_at")),
  "closure_basis" TEXT CHECK ("closure_basis" IS NULL OR (length(trim("closure_basis"))>0)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "responsible_frontdesk_id" INTEGER NOT NULL CHECK ("responsible_frontdesk_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("responsible_frontdesk_id">0),
  "closed_by" INTEGER CHECK ("closed_by" IS NULL OR ("closed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("closed_by" IS NULL OR ("closed_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待发布','待联系','待到诊或评估','已完成','已撤销')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("source_visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("source_plan_version_id") REFERENCES "plan_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("responsible_frontdesk_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("closed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((source_visit_id IS NOT NULL OR source_plan_version_id IS NOT NULL) AND target_end >= target_start),
  CHECK (NOT (status IN ('已完成','已撤销')) OR ("closed_at" IS NOT NULL AND "closed_by" IS NOT NULL AND "closure_basis" IS NOT NULL)),
  CHECK (NOT (status='已撤销') OR ("cancellation_reason" IS NOT NULL))
) STRICT;

-- 联系经历
CREATE TABLE "contact_history" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "followup_requirement_id" INTEGER NOT NULL CHECK ("followup_requirement_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("followup_requirement_id">0),
  "appointment_id" INTEGER CHECK ("appointment_id" IS NULL OR ("appointment_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("appointment_id" IS NULL OR ("appointment_id">0)),
  "method" TEXT NOT NULL CHECK (length(trim("method"))>0),
  "contacted_at" TEXT NOT NULL CHECK (length(trim("contacted_at"))>0) CHECK (length("contacted_at")=20 AND "contacted_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"contacted_at",'+0 seconds') IS "contacted_at"),
  "result" TEXT NOT NULL CHECK (length(trim("result"))>0) CHECK ("result" IN ('已联系','未联系上','拒绝','待跟进')),
  "next_contact_date" TEXT CHECK ("next_contact_date" IS NULL OR (length(trim("next_contact_date"))>0)) CHECK ("next_contact_date" IS NULL OR (length("next_contact_date")=10 AND date("next_contact_date",'+0 days') IS "next_contact_date")),
  "note" TEXT NOT NULL CHECK (length(trim("note"))>0),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("followup_requirement_id") REFERENCES "followup_requirement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (result IN ('未联系上','待跟进')) OR ("next_contact_date" IS NOT NULL))
) STRICT;

-- 临床评估
CREATE TABLE "clinical_assessment" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "followup_requirement_id" INTEGER NOT NULL CHECK ("followup_requirement_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("followup_requirement_id">0),
  "visit_id" INTEGER CHECK ("visit_id" IS NULL OR ("visit_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("visit_id" IS NULL OR ("visit_id">0)),
  "method" TEXT NOT NULL CHECK (length(trim("method"))>0) CHECK ("method" IN ('到诊检查','远程沟通')),
  "assessed_at" TEXT NOT NULL CHECK (length(trim("assessed_at"))>0) CHECK (length("assessed_at")=20 AND "assessed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"assessed_at",'+0 seconds') IS "assessed_at"),
  "result" TEXT NOT NULL CHECK (length(trim("result"))>0),
  "advice" TEXT NOT NULL CHECK (length(trim("advice"))>0) CHECK ("advice" IN ('完成','继续跟进','另行处置')),
  "next_date" TEXT CHECK ("next_date" IS NULL OR (length(trim("next_date"))>0)) CHECK ("next_date" IS NULL OR (length("next_date")=10 AND date("next_date",'+0 days') IS "next_date")),
  "assessed_by" INTEGER NOT NULL CHECK ("assessed_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("assessed_by">0),
  "responsible_staff_id" INTEGER CHECK ("responsible_staff_id" IS NULL OR ("responsible_staff_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("responsible_staff_id" IS NULL OR ("responsible_staff_id">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("followup_requirement_id") REFERENCES "followup_requirement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("assessed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("responsible_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (advice='继续跟进') OR ("next_date" IS NOT NULL AND "responsible_staff_id" IS NOT NULL))
) STRICT;

-- 材料
CREATE TABLE "material" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "name" TEXT NOT NULL CHECK (length(trim("name"))>0),
  "specification" TEXT NOT NULL CHECK (length(trim("specification"))>0),
  "base_unit" TEXT NOT NULL CHECK (length(trim("base_unit"))>0),
  "purchase_unit" TEXT NOT NULL CHECK (length(trim("purchase_unit"))>0),
  "conversion_numerator" INTEGER NOT NULL CHECK ("conversion_numerator" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("conversion_numerator">0),
  "conversion_denominator" INTEGER NOT NULL CHECK ("conversion_denominator" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("conversion_denominator">0),
  "quantity_scale" INTEGER NOT NULL CHECK ("quantity_scale" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("quantity_scale" BETWEEN 0 AND 6),
  "requires_trace" INTEGER NOT NULL CHECK ("requires_trace" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("requires_trace" IN (0,1)),
  "requires_expiry" INTEGER NOT NULL CHECK ("requires_expiry" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("requires_expiry" IN (0,1)),
  "confirmed_at" TEXT CHECK ("confirmed_at" IS NULL OR (length(trim("confirmed_at"))>0)) CHECK ("confirmed_at" IS NULL OR (length("confirmed_at")=20 AND "confirmed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"confirmed_at",'+0 seconds') IS "confirmed_at")),
  "is_active" INTEGER NOT NULL CHECK ("is_active" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("is_active" IN (0,1)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "confirmed_by" INTEGER CHECK ("confirmed_by" IS NULL OR ("confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("confirmed_by" IS NULL OR ("confirmed_by">0)),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("confirmed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (conversion_numerator > 0 AND conversion_denominator > 0 AND quantity_scale BETWEEN 0 AND 6),
  CHECK (("confirmed_at" IS NULL) = ("confirmed_by" IS NULL))
) STRICT;

-- 材料批次
CREATE TABLE "material_batch" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "material_id" INTEGER NOT NULL CHECK ("material_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("material_id">0),
  "batch_no" TEXT NOT NULL CHECK (length(trim("batch_no"))>0),
  "expiry_date" TEXT CHECK ("expiry_date" IS NULL OR (length(trim("expiry_date"))>0)) CHECK ("expiry_date" IS NULL OR (length("expiry_date")=10 AND date("expiry_date",'+0 days') IS "expiry_date")),
  "source_note" TEXT NOT NULL CHECK (length(trim("source_note"))>0),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待检','可用','隔离','停用','过期')),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("material_id","batch_no"),
  FOREIGN KEY ("material_id") REFERENCES "material"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 批次变更
CREATE TABLE "batch_change" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "material_batch_id" INTEGER NOT NULL CHECK ("material_batch_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("material_batch_id">0),
  "old_status" TEXT NOT NULL CHECK (length(trim("old_status"))>0) CHECK ("old_status" IN ('待检','可用','隔离','停用','过期')),
  "new_status" TEXT NOT NULL CHECK (length(trim("new_status"))>0) CHECK ("new_status" IN ('待检','可用','隔离','停用','过期')),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "confirmed_at" TEXT NOT NULL CHECK (length(trim("confirmed_at"))>0) CHECK (length("confirmed_at")=20 AND "confirmed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"confirmed_at",'+0 seconds') IS "confirmed_at"),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "confirmed_by" INTEGER NOT NULL CHECK ("confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("confirmed_by">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("material_batch_id") REFERENCES "material_batch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("confirmed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 存放位置
CREATE TABLE "stock_location" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "name" TEXT NOT NULL CHECK (length(trim("name"))>0),
  "purpose" TEXT NOT NULL CHECK (length(trim("purpose"))>0),
  "is_active" INTEGER NOT NULL CHECK ("is_active" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("is_active" IN (0,1)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 批次存量
CREATE TABLE "batch_stock" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "material_batch_id" INTEGER NOT NULL CHECK ("material_batch_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("material_batch_id">0),
  "stock_location_id" INTEGER NOT NULL CHECK ("stock_location_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("stock_location_id">0),
  "quantity_scaled" INTEGER NOT NULL CHECK ("quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("quantity_scaled">=0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("material_batch_id","stock_location_id"),
  FOREIGN KEY ("material_batch_id") REFERENCES "material_batch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("stock_location_id") REFERENCES "stock_location"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (quantity_scaled >= 0)
) STRICT;

-- 库存变动
CREATE TABLE "inventory_movement" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "batch_stock_id" INTEGER NOT NULL CHECK ("batch_stock_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("batch_stock_id">0),
  "original_movement_id" INTEGER CHECK ("original_movement_id" IS NULL OR ("original_movement_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("original_movement_id" IS NULL OR ("original_movement_id">0)),
  "stock_count_id" INTEGER CHECK ("stock_count_id" IS NULL OR ("stock_count_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("stock_count_id" IS NULL OR ("stock_count_id">0)),
  "purchase_receipt_item_id" INTEGER CHECK ("purchase_receipt_item_id" IS NULL OR ("purchase_receipt_item_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("purchase_receipt_item_id" IS NULL OR ("purchase_receipt_item_id">0)),
  "movement_type" TEXT NOT NULL CHECK (length(trim("movement_type"))>0) CHECK ("movement_type" IN ('验收入库','领用','未用退回','盘点','退供')),
  "delta_scaled" INTEGER NOT NULL CHECK ("delta_scaled" BETWEEN -9007199254740991 AND 9007199254740991),
  "before_scaled" INTEGER NOT NULL CHECK ("before_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("before_scaled">=0),
  "after_scaled" INTEGER NOT NULL CHECK ("after_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("after_scaled">=0),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0) CHECK (length("occurred_at")=20 AND "occurred_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"occurred_at",'+0 seconds') IS "occurred_at"),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "purchase_issue_id" INTEGER CHECK ("purchase_issue_id" IS NULL OR ("purchase_issue_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("purchase_issue_id" IS NULL OR ("purchase_issue_id">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("stock_count_id"),
  UNIQUE ("id","batch_stock_id"),
  FOREIGN KEY ("batch_stock_id") REFERENCES "batch_stock"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("original_movement_id") REFERENCES "inventory_movement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("stock_count_id") REFERENCES "stock_count"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("purchase_receipt_item_id") REFERENCES "purchase_receipt_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("purchase_issue_id") REFERENCES "purchase_issue"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("original_movement_id","batch_stock_id") REFERENCES "inventory_movement"("id","batch_stock_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("stock_count_id","batch_stock_id") REFERENCES "stock_count"("id","batch_stock_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (before_scaled >= 0 AND delta_scaled <> 0 AND after_scaled >= 0 AND after_scaled = before_scaled + delta_scaled)
) STRICT;

-- 实际用料
CREATE TABLE "material_usage" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "inventory_movement_id" INTEGER NOT NULL CHECK ("inventory_movement_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("inventory_movement_id">0),
  "visit_id" INTEGER NOT NULL CHECK ("visit_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("visit_id">0),
  "quantity_scaled" INTEGER NOT NULL CHECK ("quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("quantity_scaled">0),
  "used_at" TEXT NOT NULL CHECK (length(trim("used_at"))>0) CHECK (length("used_at")=20 AND "used_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"used_at",'+0 seconds') IS "used_at"),
  "note" TEXT NOT NULL CHECK (length(trim("note"))>0),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("inventory_movement_id") REFERENCES "inventory_movement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (quantity_scaled>0)
) STRICT;

-- 盘点核实
CREATE TABLE "stock_count" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "batch_stock_id" INTEGER NOT NULL CHECK ("batch_stock_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("batch_stock_id">0),
  "snapshot_quantity_scaled" INTEGER NOT NULL CHECK ("snapshot_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("snapshot_quantity_scaled">=0),
  "counted_quantity_scaled" INTEGER NOT NULL CHECK ("counted_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("counted_quantity_scaled">=0),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "confirmed_at" TEXT CHECK ("confirmed_at" IS NULL OR (length(trim("confirmed_at"))>0)) CHECK ("confirmed_at" IS NULL OR (length("confirmed_at")=20 AND "confirmed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"confirmed_at",'+0 seconds') IS "confirmed_at")),
  "stock_revision" INTEGER NOT NULL CHECK ("stock_revision" BETWEEN -9007199254740991 AND 9007199254740991),
  "counted_at" TEXT NOT NULL CHECK (length(trim("counted_at"))>0) CHECK (length("counted_at")=20 AND "counted_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"counted_at",'+0 seconds') IS "counted_at"),
  "review_note" TEXT CHECK ("review_note" IS NULL OR (length(trim("review_note"))>0)),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "confirmed_by" INTEGER CHECK ("confirmed_by" IS NULL OR ("confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("confirmed_by" IS NULL OR ("confirmed_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待确认差异','待重新核对','差异已确认','不予调整')),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("id","batch_stock_id"),
  FOREIGN KEY ("batch_stock_id") REFERENCES "batch_stock"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("confirmed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status IN ('差异已确认','不予调整')) OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL AND "review_note" IS NOT NULL))
) STRICT;

-- 供应商
CREATE TABLE "supplier" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "name" TEXT NOT NULL CHECK (length(trim("name"))>0),
  "contact_name" TEXT NOT NULL CHECK (length(trim("contact_name"))>0),
  "phone" TEXT NOT NULL CHECK (length(trim("phone"))>0),
  "address" TEXT CHECK ("address" IS NULL OR (length(trim("address"))>0)),
  "settlement_basis" TEXT NOT NULL CHECK (length(trim("settlement_basis"))>0),
  "is_active" INTEGER NOT NULL CHECK ("is_active" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("is_active" IN (0,1)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "verified_by" INTEGER NOT NULL CHECK ("verified_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("verified_by">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("verified_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 采购
CREATE TABLE "purchase_order" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "supplier_id" INTEGER NOT NULL CHECK ("supplier_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("supplier_id">0),
  "agreed_at" TEXT NOT NULL CHECK (length(trim("agreed_at"))>0) CHECK (length("agreed_at")=20 AND "agreed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"agreed_at",'+0 seconds') IS "agreed_at"),
  "delivery_terms" TEXT NOT NULL CHECK (length(trim("delivery_terms"))>0),
  "confirmed_at" TEXT CHECK ("confirmed_at" IS NULL OR (length(trim("confirmed_at"))>0)) CHECK ("confirmed_at" IS NULL OR (length("confirmed_at")=20 AND "confirmed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"confirmed_at",'+0 seconds') IS "confirmed_at")),
  "request_reason" TEXT NOT NULL CHECK (length(trim("request_reason"))>0),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "confirmed_by" INTEGER CHECK ("confirmed_by" IS NULL OR ("confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("confirmed_by" IS NULL OR ("confirmed_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待确认','已确认','已取消')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("confirmed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status='已确认') OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL))
) STRICT;

-- 采购项目
CREATE TABLE "purchase_order_item" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "purchase_order_id" INTEGER NOT NULL CHECK ("purchase_order_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("purchase_order_id">0),
  "material_id" INTEGER NOT NULL CHECK ("material_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("material_id">0),
  "ordered_quantity_scaled" INTEGER NOT NULL CHECK ("ordered_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("ordered_quantity_scaled">0),
  "unit_price_cents" INTEGER NOT NULL CHECK ("unit_price_cents" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("unit_price_cents">=0),
  "purchase_unit" TEXT NOT NULL CHECK (length(trim("purchase_unit"))>0),
  "conversion_numerator" INTEGER NOT NULL CHECK ("conversion_numerator" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("conversion_numerator">0),
  "conversion_denominator" INTEGER NOT NULL CHECK ("conversion_denominator" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("conversion_denominator">0),
  "quantity_scale" INTEGER NOT NULL CHECK ("quantity_scale" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("quantity_scale" BETWEEN 0 AND 6),
  "sequence_no" INTEGER NOT NULL CHECK ("sequence_no" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("sequence_no">0),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待交付','履行中','待差异处理','履行已完成','剩余已取消')),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("purchase_order_id","sequence_no"),
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("material_id") REFERENCES "material"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 验收
CREATE TABLE "purchase_receipt" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "purchase_order_id" INTEGER NOT NULL CHECK ("purchase_order_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("purchase_order_id">0),
  "arrived_at" TEXT NOT NULL CHECK (length(trim("arrived_at"))>0) CHECK (length("arrived_at")=20 AND "arrived_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"arrived_at",'+0 seconds') IS "arrived_at"),
  "delivery_evidence" TEXT NOT NULL CHECK (length(trim("delivery_evidence"))>0),
  "accepted_at" TEXT CHECK ("accepted_at" IS NULL OR (length(trim("accepted_at"))>0)) CHECK ("accepted_at" IS NULL OR (length("accepted_at")=20 AND "accepted_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"accepted_at",'+0 seconds') IS "accepted_at")),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "confirmed_by" INTEGER CHECK ("confirmed_by" IS NULL OR ("confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("confirmed_by" IS NULL OR ("confirmed_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待验收','部分待检','已确认')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("confirmed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status='已确认') OR ("accepted_at" IS NOT NULL AND "confirmed_by" IS NOT NULL))
) STRICT;

-- 验收项目
CREATE TABLE "purchase_receipt_item" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "purchase_receipt_id" INTEGER NOT NULL CHECK ("purchase_receipt_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("purchase_receipt_id">0),
  "purchase_order_item_id" INTEGER NOT NULL CHECK ("purchase_order_item_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("purchase_order_item_id">0),
  "material_batch_id" INTEGER CHECK ("material_batch_id" IS NULL OR ("material_batch_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("material_batch_id" IS NULL OR ("material_batch_id">0)),
  "arrived_quantity_scaled" INTEGER NOT NULL CHECK ("arrived_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("arrived_quantity_scaled">0),
  "accepted_quantity_scaled" INTEGER NOT NULL CHECK ("accepted_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("accepted_quantity_scaled">=0),
  "rejected_quantity_scaled" INTEGER NOT NULL CHECK ("rejected_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("rejected_quantity_scaled">=0),
  "pending_quantity_scaled" INTEGER NOT NULL CHECK ("pending_quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("pending_quantity_scaled">=0),
  "accepted_amount_cents" INTEGER CHECK ("accepted_amount_cents" IS NULL OR ("accepted_amount_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
  "inspection_note" TEXT NOT NULL CHECK (length(trim("inspection_note"))>0),
  "stock_location_id" INTEGER CHECK ("stock_location_id" IS NULL OR ("stock_location_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("stock_location_id" IS NULL OR ("stock_location_id">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("id","purchase_order_item_id"),
  FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("material_batch_id") REFERENCES "material_batch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("stock_location_id") REFERENCES "stock_location"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (arrived_quantity_scaled > 0 AND accepted_quantity_scaled >= 0 AND rejected_quantity_scaled >= 0 AND pending_quantity_scaled >= 0 AND arrived_quantity_scaled = accepted_quantity_scaled + rejected_quantity_scaled + pending_quantity_scaled),
  CHECK (accepted_quantity_scaled = 0 OR (material_batch_id IS NOT NULL AND stock_location_id IS NOT NULL AND accepted_amount_cents IS NOT NULL AND accepted_amount_cents >= 0))
) STRICT;

-- 采购差异
CREATE TABLE "purchase_issue" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "purchase_order_item_id" INTEGER NOT NULL CHECK ("purchase_order_item_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("purchase_order_item_id">0),
  "purchase_receipt_item_id" INTEGER CHECK ("purchase_receipt_item_id" IS NULL OR ("purchase_receipt_item_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("purchase_receipt_item_id" IS NULL OR ("purchase_receipt_item_id">0)),
  "quantity_scaled" INTEGER NOT NULL CHECK ("quantity_scaled" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("quantity_scaled">=0),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "resolution" TEXT NOT NULL CHECK (length(trim("resolution"))>0) CHECK ("resolution" IN ('补交','换货','退货','取消剩余','价款调整')),
  "confirmed_at" TEXT CHECK ("confirmed_at" IS NULL OR (length(trim("confirmed_at"))>0)) CHECK ("confirmed_at" IS NULL OR (length("confirmed_at")=20 AND "confirmed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"confirmed_at",'+0 seconds') IS "confirmed_at")),
  "issue_kind" TEXT NOT NULL CHECK (length(trim("issue_kind"))>0) CHECK ("issue_kind" IN ('未交付','拒收','已入库退供','结算调整')),
  "adjustment_cents" INTEGER NOT NULL CHECK ("adjustment_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "resolved_at" TEXT CHECK ("resolved_at" IS NULL OR (length(trim("resolved_at"))>0)) CHECK ("resolved_at" IS NULL OR (length("resolved_at")=20 AND "resolved_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"resolved_at",'+0 seconds') IS "resolved_at")),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "confirmed_by" INTEGER CHECK ("confirmed_by" IS NULL OR ("confirmed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("confirmed_by" IS NULL OR ("confirmed_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待确认','待处理','已完成','已拒绝')),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("purchase_receipt_item_id") REFERENCES "purchase_receipt_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("confirmed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("purchase_receipt_item_id","purchase_order_item_id") REFERENCES "purchase_receipt_item"("id","purchase_order_item_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status IN ('待处理','已完成')) OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL)),
  CHECK (NOT (issue_kind='已入库退供') OR ("purchase_receipt_item_id" IS NOT NULL))
) STRICT;

-- 供应商资金
CREATE TABLE "supplier_funds" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "supplier_id" INTEGER NOT NULL CHECK ("supplier_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("supplier_id">0),
  "opened_at" TEXT NOT NULL CHECK (length(trim("opened_at"))>0) CHECK (length("opened_at")=20 AND "opened_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"opened_at",'+0 seconds') IS "opened_at"),
  "opened_by" INTEGER NOT NULL CHECK ("opened_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("opened_by">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("supplier_id"),
  FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("opened_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 供货付款
CREATE TABLE "supplier_payment" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "supplier_funds_id" INTEGER NOT NULL CHECK ("supplier_funds_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("supplier_funds_id">0),
  "requested_cents" INTEGER NOT NULL CHECK ("requested_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "actual_cents" INTEGER CHECK ("actual_cents" IS NULL OR ("actual_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
  "channel" TEXT NOT NULL CHECK (length(trim("channel"))>0) CHECK ("channel" IN ('现金','银行卡','微信','支付宝')),
  "initiated_at" TEXT NOT NULL CHECK (length(trim("initiated_at"))>0) CHECK (length("initiated_at")=20 AND "initiated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"initiated_at",'+0 seconds') IS "initiated_at"),
  "transaction_evidence" TEXT CHECK ("transaction_evidence" IS NULL OR (length(trim("transaction_evidence"))>0)),
  "external_reference" TEXT CHECK ("external_reference" IS NULL OR (length(trim("external_reference"))>0)),
  "verified_at" TEXT CHECK ("verified_at" IS NULL OR (length(trim("verified_at"))>0)) CHECK ("verified_at" IS NULL OR (length("verified_at")=20 AND "verified_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"verified_at",'+0 seconds') IS "verified_at")),
  "authorization_basis" TEXT NOT NULL CHECK (length(trim("authorization_basis"))>0),
  "authorized_by" INTEGER NOT NULL CHECK ("authorized_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("authorized_by">0),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "verified_by" INTEGER CHECK ("verified_by" IS NULL OR ("verified_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("verified_by" IS NULL OR ("verified_by">0)),
  "previous_attempt_id" INTEGER CHECK ("previous_attempt_id" IS NULL OR ("previous_attempt_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("previous_attempt_id" IS NULL OR ("previous_attempt_id">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待付款','待核实','已确认付款','已失败')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  UNIQUE ("id","supplier_funds_id"),
  FOREIGN KEY ("supplier_funds_id") REFERENCES "supplier_funds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("authorized_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("verified_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("previous_attempt_id") REFERENCES "supplier_payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("previous_attempt_id","supplier_funds_id") REFERENCES "supplier_payment"("id","supplier_funds_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (requested_cents > 0 AND (actual_cents IS NULL OR (actual_cents > 0 AND actual_cents <= requested_cents))),
  CHECK (NOT (status IN ('已确认付款','已失败')) OR ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL AND "transaction_evidence" IS NOT NULL)),
  CHECK (NOT (status='已确认付款') OR ("actual_cents" IS NOT NULL)),
  CHECK (status='已确认付款' OR actual_cents IS NULL),
  CHECK (NOT (status='已确认付款' AND channel <> '现金') OR ("external_reference" IS NOT NULL))
) STRICT;

-- 供货分配
CREATE TABLE "supplier_allocation" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "supplier_payment_id" INTEGER NOT NULL CHECK ("supplier_payment_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("supplier_payment_id">0),
  "purchase_order_id" INTEGER CHECK ("purchase_order_id" IS NULL OR ("purchase_order_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("purchase_order_id" IS NULL OR ("purchase_order_id">0)),
  "purchase_receipt_id" INTEGER CHECK ("purchase_receipt_id" IS NULL OR ("purchase_receipt_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("purchase_receipt_id" IS NULL OR ("purchase_receipt_id">0)),
  "amount_cents" INTEGER NOT NULL CHECK ("amount_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "effective_at" TEXT CHECK ("effective_at" IS NULL OR (length(trim("effective_at"))>0)) CHECK ("effective_at" IS NULL OR (length("effective_at")=20 AND "effective_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"effective_at",'+0 seconds') IS "effective_at")),
  "allocation_state" TEXT NOT NULL CHECK (length(trim("allocation_state"))>0) CHECK ("allocation_state" IN ('待生效','已生效','已取消')),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "original_allocation_id" INTEGER CHECK ("original_allocation_id" IS NULL OR ("original_allocation_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("original_allocation_id" IS NULL OR ("original_allocation_id">0)),
  "purchase_issue_id" INTEGER CHECK ("purchase_issue_id" IS NULL OR ("purchase_issue_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("purchase_issue_id" IS NULL OR ("purchase_issue_id">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("id","supplier_payment_id"),
  FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("original_allocation_id") REFERENCES "supplier_allocation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("purchase_issue_id") REFERENCES "purchase_issue"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("original_allocation_id","supplier_payment_id") REFERENCES "supplier_allocation"("id","supplier_payment_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((purchase_order_id IS NOT NULL) + (purchase_receipt_id IS NOT NULL) = 1),
  CHECK (amount_cents <> 0 AND (amount_cents > 0 OR original_allocation_id IS NOT NULL) AND (allocation_state <> '待生效' OR amount_cents > 0) AND (allocation_state <> '已生效' OR effective_at IS NOT NULL))
) STRICT;

-- 供货退款
CREATE TABLE "supplier_refund" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "supplier_payment_id" INTEGER NOT NULL CHECK ("supplier_payment_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("supplier_payment_id">0),
  "purchase_issue_id" INTEGER NOT NULL CHECK ("purchase_issue_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("purchase_issue_id">0),
  "supplier_funds_id" INTEGER NOT NULL CHECK ("supplier_funds_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("supplier_funds_id">0),
  "received_cents" INTEGER NOT NULL CHECK ("received_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "channel" TEXT NOT NULL CHECK (length(trim("channel"))>0) CHECK ("channel" IN ('现金','银行卡','微信','支付宝')),
  "received_at" TEXT NOT NULL CHECK (length(trim("received_at"))>0) CHECK (length("received_at")=20 AND "received_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"received_at",'+0 seconds') IS "received_at"),
  "transaction_evidence" TEXT NOT NULL CHECK (length(trim("transaction_evidence"))>0),
  "external_reference" TEXT CHECK ("external_reference" IS NULL OR (length(trim("external_reference"))>0)),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "verified_by" INTEGER NOT NULL CHECK ("verified_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("verified_by">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("purchase_issue_id") REFERENCES "purchase_issue"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("supplier_funds_id") REFERENCES "supplier_funds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("verified_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("supplier_payment_id","supplier_funds_id") REFERENCES "supplier_payment"("id","supplier_funds_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (received_cents>0),
  CHECK (NOT (channel <> '现金') OR ("external_reference" IS NOT NULL))
) STRICT;

-- 器械包
CREATE TABLE "instrument_pack" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "name" TEXT NOT NULL CHECK (length(trim("name"))>0),
  "composition_note" TEXT NOT NULL CHECK (length(trim("composition_note"))>0),
  "is_active" INTEGER NOT NULL CHECK ("is_active" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("is_active" IN (0,1)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 处理设备
CREATE TABLE "processing_equipment" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "name" TEXT NOT NULL CHECK (length(trim("name"))>0),
  "available_from" TEXT NOT NULL CHECK (length(trim("available_from"))>0) CHECK (length("available_from")=20 AND "available_from" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"available_from",'+0 seconds') IS "available_from"),
  "available_until" TEXT CHECK ("available_until" IS NULL OR (length(trim("available_until"))>0)) CHECK ("available_until" IS NULL OR (length("available_until")=20 AND "available_until" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"available_until",'+0 seconds') IS "available_until")),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (available_until IS NULL OR available_until > available_from)
) STRICT;

-- 器械处理
CREATE TABLE "instrument_processing" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "processing_equipment_id" INTEGER NOT NULL CHECK ("processing_equipment_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("processing_equipment_id">0),
  "previous_processing_id" INTEGER CHECK ("previous_processing_id" IS NULL OR ("previous_processing_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("previous_processing_id" IS NULL OR ("previous_processing_id">0)),
  "preparation_note" TEXT NOT NULL CHECK (length(trim("preparation_note"))>0),
  "started_at" TEXT NOT NULL CHECK (length(trim("started_at"))>0) CHECK (length("started_at")=20 AND "started_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"started_at",'+0 seconds') IS "started_at"),
  "ended_at" TEXT CHECK ("ended_at" IS NULL OR (length(trim("ended_at"))>0)) CHECK ("ended_at" IS NULL OR (length("ended_at")=20 AND "ended_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"ended_at",'+0 seconds') IS "ended_at")),
  "released_at" TEXT CHECK ("released_at" IS NULL OR (length(trim("released_at"))>0)) CHECK ("released_at" IS NULL OR (length("released_at")=20 AND "released_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"released_at",'+0 seconds') IS "released_at")),
  "release_basis" TEXT CHECK ("release_basis" IS NULL OR (length(trim("release_basis"))>0)),
  "exception_reason" TEXT CHECK ("exception_reason" IS NULL OR (length(trim("exception_reason"))>0)),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "released_by" INTEGER CHECK ("released_by" IS NULL OR ("released_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("released_by" IS NULL OR ("released_by">0)),
  "isolated_by" INTEGER CHECK ("isolated_by" IS NULL OR ("isolated_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("isolated_by" IS NULL OR ("isolated_by">0)),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('处理中','待核对放行','已放行','隔离停用')),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("processing_equipment_id") REFERENCES "processing_equipment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("previous_processing_id") REFERENCES "instrument_processing"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("released_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("isolated_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status='已放行') OR ("ended_at" IS NOT NULL AND "released_at" IS NOT NULL AND "released_by" IS NOT NULL AND "release_basis" IS NOT NULL)),
  CHECK (NOT (status='隔离停用') OR ("exception_reason" IS NOT NULL AND "isolated_by" IS NOT NULL))
) STRICT;

-- 器械包处理
CREATE TABLE "instrument_pack_cycle" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "instrument_processing_id" INTEGER NOT NULL CHECK ("instrument_processing_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("instrument_processing_id">0),
  "instrument_pack_id" INTEGER NOT NULL CHECK ("instrument_pack_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("instrument_pack_id">0),
  "packaging_check" TEXT NOT NULL CHECK (length(trim("packaging_check"))>0),
  "expires_at" TEXT NOT NULL CHECK (length(trim("expires_at"))>0) CHECK (length("expires_at")=20 AND "expires_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"expires_at",'+0 seconds') IS "expires_at"),
  "checked_by" INTEGER NOT NULL CHECK ("checked_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("checked_by">0),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待放行','可用','已发放待确认','已使用','隔离')),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("instrument_processing_id","instrument_pack_id"),
  FOREIGN KEY ("instrument_processing_id") REFERENCES "instrument_processing"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("instrument_pack_id") REFERENCES "instrument_pack"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("checked_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 处理监测
CREATE TABLE "processing_monitor" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "instrument_processing_id" INTEGER NOT NULL CHECK ("instrument_processing_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("instrument_processing_id">0),
  "monitor_item" TEXT NOT NULL CHECK (length(trim("monitor_item"))>0),
  "result" TEXT NOT NULL CHECK (length(trim("result"))>0) CHECK ("result" IN ('通过','未通过','未取得')),
  "obtained_at" TEXT CHECK ("obtained_at" IS NULL OR (length(trim("obtained_at"))>0)) CHECK ("obtained_at" IS NULL OR (length("obtained_at")=20 AND "obtained_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"obtained_at",'+0 seconds') IS "obtained_at")),
  "evidence" TEXT NOT NULL CHECK (length(trim("evidence"))>0),
  "recorded_by" INTEGER NOT NULL CHECK ("recorded_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("recorded_by">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("instrument_processing_id") REFERENCES "instrument_processing"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (result <> '未取得') OR ("obtained_at" IS NOT NULL AND "evidence" IS NOT NULL))
) STRICT;

-- 器械使用
CREATE TABLE "instrument_use" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "visit_id" INTEGER NOT NULL CHECK ("visit_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("visit_id">0),
  "instrument_pack_cycle_id" INTEGER NOT NULL CHECK ("instrument_pack_cycle_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("instrument_pack_cycle_id">0),
  "issued_at" TEXT NOT NULL CHECK (length(trim("issued_at"))>0) CHECK (length("issued_at")=20 AND "issued_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"issued_at",'+0 seconds') IS "issued_at"),
  "used_at" TEXT CHECK ("used_at" IS NULL OR (length(trim("used_at"))>0)) CHECK ("used_at" IS NULL OR (length("used_at")=20 AND "used_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"used_at",'+0 seconds') IS "used_at")),
  "physical_check" TEXT NOT NULL CHECK (length(trim("physical_check"))>0),
  "exception_note" TEXT CHECK ("exception_note" IS NULL OR (length(trim("exception_note"))>0)),
  "use_status" TEXT NOT NULL CHECK (length(trim("use_status"))>0) CHECK ("use_status" IN ('已发放','已使用','未用退回','异常补录')),
  "returned_at" TEXT CHECK ("returned_at" IS NULL OR (length(trim("returned_at"))>0)) CHECK ("returned_at" IS NULL OR (length("returned_at")=20 AND "returned_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"returned_at",'+0 seconds') IS "returned_at")),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "used_by" INTEGER CHECK ("used_by" IS NULL OR ("used_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("used_by" IS NULL OR ("used_by">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("instrument_pack_cycle_id") REFERENCES "instrument_pack_cycle"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("used_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((used_at IS NULL OR used_at >= issued_at) AND (use_status <> '已使用' OR (used_at IS NOT NULL AND used_by IS NOT NULL)) AND (use_status <> '未用退回' OR (returned_at IS NOT NULL AND returned_at >= issued_at AND used_at IS NULL))),
  CHECK (NOT (use_status='异常补录') OR ("exception_note" IS NOT NULL))
) STRICT;

-- 收支核对
CREATE TABLE "cash_reconciliation" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "business_date" TEXT NOT NULL CHECK (length(trim("business_date"))>0) CHECK (length("business_date")=10 AND date("business_date",'+0 days') IS "business_date"),
  "channel" TEXT NOT NULL CHECK (length(trim("channel"))>0) CHECK ("channel" IN ('现金','银行卡','微信','支付宝')),
  "cutoff_at" TEXT NOT NULL CHECK (length(trim("cutoff_at"))>0) CHECK (length("cutoff_at")=20 AND "cutoff_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"cutoff_at",'+0 seconds') IS "cutoff_at"),
  "actual_cents" INTEGER NOT NULL CHECK ("actual_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "opening_cash_cents" INTEGER CHECK ("opening_cash_cents" IS NULL OR ("opening_cash_cents" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("opening_cash_cents" IS NULL OR ("opening_cash_cents">=0)),
  "cash_transfer_evidence" TEXT CHECK ("cash_transfer_evidence" IS NULL OR (length(trim("cash_transfer_evidence"))>0)),
  "cash_transfer_cents" INTEGER NOT NULL CHECK ("cash_transfer_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "reconciliation_basis" TEXT NOT NULL CHECK (length(trim("reconciliation_basis"))>0),
  "source_digest" TEXT NOT NULL CHECK (length(trim("source_digest"))>0),
  "expected_cents" INTEGER NOT NULL CHECK ("expected_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "operator_id" INTEGER NOT NULL CHECK ("operator_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("operator_id">0),
  "record_no" TEXT NOT NULL CHECK (length(trim("record_no"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("record_no"),
  FOREIGN KEY ("operator_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((channel='现金' AND opening_cash_cents IS NOT NULL AND opening_cash_cents>=0 AND actual_cents>=0) OR (channel<>'现金' AND opening_cash_cents IS NULL AND cash_transfer_cents=0)),
  CHECK (NOT (cash_transfer_cents<>0) OR ("cash_transfer_evidence" IS NOT NULL))
) STRICT;

-- 核对项目
CREATE TABLE "reconciliation_item" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "cash_reconciliation_id" INTEGER NOT NULL CHECK ("cash_reconciliation_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("cash_reconciliation_id">0),
  "patient_payment_id" INTEGER CHECK ("patient_payment_id" IS NULL OR ("patient_payment_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("patient_payment_id" IS NULL OR ("patient_payment_id">0)),
  "patient_refund_id" INTEGER CHECK ("patient_refund_id" IS NULL OR ("patient_refund_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("patient_refund_id" IS NULL OR ("patient_refund_id">0)),
  "supplier_payment_id" INTEGER CHECK ("supplier_payment_id" IS NULL OR ("supplier_payment_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("supplier_payment_id" IS NULL OR ("supplier_payment_id">0)),
  "supplier_refund_id" INTEGER CHECK ("supplier_refund_id" IS NULL OR ("supplier_refund_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("supplier_refund_id" IS NULL OR ("supplier_refund_id">0)),
  "source_type" TEXT NOT NULL CHECK (length(trim("source_type"))>0) CHECK ("source_type" IN ('患者付款','患者退款','供货付款','供货退款')),
  "included_cents" INTEGER NOT NULL CHECK ("included_cents" BETWEEN -9007199254740991 AND 9007199254740991),
  "source_at" TEXT NOT NULL CHECK (length(trim("source_at"))>0) CHECK (length("source_at")=20 AND "source_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"source_at",'+0 seconds') IS "source_at"),
  "source_revision" INTEGER NOT NULL CHECK ("source_revision" BETWEEN -9007199254740991 AND 9007199254740991),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("cash_reconciliation_id") REFERENCES "cash_reconciliation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("patient_payment_id") REFERENCES "patient_payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("patient_refund_id") REFERENCES "patient_refund"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("supplier_refund_id") REFERENCES "supplier_refund"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((patient_payment_id IS NOT NULL) + (patient_refund_id IS NOT NULL) + (supplier_payment_id IS NOT NULL) + (supplier_refund_id IS NOT NULL) = 1),
  CHECK (included_cents<>0)
) STRICT;

-- 差异跟进
CREATE TABLE "issue_followup" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "cash_reconciliation_id" INTEGER CHECK ("cash_reconciliation_id" IS NULL OR ("cash_reconciliation_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("cash_reconciliation_id" IS NULL OR ("cash_reconciliation_id">0)),
  "instrument_processing_id" INTEGER CHECK ("instrument_processing_id" IS NULL OR ("instrument_processing_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("instrument_processing_id" IS NULL OR ("instrument_processing_id">0)),
  "assigned_to" INTEGER NOT NULL CHECK ("assigned_to" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("assigned_to">0),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "due_date" TEXT NOT NULL CHECK (length(trim("due_date"))>0) CHECK (length("due_date")=10 AND date("due_date",'+0 days') IS "due_date"),
  "action_note" TEXT NOT NULL CHECK (length(trim("action_note"))>0),
  "completed_at" TEXT CHECK ("completed_at" IS NULL OR (length(trim("completed_at"))>0)) CHECK ("completed_at" IS NULL OR (length("completed_at")=20 AND "completed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"completed_at",'+0 seconds') IS "completed_at")),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待处理','处理中','已完成')),
  "result_basis" TEXT CHECK ("result_basis" IS NULL OR (length(trim("result_basis"))>0)),
  "created_by" INTEGER NOT NULL CHECK ("created_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("created_by">0),
  "completed_by" INTEGER CHECK ("completed_by" IS NULL OR ("completed_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("completed_by" IS NULL OR ("completed_by">0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  FOREIGN KEY ("cash_reconciliation_id") REFERENCES "cash_reconciliation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("instrument_processing_id") REFERENCES "instrument_processing"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("assigned_to") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("completed_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((cash_reconciliation_id IS NOT NULL) + (instrument_processing_id IS NOT NULL) = 1),
  CHECK (NOT (status='已完成') OR ("completed_at" IS NOT NULL AND "completed_by" IS NOT NULL AND "result_basis" IS NOT NULL))
) STRICT;

-- 患者决定—方案项目
CREATE TABLE "decision_plan_item" (
  "decision_id" INTEGER NOT NULL CHECK ("decision_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("decision_id">0),
  "plan_item_id" INTEGER NOT NULL CHECK ("plan_item_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("plan_item_id">0),
  "linked_at" TEXT NOT NULL CHECK (length(trim("linked_at"))>0) CHECK (length("linked_at")=20 AND "linked_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"linked_at",'+0 seconds') IS "linked_at"),
  "linked_by" INTEGER NOT NULL CHECK ("linked_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("linked_by">0),
  PRIMARY KEY ("decision_id","plan_item_id"),
  FOREIGN KEY ("decision_id") REFERENCES "patient_decision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("plan_item_id") REFERENCES "plan_item"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("linked_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 患者决定—确认原件
CREATE TABLE "decision_file_version" (
  "decision_id" INTEGER NOT NULL CHECK ("decision_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("decision_id">0),
  "document_version_id" INTEGER NOT NULL CHECK ("document_version_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("document_version_id">0),
  "linked_at" TEXT NOT NULL CHECK (length(trim("linked_at"))>0) CHECK (length("linked_at")=20 AND "linked_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"linked_at",'+0 seconds') IS "linked_at"),
  "linked_by" INTEGER NOT NULL CHECK ("linked_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("linked_by">0),
  PRIMARY KEY ("decision_id","document_version_id"),
  FOREIGN KEY ("decision_id") REFERENCES "patient_decision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("document_version_id") REFERENCES "document_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("linked_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 职员账号
CREATE TABLE "user_account" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "staff_id" INTEGER NOT NULL CHECK ("staff_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("staff_id">0),
  "login_name" TEXT NOT NULL CHECK (length(trim("login_name"))>0),
  "password_hash" TEXT NOT NULL CHECK (length(trim("password_hash"))>0),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('启用','停用')),
  "auth_version" INTEGER NOT NULL CHECK ("auth_version" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("auth_version">0),
  "password_changed_at" TEXT NOT NULL CHECK (length(trim("password_changed_at"))>0) CHECK (length("password_changed_at")=20 AND "password_changed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"password_changed_at",'+0 seconds') IS "password_changed_at"),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "updated_at" TEXT NOT NULL CHECK (length(trim("updated_at"))>0) CHECK (length("updated_at")=20 AND "updated_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"updated_at",'+0 seconds') IS "updated_at"),
  "disabled_at" TEXT CHECK ("disabled_at" IS NULL OR (length(trim("disabled_at"))>0)) CHECK ("disabled_at" IS NULL OR (length("disabled_at")=20 AND "disabled_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"disabled_at",'+0 seconds') IS "disabled_at")),
  "disabled_reason" TEXT CHECK ("disabled_reason" IS NULL OR (length(trim("disabled_reason"))>0)),
  "revision" INTEGER NOT NULL CHECK ("revision" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("revision">0),
  UNIQUE ("staff_id"),
  UNIQUE ("login_name"),
  UNIQUE ("id","staff_id"),
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status='停用') OR ("disabled_at" IS NOT NULL AND "disabled_reason" IS NOT NULL)),
  CHECK (length(login_name) BETWEEN 3 AND 64 AND login_name=lower(login_name) AND login_name NOT GLOB '*[^a-z0-9_.-]*')
) STRICT;

-- 访问角色
CREATE TABLE "access_role" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "code" TEXT NOT NULL CHECK (length(trim("code"))>0) CHECK ("code" IN ('frontdesk','dentist','cashier','assistant','manager')),
  "name" TEXT NOT NULL CHECK (length(trim("name"))>0),
  "description" TEXT NOT NULL CHECK (length(trim("description"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  UNIQUE ("code")
) STRICT;

-- 操作权限
CREATE TABLE "access_permission" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "code" TEXT NOT NULL CHECK (length(trim("code"))>0),
  "usecase_no" TEXT CHECK ("usecase_no" IS NULL OR (length(trim("usecase_no"))>0)),
  "name" TEXT NOT NULL CHECK (length(trim("name"))>0),
  "operation_kind" TEXT NOT NULL CHECK (length(trim("operation_kind"))>0) CHECK ("operation_kind" IN ('查询','业务写入','运行管理')),
  "object_rule" TEXT NOT NULL CHECK (length(trim("object_rule"))>0),
  "config_version" INTEGER NOT NULL CHECK ("config_version" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("config_version">0),
  UNIQUE ("code")
) STRICT;

-- 职员岗位资格
CREATE TABLE "staff_role_qualification" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "staff_id" INTEGER NOT NULL CHECK ("staff_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("staff_id">0),
  "role_id" INTEGER NOT NULL CHECK ("role_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("role_id">0),
  "valid_from" TEXT NOT NULL CHECK (length(trim("valid_from"))>0) CHECK (length("valid_from")=20 AND "valid_from" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"valid_from",'+0 seconds') IS "valid_from"),
  "valid_until" TEXT CHECK ("valid_until" IS NULL OR (length(trim("valid_until"))>0)) CHECK ("valid_until" IS NULL OR (length("valid_until")=20 AND "valid_until" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"valid_until",'+0 seconds') IS "valid_until")),
  "verified_by" INTEGER NOT NULL CHECK ("verified_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("verified_by">0),
  "verification_basis" TEXT NOT NULL CHECK (length(trim("verification_basis"))>0),
  "revoked_at" TEXT CHECK ("revoked_at" IS NULL OR (length(trim("revoked_at"))>0)) CHECK ("revoked_at" IS NULL OR (length("revoked_at")=20 AND "revoked_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"revoked_at",'+0 seconds') IS "revoked_at")),
  "revoked_by" INTEGER CHECK ("revoked_by" IS NULL OR ("revoked_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("revoked_by" IS NULL OR ("revoked_by">0)),
  "revocation_reason" TEXT CHECK ("revocation_reason" IS NULL OR (length(trim("revocation_reason"))>0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  UNIQUE ("id","role_id"),
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("role_id") REFERENCES "access_role"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("verified_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("revoked_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (("revoked_at" IS NULL) = ("revoked_by" IS NULL)),
  CHECK (("revoked_at" IS NULL) = ("revocation_reason" IS NULL))
) STRICT;

-- 账号角色授权
CREATE TABLE "account_role" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "account_id" INTEGER NOT NULL CHECK ("account_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("account_id">0),
  "role_id" INTEGER NOT NULL CHECK ("role_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("role_id">0),
  "qualification_id" INTEGER NOT NULL CHECK ("qualification_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("qualification_id">0),
  "granted_by" INTEGER NOT NULL CHECK ("granted_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("granted_by">0),
  "granted_at" TEXT NOT NULL CHECK (length(trim("granted_at"))>0) CHECK (length("granted_at")=20 AND "granted_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"granted_at",'+0 seconds') IS "granted_at"),
  "valid_until" TEXT CHECK ("valid_until" IS NULL OR (length(trim("valid_until"))>0)) CHECK ("valid_until" IS NULL OR (length("valid_until")=20 AND "valid_until" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"valid_until",'+0 seconds') IS "valid_until")),
  "grant_reason" TEXT NOT NULL CHECK (length(trim("grant_reason"))>0),
  "revoked_by" INTEGER CHECK ("revoked_by" IS NULL OR ("revoked_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("revoked_by" IS NULL OR ("revoked_by">0)),
  "revoked_at" TEXT CHECK ("revoked_at" IS NULL OR (length(trim("revoked_at"))>0)) CHECK ("revoked_at" IS NULL OR (length("revoked_at")=20 AND "revoked_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"revoked_at",'+0 seconds') IS "revoked_at")),
  "revocation_reason" TEXT CHECK ("revocation_reason" IS NULL OR (length(trim("revocation_reason"))>0)),
  FOREIGN KEY ("account_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("role_id") REFERENCES "access_role"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("qualification_id") REFERENCES "staff_role_qualification"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("granted_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("revoked_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("qualification_id","role_id") REFERENCES "staff_role_qualification"("id","role_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (("revoked_at" IS NULL) = ("revoked_by" IS NULL)),
  CHECK (("revoked_at" IS NULL) = ("revocation_reason" IS NULL)),
  CHECK (valid_until IS NULL OR valid_until > granted_at)
) STRICT;

-- 角色操作授权
CREATE TABLE "role_permission" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "role_id" INTEGER NOT NULL CHECK ("role_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("role_id">0),
  "permission_id" INTEGER NOT NULL CHECK ("permission_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("permission_id">0),
  "config_version" INTEGER NOT NULL CHECK ("config_version" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("config_version">0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  UNIQUE ("role_id","permission_id"),
  FOREIGN KEY ("role_id") REFERENCES "access_role"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("permission_id") REFERENCES "access_permission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- 登录会话
CREATE TABLE "login_session" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "account_id" INTEGER NOT NULL CHECK ("account_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("account_id">0),
  "token_hash" TEXT NOT NULL CHECK (length(trim("token_hash"))>0) CHECK (length("token_hash")=64 AND "token_hash" NOT GLOB '*[^0-9a-f]*'),
  "csrf_hash" TEXT NOT NULL CHECK (length(trim("csrf_hash"))>0) CHECK (length("csrf_hash")=64 AND "csrf_hash" NOT GLOB '*[^0-9a-f]*'),
  "auth_version" INTEGER NOT NULL CHECK ("auth_version" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("auth_version">0),
  "runtime_epoch" TEXT NOT NULL CHECK (length(trim("runtime_epoch"))>0),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "last_seen_at" TEXT NOT NULL CHECK (length(trim("last_seen_at"))>0) CHECK (length("last_seen_at")=20 AND "last_seen_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"last_seen_at",'+0 seconds') IS "last_seen_at"),
  "expires_at" TEXT NOT NULL CHECK (length(trim("expires_at"))>0) CHECK (length("expires_at")=20 AND "expires_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"expires_at",'+0 seconds') IS "expires_at"),
  "revoked_at" TEXT CHECK ("revoked_at" IS NULL OR (length(trim("revoked_at"))>0)) CHECK ("revoked_at" IS NULL OR (length("revoked_at")=20 AND "revoked_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"revoked_at",'+0 seconds') IS "revoked_at")),
  "revocation_reason" TEXT CHECK ("revocation_reason" IS NULL OR (length(trim("revocation_reason"))>0)),
  UNIQUE ("token_hash"),
  UNIQUE ("id","account_id"),
  FOREIGN KEY ("account_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (created_at <= last_seen_at AND last_seen_at < expires_at AND expires_at <= strftime('%Y-%m-%dT%H:%M:%SZ',created_at,'+8 hours'))
) STRICT;

-- 身份验证事件
CREATE TABLE "authentication_event" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "account_id" INTEGER CHECK ("account_id" IS NULL OR ("account_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("account_id" IS NULL OR ("account_id">0)),
  "session_id" INTEGER CHECK ("session_id" IS NULL OR ("session_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("session_id" IS NULL OR ("session_id">0)),
  "event_type" TEXT NOT NULL CHECK (length(trim("event_type"))>0) CHECK ("event_type" IN ('成功','失败','注销','失效','限流')),
  "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0) CHECK (length("occurred_at")=20 AND "occurred_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"occurred_at",'+0 seconds') IS "occurred_at"),
  "login_digest" TEXT NOT NULL CHECK (length(trim("login_digest"))>0),
  "source_digest" TEXT NOT NULL CHECK (length(trim("source_digest"))>0),
  "reason_code" TEXT NOT NULL CHECK (length(trim("reason_code"))>0),
  "correlation_id" TEXT NOT NULL CHECK (length(trim("correlation_id"))>0),
  FOREIGN KEY ("account_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("session_id") REFERENCES "login_session"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("session_id","account_id") REFERENCES "login_session"("id","account_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (session_id IS NULL OR account_id IS NOT NULL)
) STRICT;

-- 操作提交
CREATE TABLE "request_submission" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "account_id" INTEGER NOT NULL CHECK ("account_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("account_id">0),
  "permission_id" INTEGER NOT NULL CHECK ("permission_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("permission_id">0),
  "request_key" TEXT NOT NULL CHECK (length(trim("request_key"))>0),
  "payload_digest" TEXT NOT NULL CHECK (length(trim("payload_digest"))>0) CHECK (length("payload_digest")=64 AND "payload_digest" NOT GLOB '*[^0-9a-f]*'),
  "command_version" INTEGER NOT NULL CHECK ("command_version" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("command_version">0),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('处理中','已提交')),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  "committed_at" TEXT CHECK ("committed_at" IS NULL OR (length(trim("committed_at"))>0)) CHECK ("committed_at" IS NULL OR (length("committed_at")=20 AND "committed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"committed_at",'+0 seconds') IS "committed_at")),
  "result_kind" TEXT CHECK ("result_kind" IS NULL OR (length(trim("result_kind"))>0)),
  "result_key" TEXT CHECK ("result_key" IS NULL OR (length(trim("result_key"))>0)),
  "result_revision" INTEGER CHECK ("result_revision" IS NULL OR ("result_revision" BETWEEN -9007199254740991 AND 9007199254740991)),
  "result_code" TEXT CHECK ("result_code" IS NULL OR (length(trim("result_code"))>0)),
  "correlation_id" TEXT NOT NULL CHECK (length(trim("correlation_id"))>0),
  UNIQUE ("account_id","request_key"),
  UNIQUE ("id","account_id"),
  UNIQUE ("id","permission_id"),
  FOREIGN KEY ("account_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("permission_id") REFERENCES "access_permission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (status='已提交'),
  CHECK (NOT (status='已提交') OR ("committed_at" IS NOT NULL AND "result_kind" IS NOT NULL AND "result_key" IS NOT NULL AND "result_revision" IS NOT NULL AND "result_code" IS NOT NULL)),
  CHECK (length(request_key)<=128)
) STRICT;

-- 操作审计
CREATE TABLE "operation_audit" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "account_id" INTEGER CHECK ("account_id" IS NULL OR ("account_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("account_id" IS NULL OR ("account_id">0)),
  "staff_id" INTEGER CHECK ("staff_id" IS NULL OR ("staff_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("staff_id" IS NULL OR ("staff_id">0)),
  "session_id" INTEGER CHECK ("session_id" IS NULL OR ("session_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("session_id" IS NULL OR ("session_id">0)),
  "submission_id" INTEGER CHECK ("submission_id" IS NULL OR ("submission_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("submission_id" IS NULL OR ("submission_id">0)),
  "permission_id" INTEGER CHECK ("permission_id" IS NULL OR ("permission_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("permission_id" IS NULL OR ("permission_id">0)),
  "actor_kind" TEXT NOT NULL CHECK (length(trim("actor_kind"))>0) CHECK ("actor_kind" IN ('职员','计划任务','初始化')),
  "event_type" TEXT NOT NULL CHECK (length(trim("event_type"))>0) CHECK ("event_type" IN ('变更','查询','拒绝','失败','运行事件')),
  "occurred_at" TEXT NOT NULL CHECK (length(trim("occurred_at"))>0) CHECK (length("occurred_at")=20 AND "occurred_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"occurred_at",'+0 seconds') IS "occurred_at"),
  "object_kind" TEXT NOT NULL CHECK (length(trim("object_kind"))>0),
  "object_key" TEXT NOT NULL CHECK (length(trim("object_key"))>0),
  "before_revision" INTEGER CHECK ("before_revision" IS NULL OR ("before_revision" BETWEEN -9007199254740991 AND 9007199254740991)),
  "after_revision" INTEGER CHECK ("after_revision" IS NULL OR ("after_revision" BETWEEN -9007199254740991 AND 9007199254740991)),
  "reason" TEXT NOT NULL CHECK (length(trim("reason"))>0),
  "outcome_code" TEXT NOT NULL CHECK (length(trim("outcome_code"))>0),
  "correlation_id" TEXT NOT NULL CHECK (length(trim("correlation_id"))>0),
  "authority_snapshot" TEXT NOT NULL CHECK (length(trim("authority_snapshot"))>0),
  FOREIGN KEY ("account_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("session_id") REFERENCES "login_session"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("submission_id") REFERENCES "request_submission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("permission_id") REFERENCES "access_permission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("session_id","account_id") REFERENCES "login_session"("id","account_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("submission_id","account_id") REFERENCES "request_submission"("id","account_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("account_id","staff_id") REFERENCES "user_account"("id","staff_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("submission_id","permission_id") REFERENCES "request_submission"("id","permission_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((session_id IS NULL OR account_id IS NOT NULL) AND (submission_id IS NULL OR (account_id IS NOT NULL AND permission_id IS NOT NULL)) AND (actor_kind <> '职员' OR (account_id IS NOT NULL AND staff_id IS NOT NULL))),
  CHECK (json_valid(authority_snapshot))
) STRICT;

-- 审计字段变化
CREATE TABLE "audit_change" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "audit_id" INTEGER NOT NULL CHECK ("audit_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("audit_id">0),
  "field_name" TEXT NOT NULL CHECK (length(trim("field_name"))>0),
  "value_type" TEXT NOT NULL CHECK (length(trim("value_type"))>0) CHECK ("value_type" IN ('text','integer','boolean')),
  "before_value" TEXT CHECK ("before_value" IS NULL OR (length(trim("before_value"))>0)),
  "after_value" TEXT CHECK ("after_value" IS NULL OR (length(trim("after_value"))>0)),
  "sequence_no" INTEGER NOT NULL CHECK ("sequence_no" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("sequence_no">0),
  UNIQUE ("audit_id","field_name"),
  UNIQUE ("audit_id","sequence_no"),
  FOREIGN KEY ("audit_id") REFERENCES "operation_audit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (before_value IS NULL OR CASE WHEN json_valid(before_value) THEN json_type(before_value) IN ('null','text','integer','true','false') ELSE 0 END),
  CHECK (after_value IS NULL OR CASE WHEN json_valid(after_value) THEN json_type(after_value) IN ('null','text','integer','true','false') ELSE 0 END)
) STRICT;

-- 备份任务
CREATE TABLE "backup_run" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "run_no" TEXT NOT NULL CHECK (length(trim("run_no"))>0),
  "trigger_kind" TEXT NOT NULL CHECK (length(trim("trigger_kind"))>0) CHECK ("trigger_kind" IN ('每日计划','手工','升级前')),
  "requested_by" INTEGER CHECK ("requested_by" IS NULL OR ("requested_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("requested_by" IS NULL OR ("requested_by">0)),
  "responsible_staff_id" INTEGER NOT NULL CHECK ("responsible_staff_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("responsible_staff_id">0),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待执行','运行中','成功','失败')),
  "started_at" TEXT CHECK ("started_at" IS NULL OR (length(trim("started_at"))>0)) CHECK ("started_at" IS NULL OR (length("started_at")=20 AND "started_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"started_at",'+0 seconds') IS "started_at")),
  "snapshot_at" TEXT CHECK ("snapshot_at" IS NULL OR (length(trim("snapshot_at"))>0)) CHECK ("snapshot_at" IS NULL OR (length("snapshot_at")=20 AND "snapshot_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"snapshot_at",'+0 seconds') IS "snapshot_at")),
  "finished_at" TEXT CHECK ("finished_at" IS NULL OR (length(trim("finished_at"))>0)) CHECK ("finished_at" IS NULL OR (length("finished_at")=20 AND "finished_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"finished_at",'+0 seconds') IS "finished_at")),
  "schema_version" INTEGER CHECK ("schema_version" IS NULL OR ("schema_version" BETWEEN -9007199254740991 AND 9007199254740991)),
  "application_version" TEXT CHECK ("application_version" IS NULL OR (length(trim("application_version"))>0)),
  "manifest_key" TEXT CHECK ("manifest_key" IS NULL OR (length(trim("manifest_key"))>0)),
  "manifest_sha256" TEXT CHECK ("manifest_sha256" IS NULL OR (length(trim("manifest_sha256"))>0)) CHECK ("manifest_sha256" IS NULL OR (length("manifest_sha256")=64 AND "manifest_sha256" NOT GLOB '*[^0-9a-f]*')),
  "error_code" TEXT CHECK ("error_code" IS NULL OR (length(trim("error_code"))>0)),
  "created_at" TEXT NOT NULL CHECK (length(trim("created_at"))>0) CHECK (length("created_at")=20 AND "created_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"created_at",'+0 seconds') IS "created_at"),
  UNIQUE ("run_no"),
  FOREIGN KEY ("requested_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("responsible_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status IN ('成功','失败')) OR ("finished_at" IS NOT NULL)),
  CHECK (NOT (status='成功') OR ("started_at" IS NOT NULL AND "snapshot_at" IS NOT NULL AND "schema_version" IS NOT NULL AND "application_version" IS NOT NULL AND "manifest_key" IS NOT NULL AND "manifest_sha256" IS NOT NULL)),
  CHECK (NOT (status='失败') OR ("error_code" IS NOT NULL))
) STRICT;

-- 备份文件清单
CREATE TABLE "backup_artifact" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "backup_id" INTEGER NOT NULL CHECK ("backup_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("backup_id">0),
  "artifact_kind" TEXT NOT NULL CHECK (length(trim("artifact_kind"))>0) CHECK ("artifact_kind" IN ('database','attachment')),
  "document_version_id" INTEGER CHECK ("document_version_id" IS NULL OR ("document_version_id" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("document_version_id" IS NULL OR ("document_version_id">0)),
  "relative_path" TEXT NOT NULL CHECK (length(trim("relative_path"))>0),
  "size_bytes" INTEGER NOT NULL CHECK ("size_bytes" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("size_bytes">=0),
  "sha256" TEXT NOT NULL CHECK (length(trim("sha256"))>0) CHECK (length("sha256")=64 AND "sha256" NOT GLOB '*[^0-9a-f]*'),
  "verification_status" TEXT NOT NULL CHECK (length(trim("verification_status"))>0) CHECK ("verification_status" IN ('待检','通过','缺失','不符')),
  "verified_at" TEXT CHECK ("verified_at" IS NULL OR (length(trim("verified_at"))>0)) CHECK ("verified_at" IS NULL OR (length("verified_at")=20 AND "verified_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"verified_at",'+0 seconds') IS "verified_at")),
  "result_note" TEXT CHECK ("result_note" IS NULL OR (length(trim("result_note"))>0)),
  UNIQUE ("backup_id","relative_path"),
  FOREIGN KEY ("backup_id") REFERENCES "backup_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("document_version_id") REFERENCES "document_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((artifact_kind = 'database' AND document_version_id IS NULL) OR (artifact_kind = 'attachment' AND document_version_id IS NOT NULL))
) STRICT;

-- 备份副本
CREATE TABLE "backup_copy" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "backup_id" INTEGER NOT NULL CHECK ("backup_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("backup_id">0),
  "location_kind" TEXT NOT NULL CHECK (length(trim("location_kind"))>0) CHECK ("location_kind" IN ('本地','异机')),
  "storage_key" TEXT NOT NULL CHECK (length(trim("storage_key"))>0),
  "manifest_sha256" TEXT NOT NULL CHECK (length(trim("manifest_sha256"))>0) CHECK (length("manifest_sha256")=64 AND "manifest_sha256" NOT GLOB '*[^0-9a-f]*'),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('复制中','已验证','失败','已移除')),
  "started_at" TEXT NOT NULL CHECK (length(trim("started_at"))>0) CHECK (length("started_at")=20 AND "started_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"started_at",'+0 seconds') IS "started_at"),
  "verified_at" TEXT CHECK ("verified_at" IS NULL OR (length(trim("verified_at"))>0)) CHECK ("verified_at" IS NULL OR (length("verified_at")=20 AND "verified_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"verified_at",'+0 seconds') IS "verified_at")),
  "removed_at" TEXT CHECK ("removed_at" IS NULL OR (length(trim("removed_at"))>0)) CHECK ("removed_at" IS NULL OR (length("removed_at")=20 AND "removed_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"removed_at",'+0 seconds') IS "removed_at")),
  "removal_reason" TEXT CHECK ("removal_reason" IS NULL OR (length(trim("removal_reason"))>0)),
  "verified_by" INTEGER CHECK ("verified_by" IS NULL OR ("verified_by" BETWEEN -9007199254740991 AND 9007199254740991)) CHECK ("verified_by" IS NULL OR ("verified_by">0)),
  "error_code" TEXT CHECK ("error_code" IS NULL OR (length(trim("error_code"))>0)),
  UNIQUE ("backup_id","location_kind","storage_key"),
  UNIQUE ("id","backup_id"),
  FOREIGN KEY ("backup_id") REFERENCES "backup_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("verified_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status='已验证') OR ("verified_at" IS NOT NULL)),
  CHECK (NOT (status='已移除') OR ("removed_at" IS NOT NULL AND "removal_reason" IS NOT NULL)),
  CHECK (NOT (status='失败') OR ("error_code" IS NOT NULL))
) STRICT;

-- 恢复验证
CREATE TABLE "restore_verification" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "backup_id" INTEGER NOT NULL CHECK ("backup_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("backup_id">0),
  "copy_id" INTEGER NOT NULL CHECK ("copy_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("copy_id">0),
  "verified_by" INTEGER NOT NULL CHECK ("verified_by" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("verified_by">0),
  "trigger_kind" TEXT NOT NULL CHECK (length(trim("trigger_kind"))>0) CHECK ("trigger_kind" IN ('每月','升级前','故障恢复')),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待执行','运行中','通过','失败')),
  "isolated_path" TEXT NOT NULL CHECK (length(trim("isolated_path"))>0),
  "started_at" TEXT CHECK ("started_at" IS NULL OR (length(trim("started_at"))>0)) CHECK ("started_at" IS NULL OR (length("started_at")=20 AND "started_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"started_at",'+0 seconds') IS "started_at")),
  "finished_at" TEXT CHECK ("finished_at" IS NULL OR (length(trim("finished_at"))>0)) CHECK ("finished_at" IS NULL OR (length("finished_at")=20 AND "finished_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"finished_at",'+0 seconds') IS "finished_at")),
  "source_snapshot_at" TEXT NOT NULL CHECK (length(trim("source_snapshot_at"))>0) CHECK (length("source_snapshot_at")=20 AND "source_snapshot_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"source_snapshot_at",'+0 seconds') IS "source_snapshot_at"),
  "recovery_target_at" TEXT NOT NULL CHECK (length(trim("recovery_target_at"))>0) CHECK (length("recovery_target_at")=20 AND "recovery_target_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"recovery_target_at",'+0 seconds') IS "recovery_target_at"),
  "application_version" TEXT NOT NULL CHECK (length(trim("application_version"))>0),
  "result_note" TEXT CHECK ("result_note" IS NULL OR (length(trim("result_note"))>0)),
  FOREIGN KEY ("backup_id") REFERENCES "backup_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("copy_id") REFERENCES "backup_copy"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("verified_by") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("copy_id","backup_id") REFERENCES "backup_copy"("id","backup_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status IN ('通过','失败')) OR ("started_at" IS NOT NULL AND "finished_at" IS NOT NULL AND "result_note" IS NOT NULL))
) STRICT;

-- 恢复检查明细
CREATE TABLE "restore_check" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL CHECK ("id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("id">0),
  "restore_id" INTEGER NOT NULL CHECK ("restore_id" BETWEEN -9007199254740991 AND 9007199254740991) CHECK ("restore_id">0),
  "check_code" TEXT NOT NULL CHECK (length(trim("check_code"))>0),
  "status" TEXT NOT NULL CHECK (length(trim("status"))>0) CHECK ("status" IN ('待检','通过','失败')),
  "checked_at" TEXT CHECK ("checked_at" IS NULL OR (length(trim("checked_at"))>0)) CHECK ("checked_at" IS NULL OR (length("checked_at")=20 AND "checked_at" GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',"checked_at",'+0 seconds') IS "checked_at")),
  "expected_value" TEXT NOT NULL CHECK (length(trim("expected_value"))>0),
  "actual_value" TEXT CHECK ("actual_value" IS NULL OR (length(trim("actual_value"))>0)),
  "evidence_key" TEXT CHECK ("evidence_key" IS NULL OR (length(trim("evidence_key"))>0)),
  "failure_note" TEXT CHECK ("failure_note" IS NULL OR (length(trim("failure_note"))>0)),
  UNIQUE ("restore_id","check_code"),
  FOREIGN KEY ("restore_id") REFERENCES "restore_verification"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (NOT (status IN ('通过','失败')) OR ("checked_at" IS NOT NULL AND "actual_value" IS NOT NULL)),
  CHECK (NOT (status='失败') OR ("failure_note" IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX "ux_treatment_execution_p1" ON "treatment_execution" ("original_execution_id") WHERE original_execution_id IS NOT NULL;

CREATE UNIQUE INDEX "ux_reconciliation_item_p1" ON "reconciliation_item" ("cash_reconciliation_id","patient_payment_id") WHERE patient_payment_id IS NOT NULL;

CREATE UNIQUE INDEX "ux_reconciliation_item_p2" ON "reconciliation_item" ("cash_reconciliation_id","patient_refund_id") WHERE patient_refund_id IS NOT NULL;

CREATE UNIQUE INDEX "ux_reconciliation_item_p3" ON "reconciliation_item" ("cash_reconciliation_id","supplier_payment_id") WHERE supplier_payment_id IS NOT NULL;

CREATE UNIQUE INDEX "ux_reconciliation_item_p4" ON "reconciliation_item" ("cash_reconciliation_id","supplier_refund_id") WHERE supplier_refund_id IS NOT NULL;

CREATE UNIQUE INDEX "ux_instrument_use_p1" ON "instrument_use" ("instrument_pack_cycle_id") WHERE use_status IN ('已发放','已使用');

CREATE UNIQUE INDEX "ux_backup_artifact_p1" ON "backup_artifact" ("backup_id") WHERE artifact_kind = 'database';

CREATE UNIQUE INDEX "ux_backup_artifact_p2" ON "backup_artifact" ("backup_id","document_version_id") WHERE artifact_kind = 'attachment';

CREATE UNIQUE INDEX "ux_backup_run_p1" ON "backup_run" ("trigger_kind") WHERE status = '运行中';

CREATE INDEX "ix_patient_q1" ON "patient" ("name");

CREATE INDEX "ix_patient_q2" ON "patient" ("phone");

CREATE INDEX "ix_patient_change_q1" ON "patient_change" ("patient_id","occurred_at");

CREATE INDEX "ix_appointment_q1" ON "appointment" ("planned_start","status");

CREATE INDEX "ix_appointment_q2" ON "appointment" ("patient_id","status","planned_start");

CREATE INDEX "ix_appointment_change_q1" ON "appointment_change" ("appointment_id","occurred_at");

CREATE INDEX "ix_dated_schedule_q1" ON "dated_schedule" ("dentist_id","status","starts_at","ends_at");

CREATE INDEX "ix_dated_schedule_q2" ON "dated_schedule" ("dental_chair_id","status","starts_at","ends_at");

CREATE INDEX "ix_resource_occupancy_q1" ON "resource_occupancy" ("dated_schedule_id","starts_at","ends_at") WHERE released_at IS NULL;

CREATE INDEX "ix_resource_occupancy_q2" ON "resource_occupancy" ("appointment_id") WHERE released_at IS NULL;

CREATE INDEX "ix_resource_occupancy_q3" ON "resource_occupancy" ("visit_id") WHERE released_at IS NULL;

CREATE INDEX "ix_visit_q1" ON "visit" ("patient_id","arrived_at");

CREATE INDEX "ix_visit_q2" ON "visit" ("dentist_id","status","arrived_at");

CREATE INDEX "ix_clinical_handover_q1" ON "clinical_handover" ("patient_id","receiving_dentist_id","valid_from");

CREATE INDEX "ix_record_addendum_q1" ON "record_addendum" ("clinical_record_id","added_at");

CREATE INDEX "ix_health_version_q1" ON "health_version" ("patient_id","effective_at");

CREATE INDEX "ix_health_review_q1" ON "health_review" ("visit_id","reviewed_at");

CREATE INDEX "ix_treatment_plan_q1" ON "treatment_plan" ("patient_id","status","established_at");

CREATE INDEX "ix_patient_decision_q1" ON "patient_decision" ("plan_version_id","decided_at","id");

CREATE INDEX "ix_treatment_execution_q1" ON "treatment_execution" ("plan_item_id","completed_at");

CREATE INDEX "ix_treatment_execution_q2" ON "treatment_execution" ("visit_id","completed_at");

CREATE INDEX "ix_clinical_document_q1" ON "clinical_document" ("patient_id","document_type","created_at");

CREATE INDEX "ix_service_price_q1" ON "service_price" ("service_id","status","valid_from","valid_until");

CREATE INDEX "ix_bill_q1" ON "bill" ("patient_id","formed_at");

CREATE INDEX "ix_bill_item_q1" ON "bill_item" ("bill_id","pricing_status");

CREATE INDEX "ix_patient_payment_q1" ON "patient_payment" ("patient_funds_id","status","received_at");

CREATE INDEX "ix_payment_allocation_q1" ON "payment_allocation" ("bill_id","effective_at");

CREATE INDEX "ix_prepayment_offset_q1" ON "prepayment_offset" ("bill_id","effective_at");

CREATE INDEX "ix_fee_request_q1" ON "fee_request" ("status","submitted_at");

CREATE INDEX "ix_patient_refund_q1" ON "patient_refund" ("fee_request_id","status");

CREATE INDEX "ix_patient_refund_q2" ON "patient_refund" ("patient_payment_id","status");

CREATE INDEX "ix_followup_requirement_q1" ON "followup_requirement" ("responsible_frontdesk_id","status","next_contact_date");

CREATE INDEX "ix_followup_requirement_q2" ON "followup_requirement" ("patient_id","status","target_start");

CREATE INDEX "ix_contact_history_q1" ON "contact_history" ("followup_requirement_id","contacted_at");

CREATE INDEX "ix_clinical_assessment_q1" ON "clinical_assessment" ("followup_requirement_id","assessed_at");

CREATE INDEX "ix_material_batch_q1" ON "material_batch" ("material_id","status","expiry_date");

CREATE INDEX "ix_inventory_movement_q1" ON "inventory_movement" ("batch_stock_id","occurred_at","id");

CREATE INDEX "ix_material_usage_q1" ON "material_usage" ("visit_id","used_at");

CREATE INDEX "ix_stock_count_q1" ON "stock_count" ("status","counted_at");

CREATE INDEX "ix_purchase_order_q1" ON "purchase_order" ("supplier_id","status","agreed_at");

CREATE INDEX "ix_purchase_receipt_q1" ON "purchase_receipt" ("purchase_order_id","arrived_at");

CREATE INDEX "ix_purchase_receipt_item_q1" ON "purchase_receipt_item" ("purchase_order_item_id");

CREATE INDEX "ix_purchase_issue_q1" ON "purchase_issue" ("status","created_at");

CREATE INDEX "ix_supplier_payment_q1" ON "supplier_payment" ("supplier_funds_id","status","initiated_at");

CREATE INDEX "ix_supplier_allocation_q1" ON "supplier_allocation" ("purchase_order_id","allocation_state");

CREATE INDEX "ix_supplier_allocation_q2" ON "supplier_allocation" ("purchase_receipt_id","allocation_state");

CREATE INDEX "ix_supplier_refund_q1" ON "supplier_refund" ("supplier_payment_id","received_at");

CREATE INDEX "ix_instrument_processing_q1" ON "instrument_processing" ("status","started_at");

CREATE INDEX "ix_instrument_pack_cycle_q1" ON "instrument_pack_cycle" ("instrument_pack_id","status","expires_at");

CREATE INDEX "ix_instrument_use_q1" ON "instrument_use" ("visit_id","issued_at");

CREATE INDEX "ix_cash_reconciliation_q1" ON "cash_reconciliation" ("business_date","channel","cutoff_at");

CREATE INDEX "ix_issue_followup_q1" ON "issue_followup" ("assigned_to","status","due_date");

CREATE INDEX "ix_patient_payment_q2" ON "patient_payment" ("channel","received_at");

CREATE INDEX "ix_patient_refund_q3" ON "patient_refund" ("channel","verified_at");

CREATE INDEX "ix_supplier_payment_q2" ON "supplier_payment" ("channel","verified_at");

CREATE INDEX "ix_supplier_refund_q2" ON "supplier_refund" ("channel","received_at");

CREATE INDEX "ix_account_role_q1" ON "account_role" ("account_id","role_id","granted_at");

CREATE INDEX "ix_staff_role_qualification_q1" ON "staff_role_qualification" ("staff_id","role_id","valid_from");

CREATE INDEX "ix_authentication_event_q1" ON "authentication_event" ("login_digest","source_digest","occurred_at");

CREATE INDEX "ix_authentication_event_q2" ON "authentication_event" ("source_digest","occurred_at");

CREATE INDEX "ix_authentication_event_q3" ON "authentication_event" ("login_digest","occurred_at");

CREATE INDEX "ix_operation_audit_q1" ON "operation_audit" ("object_kind","object_key","occurred_at");

CREATE INDEX "ix_operation_audit_q2" ON "operation_audit" ("submission_id");

CREATE INDEX "ix_backup_run_q1" ON "backup_run" ("status","created_at");

CREATE INDEX "ix_backup_copy_q1" ON "backup_copy" ("backup_id","status");

CREATE INDEX "ix_restore_verification_q1" ON "restore_verification" ("backup_id","started_at");

CREATE INDEX "ix_fk_patient_created_by" ON "patient" ("created_by");

CREATE INDEX "ix_fk_staff_created_by" ON "staff" ("created_by");

CREATE INDEX "ix_fk_patient_change_operator_id" ON "patient_change" ("operator_id");

CREATE INDEX "ix_fk_patient_proxy_patient_id" ON "patient_proxy" ("patient_id");

CREATE INDEX "ix_fk_patient_proxy_verified_by" ON "patient_proxy" ("verified_by");

CREATE INDEX "ix_fk_clinical_handover_receiving_dentist_id" ON "clinical_handover" ("receiving_dentist_id");

CREATE INDEX "ix_fk_clinical_handover_handover_by" ON "clinical_handover" ("handover_by");

CREATE INDEX "ix_fk_dental_chair_created_by" ON "dental_chair" ("created_by");

CREATE INDEX "ix_fk_dated_schedule_created_by" ON "dated_schedule" ("created_by");

CREATE INDEX "ix_fk_dated_schedule_confirmed_by" ON "dated_schedule" ("confirmed_by");

CREATE INDEX "ix_fk_schedule_change_dated_schedule_id" ON "schedule_change" ("dated_schedule_id");

CREATE INDEX "ix_fk_schedule_change_operator_id" ON "schedule_change" ("operator_id");

CREATE INDEX "ix_fk_schedule_change_old_dentist_id" ON "schedule_change" ("old_dentist_id");

CREATE INDEX "ix_fk_schedule_change_new_dentist_id" ON "schedule_change" ("new_dentist_id");

CREATE INDEX "ix_fk_schedule_change_old_chair_id" ON "schedule_change" ("old_chair_id");

CREATE INDEX "ix_fk_schedule_change_new_chair_id" ON "schedule_change" ("new_chair_id");

CREATE INDEX "ix_fk_resource_occupancy_visit_id_appointment_id" ON "resource_occupancy" ("visit_id","appointment_id");

CREATE INDEX "ix_fk_resource_occupancy_dated_schedule_id" ON "resource_occupancy" ("dated_schedule_id");

CREATE INDEX "ix_fk_resource_occupancy_appointment_id" ON "resource_occupancy" ("appointment_id");

CREATE INDEX "ix_fk_resource_occupancy_created_by" ON "resource_occupancy" ("created_by");

CREATE INDEX "ix_fk_resource_occupancy_released_by" ON "resource_occupancy" ("released_by");

CREATE INDEX "ix_fk_appointment_created_by" ON "appointment" ("created_by");

CREATE INDEX "ix_fk_appointment_notified_by" ON "appointment" ("notified_by");

CREATE INDEX "ix_fk_appointment_change_operator_id" ON "appointment_change" ("operator_id");

CREATE INDEX "ix_fk_appointment_change_old_schedule_id" ON "appointment_change" ("old_schedule_id");

CREATE INDEX "ix_fk_appointment_change_new_schedule_id" ON "appointment_change" ("new_schedule_id");

CREATE INDEX "ix_fk_visit_appointment_id_patient_id" ON "visit" ("appointment_id","patient_id");

CREATE INDEX "ix_fk_visit_registered_by" ON "visit" ("registered_by");

CREATE INDEX "ix_fk_health_version_previous_version_id_patient_id" ON "health_version" ("previous_version_id","patient_id");

CREATE INDEX "ix_fk_health_version_created_by" ON "health_version" ("created_by");

CREATE INDEX "ix_fk_health_item_health_version_id" ON "health_item" ("health_version_id");

CREATE INDEX "ix_fk_health_review_health_version_id" ON "health_review" ("health_version_id");

CREATE INDEX "ix_fk_health_review_reviewed_by" ON "health_review" ("reviewed_by");

CREATE INDEX "ix_fk_clinical_record_signed_by" ON "clinical_record" ("signed_by");

CREATE INDEX "ix_fk_clinical_finding_recorded_by" ON "clinical_finding" ("recorded_by");

CREATE INDEX "ix_fk_record_addendum_signed_by" ON "record_addendum" ("signed_by");

CREATE INDEX "ix_fk_clinical_document_visit_id" ON "clinical_document" ("visit_id");

CREATE INDEX "ix_fk_clinical_document_plan_version_id" ON "clinical_document" ("plan_version_id");

CREATE INDEX "ix_fk_clinical_document_created_by" ON "clinical_document" ("created_by");

CREATE INDEX "ix_fk_document_version_previous_version_id_clinical_document_id" ON "document_version" ("previous_version_id","clinical_document_id");

CREATE INDEX "ix_fk_document_version_uploaded_by" ON "document_version" ("uploaded_by");

CREATE INDEX "ix_fk_document_version_confirmed_by" ON "document_version" ("confirmed_by");

CREATE INDEX "ix_fk_treatment_plan_created_by" ON "treatment_plan" ("created_by");

CREATE INDEX "ix_fk_treatment_plan_closed_by" ON "treatment_plan" ("closed_by");

CREATE INDEX "ix_fk_plan_version_previous_version_id_treatment_plan_id" ON "plan_version" ("previous_version_id","treatment_plan_id");

CREATE INDEX "ix_fk_plan_version_source_visit_id" ON "plan_version" ("source_visit_id");

CREATE INDEX "ix_fk_plan_version_created_by" ON "plan_version" ("created_by");

CREATE INDEX "ix_fk_plan_version_explained_by" ON "plan_version" ("explained_by");

CREATE INDEX "ix_fk_patient_decision_patient_proxy_id" ON "patient_decision" ("patient_proxy_id");

CREATE INDEX "ix_fk_patient_decision_explained_by" ON "patient_decision" ("explained_by");

CREATE INDEX "ix_fk_patient_decision_recorded_by" ON "patient_decision" ("recorded_by");

CREATE INDEX "ix_fk_treatment_execution_service_id" ON "treatment_execution" ("service_id");

CREATE INDEX "ix_fk_treatment_execution_original_execution_id" ON "treatment_execution" ("original_execution_id");

CREATE INDEX "ix_fk_treatment_execution_performed_by" ON "treatment_execution" ("performed_by");

CREATE INDEX "ix_fk_service_created_by" ON "service" ("created_by");

CREATE INDEX "ix_fk_service_price_created_by" ON "service_price" ("created_by");

CREATE INDEX "ix_fk_service_price_confirmed_by" ON "service_price" ("confirmed_by");

CREATE INDEX "ix_fk_bill_patient_funds_id_patient_id" ON "bill" ("patient_funds_id","patient_id");

CREATE INDEX "ix_fk_bill_created_by" ON "bill" ("created_by");

CREATE INDEX "ix_fk_bill_item_service_price_id" ON "bill_item" ("service_price_id");

CREATE INDEX "ix_fk_bill_item_priced_by" ON "bill_item" ("priced_by");

CREATE INDEX "ix_fk_patient_funds_opened_by" ON "patient_funds" ("opened_by");

CREATE INDEX "ix_fk_patient_payment_operator_id" ON "patient_payment" ("operator_id");

CREATE INDEX "ix_fk_patient_payment_verified_by" ON "patient_payment" ("verified_by");

CREATE INDEX "ix_fk_payment_allocation_original_allocation_id_patient_payment_id_bill_id" ON "payment_allocation" ("original_allocation_id","patient_payment_id","bill_id");

CREATE INDEX "ix_fk_payment_allocation_patient_payment_id" ON "payment_allocation" ("patient_payment_id");

CREATE INDEX "ix_fk_payment_allocation_operator_id" ON "payment_allocation" ("operator_id");

CREATE INDEX "ix_fk_payment_allocation_fee_request_id" ON "payment_allocation" ("fee_request_id");

CREATE INDEX "ix_fk_prepayment_offset_original_offset_id_patient_payment_id_bill_id" ON "prepayment_offset" ("original_offset_id","patient_payment_id","bill_id");

CREATE INDEX "ix_fk_prepayment_offset_patient_payment_id" ON "prepayment_offset" ("patient_payment_id");

CREATE INDEX "ix_fk_prepayment_offset_operator_id" ON "prepayment_offset" ("operator_id");

CREATE INDEX "ix_fk_prepayment_offset_fee_request_id" ON "prepayment_offset" ("fee_request_id");

CREATE INDEX "ix_fk_fee_request_bill_id_patient_funds_id" ON "fee_request" ("bill_id","patient_funds_id");

CREATE INDEX "ix_fk_fee_request_patient_payment_id_patient_funds_id" ON "fee_request" ("patient_payment_id","patient_funds_id");

CREATE INDEX "ix_fk_fee_request_patient_funds_id" ON "fee_request" ("patient_funds_id");

CREATE INDEX "ix_fk_fee_request_created_by" ON "fee_request" ("created_by");

CREATE INDEX "ix_fk_fee_request_reviewed_by" ON "fee_request" ("reviewed_by");

CREATE INDEX "ix_fk_fee_adjustment_fee_request_id_bill_id" ON "fee_adjustment" ("fee_request_id","bill_id");

CREATE INDEX "ix_fk_fee_adjustment_bill_id" ON "fee_adjustment" ("bill_id");

CREATE INDEX "ix_fk_fee_adjustment_approved_by" ON "fee_adjustment" ("approved_by");

CREATE INDEX "ix_fk_fee_adjustment_item_bill_item_id" ON "fee_adjustment_item" ("bill_item_id");

CREATE INDEX "ix_fk_patient_refund_fee_request_id_patient_funds_id" ON "patient_refund" ("fee_request_id","patient_funds_id");

CREATE INDEX "ix_fk_patient_refund_patient_payment_id_patient_funds_id" ON "patient_refund" ("patient_payment_id","patient_funds_id");

CREATE INDEX "ix_fk_patient_refund_previous_attempt_id_patient_funds_id" ON "patient_refund" ("previous_attempt_id","patient_funds_id");

CREATE INDEX "ix_fk_patient_refund_patient_funds_id" ON "patient_refund" ("patient_funds_id");

CREATE INDEX "ix_fk_patient_refund_operator_id" ON "patient_refund" ("operator_id");

CREATE INDEX "ix_fk_patient_refund_verified_by" ON "patient_refund" ("verified_by");

CREATE INDEX "ix_fk_followup_requirement_source_visit_id" ON "followup_requirement" ("source_visit_id");

CREATE INDEX "ix_fk_followup_requirement_source_plan_version_id" ON "followup_requirement" ("source_plan_version_id");

CREATE INDEX "ix_fk_followup_requirement_created_by" ON "followup_requirement" ("created_by");

CREATE INDEX "ix_fk_followup_requirement_closed_by" ON "followup_requirement" ("closed_by");

CREATE INDEX "ix_fk_contact_history_appointment_id" ON "contact_history" ("appointment_id");

CREATE INDEX "ix_fk_contact_history_operator_id" ON "contact_history" ("operator_id");

CREATE INDEX "ix_fk_clinical_assessment_visit_id" ON "clinical_assessment" ("visit_id");

CREATE INDEX "ix_fk_clinical_assessment_assessed_by" ON "clinical_assessment" ("assessed_by");

CREATE INDEX "ix_fk_clinical_assessment_responsible_staff_id" ON "clinical_assessment" ("responsible_staff_id");

CREATE INDEX "ix_fk_material_created_by" ON "material" ("created_by");

CREATE INDEX "ix_fk_material_confirmed_by" ON "material" ("confirmed_by");

CREATE INDEX "ix_fk_material_batch_created_by" ON "material_batch" ("created_by");

CREATE INDEX "ix_fk_batch_change_material_batch_id" ON "batch_change" ("material_batch_id");

CREATE INDEX "ix_fk_batch_change_operator_id" ON "batch_change" ("operator_id");

CREATE INDEX "ix_fk_batch_change_confirmed_by" ON "batch_change" ("confirmed_by");

CREATE INDEX "ix_fk_stock_location_created_by" ON "stock_location" ("created_by");

CREATE INDEX "ix_fk_batch_stock_stock_location_id" ON "batch_stock" ("stock_location_id");

CREATE INDEX "ix_fk_inventory_movement_original_movement_id_batch_stock_id" ON "inventory_movement" ("original_movement_id","batch_stock_id");

CREATE INDEX "ix_fk_inventory_movement_stock_count_id_batch_stock_id" ON "inventory_movement" ("stock_count_id","batch_stock_id");

CREATE INDEX "ix_fk_inventory_movement_purchase_receipt_item_id" ON "inventory_movement" ("purchase_receipt_item_id");

CREATE INDEX "ix_fk_inventory_movement_operator_id" ON "inventory_movement" ("operator_id");

CREATE INDEX "ix_fk_inventory_movement_purchase_issue_id" ON "inventory_movement" ("purchase_issue_id");

CREATE INDEX "ix_fk_material_usage_inventory_movement_id" ON "material_usage" ("inventory_movement_id");

CREATE INDEX "ix_fk_material_usage_operator_id" ON "material_usage" ("operator_id");

CREATE INDEX "ix_fk_stock_count_batch_stock_id" ON "stock_count" ("batch_stock_id");

CREATE INDEX "ix_fk_stock_count_operator_id" ON "stock_count" ("operator_id");

CREATE INDEX "ix_fk_stock_count_confirmed_by" ON "stock_count" ("confirmed_by");

CREATE INDEX "ix_fk_supplier_created_by" ON "supplier" ("created_by");

CREATE INDEX "ix_fk_supplier_verified_by" ON "supplier" ("verified_by");

CREATE INDEX "ix_fk_purchase_order_created_by" ON "purchase_order" ("created_by");

CREATE INDEX "ix_fk_purchase_order_confirmed_by" ON "purchase_order" ("confirmed_by");

CREATE INDEX "ix_fk_purchase_order_item_material_id" ON "purchase_order_item" ("material_id");

CREATE INDEX "ix_fk_purchase_receipt_operator_id" ON "purchase_receipt" ("operator_id");

CREATE INDEX "ix_fk_purchase_receipt_confirmed_by" ON "purchase_receipt" ("confirmed_by");

CREATE INDEX "ix_fk_purchase_receipt_item_purchase_receipt_id" ON "purchase_receipt_item" ("purchase_receipt_id");

CREATE INDEX "ix_fk_purchase_receipt_item_material_batch_id" ON "purchase_receipt_item" ("material_batch_id");

CREATE INDEX "ix_fk_purchase_receipt_item_stock_location_id" ON "purchase_receipt_item" ("stock_location_id");

CREATE INDEX "ix_fk_purchase_issue_purchase_receipt_item_id_purchase_order_item_id" ON "purchase_issue" ("purchase_receipt_item_id","purchase_order_item_id");

CREATE INDEX "ix_fk_purchase_issue_purchase_order_item_id" ON "purchase_issue" ("purchase_order_item_id");

CREATE INDEX "ix_fk_purchase_issue_created_by" ON "purchase_issue" ("created_by");

CREATE INDEX "ix_fk_purchase_issue_confirmed_by" ON "purchase_issue" ("confirmed_by");

CREATE INDEX "ix_fk_supplier_funds_opened_by" ON "supplier_funds" ("opened_by");

CREATE INDEX "ix_fk_supplier_payment_previous_attempt_id_supplier_funds_id" ON "supplier_payment" ("previous_attempt_id","supplier_funds_id");

CREATE INDEX "ix_fk_supplier_payment_authorized_by" ON "supplier_payment" ("authorized_by");

CREATE INDEX "ix_fk_supplier_payment_operator_id" ON "supplier_payment" ("operator_id");

CREATE INDEX "ix_fk_supplier_payment_verified_by" ON "supplier_payment" ("verified_by");

CREATE INDEX "ix_fk_supplier_allocation_original_allocation_id_supplier_payment_id" ON "supplier_allocation" ("original_allocation_id","supplier_payment_id");

CREATE INDEX "ix_fk_supplier_allocation_supplier_payment_id" ON "supplier_allocation" ("supplier_payment_id");

CREATE INDEX "ix_fk_supplier_allocation_operator_id" ON "supplier_allocation" ("operator_id");

CREATE INDEX "ix_fk_supplier_allocation_purchase_issue_id" ON "supplier_allocation" ("purchase_issue_id");

CREATE INDEX "ix_fk_supplier_refund_supplier_payment_id_supplier_funds_id" ON "supplier_refund" ("supplier_payment_id","supplier_funds_id");

CREATE INDEX "ix_fk_supplier_refund_purchase_issue_id" ON "supplier_refund" ("purchase_issue_id");

CREATE INDEX "ix_fk_supplier_refund_supplier_funds_id" ON "supplier_refund" ("supplier_funds_id");

CREATE INDEX "ix_fk_supplier_refund_operator_id" ON "supplier_refund" ("operator_id");

CREATE INDEX "ix_fk_supplier_refund_verified_by" ON "supplier_refund" ("verified_by");

CREATE INDEX "ix_fk_instrument_pack_created_by" ON "instrument_pack" ("created_by");

CREATE INDEX "ix_fk_processing_equipment_created_by" ON "processing_equipment" ("created_by");

CREATE INDEX "ix_fk_instrument_processing_processing_equipment_id" ON "instrument_processing" ("processing_equipment_id");

CREATE INDEX "ix_fk_instrument_processing_previous_processing_id" ON "instrument_processing" ("previous_processing_id");

CREATE INDEX "ix_fk_instrument_processing_operator_id" ON "instrument_processing" ("operator_id");

CREATE INDEX "ix_fk_instrument_processing_released_by" ON "instrument_processing" ("released_by");

CREATE INDEX "ix_fk_instrument_processing_isolated_by" ON "instrument_processing" ("isolated_by");

CREATE INDEX "ix_fk_instrument_pack_cycle_checked_by" ON "instrument_pack_cycle" ("checked_by");

CREATE INDEX "ix_fk_processing_monitor_instrument_processing_id" ON "processing_monitor" ("instrument_processing_id");

CREATE INDEX "ix_fk_processing_monitor_recorded_by" ON "processing_monitor" ("recorded_by");

CREATE INDEX "ix_fk_instrument_use_instrument_pack_cycle_id" ON "instrument_use" ("instrument_pack_cycle_id");

CREATE INDEX "ix_fk_instrument_use_operator_id" ON "instrument_use" ("operator_id");

CREATE INDEX "ix_fk_instrument_use_used_by" ON "instrument_use" ("used_by");

CREATE INDEX "ix_fk_cash_reconciliation_operator_id" ON "cash_reconciliation" ("operator_id");

CREATE INDEX "ix_fk_reconciliation_item_cash_reconciliation_id" ON "reconciliation_item" ("cash_reconciliation_id");

CREATE INDEX "ix_fk_reconciliation_item_patient_payment_id" ON "reconciliation_item" ("patient_payment_id");

CREATE INDEX "ix_fk_reconciliation_item_patient_refund_id" ON "reconciliation_item" ("patient_refund_id");

CREATE INDEX "ix_fk_reconciliation_item_supplier_payment_id" ON "reconciliation_item" ("supplier_payment_id");

CREATE INDEX "ix_fk_reconciliation_item_supplier_refund_id" ON "reconciliation_item" ("supplier_refund_id");

CREATE INDEX "ix_fk_issue_followup_cash_reconciliation_id" ON "issue_followup" ("cash_reconciliation_id");

CREATE INDEX "ix_fk_issue_followup_instrument_processing_id" ON "issue_followup" ("instrument_processing_id");

CREATE INDEX "ix_fk_issue_followup_created_by" ON "issue_followup" ("created_by");

CREATE INDEX "ix_fk_issue_followup_completed_by" ON "issue_followup" ("completed_by");

CREATE INDEX "ix_fk_decision_plan_item_plan_item_id" ON "decision_plan_item" ("plan_item_id");

CREATE INDEX "ix_fk_decision_plan_item_linked_by" ON "decision_plan_item" ("linked_by");

CREATE INDEX "ix_fk_decision_file_version_document_version_id" ON "decision_file_version" ("document_version_id");

CREATE INDEX "ix_fk_decision_file_version_linked_by" ON "decision_file_version" ("linked_by");

CREATE INDEX "ix_fk_staff_role_qualification_role_id" ON "staff_role_qualification" ("role_id");

CREATE INDEX "ix_fk_staff_role_qualification_verified_by" ON "staff_role_qualification" ("verified_by");

CREATE INDEX "ix_fk_staff_role_qualification_revoked_by" ON "staff_role_qualification" ("revoked_by");

CREATE INDEX "ix_fk_account_role_qualification_id_role_id" ON "account_role" ("qualification_id","role_id");

CREATE INDEX "ix_fk_account_role_role_id" ON "account_role" ("role_id");

CREATE INDEX "ix_fk_account_role_granted_by" ON "account_role" ("granted_by");

CREATE INDEX "ix_fk_account_role_revoked_by" ON "account_role" ("revoked_by");

CREATE INDEX "ix_fk_role_permission_permission_id" ON "role_permission" ("permission_id");

CREATE INDEX "ix_fk_login_session_account_id" ON "login_session" ("account_id");

CREATE INDEX "ix_fk_authentication_event_session_id_account_id" ON "authentication_event" ("session_id","account_id");

CREATE INDEX "ix_fk_authentication_event_account_id" ON "authentication_event" ("account_id");

CREATE INDEX "ix_fk_request_submission_permission_id" ON "request_submission" ("permission_id");

CREATE INDEX "ix_fk_operation_audit_session_id_account_id" ON "operation_audit" ("session_id","account_id");

CREATE INDEX "ix_fk_operation_audit_submission_id_account_id" ON "operation_audit" ("submission_id","account_id");

CREATE INDEX "ix_fk_operation_audit_account_id_staff_id" ON "operation_audit" ("account_id","staff_id");

CREATE INDEX "ix_fk_operation_audit_submission_id_permission_id" ON "operation_audit" ("submission_id","permission_id");

CREATE INDEX "ix_fk_operation_audit_staff_id" ON "operation_audit" ("staff_id");

CREATE INDEX "ix_fk_operation_audit_permission_id" ON "operation_audit" ("permission_id");

CREATE INDEX "ix_fk_backup_run_requested_by" ON "backup_run" ("requested_by");

CREATE INDEX "ix_fk_backup_run_responsible_staff_id" ON "backup_run" ("responsible_staff_id");

CREATE INDEX "ix_fk_backup_artifact_document_version_id" ON "backup_artifact" ("document_version_id");

CREATE INDEX "ix_fk_backup_copy_verified_by" ON "backup_copy" ("verified_by");

CREATE INDEX "ix_fk_restore_verification_copy_id_backup_id" ON "restore_verification" ("copy_id","backup_id");

CREATE INDEX "ix_fk_restore_verification_verified_by" ON "restore_verification" ("verified_by");

CREATE TRIGGER "tr_patient_delete_forbidden_delete" BEFORE DELETE ON "patient" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_patient_stable_id_update" BEFORE UPDATE ON "patient" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_staff_delete_forbidden_delete" BEFORE DELETE ON "staff" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_staff_stable_id_update" BEFORE UPDATE ON "staff" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_patient_change_delete_forbidden_delete" BEFORE DELETE ON "patient_change" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_patient_change_stable_id_update" BEFORE UPDATE ON "patient_change" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_patient_proxy_delete_forbidden_delete" BEFORE DELETE ON "patient_proxy" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_patient_proxy_stable_id_update" BEFORE UPDATE ON "patient_proxy" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_clinical_handover_delete_forbidden_delete" BEFORE DELETE ON "clinical_handover" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_clinical_handover_stable_id_update" BEFORE UPDATE ON "clinical_handover" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_dental_chair_delete_forbidden_delete" BEFORE DELETE ON "dental_chair" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_dental_chair_stable_id_update" BEFORE UPDATE ON "dental_chair" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_dated_schedule_delete_forbidden_delete" BEFORE DELETE ON "dated_schedule" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_dated_schedule_stable_id_update" BEFORE UPDATE ON "dated_schedule" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_schedule_change_delete_forbidden_delete" BEFORE DELETE ON "schedule_change" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_schedule_change_stable_id_update" BEFORE UPDATE ON "schedule_change" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_resource_occupancy_delete_forbidden_delete" BEFORE DELETE ON "resource_occupancy" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_resource_occupancy_stable_id_update" BEFORE UPDATE ON "resource_occupancy" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_appointment_delete_forbidden_delete" BEFORE DELETE ON "appointment" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_appointment_stable_id_update" BEFORE UPDATE ON "appointment" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_appointment_change_delete_forbidden_delete" BEFORE DELETE ON "appointment_change" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_appointment_change_stable_id_update" BEFORE UPDATE ON "appointment_change" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_visit_delete_forbidden_delete" BEFORE DELETE ON "visit" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_visit_stable_id_update" BEFORE UPDATE ON "visit" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_health_version_delete_forbidden_delete" BEFORE DELETE ON "health_version" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_health_version_stable_id_update" BEFORE UPDATE ON "health_version" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_health_item_delete_forbidden_delete" BEFORE DELETE ON "health_item" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_health_item_stable_id_update" BEFORE UPDATE ON "health_item" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_health_review_delete_forbidden_delete" BEFORE DELETE ON "health_review" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_health_review_stable_id_update" BEFORE UPDATE ON "health_review" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_clinical_record_delete_forbidden_delete" BEFORE DELETE ON "clinical_record" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_clinical_record_stable_id_update" BEFORE UPDATE ON "clinical_record" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_clinical_finding_delete_forbidden_delete" BEFORE DELETE ON "clinical_finding" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_clinical_finding_stable_id_update" BEFORE UPDATE ON "clinical_finding" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_record_addendum_delete_forbidden_delete" BEFORE DELETE ON "record_addendum" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_record_addendum_stable_id_update" BEFORE UPDATE ON "record_addendum" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_clinical_document_delete_forbidden_delete" BEFORE DELETE ON "clinical_document" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_clinical_document_stable_id_update" BEFORE UPDATE ON "clinical_document" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_document_version_delete_forbidden_delete" BEFORE DELETE ON "document_version" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_document_version_stable_id_update" BEFORE UPDATE ON "document_version" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_treatment_plan_delete_forbidden_delete" BEFORE DELETE ON "treatment_plan" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_treatment_plan_stable_id_update" BEFORE UPDATE ON "treatment_plan" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_plan_version_delete_forbidden_delete" BEFORE DELETE ON "plan_version" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_plan_version_stable_id_update" BEFORE UPDATE ON "plan_version" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_plan_item_delete_forbidden_delete" BEFORE DELETE ON "plan_item" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_plan_item_stable_id_update" BEFORE UPDATE ON "plan_item" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_patient_decision_delete_forbidden_delete" BEFORE DELETE ON "patient_decision" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_patient_decision_stable_id_update" BEFORE UPDATE ON "patient_decision" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_treatment_execution_delete_forbidden_delete" BEFORE DELETE ON "treatment_execution" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_treatment_execution_stable_id_update" BEFORE UPDATE ON "treatment_execution" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_service_delete_forbidden_delete" BEFORE DELETE ON "service" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_service_stable_id_update" BEFORE UPDATE ON "service" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_service_price_delete_forbidden_delete" BEFORE DELETE ON "service_price" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_service_price_stable_id_update" BEFORE UPDATE ON "service_price" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_bill_delete_forbidden_delete" BEFORE DELETE ON "bill" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_bill_stable_id_update" BEFORE UPDATE ON "bill" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_bill_item_delete_forbidden_delete" BEFORE DELETE ON "bill_item" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_bill_item_stable_id_update" BEFORE UPDATE ON "bill_item" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_patient_funds_delete_forbidden_delete" BEFORE DELETE ON "patient_funds" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_patient_funds_stable_id_update" BEFORE UPDATE ON "patient_funds" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_patient_payment_delete_forbidden_delete" BEFORE DELETE ON "patient_payment" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_patient_payment_stable_id_update" BEFORE UPDATE ON "patient_payment" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_payment_allocation_delete_forbidden_delete" BEFORE DELETE ON "payment_allocation" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_payment_allocation_stable_id_update" BEFORE UPDATE ON "payment_allocation" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_prepayment_offset_delete_forbidden_delete" BEFORE DELETE ON "prepayment_offset" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_prepayment_offset_stable_id_update" BEFORE UPDATE ON "prepayment_offset" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_fee_request_delete_forbidden_delete" BEFORE DELETE ON "fee_request" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_fee_request_stable_id_update" BEFORE UPDATE ON "fee_request" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_fee_adjustment_delete_forbidden_delete" BEFORE DELETE ON "fee_adjustment" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_fee_adjustment_stable_id_update" BEFORE UPDATE ON "fee_adjustment" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_fee_adjustment_item_delete_forbidden_delete" BEFORE DELETE ON "fee_adjustment_item" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_fee_adjustment_item_stable_id_update" BEFORE UPDATE ON "fee_adjustment_item" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_patient_refund_delete_forbidden_delete" BEFORE DELETE ON "patient_refund" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_patient_refund_stable_id_update" BEFORE UPDATE ON "patient_refund" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_followup_requirement_delete_forbidden_delete" BEFORE DELETE ON "followup_requirement" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_followup_requirement_stable_id_update" BEFORE UPDATE ON "followup_requirement" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_contact_history_delete_forbidden_delete" BEFORE DELETE ON "contact_history" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_contact_history_stable_id_update" BEFORE UPDATE ON "contact_history" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_clinical_assessment_delete_forbidden_delete" BEFORE DELETE ON "clinical_assessment" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_clinical_assessment_stable_id_update" BEFORE UPDATE ON "clinical_assessment" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_material_delete_forbidden_delete" BEFORE DELETE ON "material" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_material_stable_id_update" BEFORE UPDATE ON "material" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_material_batch_delete_forbidden_delete" BEFORE DELETE ON "material_batch" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_material_batch_stable_id_update" BEFORE UPDATE ON "material_batch" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_batch_change_delete_forbidden_delete" BEFORE DELETE ON "batch_change" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_batch_change_stable_id_update" BEFORE UPDATE ON "batch_change" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_stock_location_delete_forbidden_delete" BEFORE DELETE ON "stock_location" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_stock_location_stable_id_update" BEFORE UPDATE ON "stock_location" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_batch_stock_delete_forbidden_delete" BEFORE DELETE ON "batch_stock" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_batch_stock_stable_id_update" BEFORE UPDATE ON "batch_stock" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_inventory_movement_delete_forbidden_delete" BEFORE DELETE ON "inventory_movement" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_inventory_movement_stable_id_update" BEFORE UPDATE ON "inventory_movement" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_material_usage_delete_forbidden_delete" BEFORE DELETE ON "material_usage" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_material_usage_stable_id_update" BEFORE UPDATE ON "material_usage" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_stock_count_delete_forbidden_delete" BEFORE DELETE ON "stock_count" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_stock_count_stable_id_update" BEFORE UPDATE ON "stock_count" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_supplier_delete_forbidden_delete" BEFORE DELETE ON "supplier" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_supplier_stable_id_update" BEFORE UPDATE ON "supplier" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_purchase_order_delete_forbidden_delete" BEFORE DELETE ON "purchase_order" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_purchase_order_stable_id_update" BEFORE UPDATE ON "purchase_order" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_purchase_order_item_delete_forbidden_delete" BEFORE DELETE ON "purchase_order_item" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_purchase_order_item_stable_id_update" BEFORE UPDATE ON "purchase_order_item" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_purchase_receipt_delete_forbidden_delete" BEFORE DELETE ON "purchase_receipt" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_purchase_receipt_stable_id_update" BEFORE UPDATE ON "purchase_receipt" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_purchase_receipt_item_delete_forbidden_delete" BEFORE DELETE ON "purchase_receipt_item" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_purchase_receipt_item_stable_id_update" BEFORE UPDATE ON "purchase_receipt_item" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_purchase_issue_delete_forbidden_delete" BEFORE DELETE ON "purchase_issue" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_purchase_issue_stable_id_update" BEFORE UPDATE ON "purchase_issue" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_supplier_funds_delete_forbidden_delete" BEFORE DELETE ON "supplier_funds" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_supplier_funds_stable_id_update" BEFORE UPDATE ON "supplier_funds" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_supplier_payment_delete_forbidden_delete" BEFORE DELETE ON "supplier_payment" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_supplier_payment_stable_id_update" BEFORE UPDATE ON "supplier_payment" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_supplier_allocation_delete_forbidden_delete" BEFORE DELETE ON "supplier_allocation" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_supplier_allocation_stable_id_update" BEFORE UPDATE ON "supplier_allocation" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_supplier_refund_delete_forbidden_delete" BEFORE DELETE ON "supplier_refund" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_supplier_refund_stable_id_update" BEFORE UPDATE ON "supplier_refund" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_instrument_pack_delete_forbidden_delete" BEFORE DELETE ON "instrument_pack" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_instrument_pack_stable_id_update" BEFORE UPDATE ON "instrument_pack" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_processing_equipment_delete_forbidden_delete" BEFORE DELETE ON "processing_equipment" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_processing_equipment_stable_id_update" BEFORE UPDATE ON "processing_equipment" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_instrument_processing_delete_forbidden_delete" BEFORE DELETE ON "instrument_processing" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_instrument_processing_stable_id_update" BEFORE UPDATE ON "instrument_processing" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_instrument_pack_cycle_delete_forbidden_delete" BEFORE DELETE ON "instrument_pack_cycle" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_instrument_pack_cycle_stable_id_update" BEFORE UPDATE ON "instrument_pack_cycle" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_processing_monitor_delete_forbidden_delete" BEFORE DELETE ON "processing_monitor" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_processing_monitor_stable_id_update" BEFORE UPDATE ON "processing_monitor" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_instrument_use_delete_forbidden_delete" BEFORE DELETE ON "instrument_use" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_instrument_use_stable_id_update" BEFORE UPDATE ON "instrument_use" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_cash_reconciliation_delete_forbidden_delete" BEFORE DELETE ON "cash_reconciliation" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_cash_reconciliation_stable_id_update" BEFORE UPDATE ON "cash_reconciliation" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_reconciliation_item_delete_forbidden_delete" BEFORE DELETE ON "reconciliation_item" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_reconciliation_item_stable_id_update" BEFORE UPDATE ON "reconciliation_item" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_issue_followup_delete_forbidden_delete" BEFORE DELETE ON "issue_followup" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_issue_followup_stable_id_update" BEFORE UPDATE ON "issue_followup" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_decision_plan_item_delete_forbidden_delete" BEFORE DELETE ON "decision_plan_item" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_decision_file_version_delete_forbidden_delete" BEFORE DELETE ON "decision_file_version" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_user_account_delete_forbidden_delete" BEFORE DELETE ON "user_account" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_user_account_stable_id_update" BEFORE UPDATE ON "user_account" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_access_role_delete_forbidden_delete" BEFORE DELETE ON "access_role" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_access_role_stable_id_update" BEFORE UPDATE ON "access_role" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_access_permission_delete_forbidden_delete" BEFORE DELETE ON "access_permission" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_access_permission_stable_id_update" BEFORE UPDATE ON "access_permission" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_staff_role_qualification_delete_forbidden_delete" BEFORE DELETE ON "staff_role_qualification" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_staff_role_qualification_stable_id_update" BEFORE UPDATE ON "staff_role_qualification" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_account_role_delete_forbidden_delete" BEFORE DELETE ON "account_role" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_account_role_stable_id_update" BEFORE UPDATE ON "account_role" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_role_permission_delete_forbidden_delete" BEFORE DELETE ON "role_permission" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_role_permission_stable_id_update" BEFORE UPDATE ON "role_permission" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_login_session_delete_forbidden_delete" BEFORE DELETE ON "login_session" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_login_session_stable_id_update" BEFORE UPDATE ON "login_session" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_authentication_event_delete_forbidden_delete" BEFORE DELETE ON "authentication_event" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_authentication_event_stable_id_update" BEFORE UPDATE ON "authentication_event" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_request_submission_delete_forbidden_delete" BEFORE DELETE ON "request_submission" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_request_submission_stable_id_update" BEFORE UPDATE ON "request_submission" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_operation_audit_delete_forbidden_delete" BEFORE DELETE ON "operation_audit" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_operation_audit_stable_id_update" BEFORE UPDATE ON "operation_audit" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_audit_change_delete_forbidden_delete" BEFORE DELETE ON "audit_change" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_audit_change_stable_id_update" BEFORE UPDATE ON "audit_change" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_backup_run_delete_forbidden_delete" BEFORE DELETE ON "backup_run" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_backup_run_stable_id_update" BEFORE UPDATE ON "backup_run" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_backup_artifact_delete_forbidden_delete" BEFORE DELETE ON "backup_artifact" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_backup_artifact_stable_id_update" BEFORE UPDATE ON "backup_artifact" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_backup_copy_delete_forbidden_delete" BEFORE DELETE ON "backup_copy" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_backup_copy_stable_id_update" BEFORE UPDATE ON "backup_copy" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_restore_verification_delete_forbidden_delete" BEFORE DELETE ON "restore_verification" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_restore_verification_stable_id_update" BEFORE UPDATE ON "restore_verification" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_restore_check_delete_forbidden_delete" BEFORE DELETE ON "restore_check" WHEN (1) BEGIN SELECT RAISE(ABORT,'delete_forbidden'); END;

CREATE TRIGGER "tr_restore_check_stable_id_update" BEFORE UPDATE ON "restore_check" WHEN ((1) AND (NEW."id" IS NOT OLD."id")) BEGIN SELECT RAISE(ABORT,'stable_id'); END;

CREATE TRIGGER "tr_patient_change_immutable_fact_update" BEFORE UPDATE ON "patient_change" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_schedule_change_immutable_fact_update" BEFORE UPDATE ON "schedule_change" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_appointment_change_immutable_fact_update" BEFORE UPDATE ON "appointment_change" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_health_version_immutable_fact_update" BEFORE UPDATE ON "health_version" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_health_item_immutable_fact_update" BEFORE UPDATE ON "health_item" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_health_review_immutable_fact_update" BEFORE UPDATE ON "health_review" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_record_addendum_immutable_fact_update" BEFORE UPDATE ON "record_addendum" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_patient_decision_immutable_fact_update" BEFORE UPDATE ON "patient_decision" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_treatment_execution_immutable_fact_update" BEFORE UPDATE ON "treatment_execution" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_payment_allocation_immutable_fact_update" BEFORE UPDATE ON "payment_allocation" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_prepayment_offset_immutable_fact_update" BEFORE UPDATE ON "prepayment_offset" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_fee_adjustment_immutable_fact_update" BEFORE UPDATE ON "fee_adjustment" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_fee_adjustment_item_immutable_fact_update" BEFORE UPDATE ON "fee_adjustment_item" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_inventory_movement_immutable_fact_update" BEFORE UPDATE ON "inventory_movement" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_material_usage_immutable_fact_update" BEFORE UPDATE ON "material_usage" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_supplier_refund_immutable_fact_update" BEFORE UPDATE ON "supplier_refund" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_contact_history_immutable_fact_update" BEFORE UPDATE ON "contact_history" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_clinical_assessment_immutable_fact_update" BEFORE UPDATE ON "clinical_assessment" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_cash_reconciliation_immutable_fact_update" BEFORE UPDATE ON "cash_reconciliation" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_reconciliation_item_immutable_fact_update" BEFORE UPDATE ON "reconciliation_item" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_decision_plan_item_immutable_fact_update" BEFORE UPDATE ON "decision_plan_item" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_decision_file_version_immutable_fact_update" BEFORE UPDATE ON "decision_file_version" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_authentication_event_immutable_fact_update" BEFORE UPDATE ON "authentication_event" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_operation_audit_immutable_fact_update" BEFORE UPDATE ON "operation_audit" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_audit_change_immutable_fact_update" BEFORE UPDATE ON "audit_change" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_request_submission_immutable_fact_update" BEFORE UPDATE ON "request_submission" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;

CREATE TRIGGER "tr_appointment_immutable_ownership_update" BEFORE UPDATE ON "appointment" WHEN ((1) AND (NEW."patient_id" IS NOT OLD."patient_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_visit_immutable_ownership_update" BEFORE UPDATE ON "visit" WHEN ((1) AND (NEW."patient_id" IS NOT OLD."patient_id" OR NEW."appointment_id" IS NOT OLD."appointment_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_clinical_record_immutable_ownership_update" BEFORE UPDATE ON "clinical_record" WHEN ((1) AND (NEW."visit_id" IS NOT OLD."visit_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_clinical_document_immutable_ownership_update" BEFORE UPDATE ON "clinical_document" WHEN ((1) AND (NEW."patient_id" IS NOT OLD."patient_id" OR NEW."visit_id" IS NOT OLD."visit_id" OR NEW."plan_version_id" IS NOT OLD."plan_version_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_document_version_immutable_ownership_update" BEFORE UPDATE ON "document_version" WHEN ((1) AND (NEW."clinical_document_id" IS NOT OLD."clinical_document_id" OR NEW."version_no" IS NOT OLD."version_no" OR NEW."storage_key" IS NOT OLD."storage_key" OR NEW."sha256" IS NOT OLD."sha256" OR NEW."size_bytes" IS NOT OLD."size_bytes" OR NEW."media_type" IS NOT OLD."media_type" OR NEW."original_name" IS NOT OLD."original_name" OR NEW."previous_version_id" IS NOT OLD."previous_version_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_treatment_plan_immutable_ownership_update" BEFORE UPDATE ON "treatment_plan" WHEN ((1) AND (NEW."patient_id" IS NOT OLD."patient_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_plan_version_immutable_ownership_update" BEFORE UPDATE ON "plan_version" WHEN ((1) AND (NEW."treatment_plan_id" IS NOT OLD."treatment_plan_id" OR NEW."source_visit_id" IS NOT OLD."source_visit_id" OR NEW."version_no" IS NOT OLD."version_no" OR NEW."previous_version_id" IS NOT OLD."previous_version_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_plan_item_immutable_ownership_update" BEFORE UPDATE ON "plan_item" WHEN ((1) AND (NEW."plan_version_id" IS NOT OLD."plan_version_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_bill_immutable_ownership_update" BEFORE UPDATE ON "bill" WHEN ((1) AND (NEW."patient_id" IS NOT OLD."patient_id" OR NEW."patient_funds_id" IS NOT OLD."patient_funds_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_patient_funds_immutable_ownership_update" BEFORE UPDATE ON "patient_funds" WHEN ((1) AND (NEW."patient_id" IS NOT OLD."patient_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_patient_payment_immutable_ownership_update" BEFORE UPDATE ON "patient_payment" WHEN ((1) AND (NEW."patient_funds_id" IS NOT OLD."patient_funds_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_bill_item_immutable_ownership_update" BEFORE UPDATE ON "bill_item" WHEN ((1) AND (NEW."bill_id" IS NOT OLD."bill_id" OR NEW."treatment_execution_id" IS NOT OLD."treatment_execution_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_fee_request_immutable_ownership_update" BEFORE UPDATE ON "fee_request" WHEN ((1) AND (NEW."patient_funds_id" IS NOT OLD."patient_funds_id" OR NEW."bill_id" IS NOT OLD."bill_id" OR NEW."patient_payment_id" IS NOT OLD."patient_payment_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_patient_refund_immutable_ownership_update" BEFORE UPDATE ON "patient_refund" WHEN ((1) AND (NEW."fee_request_id" IS NOT OLD."fee_request_id" OR NEW."patient_payment_id" IS NOT OLD."patient_payment_id" OR NEW."patient_funds_id" IS NOT OLD."patient_funds_id" OR NEW."requested_cents" IS NOT OLD."requested_cents" OR NEW."previous_attempt_id" IS NOT OLD."previous_attempt_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_followup_requirement_immutable_ownership_update" BEFORE UPDATE ON "followup_requirement" WHEN ((1) AND (NEW."patient_id" IS NOT OLD."patient_id" OR NEW."source_visit_id" IS NOT OLD."source_visit_id" OR NEW."source_plan_version_id" IS NOT OLD."source_plan_version_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_material_batch_immutable_ownership_update" BEFORE UPDATE ON "material_batch" WHEN ((1) AND (NEW."material_id" IS NOT OLD."material_id" OR NEW."batch_no" IS NOT OLD."batch_no")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_batch_stock_immutable_ownership_update" BEFORE UPDATE ON "batch_stock" WHEN ((1) AND (NEW."material_batch_id" IS NOT OLD."material_batch_id" OR NEW."stock_location_id" IS NOT OLD."stock_location_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_purchase_order_immutable_ownership_update" BEFORE UPDATE ON "purchase_order" WHEN ((1) AND (NEW."supplier_id" IS NOT OLD."supplier_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_purchase_order_item_immutable_ownership_update" BEFORE UPDATE ON "purchase_order_item" WHEN ((1) AND (NEW."purchase_order_id" IS NOT OLD."purchase_order_id" OR NEW."material_id" IS NOT OLD."material_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_purchase_receipt_immutable_ownership_update" BEFORE UPDATE ON "purchase_receipt" WHEN ((1) AND (NEW."purchase_order_id" IS NOT OLD."purchase_order_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_purchase_receipt_item_immutable_ownership_update" BEFORE UPDATE ON "purchase_receipt_item" WHEN ((1) AND (NEW."purchase_receipt_id" IS NOT OLD."purchase_receipt_id" OR NEW."purchase_order_item_id" IS NOT OLD."purchase_order_item_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_supplier_funds_immutable_ownership_update" BEFORE UPDATE ON "supplier_funds" WHEN ((1) AND (NEW."supplier_id" IS NOT OLD."supplier_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_supplier_payment_immutable_ownership_update" BEFORE UPDATE ON "supplier_payment" WHEN ((1) AND (NEW."supplier_funds_id" IS NOT OLD."supplier_funds_id" OR NEW."requested_cents" IS NOT OLD."requested_cents" OR NEW."previous_attempt_id" IS NOT OLD."previous_attempt_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_supplier_allocation_immutable_ownership_update" BEFORE UPDATE ON "supplier_allocation" WHEN ((1) AND (NEW."supplier_payment_id" IS NOT OLD."supplier_payment_id" OR NEW."purchase_order_id" IS NOT OLD."purchase_order_id" OR NEW."purchase_receipt_id" IS NOT OLD."purchase_receipt_id" OR NEW."original_allocation_id" IS NOT OLD."original_allocation_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_user_account_immutable_ownership_update" BEFORE UPDATE ON "user_account" WHEN ((1) AND (NEW."staff_id" IS NOT OLD."staff_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_account_role_immutable_ownership_update" BEFORE UPDATE ON "account_role" WHEN ((1) AND (NEW."account_id" IS NOT OLD."account_id" OR NEW."role_id" IS NOT OLD."role_id" OR NEW."qualification_id" IS NOT OLD."qualification_id" OR NEW."granted_at" IS NOT OLD."granted_at")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_staff_role_qualification_immutable_ownership_update" BEFORE UPDATE ON "staff_role_qualification" WHEN ((1) AND (NEW."staff_id" IS NOT OLD."staff_id" OR NEW."role_id" IS NOT OLD."role_id" OR NEW."valid_from" IS NOT OLD."valid_from")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_instrument_pack_cycle_immutable_ownership_update" BEFORE UPDATE ON "instrument_pack_cycle" WHEN ((1) AND (NEW."instrument_processing_id" IS NOT OLD."instrument_processing_id" OR NEW."instrument_pack_id" IS NOT OLD."instrument_pack_id")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_instrument_use_immutable_ownership_update" BEFORE UPDATE ON "instrument_use" WHEN ((1) AND (NEW."visit_id" IS NOT OLD."visit_id" OR NEW."instrument_pack_cycle_id" IS NOT OLD."instrument_pack_cycle_id" OR NEW."issued_at" IS NOT OLD."issued_at")) BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;

CREATE TRIGGER "tr_patient_payment_terminal_frozen_update" BEFORE UPDATE ON "patient_payment" WHEN ((OLD.status IN ('到账已确认','未到账已核实')) AND 1) BEGIN SELECT RAISE(ABORT,'terminal_frozen'); END;

CREATE TRIGGER "tr_patient_refund_terminal_frozen_update" BEFORE UPDATE ON "patient_refund" WHEN ((OLD.status IN ('已确认退款','已失败')) AND 1) BEGIN SELECT RAISE(ABORT,'terminal_frozen'); END;

CREATE TRIGGER "tr_supplier_payment_terminal_frozen_update" BEFORE UPDATE ON "supplier_payment" WHEN ((OLD.status IN ('已确认付款','已失败')) AND 1) BEGIN SELECT RAISE(ABORT,'terminal_frozen'); END;

CREATE TRIGGER "tr_supplier_allocation_terminal_frozen_update" BEFORE UPDATE ON "supplier_allocation" WHEN ((OLD.allocation_state IN ('已生效','已取消')) AND 1) BEGIN SELECT RAISE(ABORT,'terminal_frozen'); END;

CREATE TRIGGER "tr_fee_request_terminal_frozen_update" BEFORE UPDATE ON "fee_request" WHEN ((OLD.status IN ('已同意','已拒绝','已撤回')) AND 1) BEGIN SELECT RAISE(ABORT,'terminal_frozen'); END;

CREATE TRIGGER "tr_clinical_record_terminal_frozen_update" BEFORE UPDATE ON "clinical_record" WHEN ((OLD.status IN ('已签署')) AND 1) BEGIN SELECT RAISE(ABORT,'terminal_frozen'); END;

CREATE TRIGGER "tr_dated_schedule_schedule_overlap_insert" BEFORE INSERT ON "dated_schedule" WHEN (NEW.status='已确认' AND EXISTS (SELECT 1 FROM dated_schedule x WHERE x.id<>NEW.id AND x.status='已确认' AND (x.dentist_id=NEW.dentist_id OR x.dental_chair_id=NEW.dental_chair_id) AND x.starts_at<NEW.ends_at AND NEW.starts_at<x.ends_at)) BEGIN SELECT RAISE(ABORT,'schedule_overlap'); END;

CREATE TRIGGER "tr_dated_schedule_schedule_overlap_update" BEFORE UPDATE ON "dated_schedule" WHEN (NEW.status='已确认' AND EXISTS (SELECT 1 FROM dated_schedule x WHERE x.id<>NEW.id AND x.status='已确认' AND (x.dentist_id=NEW.dentist_id OR x.dental_chair_id=NEW.dental_chair_id) AND x.starts_at<NEW.ends_at AND NEW.starts_at<x.ends_at)) BEGIN SELECT RAISE(ABORT,'schedule_overlap'); END;

CREATE TRIGGER "tr_dated_schedule_schedule_has_active_occupancy_update" BEFORE UPDATE ON "dated_schedule" WHEN (EXISTS (SELECT 1 FROM resource_occupancy WHERE dated_schedule_id=OLD.id AND released_at IS NULL) AND (NEW.starts_at IS NOT OLD.starts_at OR NEW.ends_at IS NOT OLD.ends_at OR NEW.dentist_id IS NOT OLD.dentist_id OR NEW.dental_chair_id IS NOT OLD.dental_chair_id OR NEW.status <> '已确认')) BEGIN SELECT RAISE(ABORT,'schedule_has_active_occupancy'); END;

CREATE TRIGGER "tr_resource_occupancy_occupancy_schedule_insert" BEFORE INSERT ON "resource_occupancy" WHEN (NEW.released_at IS NULL AND NOT EXISTS (SELECT 1 FROM dated_schedule s WHERE s.id=NEW.dated_schedule_id AND s.status='已确认' AND s.revision=NEW.arrangement_revision AND s.starts_at<=NEW.starts_at AND NEW.ends_at<=s.ends_at)) BEGIN SELECT RAISE(ABORT,'occupancy_schedule'); END;

CREATE TRIGGER "tr_resource_occupancy_occupancy_schedule_update" BEFORE UPDATE ON "resource_occupancy" WHEN (NEW.released_at IS NULL AND NOT EXISTS (SELECT 1 FROM dated_schedule s WHERE s.id=NEW.dated_schedule_id AND s.status='已确认' AND s.revision=NEW.arrangement_revision AND s.starts_at<=NEW.starts_at AND NEW.ends_at<=s.ends_at)) BEGIN SELECT RAISE(ABORT,'occupancy_schedule'); END;

CREATE TRIGGER "tr_resource_occupancy_occupancy_overlap_insert" BEFORE INSERT ON "resource_occupancy" WHEN (NEW.released_at IS NULL AND EXISTS (SELECT 1 FROM resource_occupancy o JOIN dated_schedule s ON s.id=o.dated_schedule_id JOIN dated_schedule n ON n.id=NEW.dated_schedule_id WHERE o.id<>NEW.id AND o.released_at IS NULL AND o.starts_at<NEW.ends_at AND NEW.starts_at<o.ends_at AND (s.dentist_id=n.dentist_id OR s.dental_chair_id=n.dental_chair_id OR COALESCE((SELECT patient_id FROM appointment WHERE id=o.appointment_id),(SELECT patient_id FROM visit WHERE id=o.visit_id))=COALESCE((SELECT patient_id FROM appointment WHERE id=NEW.appointment_id),(SELECT patient_id FROM visit WHERE id=NEW.visit_id))))) BEGIN SELECT RAISE(ABORT,'occupancy_overlap'); END;

CREATE TRIGGER "tr_resource_occupancy_occupancy_overlap_update" BEFORE UPDATE ON "resource_occupancy" WHEN (NEW.released_at IS NULL AND EXISTS (SELECT 1 FROM resource_occupancy o JOIN dated_schedule s ON s.id=o.dated_schedule_id JOIN dated_schedule n ON n.id=NEW.dated_schedule_id WHERE o.id<>NEW.id AND o.released_at IS NULL AND o.starts_at<NEW.ends_at AND NEW.starts_at<o.ends_at AND (s.dentist_id=n.dentist_id OR s.dental_chair_id=n.dental_chair_id OR COALESCE((SELECT patient_id FROM appointment WHERE id=o.appointment_id),(SELECT patient_id FROM visit WHERE id=o.visit_id))=COALESCE((SELECT patient_id FROM appointment WHERE id=NEW.appointment_id),(SELECT patient_id FROM visit WHERE id=NEW.visit_id))))) BEGIN SELECT RAISE(ABORT,'occupancy_overlap'); END;

CREATE TRIGGER "tr_resource_occupancy_occupancy_move_requires_new_update" BEFORE UPDATE ON "resource_occupancy" WHEN ((1) AND (NEW."dated_schedule_id" IS NOT OLD."dated_schedule_id" OR NEW."appointment_id" IS NOT OLD."appointment_id" OR NEW."starts_at" IS NOT OLD."starts_at" OR NEW."ends_at" IS NOT OLD."ends_at" OR NEW."arrangement_revision" IS NOT OLD."arrangement_revision")) BEGIN SELECT RAISE(ABORT,'occupancy_move_requires_new'); END;

CREATE TRIGGER "tr_resource_occupancy_released_occupancy_frozen_update" BEFORE UPDATE ON "resource_occupancy" WHEN ((OLD.released_at IS NOT NULL) AND 1) BEGIN SELECT RAISE(ABORT,'released_occupancy_frozen'); END;

CREATE TRIGGER "tr_health_version_version_order_insert" BEFORE INSERT ON "health_version" WHEN (NEW.previous_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM health_version p WHERE p.id=NEW.previous_version_id AND p.patient_id=NEW.patient_id AND p.version_no<NEW.version_no AND p.id<>NEW.id)) BEGIN SELECT RAISE(ABORT,'version_order'); END;

CREATE TRIGGER "tr_health_version_version_order_update" BEFORE UPDATE ON "health_version" WHEN (NEW.previous_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM health_version p WHERE p.id=NEW.previous_version_id AND p.patient_id=NEW.patient_id AND p.version_no<NEW.version_no AND p.id<>NEW.id)) BEGIN SELECT RAISE(ABORT,'version_order'); END;

CREATE TRIGGER "tr_document_version_version_order_insert" BEFORE INSERT ON "document_version" WHEN (NEW.previous_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_version p WHERE p.id=NEW.previous_version_id AND p.clinical_document_id=NEW.clinical_document_id AND p.version_no<NEW.version_no AND p.id<>NEW.id)) BEGIN SELECT RAISE(ABORT,'version_order'); END;

CREATE TRIGGER "tr_document_version_version_order_update" BEFORE UPDATE ON "document_version" WHEN (NEW.previous_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_version p WHERE p.id=NEW.previous_version_id AND p.clinical_document_id=NEW.clinical_document_id AND p.version_no<NEW.version_no AND p.id<>NEW.id)) BEGIN SELECT RAISE(ABORT,'version_order'); END;

CREATE TRIGGER "tr_plan_version_version_order_insert" BEFORE INSERT ON "plan_version" WHEN (NEW.previous_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plan_version p WHERE p.id=NEW.previous_version_id AND p.treatment_plan_id=NEW.treatment_plan_id AND p.version_no<NEW.version_no AND p.id<>NEW.id)) BEGIN SELECT RAISE(ABORT,'version_order'); END;

CREATE TRIGGER "tr_plan_version_version_order_update" BEFORE UPDATE ON "plan_version" WHEN (NEW.previous_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plan_version p WHERE p.id=NEW.previous_version_id AND p.treatment_plan_id=NEW.treatment_plan_id AND p.version_no<NEW.version_no AND p.id<>NEW.id)) BEGIN SELECT RAISE(ABORT,'version_order'); END;

CREATE TRIGGER "tr_health_review_health_patient_insert" BEFORE INSERT ON "health_review" WHEN ((SELECT patient_id FROM visit WHERE id=NEW.visit_id) IS NOT (SELECT patient_id FROM health_version WHERE id=NEW.health_version_id)) BEGIN SELECT RAISE(ABORT,'health_patient'); END;

CREATE TRIGGER "tr_health_review_health_patient_update" BEFORE UPDATE ON "health_review" WHEN ((SELECT patient_id FROM visit WHERE id=NEW.visit_id) IS NOT (SELECT patient_id FROM health_version WHERE id=NEW.health_version_id)) BEGIN SELECT RAISE(ABORT,'health_patient'); END;

CREATE TRIGGER "tr_clinical_record_sign_missing_evidence_insert" BEFORE INSERT ON "clinical_record" WHEN (NEW.status='已签署' AND (NOT EXISTS (SELECT 1 FROM clinical_finding WHERE clinical_record_id=NEW.id) OR NOT EXISTS (SELECT 1 FROM health_review WHERE visit_id=NEW.visit_id))) BEGIN SELECT RAISE(ABORT,'sign_missing_evidence'); END;

CREATE TRIGGER "tr_clinical_record_sign_missing_evidence_update" BEFORE UPDATE ON "clinical_record" WHEN (NEW.status='已签署' AND (NOT EXISTS (SELECT 1 FROM clinical_finding WHERE clinical_record_id=NEW.id) OR NOT EXISTS (SELECT 1 FROM health_review WHERE visit_id=NEW.visit_id))) BEGIN SELECT RAISE(ABORT,'sign_missing_evidence'); END;

CREATE TRIGGER "tr_clinical_finding_signed_findings_frozen_insert" BEFORE INSERT ON "clinical_finding" WHEN (EXISTS (SELECT 1 FROM clinical_record WHERE id=NEW.clinical_record_id AND status='已签署')) BEGIN SELECT RAISE(ABORT,'signed_findings_frozen'); END;

CREATE TRIGGER "tr_clinical_finding_signed_findings_frozen_update" BEFORE UPDATE ON "clinical_finding" WHEN (EXISTS (SELECT 1 FROM clinical_record WHERE id=NEW.clinical_record_id AND status='已签署')) BEGIN SELECT RAISE(ABORT,'signed_findings_frozen'); END;

CREATE TRIGGER "tr_clinical_finding_signed_findings_move_update" BEFORE UPDATE ON "clinical_finding" WHEN (EXISTS (SELECT 1 FROM clinical_record WHERE id=OLD.clinical_record_id AND status='已签署')) BEGIN SELECT RAISE(ABORT,'signed_findings_move'); END;

CREATE TRIGGER "tr_record_addendum_addendum_unsigned_insert" BEFORE INSERT ON "record_addendum" WHEN (NOT EXISTS (SELECT 1 FROM clinical_record WHERE id=NEW.clinical_record_id AND status='已签署')) BEGIN SELECT RAISE(ABORT,'addendum_unsigned'); END;

CREATE TRIGGER "tr_record_addendum_addendum_unsigned_update" BEFORE UPDATE ON "record_addendum" WHEN (NOT EXISTS (SELECT 1 FROM clinical_record WHERE id=NEW.clinical_record_id AND status='已签署')) BEGIN SELECT RAISE(ABORT,'addendum_unsigned'); END;

CREATE TRIGGER "tr_visit_visit_end_unsigned_insert" BEFORE INSERT ON "visit" WHEN (NEW.status='诊疗结束' AND NOT EXISTS (SELECT 1 FROM clinical_record WHERE visit_id=NEW.id AND status='已签署')) BEGIN SELECT RAISE(ABORT,'visit_end_unsigned'); END;

CREATE TRIGGER "tr_visit_visit_end_unsigned_update" BEFORE UPDATE ON "visit" WHEN (NEW.status='诊疗结束' AND NOT EXISTS (SELECT 1 FROM clinical_record WHERE visit_id=NEW.id AND status='已签署')) BEGIN SELECT RAISE(ABORT,'visit_end_unsigned'); END;

CREATE TRIGGER "tr_clinical_document_context_patient_insert" BEFORE INSERT ON "clinical_document" WHEN ((NEW.visit_id IS NOT NULL AND NEW.patient_id IS NOT (SELECT patient_id FROM visit WHERE id=NEW.visit_id)) OR (NEW.plan_version_id IS NOT NULL AND NEW.patient_id IS NOT (SELECT p.patient_id FROM plan_version v JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE v.id=NEW.plan_version_id))) BEGIN SELECT RAISE(ABORT,'context_patient'); END;

CREATE TRIGGER "tr_clinical_document_context_patient_update" BEFORE UPDATE ON "clinical_document" WHEN ((NEW.visit_id IS NOT NULL AND NEW.patient_id IS NOT (SELECT patient_id FROM visit WHERE id=NEW.visit_id)) OR (NEW.plan_version_id IS NOT NULL AND NEW.patient_id IS NOT (SELECT p.patient_id FROM plan_version v JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE v.id=NEW.plan_version_id))) BEGIN SELECT RAISE(ABORT,'context_patient'); END;

CREATE TRIGGER "tr_followup_requirement_context_patient_insert" BEFORE INSERT ON "followup_requirement" WHEN ((NEW.source_visit_id IS NOT NULL AND NEW.patient_id IS NOT (SELECT patient_id FROM visit WHERE id=NEW.source_visit_id)) OR (NEW.source_plan_version_id IS NOT NULL AND NEW.patient_id IS NOT (SELECT p.patient_id FROM plan_version v JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE v.id=NEW.source_plan_version_id))) BEGIN SELECT RAISE(ABORT,'context_patient'); END;

CREATE TRIGGER "tr_followup_requirement_context_patient_update" BEFORE UPDATE ON "followup_requirement" WHEN ((NEW.source_visit_id IS NOT NULL AND NEW.patient_id IS NOT (SELECT patient_id FROM visit WHERE id=NEW.source_visit_id)) OR (NEW.source_plan_version_id IS NOT NULL AND NEW.patient_id IS NOT (SELECT p.patient_id FROM plan_version v JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE v.id=NEW.source_plan_version_id))) BEGIN SELECT RAISE(ABORT,'context_patient'); END;

CREATE TRIGGER "tr_plan_version_plan_source_patient_insert" BEFORE INSERT ON "plan_version" WHEN (NEW.source_visit_id IS NOT NULL AND (SELECT patient_id FROM visit WHERE id=NEW.source_visit_id) IS NOT (SELECT patient_id FROM treatment_plan WHERE id=NEW.treatment_plan_id)) BEGIN SELECT RAISE(ABORT,'plan_source_patient'); END;

CREATE TRIGGER "tr_plan_version_plan_source_patient_update" BEFORE UPDATE ON "plan_version" WHEN (NEW.source_visit_id IS NOT NULL AND (SELECT patient_id FROM visit WHERE id=NEW.source_visit_id) IS NOT (SELECT patient_id FROM treatment_plan WHERE id=NEW.treatment_plan_id)) BEGIN SELECT RAISE(ABORT,'plan_source_patient'); END;

CREATE TRIGGER "tr_decision_plan_item_decision_wrong_version_insert" BEFORE INSERT ON "decision_plan_item" WHEN ((SELECT plan_version_id FROM patient_decision WHERE id=NEW.decision_id) IS NOT (SELECT plan_version_id FROM plan_item WHERE id=NEW.plan_item_id)) BEGIN SELECT RAISE(ABORT,'decision_wrong_version'); END;

CREATE TRIGGER "tr_decision_plan_item_decision_wrong_version_update" BEFORE UPDATE ON "decision_plan_item" WHEN ((SELECT plan_version_id FROM patient_decision WHERE id=NEW.decision_id) IS NOT (SELECT plan_version_id FROM plan_item WHERE id=NEW.plan_item_id)) BEGIN SELECT RAISE(ABORT,'decision_wrong_version'); END;

CREATE TRIGGER "tr_decision_file_version_decision_file_patient_insert" BEFORE INSERT ON "decision_file_version" WHEN ((SELECT p.patient_id FROM patient_decision d JOIN plan_version v ON v.id=d.plan_version_id JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE d.id=NEW.decision_id) IS NOT (SELECT c.patient_id FROM document_version v JOIN clinical_document c ON c.id=v.clinical_document_id WHERE v.id=NEW.document_version_id)) BEGIN SELECT RAISE(ABORT,'decision_file_patient'); END;

CREATE TRIGGER "tr_decision_file_version_decision_file_patient_update" BEFORE UPDATE ON "decision_file_version" WHEN ((SELECT p.patient_id FROM patient_decision d JOIN plan_version v ON v.id=d.plan_version_id JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE d.id=NEW.decision_id) IS NOT (SELECT c.patient_id FROM document_version v JOIN clinical_document c ON c.id=v.clinical_document_id WHERE v.id=NEW.document_version_id)) BEGIN SELECT RAISE(ABORT,'decision_file_patient'); END;

CREATE TRIGGER "tr_patient_decision_proxy_wrong_patient_or_time_insert" BEFORE INSERT ON "patient_decision" WHEN (NEW.patient_proxy_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patient_proxy x JOIN plan_version v ON v.id=NEW.plan_version_id JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE x.id=NEW.patient_proxy_id AND x.patient_id=p.patient_id AND x.valid_from<=NEW.decided_at AND (x.valid_until IS NULL OR NEW.decided_at<x.valid_until))) BEGIN SELECT RAISE(ABORT,'proxy_wrong_patient_or_time'); END;

CREATE TRIGGER "tr_patient_decision_proxy_wrong_patient_or_time_update" BEFORE UPDATE ON "patient_decision" WHEN (NEW.patient_proxy_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patient_proxy x JOIN plan_version v ON v.id=NEW.plan_version_id JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE x.id=NEW.patient_proxy_id AND x.patient_id=p.patient_id AND x.valid_from<=NEW.decided_at AND (x.valid_until IS NULL OR NEW.decided_at<x.valid_until))) BEGIN SELECT RAISE(ABORT,'proxy_wrong_patient_or_time'); END;

CREATE TRIGGER "tr_treatment_execution_execution_patient_insert" BEFORE INSERT ON "treatment_execution" WHEN (NEW.plan_item_id IS NOT NULL AND (SELECT v.patient_id FROM visit v WHERE v.id=NEW.visit_id) IS NOT (SELECT p.patient_id FROM plan_item i JOIN plan_version v ON v.id=i.plan_version_id JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE i.id=NEW.plan_item_id)) BEGIN SELECT RAISE(ABORT,'execution_patient'); END;

CREATE TRIGGER "tr_treatment_execution_execution_patient_update" BEFORE UPDATE ON "treatment_execution" WHEN (NEW.plan_item_id IS NOT NULL AND (SELECT v.patient_id FROM visit v WHERE v.id=NEW.visit_id) IS NOT (SELECT p.patient_id FROM plan_item i JOIN plan_version v ON v.id=i.plan_version_id JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE i.id=NEW.plan_item_id)) BEGIN SELECT RAISE(ABORT,'execution_patient'); END;

CREATE TRIGGER "tr_treatment_execution_correction_chain_insert" BEFORE INSERT ON "treatment_execution" WHEN (NEW.original_execution_id IS NOT NULL AND (NEW.original_execution_id=NEW.id OR NOT EXISTS (SELECT 1 FROM treatment_execution e WHERE e.id=NEW.original_execution_id AND e.visit_id=NEW.visit_id))) BEGIN SELECT RAISE(ABORT,'correction_chain'); END;

CREATE TRIGGER "tr_treatment_execution_correction_chain_update" BEFORE UPDATE ON "treatment_execution" WHEN (NEW.original_execution_id IS NOT NULL AND (NEW.original_execution_id=NEW.id OR NOT EXISTS (SELECT 1 FROM treatment_execution e WHERE e.id=NEW.original_execution_id AND e.visit_id=NEW.visit_id))) BEGIN SELECT RAISE(ABORT,'correction_chain'); END;

CREATE TRIGGER "tr_service_price_price_overlap_insert" BEFORE INSERT ON "service_price" WHEN (NEW.status='已确认可适用' AND EXISTS (SELECT 1 FROM service_price x WHERE x.id<>NEW.id AND x.service_id=NEW.service_id AND x.status='已确认可适用' AND x.valid_from<COALESCE(NEW.valid_until,'9999') AND NEW.valid_from<COALESCE(x.valid_until,'9999'))) BEGIN SELECT RAISE(ABORT,'price_overlap'); END;

CREATE TRIGGER "tr_service_price_price_overlap_update" BEFORE UPDATE ON "service_price" WHEN (NEW.status='已确认可适用' AND EXISTS (SELECT 1 FROM service_price x WHERE x.id<>NEW.id AND x.service_id=NEW.service_id AND x.status='已确认可适用' AND x.valid_from<COALESCE(NEW.valid_until,'9999') AND NEW.valid_from<COALESCE(x.valid_until,'9999'))) BEGIN SELECT RAISE(ABORT,'price_overlap'); END;

CREATE TRIGGER "tr_service_price_referenced_price_frozen_update" BEFORE UPDATE ON "service_price" WHEN ((EXISTS (SELECT 1 FROM bill_item WHERE service_price_id=OLD.id)) AND (NEW."service_id" IS NOT OLD."service_id" OR NEW."unit_price_cents" IS NOT OLD."unit_price_cents" OR NEW."valid_from" IS NOT OLD."valid_from" OR NEW."valid_until" IS NOT OLD."valid_until")) BEGIN SELECT RAISE(ABORT,'referenced_price_frozen'); END;

CREATE TRIGGER "tr_bill_item_priced_item_frozen_update" BEFORE UPDATE ON "bill_item" WHEN ((OLD.pricing_status='已核价') AND 1) BEGIN SELECT RAISE(ABORT,'priced_item_frozen'); END;

CREATE TRIGGER "tr_bill_item_bill_execution_patient_insert" BEFORE INSERT ON "bill_item" WHEN ((SELECT patient_id FROM bill WHERE id=NEW.bill_id) IS NOT (SELECT v.patient_id FROM treatment_execution e JOIN visit v ON v.id=e.visit_id WHERE e.id=NEW.treatment_execution_id)) BEGIN SELECT RAISE(ABORT,'bill_execution_patient'); END;

CREATE TRIGGER "tr_bill_item_bill_execution_patient_update" BEFORE UPDATE ON "bill_item" WHEN ((SELECT patient_id FROM bill WHERE id=NEW.bill_id) IS NOT (SELECT v.patient_id FROM treatment_execution e JOIN visit v ON v.id=e.visit_id WHERE e.id=NEW.treatment_execution_id)) BEGIN SELECT RAISE(ABORT,'bill_execution_patient'); END;

CREATE TRIGGER "tr_bill_item_bill_price_source_insert" BEFORE INSERT ON "bill_item" WHEN (NEW.service_price_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM service_price p JOIN treatment_execution e ON e.id=NEW.treatment_execution_id WHERE p.id=NEW.service_price_id AND p.service_id=e.service_id AND p.valid_from<=NEW.priced_at AND (p.valid_until IS NULL OR NEW.priced_at<p.valid_until) AND p.status IN ('已确认可适用','不再用于新计费') AND (NEW.pricing_status<>'已核价' OR NEW.unit_price_cents=p.unit_price_cents))) BEGIN SELECT RAISE(ABORT,'bill_price_source'); END;

CREATE TRIGGER "tr_bill_item_bill_price_source_update" BEFORE UPDATE ON "bill_item" WHEN (NEW.service_price_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM service_price p JOIN treatment_execution e ON e.id=NEW.treatment_execution_id WHERE p.id=NEW.service_price_id AND p.service_id=e.service_id AND p.valid_from<=NEW.priced_at AND (p.valid_until IS NULL OR NEW.priced_at<p.valid_until) AND p.status IN ('已确认可适用','不再用于新计费') AND (NEW.pricing_status<>'已核价' OR NEW.unit_price_cents=p.unit_price_cents))) BEGIN SELECT RAISE(ABORT,'bill_price_source'); END;

CREATE TRIGGER "tr_payment_allocation_allocation_owner_insert" BEFORE INSERT ON "payment_allocation" WHEN (NOT EXISTS (SELECT 1 FROM patient_payment p JOIN bill b ON b.id=NEW.bill_id WHERE p.id=NEW.patient_payment_id AND p.patient_funds_id=b.patient_funds_id AND p.status='到账已确认')) BEGIN SELECT RAISE(ABORT,'allocation_owner'); END;

CREATE TRIGGER "tr_payment_allocation_payment_budget_insert" BEFORE INSERT ON "payment_allocation" WHEN (NEW.amount_cents>0 AND (NEW.amount_cents+(COALESCE((SELECT sum(amount_cents) FROM payment_allocation WHERE patient_payment_id=NEW.patient_payment_id),0)+COALESCE((SELECT sum(amount_cents) FROM prepayment_offset WHERE patient_payment_id=NEW.patient_payment_id),0))+COALESCE((SELECT sum(CASE WHEN status='已确认退款' THEN actual_cents WHEN status IN ('待办理','待核实') THEN requested_cents ELSE 0 END) FROM patient_refund WHERE patient_payment_id=NEW.patient_payment_id AND id<>-1),0)>(SELECT net_cents FROM patient_payment WHERE id=NEW.patient_payment_id) OR NEW.amount_cents>(COALESCE((SELECT sum(quantity*unit_price_cents) FROM bill_item WHERE bill_id=NEW.bill_id AND pricing_status='已核价'),0)+COALESCE((SELECT sum(i.amount_cents) FROM fee_adjustment_item i JOIN fee_adjustment a ON a.id=i.fee_adjustment_id WHERE a.bill_id=NEW.bill_id),0)-COALESCE((SELECT sum(amount_cents) FROM payment_allocation WHERE bill_id=NEW.bill_id),0)-COALESCE((SELECT sum(amount_cents) FROM prepayment_offset WHERE bill_id=NEW.bill_id),0)))) BEGIN SELECT RAISE(ABORT,'payment_budget'); END;

CREATE TRIGGER "tr_payment_allocation_release_budget_insert" BEFORE INSERT ON "payment_allocation" WHEN (NEW.amount_cents<0 AND (NOT EXISTS (SELECT 1 FROM payment_allocation a WHERE a.id=NEW.original_allocation_id AND a.amount_cents>0) OR -NEW.amount_cents-COALESCE((SELECT sum(amount_cents) FROM payment_allocation WHERE original_allocation_id=NEW.original_allocation_id),0)>(SELECT amount_cents FROM payment_allocation WHERE id=NEW.original_allocation_id) OR NOT EXISTS (SELECT 1 FROM fee_request r JOIN bill b ON b.id=NEW.bill_id WHERE r.id=NEW.fee_request_id AND r.status='已同意' AND r.patient_funds_id=b.patient_funds_id AND (r.bill_id IS NULL OR r.bill_id=NEW.bill_id) AND (r.patient_payment_id IS NULL OR r.patient_payment_id=NEW.patient_payment_id)))) BEGIN SELECT RAISE(ABORT,'release_budget'); END;

CREATE TRIGGER "tr_prepayment_offset_allocation_owner_insert" BEFORE INSERT ON "prepayment_offset" WHEN (NOT EXISTS (SELECT 1 FROM patient_payment p JOIN bill b ON b.id=NEW.bill_id WHERE p.id=NEW.patient_payment_id AND p.patient_funds_id=b.patient_funds_id AND p.status='到账已确认')) BEGIN SELECT RAISE(ABORT,'allocation_owner'); END;

CREATE TRIGGER "tr_prepayment_offset_payment_budget_insert" BEFORE INSERT ON "prepayment_offset" WHEN (NEW.amount_cents>0 AND (NEW.amount_cents+(COALESCE((SELECT sum(amount_cents) FROM payment_allocation WHERE patient_payment_id=NEW.patient_payment_id),0)+COALESCE((SELECT sum(amount_cents) FROM prepayment_offset WHERE patient_payment_id=NEW.patient_payment_id),0))+COALESCE((SELECT sum(CASE WHEN status='已确认退款' THEN actual_cents WHEN status IN ('待办理','待核实') THEN requested_cents ELSE 0 END) FROM patient_refund WHERE patient_payment_id=NEW.patient_payment_id AND id<>-1),0)>(SELECT net_cents FROM patient_payment WHERE id=NEW.patient_payment_id) OR NEW.amount_cents>(COALESCE((SELECT sum(quantity*unit_price_cents) FROM bill_item WHERE bill_id=NEW.bill_id AND pricing_status='已核价'),0)+COALESCE((SELECT sum(i.amount_cents) FROM fee_adjustment_item i JOIN fee_adjustment a ON a.id=i.fee_adjustment_id WHERE a.bill_id=NEW.bill_id),0)-COALESCE((SELECT sum(amount_cents) FROM payment_allocation WHERE bill_id=NEW.bill_id),0)-COALESCE((SELECT sum(amount_cents) FROM prepayment_offset WHERE bill_id=NEW.bill_id),0)))) BEGIN SELECT RAISE(ABORT,'payment_budget'); END;

CREATE TRIGGER "tr_prepayment_offset_release_budget_insert" BEFORE INSERT ON "prepayment_offset" WHEN (NEW.amount_cents<0 AND (NOT EXISTS (SELECT 1 FROM prepayment_offset a WHERE a.id=NEW.original_offset_id AND a.amount_cents>0) OR -NEW.amount_cents-COALESCE((SELECT sum(amount_cents) FROM prepayment_offset WHERE original_offset_id=NEW.original_offset_id),0)>(SELECT amount_cents FROM prepayment_offset WHERE id=NEW.original_offset_id) OR NOT EXISTS (SELECT 1 FROM fee_request r JOIN bill b ON b.id=NEW.bill_id WHERE r.id=NEW.fee_request_id AND r.status='已同意' AND r.patient_funds_id=b.patient_funds_id AND (r.bill_id IS NULL OR r.bill_id=NEW.bill_id) AND (r.patient_payment_id IS NULL OR r.patient_payment_id=NEW.patient_payment_id)))) BEGIN SELECT RAISE(ABORT,'release_budget'); END;

CREATE TRIGGER "tr_fee_adjustment_adjustment_approval_insert" BEFORE INSERT ON "fee_adjustment" WHEN (NOT EXISTS (SELECT 1 FROM fee_request r WHERE r.id=NEW.fee_request_id AND r.status='已同意' AND r.bill_id=NEW.bill_id AND r.reviewed_by=NEW.approved_by)) BEGIN SELECT RAISE(ABORT,'adjustment_approval'); END;

CREATE TRIGGER "tr_fee_adjustment_item_adjustment_wrong_bill_insert" BEFORE INSERT ON "fee_adjustment_item" WHEN ((SELECT bill_id FROM fee_adjustment WHERE id=NEW.fee_adjustment_id) IS NOT (SELECT bill_id FROM bill_item WHERE id=NEW.bill_item_id)) BEGIN SELECT RAISE(ABORT,'adjustment_wrong_bill'); END;

CREATE TRIGGER "tr_fee_adjustment_item_adjustment_negative_receivable_insert" BEFORE INSERT ON "fee_adjustment_item" WHEN (NEW.amount_cents+(COALESCE((SELECT sum(quantity*unit_price_cents) FROM bill_item WHERE bill_id=(SELECT bill_id FROM fee_adjustment WHERE id=NEW.fee_adjustment_id) AND pricing_status='已核价'),0)+COALESCE((SELECT sum(i.amount_cents) FROM fee_adjustment_item i JOIN fee_adjustment a ON a.id=i.fee_adjustment_id WHERE a.bill_id=(SELECT bill_id FROM fee_adjustment WHERE id=NEW.fee_adjustment_id)),0)-COALESCE((SELECT sum(amount_cents) FROM payment_allocation WHERE bill_id=(SELECT bill_id FROM fee_adjustment WHERE id=NEW.fee_adjustment_id)),0)-COALESCE((SELECT sum(amount_cents) FROM prepayment_offset WHERE bill_id=(SELECT bill_id FROM fee_adjustment WHERE id=NEW.fee_adjustment_id)),0))<0) BEGIN SELECT RAISE(ABORT,'adjustment_negative_receivable'); END;

CREATE TRIGGER "tr_patient_refund_refund_approval_insert" BEFORE INSERT ON "patient_refund" WHEN (NOT EXISTS (SELECT 1 FROM fee_request r JOIN patient_payment p ON p.id=NEW.patient_payment_id WHERE r.id=NEW.fee_request_id AND r.status='已同意' AND r.patient_funds_id=p.patient_funds_id AND p.status='到账已确认' AND (r.patient_payment_id IS NULL OR r.patient_payment_id=p.id))) BEGIN SELECT RAISE(ABORT,'refund_approval'); END;

CREATE TRIGGER "tr_patient_refund_refund_approval_update" BEFORE UPDATE ON "patient_refund" WHEN (NOT EXISTS (SELECT 1 FROM fee_request r JOIN patient_payment p ON p.id=NEW.patient_payment_id WHERE r.id=NEW.fee_request_id AND r.status='已同意' AND r.patient_funds_id=p.patient_funds_id AND p.status='到账已确认' AND (r.patient_payment_id IS NULL OR r.patient_payment_id=p.id))) BEGIN SELECT RAISE(ABORT,'refund_approval'); END;

CREATE TRIGGER "tr_patient_refund_refund_budget_insert" BEFORE INSERT ON "patient_refund" WHEN ((CASE WHEN NEW.status='已确认退款' THEN NEW.actual_cents WHEN NEW.status IN ('待办理','待核实') THEN NEW.requested_cents ELSE 0 END)+COALESCE((SELECT sum(CASE WHEN status='已确认退款' THEN actual_cents WHEN status IN ('待办理','待核实') THEN requested_cents ELSE 0 END) FROM patient_refund WHERE patient_payment_id=NEW.patient_payment_id AND id<>NEW.id),0)+(COALESCE((SELECT sum(amount_cents) FROM payment_allocation WHERE patient_payment_id=NEW.patient_payment_id),0)+COALESCE((SELECT sum(amount_cents) FROM prepayment_offset WHERE patient_payment_id=NEW.patient_payment_id),0))>(SELECT net_cents FROM patient_payment WHERE id=NEW.patient_payment_id) OR (CASE WHEN NEW.status='已确认退款' THEN NEW.actual_cents WHEN NEW.status IN ('待办理','待核实') THEN NEW.requested_cents ELSE 0 END)+COALESCE((SELECT sum(CASE WHEN status='已确认退款' THEN actual_cents WHEN status IN ('待办理','待核实') THEN requested_cents ELSE 0 END) FROM patient_refund WHERE fee_request_id=NEW.fee_request_id AND id<>NEW.id),0)>(SELECT approved_refund_cents FROM fee_request WHERE id=NEW.fee_request_id)) BEGIN SELECT RAISE(ABORT,'refund_budget'); END;

CREATE TRIGGER "tr_patient_refund_refund_budget_update" BEFORE UPDATE ON "patient_refund" WHEN ((CASE WHEN NEW.status='已确认退款' THEN NEW.actual_cents WHEN NEW.status IN ('待办理','待核实') THEN NEW.requested_cents ELSE 0 END)+COALESCE((SELECT sum(CASE WHEN status='已确认退款' THEN actual_cents WHEN status IN ('待办理','待核实') THEN requested_cents ELSE 0 END) FROM patient_refund WHERE patient_payment_id=NEW.patient_payment_id AND id<>NEW.id),0)+(COALESCE((SELECT sum(amount_cents) FROM payment_allocation WHERE patient_payment_id=NEW.patient_payment_id),0)+COALESCE((SELECT sum(amount_cents) FROM prepayment_offset WHERE patient_payment_id=NEW.patient_payment_id),0))>(SELECT net_cents FROM patient_payment WHERE id=NEW.patient_payment_id) OR (CASE WHEN NEW.status='已确认退款' THEN NEW.actual_cents WHEN NEW.status IN ('待办理','待核实') THEN NEW.requested_cents ELSE 0 END)+COALESCE((SELECT sum(CASE WHEN status='已确认退款' THEN actual_cents WHEN status IN ('待办理','待核实') THEN requested_cents ELSE 0 END) FROM patient_refund WHERE fee_request_id=NEW.fee_request_id AND id<>NEW.id),0)>(SELECT approved_refund_cents FROM fee_request WHERE id=NEW.fee_request_id)) BEGIN SELECT RAISE(ABORT,'refund_budget'); END;

CREATE TRIGGER "tr_patient_refund_refund_retry_not_failed_insert" BEFORE INSERT ON "patient_refund" WHEN (NEW.previous_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patient_refund p WHERE p.id=NEW.previous_attempt_id AND p.id<>NEW.id AND p.status='已失败' AND p.patient_payment_id=NEW.patient_payment_id AND p.fee_request_id=NEW.fee_request_id)) BEGIN SELECT RAISE(ABORT,'refund_retry_not_failed'); END;

CREATE TRIGGER "tr_patient_refund_refund_retry_not_failed_update" BEFORE UPDATE ON "patient_refund" WHEN (NEW.previous_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patient_refund p WHERE p.id=NEW.previous_attempt_id AND p.id<>NEW.id AND p.status='已失败' AND p.patient_payment_id=NEW.patient_payment_id AND p.fee_request_id=NEW.fee_request_id)) BEGIN SELECT RAISE(ABORT,'refund_retry_not_failed'); END;

CREATE TRIGGER "tr_contact_history_followup_patient_insert" BEFORE INSERT ON "contact_history" WHEN (NEW.appointment_id IS NOT NULL AND (SELECT patient_id FROM appointment WHERE id=NEW.appointment_id) IS NOT (SELECT patient_id FROM followup_requirement WHERE id=NEW.followup_requirement_id)) BEGIN SELECT RAISE(ABORT,'followup_patient'); END;

CREATE TRIGGER "tr_contact_history_followup_patient_update" BEFORE UPDATE ON "contact_history" WHEN (NEW.appointment_id IS NOT NULL AND (SELECT patient_id FROM appointment WHERE id=NEW.appointment_id) IS NOT (SELECT patient_id FROM followup_requirement WHERE id=NEW.followup_requirement_id)) BEGIN SELECT RAISE(ABORT,'followup_patient'); END;

CREATE TRIGGER "tr_clinical_assessment_followup_patient_insert" BEFORE INSERT ON "clinical_assessment" WHEN (NEW.visit_id IS NOT NULL AND (SELECT patient_id FROM visit WHERE id=NEW.visit_id) IS NOT (SELECT patient_id FROM followup_requirement WHERE id=NEW.followup_requirement_id)) BEGIN SELECT RAISE(ABORT,'followup_patient'); END;

CREATE TRIGGER "tr_clinical_assessment_followup_patient_update" BEFORE UPDATE ON "clinical_assessment" WHEN (NEW.visit_id IS NOT NULL AND (SELECT patient_id FROM visit WHERE id=NEW.visit_id) IS NOT (SELECT patient_id FROM followup_requirement WHERE id=NEW.followup_requirement_id)) BEGIN SELECT RAISE(ABORT,'followup_patient'); END;

CREATE TRIGGER "tr_followup_requirement_assessment_required_insert" BEFORE INSERT ON "followup_requirement" WHEN (NEW.status='已完成' AND NEW.requires_assessment=1 AND NOT EXISTS (SELECT 1 FROM clinical_assessment WHERE followup_requirement_id=NEW.id AND advice='完成')) BEGIN SELECT RAISE(ABORT,'assessment_required'); END;

CREATE TRIGGER "tr_followup_requirement_assessment_required_update" BEFORE UPDATE ON "followup_requirement" WHEN (NEW.status='已完成' AND NEW.requires_assessment=1 AND NOT EXISTS (SELECT 1 FROM clinical_assessment WHERE followup_requirement_id=NEW.id AND advice='完成')) BEGIN SELECT RAISE(ABORT,'assessment_required'); END;

CREATE TRIGGER "tr_material_material_units_frozen_update" BEFORE UPDATE ON "material" WHEN ((EXISTS (SELECT 1 FROM inventory_movement m JOIN batch_stock s ON s.id=m.batch_stock_id JOIN material_batch b ON b.id=s.material_batch_id WHERE b.material_id=OLD.id)) AND (NEW."base_unit" IS NOT OLD."base_unit" OR NEW."purchase_unit" IS NOT OLD."purchase_unit" OR NEW."conversion_numerator" IS NOT OLD."conversion_numerator" OR NEW."conversion_denominator" IS NOT OLD."conversion_denominator" OR NEW."quantity_scale" IS NOT OLD."quantity_scale")) BEGIN SELECT RAISE(ABORT,'material_units_frozen'); END;

CREATE TRIGGER "tr_material_batch_expiry_required_insert" BEFORE INSERT ON "material_batch" WHEN (NEW.status='可用' AND NEW.expiry_date IS NULL AND EXISTS (SELECT 1 FROM material WHERE id=NEW.material_id AND requires_expiry=1)) BEGIN SELECT RAISE(ABORT,'expiry_required'); END;

CREATE TRIGGER "tr_material_batch_expiry_required_update" BEFORE UPDATE ON "material_batch" WHEN (NEW.status='可用' AND NEW.expiry_date IS NULL AND EXISTS (SELECT 1 FROM material WHERE id=NEW.material_id AND requires_expiry=1)) BEGIN SELECT RAISE(ABORT,'expiry_required'); END;

CREATE TRIGGER "tr_batch_stock_stock_starts_zero_insert" BEFORE INSERT ON "batch_stock" WHEN (NEW.quantity_scaled<>0) BEGIN SELECT RAISE(ABORT,'stock_starts_zero'); END;

CREATE TRIGGER "tr_inventory_movement_stock_stale_insert" BEFORE INSERT ON "inventory_movement" WHEN (NEW.before_scaled IS NOT (SELECT quantity_scaled FROM batch_stock WHERE id=NEW.batch_stock_id)) BEGIN SELECT RAISE(ABORT,'stock_stale'); END;

CREATE TRIGGER "tr_inventory_movement_issue_batch_unavailable_insert" BEFORE INSERT ON "inventory_movement" WHEN (NEW.movement_type='领用' AND NOT EXISTS (SELECT 1 FROM batch_stock s JOIN material_batch b ON b.id=s.material_batch_id JOIN material m ON m.id=b.material_id JOIN stock_location l ON l.id=s.stock_location_id WHERE s.id=NEW.batch_stock_id AND b.status='可用' AND m.is_active=1 AND m.confirmed_at IS NOT NULL AND m.confirmed_by IS NOT NULL AND l.is_active=1)) BEGIN SELECT RAISE(ABORT,'issue_batch_unavailable'); END;

CREATE TRIGGER "tr_inventory_movement_movement_type_source_insert" BEFORE INSERT ON "inventory_movement" WHEN ((NEW.movement_type IN ('验收入库','未用退回') AND NEW.delta_scaled<=0) OR (NEW.movement_type IN ('领用','退供') AND NEW.delta_scaled>=0) OR (NEW.movement_type='验收入库' AND NEW.purchase_receipt_item_id IS NULL) OR (NEW.movement_type='未用退回' AND NEW.original_movement_id IS NULL) OR (NEW.movement_type='盘点' AND NEW.stock_count_id IS NULL) OR (NEW.movement_type='退供' AND NEW.purchase_issue_id IS NULL)) BEGIN SELECT RAISE(ABORT,'movement_type_source'); END;

CREATE TRIGGER "tr_inventory_movement_count_stale_insert" BEFORE INSERT ON "inventory_movement" WHEN (NEW.movement_type='盘点' AND NOT EXISTS (SELECT 1 FROM stock_count c JOIN batch_stock s ON s.id=c.batch_stock_id WHERE c.id=NEW.stock_count_id AND c.status='差异已确认' AND c.stock_revision=s.revision AND c.snapshot_quantity_scaled=NEW.before_scaled AND c.counted_quantity_scaled=NEW.after_scaled)) BEGIN SELECT RAISE(ABORT,'count_stale'); END;

CREATE TRIGGER "tr_inventory_movement_receipt_stock_context_insert" BEFORE INSERT ON "inventory_movement" WHEN (NEW.movement_type='验收入库' AND NOT EXISTS (SELECT 1 FROM purchase_receipt_item r JOIN batch_stock s ON s.id=NEW.batch_stock_id JOIN purchase_receipt h ON h.id=r.purchase_receipt_id WHERE r.id=NEW.purchase_receipt_item_id AND r.material_batch_id=s.material_batch_id AND r.stock_location_id=s.stock_location_id AND h.accepted_at IS NOT NULL AND h.confirmed_by IS NOT NULL AND r.accepted_quantity_scaled>=NEW.delta_scaled+COALESCE((SELECT sum(delta_scaled) FROM inventory_movement WHERE purchase_receipt_item_id=r.id AND movement_type='验收入库'),0))) BEGIN SELECT RAISE(ABORT,'receipt_stock_context'); END;

CREATE TRIGGER "tr_inventory_movement_return_over_issue_insert" BEFORE INSERT ON "inventory_movement" WHEN (NEW.movement_type='未用退回' AND (NOT EXISTS (SELECT 1 FROM inventory_movement WHERE id=NEW.original_movement_id AND movement_type='领用') OR NEW.delta_scaled+COALESCE((SELECT sum(delta_scaled) FROM inventory_movement WHERE original_movement_id=NEW.original_movement_id AND movement_type='未用退回'),0)+COALESCE((SELECT sum(quantity_scaled) FROM material_usage WHERE inventory_movement_id=NEW.original_movement_id),0)>-(SELECT delta_scaled FROM inventory_movement WHERE id=NEW.original_movement_id))) BEGIN SELECT RAISE(ABORT,'return_over_issue'); END;

CREATE TRIGGER "tr_material_usage_usage_over_issue_insert" BEFORE INSERT ON "material_usage" WHEN (NOT EXISTS (SELECT 1 FROM inventory_movement WHERE id=NEW.inventory_movement_id AND movement_type='领用') OR NEW.quantity_scaled+COALESCE((SELECT sum(quantity_scaled) FROM material_usage WHERE inventory_movement_id=NEW.inventory_movement_id),0)+COALESCE((SELECT sum(delta_scaled) FROM inventory_movement WHERE original_movement_id=NEW.inventory_movement_id AND movement_type='未用退回'),0)>-(SELECT delta_scaled FROM inventory_movement WHERE id=NEW.inventory_movement_id)) BEGIN SELECT RAISE(ABORT,'usage_over_issue'); END;

CREATE TRIGGER tr_inventory_movement_post AFTER INSERT ON inventory_movement BEGIN UPDATE batch_stock SET quantity_scaled=NEW.after_scaled,revision=revision+1,updated_at=NEW.created_at WHERE id=NEW.batch_stock_id; END;

CREATE TRIGGER "tr_batch_stock_stock_ledger_mismatch_update" BEFORE UPDATE ON "batch_stock" WHEN (NEW.quantity_scaled IS NOT COALESCE((SELECT sum(delta_scaled) FROM inventory_movement WHERE batch_stock_id=NEW.id),0)) BEGIN SELECT RAISE(ABORT,'stock_ledger_mismatch'); END;

CREATE TRIGGER "tr_purchase_receipt_item_receipt_order_material_insert" BEFORE INSERT ON "purchase_receipt_item" WHEN ((SELECT purchase_order_id FROM purchase_receipt WHERE id=NEW.purchase_receipt_id) IS NOT (SELECT purchase_order_id FROM purchase_order_item WHERE id=NEW.purchase_order_item_id) OR (NEW.material_batch_id IS NOT NULL AND (SELECT material_id FROM material_batch WHERE id=NEW.material_batch_id) IS NOT (SELECT material_id FROM purchase_order_item WHERE id=NEW.purchase_order_item_id))) BEGIN SELECT RAISE(ABORT,'receipt_order_material'); END;

CREATE TRIGGER "tr_purchase_receipt_item_receipt_order_material_update" BEFORE UPDATE ON "purchase_receipt_item" WHEN ((SELECT purchase_order_id FROM purchase_receipt WHERE id=NEW.purchase_receipt_id) IS NOT (SELECT purchase_order_id FROM purchase_order_item WHERE id=NEW.purchase_order_item_id) OR (NEW.material_batch_id IS NOT NULL AND (SELECT material_id FROM material_batch WHERE id=NEW.material_batch_id) IS NOT (SELECT material_id FROM purchase_order_item WHERE id=NEW.purchase_order_item_id))) BEGIN SELECT RAISE(ABORT,'receipt_order_material'); END;

CREATE TRIGGER "tr_purchase_receipt_item_accepted_below_stocked_insert" BEFORE INSERT ON "purchase_receipt_item" WHEN (NEW.accepted_quantity_scaled<COALESCE((SELECT sum(delta_scaled) FROM inventory_movement WHERE purchase_receipt_item_id=NEW.id AND movement_type='验收入库'),0)) BEGIN SELECT RAISE(ABORT,'accepted_below_stocked'); END;

CREATE TRIGGER "tr_purchase_receipt_item_accepted_below_stocked_update" BEFORE UPDATE ON "purchase_receipt_item" WHEN (NEW.accepted_quantity_scaled<COALESCE((SELECT sum(delta_scaled) FROM inventory_movement WHERE purchase_receipt_item_id=NEW.id AND movement_type='验收入库'),0)) BEGIN SELECT RAISE(ABORT,'accepted_below_stocked'); END;

CREATE TRIGGER "tr_purchase_order_order_without_items_insert" BEFORE INSERT ON "purchase_order" WHEN (NEW.status='已确认' AND NOT EXISTS (SELECT 1 FROM purchase_order_item WHERE purchase_order_id=NEW.id)) BEGIN SELECT RAISE(ABORT,'order_without_items'); END;

CREATE TRIGGER "tr_purchase_order_order_without_items_update" BEFORE UPDATE ON "purchase_order" WHEN (NEW.status='已确认' AND NOT EXISTS (SELECT 1 FROM purchase_order_item WHERE purchase_order_id=NEW.id)) BEGIN SELECT RAISE(ABORT,'order_without_items'); END;

CREATE TRIGGER "tr_purchase_order_item_confirmed_order_terms_frozen_update" BEFORE UPDATE ON "purchase_order_item" WHEN ((EXISTS (SELECT 1 FROM purchase_order WHERE id=OLD.purchase_order_id AND status='已确认')) AND (NEW."ordered_quantity_scaled" IS NOT OLD."ordered_quantity_scaled" OR NEW."unit_price_cents" IS NOT OLD."unit_price_cents" OR NEW."purchase_unit" IS NOT OLD."purchase_unit" OR NEW."conversion_numerator" IS NOT OLD."conversion_numerator" OR NEW."conversion_denominator" IS NOT OLD."conversion_denominator" OR NEW."quantity_scale" IS NOT OLD."quantity_scale")) BEGIN SELECT RAISE(ABORT,'confirmed_order_terms_frozen'); END;

CREATE TRIGGER "tr_supplier_allocation_supplier_allocation_owner_insert" BEFORE INSERT ON "supplier_allocation" WHEN (COALESCE((SELECT supplier_id FROM purchase_order WHERE id=NEW.purchase_order_id),(SELECT o.supplier_id FROM purchase_receipt r JOIN purchase_order o ON o.id=r.purchase_order_id WHERE r.id=NEW.purchase_receipt_id)) IS NOT (SELECT f.supplier_id FROM supplier_payment p JOIN supplier_funds f ON f.id=p.supplier_funds_id WHERE p.id=NEW.supplier_payment_id)) BEGIN SELECT RAISE(ABORT,'supplier_allocation_owner'); END;

CREATE TRIGGER "tr_supplier_allocation_supplier_allocation_owner_update" BEFORE UPDATE ON "supplier_allocation" WHEN (COALESCE((SELECT supplier_id FROM purchase_order WHERE id=NEW.purchase_order_id),(SELECT o.supplier_id FROM purchase_receipt r JOIN purchase_order o ON o.id=r.purchase_order_id WHERE r.id=NEW.purchase_receipt_id)) IS NOT (SELECT f.supplier_id FROM supplier_payment p JOIN supplier_funds f ON f.id=p.supplier_funds_id WHERE p.id=NEW.supplier_payment_id)) BEGIN SELECT RAISE(ABORT,'supplier_allocation_owner'); END;

CREATE TRIGGER "tr_supplier_allocation_supplier_release_insert" BEFORE INSERT ON "supplier_allocation" WHEN (NEW.amount_cents<0 AND NOT EXISTS (SELECT 1 FROM supplier_allocation a WHERE a.id=NEW.original_allocation_id AND a.amount_cents>0 AND a.allocation_state='已生效' AND a.purchase_order_id IS NEW.purchase_order_id AND a.purchase_receipt_id IS NEW.purchase_receipt_id AND -NEW.amount_cents-COALESCE((SELECT sum(amount_cents) FROM supplier_allocation WHERE original_allocation_id=a.id AND id<>NEW.id AND allocation_state='已生效'),0)<=a.amount_cents)) BEGIN SELECT RAISE(ABORT,'supplier_release'); END;

CREATE TRIGGER "tr_supplier_allocation_supplier_release_update" BEFORE UPDATE ON "supplier_allocation" WHEN (NEW.amount_cents<0 AND NOT EXISTS (SELECT 1 FROM supplier_allocation a WHERE a.id=NEW.original_allocation_id AND a.amount_cents>0 AND a.allocation_state='已生效' AND a.purchase_order_id IS NEW.purchase_order_id AND a.purchase_receipt_id IS NEW.purchase_receipt_id AND -NEW.amount_cents-COALESCE((SELECT sum(amount_cents) FROM supplier_allocation WHERE original_allocation_id=a.id AND id<>NEW.id AND allocation_state='已生效'),0)<=a.amount_cents)) BEGIN SELECT RAISE(ABORT,'supplier_release'); END;

CREATE TRIGGER "tr_supplier_allocation_supplier_payment_budget_insert" BEFORE INSERT ON "supplier_allocation" WHEN (NEW.allocation_state<>'已取消' AND (NEW.amount_cents+COALESCE((SELECT sum(amount_cents) FROM supplier_allocation WHERE supplier_payment_id=NEW.supplier_payment_id AND id<>NEW.id AND allocation_state<>'已取消'),0)+COALESCE((SELECT sum(received_cents) FROM supplier_refund WHERE supplier_payment_id=NEW.supplier_payment_id),0)>(SELECT CASE WHEN status='已确认付款' THEN actual_cents ELSE requested_cents END FROM supplier_payment WHERE id=NEW.supplier_payment_id) OR (NEW.allocation_state='已生效' AND NOT EXISTS (SELECT 1 FROM supplier_payment WHERE id=NEW.supplier_payment_id AND status='已确认付款')))) BEGIN SELECT RAISE(ABORT,'supplier_payment_budget'); END;

CREATE TRIGGER "tr_supplier_allocation_supplier_payment_budget_update" BEFORE UPDATE ON "supplier_allocation" WHEN (NEW.allocation_state<>'已取消' AND (NEW.amount_cents+COALESCE((SELECT sum(amount_cents) FROM supplier_allocation WHERE supplier_payment_id=NEW.supplier_payment_id AND id<>NEW.id AND allocation_state<>'已取消'),0)+COALESCE((SELECT sum(received_cents) FROM supplier_refund WHERE supplier_payment_id=NEW.supplier_payment_id),0)>(SELECT CASE WHEN status='已确认付款' THEN actual_cents ELSE requested_cents END FROM supplier_payment WHERE id=NEW.supplier_payment_id) OR (NEW.allocation_state='已生效' AND NOT EXISTS (SELECT 1 FROM supplier_payment WHERE id=NEW.supplier_payment_id AND status='已确认付款')))) BEGIN SELECT RAISE(ABORT,'supplier_payment_budget'); END;

CREATE TRIGGER "tr_supplier_refund_supplier_refund_owner_budget_insert" BEFORE INSERT ON "supplier_refund" WHEN (NOT EXISTS (SELECT 1 FROM purchase_issue i JOIN purchase_order_item j ON j.id=i.purchase_order_item_id JOIN purchase_order o ON o.id=j.purchase_order_id JOIN supplier_funds f ON f.supplier_id=o.supplier_id WHERE i.id=NEW.purchase_issue_id AND f.id=NEW.supplier_funds_id AND i.status IN ('待处理','已完成')) OR NOT EXISTS (SELECT 1 FROM supplier_payment p WHERE p.id=NEW.supplier_payment_id AND p.status='已确认付款' AND p.actual_cents>=NEW.received_cents+COALESCE((SELECT sum(received_cents) FROM supplier_refund WHERE supplier_payment_id=p.id),0)+COALESCE((SELECT sum(amount_cents) FROM supplier_allocation WHERE supplier_payment_id=p.id AND allocation_state='已生效'),0))) BEGIN SELECT RAISE(ABORT,'supplier_refund_owner_budget'); END;

CREATE TRIGGER "tr_instrument_processing_release_missing_checks_insert" BEFORE INSERT ON "instrument_processing" WHEN (NEW.status='已放行' AND (NOT EXISTS (SELECT 1 FROM instrument_pack_cycle WHERE instrument_processing_id=NEW.id) OR NOT EXISTS (SELECT 1 FROM processing_monitor WHERE instrument_processing_id=NEW.id) OR EXISTS (SELECT 1 FROM processing_monitor WHERE instrument_processing_id=NEW.id AND (result<>'通过' OR evidence IS NULL)) OR EXISTS (SELECT 1 FROM instrument_pack_cycle WHERE instrument_processing_id=NEW.id AND (expires_at IS NULL OR expires_at<=NEW.released_at)))) BEGIN SELECT RAISE(ABORT,'release_missing_checks'); END;

CREATE TRIGGER "tr_instrument_processing_release_missing_checks_update" BEFORE UPDATE ON "instrument_processing" WHEN (NEW.status='已放行' AND (NOT EXISTS (SELECT 1 FROM instrument_pack_cycle WHERE instrument_processing_id=NEW.id) OR NOT EXISTS (SELECT 1 FROM processing_monitor WHERE instrument_processing_id=NEW.id) OR EXISTS (SELECT 1 FROM processing_monitor WHERE instrument_processing_id=NEW.id AND (result<>'通过' OR evidence IS NULL)) OR EXISTS (SELECT 1 FROM instrument_pack_cycle WHERE instrument_processing_id=NEW.id AND (expires_at IS NULL OR expires_at<=NEW.released_at)))) BEGIN SELECT RAISE(ABORT,'release_missing_checks'); END;

CREATE TRIGGER "tr_instrument_use_pack_not_released_insert" BEFORE INSERT ON "instrument_use" WHEN (NEW.use_status IN ('已发放','已使用') AND NOT EXISTS (SELECT 1 FROM instrument_pack_cycle c JOIN instrument_processing p ON p.id=c.instrument_processing_id WHERE c.id=NEW.instrument_pack_cycle_id AND p.status='已放行' AND c.status IN ('可用','已发放待确认','已使用') AND p.released_at<=NEW.issued_at AND c.expires_at>COALESCE(NEW.used_at,NEW.issued_at))) BEGIN SELECT RAISE(ABORT,'pack_not_released'); END;

CREATE TRIGGER "tr_instrument_use_pack_not_released_update" BEFORE UPDATE ON "instrument_use" WHEN (NEW.use_status IN ('已发放','已使用') AND NOT EXISTS (SELECT 1 FROM instrument_pack_cycle c JOIN instrument_processing p ON p.id=c.instrument_processing_id WHERE c.id=NEW.instrument_pack_cycle_id AND p.status='已放行' AND c.status IN ('可用','已发放待确认','已使用') AND p.released_at<=NEW.issued_at AND c.expires_at>COALESCE(NEW.used_at,NEW.issued_at))) BEGIN SELECT RAISE(ABORT,'pack_not_released'); END;

CREATE TRIGGER "tr_instrument_use_use_history_frozen_update" BEFORE UPDATE ON "instrument_use" WHEN ((OLD.use_status IN ('已使用','未用退回','异常补录')) AND 1) BEGIN SELECT RAISE(ABORT,'use_history_frozen'); END;

CREATE TRIGGER "tr_reconciliation_item_reconcile_patient_payment_insert" BEFORE INSERT ON "reconciliation_item" WHEN (NEW.patient_payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patient_payment s JOIN cash_reconciliation r ON r.id=NEW.cash_reconciliation_id WHERE s.id=NEW.patient_payment_id AND s.status='到账已确认' AND NEW.source_type='患者付款' AND NEW.included_cents=s.net_cents AND NEW.source_at=s.received_at AND NEW.source_revision=s.revision AND s.channel=r.channel AND s.received_at<=r.cutoff_at)) BEGIN SELECT RAISE(ABORT,'reconcile_patient_payment'); END;

CREATE TRIGGER "tr_reconciliation_item_reconcile_patient_refund_insert" BEFORE INSERT ON "reconciliation_item" WHEN (NEW.patient_refund_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patient_refund s JOIN cash_reconciliation r ON r.id=NEW.cash_reconciliation_id WHERE s.id=NEW.patient_refund_id AND s.status='已确认退款' AND NEW.source_type='患者退款' AND NEW.included_cents=-s.actual_cents AND NEW.source_at=s.verified_at AND NEW.source_revision=s.revision AND s.channel=r.channel AND s.verified_at<=r.cutoff_at)) BEGIN SELECT RAISE(ABORT,'reconcile_patient_refund'); END;

CREATE TRIGGER "tr_reconciliation_item_reconcile_supplier_payment_insert" BEFORE INSERT ON "reconciliation_item" WHEN (NEW.supplier_payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM supplier_payment s JOIN cash_reconciliation r ON r.id=NEW.cash_reconciliation_id WHERE s.id=NEW.supplier_payment_id AND s.status='已确认付款' AND NEW.source_type='供货付款' AND NEW.included_cents=-s.actual_cents AND NEW.source_at=s.verified_at AND NEW.source_revision=s.revision AND s.channel=r.channel AND s.verified_at<=r.cutoff_at)) BEGIN SELECT RAISE(ABORT,'reconcile_supplier_payment'); END;

CREATE TRIGGER "tr_reconciliation_item_reconcile_supplier_refund_insert" BEFORE INSERT ON "reconciliation_item" WHEN (NEW.supplier_refund_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM supplier_refund s JOIN cash_reconciliation r ON r.id=NEW.cash_reconciliation_id WHERE s.id=NEW.supplier_refund_id AND 1 AND NEW.source_type='供货退款' AND NEW.included_cents=s.received_cents AND NEW.source_at=s.received_at AND NEW.source_revision=s.revision AND s.channel=r.channel AND s.received_at<=r.cutoff_at)) BEGIN SELECT RAISE(ABORT,'reconcile_supplier_refund'); END;

CREATE TRIGGER "tr_staff_role_qualification_qualification_overlap_insert" BEFORE INSERT ON "staff_role_qualification" WHEN (EXISTS (SELECT 1 FROM staff_role_qualification q WHERE q.id<>NEW.id AND q.staff_id=NEW.staff_id AND q.role_id=NEW.role_id AND q.valid_from<min(COALESCE(NEW.valid_until,'9999'),COALESCE(NEW.revoked_at,'9999')) AND NEW.valid_from<min(COALESCE(q.valid_until,'9999'),COALESCE(q.revoked_at,'9999')))) BEGIN SELECT RAISE(ABORT,'qualification_overlap'); END;

CREATE TRIGGER "tr_staff_role_qualification_qualification_overlap_update" BEFORE UPDATE ON "staff_role_qualification" WHEN (EXISTS (SELECT 1 FROM staff_role_qualification q WHERE q.id<>NEW.id AND q.staff_id=NEW.staff_id AND q.role_id=NEW.role_id AND q.valid_from<min(COALESCE(NEW.valid_until,'9999'),COALESCE(NEW.revoked_at,'9999')) AND NEW.valid_from<min(COALESCE(q.valid_until,'9999'),COALESCE(q.revoked_at,'9999')))) BEGIN SELECT RAISE(ABORT,'qualification_overlap'); END;

CREATE TRIGGER "tr_account_role_qualification_account_insert" BEFORE INSERT ON "account_role" WHEN (NOT EXISTS (SELECT 1 FROM staff_role_qualification q JOIN user_account a ON a.staff_id=q.staff_id WHERE q.id=NEW.qualification_id AND a.id=NEW.account_id AND q.role_id=NEW.role_id AND q.valid_from<=NEW.granted_at AND NEW.granted_at<min(COALESCE(q.valid_until,'9999'),COALESCE(q.revoked_at,'9999')) AND COALESCE(NEW.valid_until,'9999')<=min(COALESCE(q.valid_until,'9999'),COALESCE(q.revoked_at,'9999')))) BEGIN SELECT RAISE(ABORT,'qualification_account'); END;

CREATE TRIGGER "tr_account_role_qualification_account_update" BEFORE UPDATE ON "account_role" WHEN (NOT EXISTS (SELECT 1 FROM staff_role_qualification q JOIN user_account a ON a.staff_id=q.staff_id WHERE q.id=NEW.qualification_id AND a.id=NEW.account_id AND q.role_id=NEW.role_id AND q.valid_from<=NEW.granted_at AND NEW.granted_at<min(COALESCE(q.valid_until,'9999'),COALESCE(q.revoked_at,'9999')) AND COALESCE(NEW.valid_until,'9999')<=min(COALESCE(q.valid_until,'9999'),COALESCE(q.revoked_at,'9999')))) BEGIN SELECT RAISE(ABORT,'qualification_account'); END;

CREATE TRIGGER "tr_account_role_grant_overlap_insert" BEFORE INSERT ON "account_role" WHEN (EXISTS (SELECT 1 FROM account_role a WHERE a.id<>NEW.id AND a.account_id=NEW.account_id AND a.role_id=NEW.role_id AND a.granted_at<min(COALESCE(NEW.valid_until,'9999'),COALESCE(NEW.revoked_at,'9999')) AND NEW.granted_at<min(COALESCE(a.valid_until,'9999'),COALESCE(a.revoked_at,'9999')))) BEGIN SELECT RAISE(ABORT,'grant_overlap'); END;

CREATE TRIGGER "tr_account_role_grant_overlap_update" BEFORE UPDATE ON "account_role" WHEN (EXISTS (SELECT 1 FROM account_role a WHERE a.id<>NEW.id AND a.account_id=NEW.account_id AND a.role_id=NEW.role_id AND a.granted_at<min(COALESCE(NEW.valid_until,'9999'),COALESCE(NEW.revoked_at,'9999')) AND NEW.granted_at<min(COALESCE(a.valid_until,'9999'),COALESCE(a.revoked_at,'9999')))) BEGIN SELECT RAISE(ABORT,'grant_overlap'); END;

CREATE TRIGGER "tr_backup_run_backup_success_gate_insert" BEFORE INSERT ON "backup_run" WHEN (NEW.status='成功' AND (NOT EXISTS (SELECT 1 FROM backup_artifact WHERE backup_id=NEW.id AND artifact_kind='database' AND verification_status='通过') OR EXISTS (SELECT 1 FROM backup_artifact WHERE backup_id=NEW.id AND verification_status<>'通过') OR NOT EXISTS (SELECT 1 FROM backup_copy WHERE backup_id=NEW.id AND location_kind='本地' AND status='已验证' AND manifest_sha256=NEW.manifest_sha256) OR NOT EXISTS (SELECT 1 FROM backup_copy WHERE backup_id=NEW.id AND location_kind='异机' AND status='已验证' AND manifest_sha256=NEW.manifest_sha256))) BEGIN SELECT RAISE(ABORT,'backup_success_gate'); END;

CREATE TRIGGER "tr_backup_run_backup_success_gate_update" BEFORE UPDATE ON "backup_run" WHEN (NEW.status='成功' AND (NOT EXISTS (SELECT 1 FROM backup_artifact WHERE backup_id=NEW.id AND artifact_kind='database' AND verification_status='通过') OR EXISTS (SELECT 1 FROM backup_artifact WHERE backup_id=NEW.id AND verification_status<>'通过') OR NOT EXISTS (SELECT 1 FROM backup_copy WHERE backup_id=NEW.id AND location_kind='本地' AND status='已验证' AND manifest_sha256=NEW.manifest_sha256) OR NOT EXISTS (SELECT 1 FROM backup_copy WHERE backup_id=NEW.id AND location_kind='异机' AND status='已验证' AND manifest_sha256=NEW.manifest_sha256))) BEGIN SELECT RAISE(ABORT,'backup_success_gate'); END;

CREATE TRIGGER "tr_plan_version_plan_publish_empty_update" BEFORE UPDATE ON "plan_version" WHEN (OLD.status='草稿' AND NEW.status='待确认' AND NOT EXISTS (SELECT 1 FROM plan_item WHERE plan_version_id=NEW.id)) BEGIN SELECT RAISE(ABORT,'plan_publish_empty'); END;

CREATE TRIGGER "tr_plan_item_plan_scope_frozen_insert" BEFORE INSERT ON "plan_item" WHEN (EXISTS (SELECT 1 FROM plan_version WHERE id=NEW.plan_version_id AND status<>'草稿')) BEGIN SELECT RAISE(ABORT,'plan_scope_frozen'); END;

CREATE TRIGGER "tr_plan_item_plan_scope_frozen_update" BEFORE UPDATE ON "plan_item" WHEN (EXISTS (SELECT 1 FROM plan_version WHERE id=NEW.plan_version_id AND status<>'草稿')) BEGIN SELECT RAISE(ABORT,'plan_scope_frozen'); END;

CREATE TRIGGER "tr_plan_item_plan_old_scope_frozen_update" BEFORE UPDATE ON "plan_item" WHEN (EXISTS (SELECT 1 FROM plan_version WHERE id=OLD.plan_version_id AND status<>'草稿')) BEGIN SELECT RAISE(ABORT,'plan_old_scope_frozen'); END;

CREATE TRIGGER "tr_plan_version_published_plan_content_frozen_update" BEFORE UPDATE ON "plan_version" WHEN ((OLD.status<>'草稿') AND (NEW."diagnostic_basis" IS NOT OLD."diagnostic_basis" OR NEW."planned_schedule" IS NOT OLD."planned_schedule" OR NEW."change_reason" IS NOT OLD."change_reason")) BEGIN SELECT RAISE(ABORT,'published_plan_content_frozen'); END;

CREATE TRIGGER "tr_health_item_reviewed_health_frozen_insert" BEFORE INSERT ON "health_item" WHEN (EXISTS (SELECT 1 FROM health_review WHERE health_version_id=NEW.health_version_id)) BEGIN SELECT RAISE(ABORT,'reviewed_health_frozen'); END;

CREATE TRIGGER "tr_processing_monitor_processing_scope_frozen_insert" BEFORE INSERT ON "processing_monitor" WHEN (EXISTS (SELECT 1 FROM instrument_processing WHERE id=NEW.instrument_processing_id AND status IN ('已放行','隔离停用'))) BEGIN SELECT RAISE(ABORT,'processing_scope_frozen'); END;

CREATE TRIGGER "tr_instrument_pack_cycle_processing_scope_frozen_insert" BEFORE INSERT ON "instrument_pack_cycle" WHEN (EXISTS (SELECT 1 FROM instrument_processing WHERE id=NEW.instrument_processing_id AND status IN ('已放行','隔离停用'))) BEGIN SELECT RAISE(ABORT,'processing_scope_frozen'); END;

CREATE TRIGGER "tr_processing_monitor_released_monitor_frozen_update" BEFORE UPDATE ON "processing_monitor" WHEN ((EXISTS (SELECT 1 FROM instrument_processing WHERE id=OLD.instrument_processing_id AND status IN ('已放行','隔离停用'))) AND 1) BEGIN SELECT RAISE(ABORT,'released_monitor_frozen'); END;

CREATE TRIGGER "tr_instrument_pack_cycle_released_pack_identity_frozen_update" BEFORE UPDATE ON "instrument_pack_cycle" WHEN ((EXISTS (SELECT 1 FROM instrument_processing WHERE id=OLD.instrument_processing_id AND status IN ('已放行','隔离停用'))) AND (NEW."packaging_check" IS NOT OLD."packaging_check" OR NEW."expires_at" IS NOT OLD."expires_at" OR NEW."checked_by" IS NOT OLD."checked_by")) BEGIN SELECT RAISE(ABORT,'released_pack_identity_frozen'); END;

CREATE TRIGGER "tr_instrument_processing_release_evidence_frozen_update" BEFORE UPDATE ON "instrument_processing" WHEN ((OLD.released_at IS NOT NULL) AND (NEW."processing_equipment_id" IS NOT OLD."processing_equipment_id" OR NEW."previous_processing_id" IS NOT OLD."previous_processing_id" OR NEW."started_at" IS NOT OLD."started_at" OR NEW."ended_at" IS NOT OLD."ended_at" OR NEW."released_at" IS NOT OLD."released_at" OR NEW."release_basis" IS NOT OLD."release_basis" OR NEW."released_by" IS NOT OLD."released_by" OR NEW."operator_id" IS NOT OLD."operator_id")) BEGIN SELECT RAISE(ABORT,'release_evidence_frozen'); END;

CREATE TRIGGER "tr_stock_count_completed_workflow_frozen_update" BEFORE UPDATE ON "stock_count" WHEN ((OLD.status IN ('差异已确认','不予调整')) AND 1) BEGIN SELECT RAISE(ABORT,'completed_workflow_frozen'); END;

CREATE TRIGGER "tr_followup_requirement_completed_workflow_frozen_update" BEFORE UPDATE ON "followup_requirement" WHEN ((OLD.status IN ('已完成','已撤销')) AND 1) BEGIN SELECT RAISE(ABORT,'completed_workflow_frozen'); END;

CREATE TRIGGER "tr_appointment_state_initial_insert" BEFORE INSERT ON "appointment" WHEN (NEW.status NOT IN ('已预约')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_appointment_state_transition_update" BEFORE UPDATE ON "appointment" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='已预约' AND NEW.status='已取消') OR (OLD.status='已预约' AND NEW.status='已到诊') OR (OLD.status='已预约' AND NEW.status='未到'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_visit_state_initial_insert" BEFORE INSERT ON "visit" WHEN (NEW.status NOT IN ('候诊')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_visit_state_transition_update" BEFORE UPDATE ON "visit" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='候诊' AND NEW.status='接诊中') OR (OLD.status='接诊中' AND NEW.status='诊疗结束'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_clinical_record_state_initial_insert" BEFORE INSERT ON "clinical_record" WHEN (NEW.status NOT IN ('草稿')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_clinical_record_state_transition_update" BEFORE UPDATE ON "clinical_record" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='草稿' AND NEW.status='已签署'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_plan_version_state_initial_insert" BEFORE INSERT ON "plan_version" WHEN (NEW.status NOT IN ('草稿')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_plan_version_state_transition_update" BEFORE UPDATE ON "plan_version" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='草稿' AND NEW.status='待确认') OR (OLD.status='待确认' AND NEW.status='已确认') OR (OLD.status='待确认' AND NEW.status='暂缓') OR (OLD.status='待确认' AND NEW.status='已拒绝') OR (OLD.status='暂缓' AND NEW.status='待确认') OR (OLD.status='已确认' AND NEW.status='停止后续执行') OR (OLD.status='已确认' AND NEW.status='本版执行完成'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_followup_requirement_state_initial_insert" BEFORE INSERT ON "followup_requirement" WHEN (NEW.status NOT IN ('待发布','待联系')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_followup_requirement_state_transition_update" BEFORE UPDATE ON "followup_requirement" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='待发布' AND NEW.status='待联系') OR (OLD.status='待联系' AND NEW.status='待到诊或评估') OR (OLD.status='待到诊或评估' AND NEW.status='待联系') OR (OLD.status='待到诊或评估' AND NEW.status='已完成') OR (OLD.status='待联系' AND NEW.status='已完成') OR (OLD.status='待到诊或评估' AND NEW.status='待联系') OR (OLD.status='待联系' AND NEW.status='已撤销') OR (OLD.status='待到诊或评估' AND NEW.status='已撤销'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_service_price_state_initial_insert" BEFORE INSERT ON "service_price" WHEN (NEW.status NOT IN ('价目草稿')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_service_price_state_transition_update" BEFORE UPDATE ON "service_price" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='价目草稿' AND NEW.status='待负责人确认') OR (OLD.status='待负责人确认' AND NEW.status='已确认可适用') OR (OLD.status='待负责人确认' AND NEW.status='已退回') OR (OLD.status='已退回' AND NEW.status='待负责人确认') OR (OLD.status='已确认可适用' AND NEW.status='不再用于新计费'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_patient_payment_state_initial_insert" BEFORE INSERT ON "patient_payment" WHEN (NEW.status NOT IN ('待核实','到账已确认')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_patient_payment_state_transition_update" BEFORE UPDATE ON "patient_payment" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='待核实' AND NEW.status='到账已确认') OR (OLD.status='待核实' AND NEW.status='未到账已核实'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_fee_request_state_initial_insert" BEFORE INSERT ON "fee_request" WHEN (NEW.status NOT IN ('待审核')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_fee_request_state_transition_update" BEFORE UPDATE ON "fee_request" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='待审核' AND NEW.status='已退回') OR (OLD.status='已退回' AND NEW.status='待审核') OR (OLD.status='待审核' AND NEW.status='已拒绝') OR (OLD.status='待审核' AND NEW.status='已同意') OR (OLD.status='待审核' AND NEW.status='已撤回'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_patient_refund_state_initial_insert" BEFORE INSERT ON "patient_refund" WHEN (NEW.status NOT IN ('待办理')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_patient_refund_state_transition_update" BEFORE UPDATE ON "patient_refund" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='待办理' AND NEW.status='待核实') OR (OLD.status='待办理' AND NEW.status='已确认退款') OR (OLD.status='待办理' AND NEW.status='已失败') OR (OLD.status='待核实' AND NEW.status='已确认退款') OR (OLD.status='待核实' AND NEW.status='已失败'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_supplier_payment_state_initial_insert" BEFORE INSERT ON "supplier_payment" WHEN (NEW.status NOT IN ('待付款')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_supplier_payment_state_transition_update" BEFORE UPDATE ON "supplier_payment" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='待付款' AND NEW.status='待核实') OR (OLD.status='待付款' AND NEW.status='已确认付款') OR (OLD.status='待付款' AND NEW.status='已失败') OR (OLD.status='待核实' AND NEW.status='已确认付款') OR (OLD.status='待核实' AND NEW.status='已失败'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_material_batch_state_initial_insert" BEFORE INSERT ON "material_batch" WHEN (NEW.status NOT IN ('待检')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_material_batch_state_transition_update" BEFORE UPDATE ON "material_batch" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='待检' AND NEW.status='可用') OR (OLD.status='可用' AND NEW.status='隔离') OR (OLD.status='隔离' AND NEW.status='停用') OR (OLD.status='隔离' AND NEW.status='可用') OR (OLD.status='停用' AND NEW.status='可用') OR (OLD.status='可用' AND NEW.status='过期') OR (OLD.status='隔离' AND NEW.status='过期') OR (OLD.status='待检' AND NEW.status='过期'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_stock_count_state_initial_insert" BEFORE INSERT ON "stock_count" WHEN (NEW.status NOT IN ('待确认差异')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_stock_count_state_transition_update" BEFORE UPDATE ON "stock_count" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='待确认差异' AND NEW.status='待重新核对') OR (OLD.status='待重新核对' AND NEW.status='待确认差异') OR (OLD.status='待确认差异' AND NEW.status='差异已确认') OR (OLD.status='待确认差异' AND NEW.status='不予调整'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_instrument_processing_state_initial_insert" BEFORE INSERT ON "instrument_processing" WHEN (NEW.status NOT IN ('处理中')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_instrument_processing_state_transition_update" BEFORE UPDATE ON "instrument_processing" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='处理中' AND NEW.status='待核对放行') OR (OLD.status='待核对放行' AND NEW.status='已放行') OR (OLD.status='待核对放行' AND NEW.status='隔离停用') OR (OLD.status='已放行' AND NEW.status='隔离停用'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_instrument_pack_cycle_state_initial_insert" BEFORE INSERT ON "instrument_pack_cycle" WHEN (NEW.status NOT IN ('待放行')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_instrument_pack_cycle_state_transition_update" BEFORE UPDATE ON "instrument_pack_cycle" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='待放行' AND NEW.status='可用') OR (OLD.status='可用' AND NEW.status='已发放待确认') OR (OLD.status='已发放待确认' AND NEW.status='已使用') OR (OLD.status='已发放待确认' AND NEW.status='可用') OR (OLD.status='可用' AND NEW.status='隔离') OR (OLD.status='已发放待确认' AND NEW.status='隔离'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_purchase_order_item_state_initial_insert" BEFORE INSERT ON "purchase_order_item" WHEN (NEW.status NOT IN ('待交付')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_purchase_order_item_state_transition_update" BEFORE UPDATE ON "purchase_order_item" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='待交付' AND NEW.status='履行中') OR (OLD.status='待交付' AND NEW.status='履行已完成') OR (OLD.status='待交付' AND NEW.status='待差异处理') OR (OLD.status='履行中' AND NEW.status='待差异处理') OR (OLD.status='待差异处理' AND NEW.status='履行中') OR (OLD.status='履行中' AND NEW.status='履行已完成') OR (OLD.status='待差异处理' AND NEW.status='履行已完成') OR (OLD.status='待交付' AND NEW.status='剩余已取消') OR (OLD.status='履行中' AND NEW.status='剩余已取消'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

CREATE TRIGGER "tr_document_version_state_initial_insert" BEFORE INSERT ON "document_version" WHEN (NEW.status NOT IN ('原件待确认')) BEGIN SELECT RAISE(ABORT,'state_initial'); END;

CREATE TRIGGER "tr_document_version_state_transition_update" BEFORE UPDATE ON "document_version" WHEN (NEW.status<>OLD.status AND NOT ((OLD.status='原件待确认' AND NEW.status='原件已确认') OR (OLD.status='原件待确认' AND NEW.status='退回核对') OR (OLD.status='原件已确认' AND NEW.status='缺失或不可读') OR (OLD.status='缺失或不可读' AND NEW.status='原件已确认'))) BEGIN SELECT RAISE(ABORT,'state_transition'); END;

INSERT INTO access_role(code,name,description,created_at) VALUES('frontdesk','前台','前台固定业务岗位','2026-10-18T00:00:00Z');

INSERT INTO access_role(code,name,description,created_at) VALUES('dentist','牙医','牙医固定业务岗位','2026-10-18T00:00:00Z');

INSERT INTO access_role(code,name,description,created_at) VALUES('cashier','收费人员','收费人员固定业务岗位','2026-10-18T00:00:00Z');

INSERT INTO access_role(code,name,description,created_at) VALUES('assistant','诊疗助理','诊疗助理固定业务岗位','2026-10-18T00:00:00Z');

INSERT INTO access_role(code,name,description,created_at) VALUES('manager','诊所负责人','诊所负责人固定业务岗位','2026-10-18T00:00:00Z');

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc01.maintain','UC-01','维护与取消预约','业务写入','uc01.maintain',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='frontdesk' AND p.code='uc01.maintain';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc02.query','UC-02','查询预约','查询','uc02.query',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='frontdesk' AND p.code='uc02.query';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc03.register','UC-03','登记到诊','业务写入','uc03.register',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='frontdesk' AND p.code='uc03.register';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc04.execute','UC-04','确认实际执行','业务写入','uc04.execute',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc04.execute';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc05.draft','UC-05','录入价目','业务写入','uc05.draft',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='cashier' AND p.code='uc05.draft';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc05.approve','UC-05','确认或退回价目','业务写入','uc05.approve',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc05.approve';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc06.query','UC-06','查询费用','查询','uc06.query',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='cashier' AND p.code='uc06.query';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc07.receive','UC-07','登记患者付款','业务写入','uc07.receive',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='cashier' AND p.code='uc07.receive';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc07.allocate','UC-07','分配及抵扣','业务写入','uc07.allocate',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='cashier' AND p.code='uc07.allocate';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc08.maintain','UC-08','维护患者资料','业务写入','uc08.maintain',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='frontdesk' AND p.code='uc08.maintain';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc09.query','UC-09','查询获准诊疗资料','查询','uc09.query',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc09.query';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc10.record','UC-10','记录检查诊断','业务写入','uc10.record',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc10.record';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc11.sign','UC-11','签署或独立补充','业务写入','uc11.sign',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc11.sign';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc12.propose','UC-12','提出或撤销诊后要求','业务写入','uc12.propose',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc12.propose';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc13.contact','UC-13','联系及安排','业务写入','uc13.contact',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='frontdesk' AND p.code='uc13.contact';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc14.assess','UC-14','临床评估','业务写入','uc14.assess',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc14.assess';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc15.schedule','UC-15','确认排班或停诊','业务写入','uc15.schedule',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc15.schedule';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc16.query','UC-16','查询可用安排','查询','uc16.query',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='frontdesk' AND p.code='uc16.query';

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc16.query';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc17.query','UC-17','查询批次库存','查询','uc17.query',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='assistant' AND p.code='uc17.query';

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc17.query';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc18.record','UC-18','领用退回及盘点录入','业务写入','uc18.record',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='assistant' AND p.code='uc18.record';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc18.approve','UC-18','确认盘点差异','业务写入','uc18.approve',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc18.approve';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc19.funds','UC-19','查询收付业务明细','查询','uc19.funds',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='cashier' AND p.code='uc19.funds';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc19.management','UC-19','查询经营及资金明细','查询','uc19.management',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc19.management';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc20.reconcile','UC-20','登记收支核对','业务写入','uc20.reconcile',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='cashier' AND p.code='uc20.reconcile';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc20.follow','UC-20','指定与核实差异处理','业务写入','uc20.follow',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc20.follow';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc21.health','UC-21','记录及复核健康版本','业务写入','uc21.health',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc21.health';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc22.plan','UC-22','方案及患者决定','业务写入','uc22.plan',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc22.plan';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc23.upload','UC-23','上传原件及核对元数据','业务写入','uc23.upload',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc23.upload';

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='assistant' AND p.code='uc23.upload';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc23.confirm','UC-23','确认诊疗原件','业务写入','uc23.confirm',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc23.confirm';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc24.apply','UC-24','提交/重提/撤回申请','业务写入','uc24.apply',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='cashier' AND p.code='uc24.apply';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc25.approve','UC-25','审核费用及退费','业务写入','uc25.approve',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc25.approve';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc26.refund','UC-26','办理及核实退款','业务写入','uc26.refund',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='cashier' AND p.code='uc26.refund';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc27.supplier','UC-27','维护供应商及结算依据','业务写入','uc27.supplier',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc27.supplier';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc27.draft','UC-27','录入采购需求','业务写入','uc27.draft',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='assistant' AND p.code='uc27.draft';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc27.approve','UC-27','确认采购约定','业务写入','uc27.approve',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc27.approve';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc28.receive','UC-28','录入验收及差异','业务写入','uc28.receive',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='assistant' AND p.code='uc28.receive';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc28.approve','UC-28','确认退换差异','业务写入','uc28.approve',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc28.approve';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc29.authorize','UC-29','确认供货付款依据','业务写入','uc29.authorize',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc29.authorize';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc29.pay','UC-29','办理付款分配及退回款','业务写入','uc29.pay',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='cashier' AND p.code='uc29.pay';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc30.process','UC-30','记录处理监测及放行','业务写入','uc30.process',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='assistant' AND p.code='uc30.process';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc31.use','UC-31','登记实际使用及退回','业务写入','uc31.use',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='assistant' AND p.code='uc31.use';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc31.clinical_trace','UC-31','查看获准就诊使用依据','查询','uc31.clinical_trace',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='uc31.clinical_trace';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc31.trace','UC-31','追溯异常及处置跟进','业务写入','uc31.trace',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc31.trace';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc32.record','UC-32','录入材料批次及立即隔离','业务写入','uc32.record',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='assistant' AND p.code='uc32.record';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('uc32.approve','UC-32','确认配置与恢复停用','业务写入','uc32.approve',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='uc32.approve';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('ops.identity.manage',NULL,'账号资格与授权维护','运行管理','ops.identity.manage',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='ops.identity.manage';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('ops.audit.query',NULL,'按对象范围查询操作历史','运行管理','ops.audit.query',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='ops.audit.query';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('ops.backup.manage',NULL,'备份及副本管理','运行管理','ops.backup.manage',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='ops.backup.manage';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('ops.restore.verify',NULL,'隔离恢复验证','运行管理','ops.restore.verify',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='ops.restore.verify';

INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('ops.request.query',NULL,'查询本人提交结果','运行管理','ops.request.query',1);

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='frontdesk' AND p.code='ops.request.query';

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='dentist' AND p.code='ops.request.query';

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='cashier' AND p.code='ops.request.query';

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='assistant' AND p.code='ops.request.query';

INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-18T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='ops.request.query';

PRAGMA user_version=20261018;
COMMIT;
