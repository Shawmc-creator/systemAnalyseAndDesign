// Requirements document: UC-04..07 and the clinic's daily management flows.
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function role(user, ...roles) {
  if (!roles.some(r => String(user?.roles || '').split(',').includes(r))) fail(403, '当前角色不能执行此操作');
}
function cents(value, label = '金额') {
  if (value == null || String(value).trim() === '') fail(400, `${label}为必填`);
  const n = Number(value), c = Math.round(n * 100);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(c) || Math.abs(n * 100 - c) > 0.000001) fail(400, `${label}必须为非负金额，最多两位小数`);
  return c;
}
function time(value, label = '时间') {
  const calendar=String(value||'').match(/^\d{4}-\d{2}-\d{2}/);if(calendar)day(calendar[0]);
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) fail(400, `${label}无效`);
  return date.toISOString();
}
function day(value) {
  const text = String(value || '');
  const parsed = new Date(`${text}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) fail(400, '日期无效');
  return text;
}
function log(db, user, action, target, id, patientId, details) { require('./db').audit(db, user?.id, action, target, id, patientId, details); }
function transaction(db, operation) {
  if (db.isTransaction) return operation();
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
function column(db, table, name, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
function initializeRequirementsSchema(db) {
  column(db, 'services', 'unit', "TEXT NOT NULL DEFAULT '项'");
  column(db, 'appointments', 'version', 'INTEGER NOT NULL DEFAULT 1');
  column(db, 'appointments', 'arrangement_confirmed_by', 'INTEGER REFERENCES users(id)');
  column(db, 'appointments', 'arrangement_confirmed_at', 'TEXT');
  column(db, 'encounters', 'confirmation_version', 'INTEGER NOT NULL DEFAULT 0');
  column(db, 'treatments', 'price_version_id', 'INTEGER');
  column(db, 'treatments', 'price_missing', 'INTEGER NOT NULL DEFAULT 0');
  column(db, 'treatments', 'confirmed_at', 'TEXT');
  column(db, 'invoices', 'version', 'INTEGER NOT NULL DEFAULT 1');
  column(db, 'invoices', 'confirmation_version', 'INTEGER NOT NULL DEFAULT 0');
  column(db, 'invoice_lines', 'unit', "TEXT NOT NULL DEFAULT '项'");
  column(db, 'followups', 'appointment_id', 'INTEGER REFERENCES appointments(id)');
  column(db, 'followups', 'next_contact_date', 'TEXT');
  column(db, 'followups', 'last_contact_by', 'INTEGER REFERENCES users(id)');
  column(db, 'followups', 'last_contact_at', 'TEXT');
  column(db, 'followups', 'completed_at', 'TEXT');
  column(db, 'followups', 'completed_by', 'INTEGER REFERENCES users(id)');
  column(db, 'followups', 'clinical_result', 'TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS requirements_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS service_price_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER NOT NULL REFERENCES services(id),
      unit_price REAL NOT NULL CHECK(unit_price>=0), effective_from TEXT NOT NULL, effective_to TEXT,
      confirmed_by INTEGER NOT NULL REFERENCES users(id), confirmed_at TEXT NOT NULL,
      confirmation_note TEXT NOT NULL, recorded_by INTEGER NOT NULL REFERENCES users(id),
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(effective_to IS NULL OR effective_to>effective_from));
    CREATE INDEX IF NOT EXISTS idx_price_versions ON service_price_versions(service_id,effective_from,effective_to);
    CREATE TABLE IF NOT EXISTS treatment_confirmation_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, encounter_id INTEGER NOT NULL REFERENCES encounters(id),
      version INTEGER NOT NULL, confirmed_by INTEGER NOT NULL REFERENCES users(id), confirmed_at TEXT NOT NULL,
      reason TEXT, items_json TEXT NOT NULL, UNIQUE(encounter_id,version));
    CREATE TABLE IF NOT EXISTS cash_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),
      receipt_no TEXT NOT NULL UNIQUE, due_amount REAL NOT NULL CHECK(due_amount>=0),
      tendered_amount REAL NOT NULL CHECK(tendered_amount>=due_amount), change_amount REAL NOT NULL CHECK(change_amount>=0),
      received_by INTEGER NOT NULL REFERENCES users(id), paid_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS daily_reconciliations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, expected_cash REAL NOT NULL,
      counted_cash REAL NOT NULL, difference REAL NOT NULL, difference_reason TEXT, resolution_note TEXT,
      recorded_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS followup_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, followup_id INTEGER NOT NULL REFERENCES followups(id),
      status TEXT NOT NULL, result TEXT, appointment_id INTEGER REFERENCES appointments(id), next_contact_date TEXT,
      changed_by INTEGER NOT NULL REFERENCES users(id), changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
}
function seedRequirements(db) {
  const owner = db.prepare("SELECT id FROM users WHERE active=1 AND (','||roles||',') LIKE '%,manager,%' ORDER BY id LIMIT 1").get();
  if (!owner) return;
  const cashier = db.prepare("SELECT id FROM users WHERE username='cashier'").get() || owner;
  if (!db.prepare("SELECT name FROM requirements_migrations WHERE name='legacy-prices'").get()) {
  for (const s of db.prepare('SELECT * FROM services').all()) {
    if (db.prepare('SELECT id FROM service_price_versions WHERE service_id=?').get(s.id)) continue;
    // Preserve the old price history instead of replacing it with today's catalog price.
    const history = db.prepare('SELECT * FROM service_price_history WHERE service_id=? ORDER BY effective_from,id').all(s.id);
    const versions = [];
    for (const h of history) {
      const at = time(h.effective_from.includes('T') ? h.effective_from : h.effective_from.replace(' ', 'T') + 'Z');
      if (versions.length && versions.at(-1).at === at) versions[versions.length - 1] = { at, price: h.price };
      else versions.push({ at, price: h.price });
    }
    if (!versions.length) versions.push({ at: new Date().toISOString(), price: s.current_price });
    for (let i = 0; i < versions.length; i++) db.prepare(`INSERT INTO service_price_versions(service_id,unit_price,effective_from,effective_to,confirmed_by,confirmed_at,confirmation_note,recorded_by) VALUES(?,?,?,?,?,?,?,?)`)
      .run(s.id, cents(versions[i].price) / 100, versions[i].at, versions[i + 1]?.at || null, owner.id, versions[i].at, '既有价目记录', cashier.id);
  }
  db.prepare("INSERT INTO requirements_migrations(name) VALUES('legacy-prices')").run();
  }
  db.prepare(`UPDATE service_price_versions AS v SET effective_from=confirmed_at
    WHERE effective_from='1970-01-01T00:00:00.000Z' AND confirmation_note='既有价目记录'
    AND NOT EXISTS(SELECT 1 FROM treatments t WHERE t.price_version_id=v.id AND t.confirmed_at<v.confirmed_at)`).run();
  db.prepare("UPDATE appointments SET status='confirmed' WHERE status='pending'").run();
  db.prepare("UPDATE appointments SET status='cancelled' WHERE status IN ('rescheduled','no_show')").run();
  db.prepare("UPDATE appointments SET status='arrived' WHERE status IN ('waiting','in_treatment','completed')").run();
  db.prepare('UPDATE appointments SET arrangement_confirmed_by=COALESCE(arrangement_confirmed_by,dentist_id),arrangement_confirmed_at=COALESCE(arrangement_confirmed_at,created_at)').run();
  // Earlier demos sometimes marked arrival without creating the visit record.
  for (const a of db.prepare("SELECT a.* FROM appointments a WHERE a.status='arrived' AND NOT EXISTS(SELECT 1 FROM encounters e WHERE e.appointment_id=a.id)").all()) {
    const no = require('./db').nextNo(db, 'encounters', 'encounter_no', 'E');
    db.prepare("INSERT INTO encounters(encounter_no,patient_id,appointment_id,dentist_id,status,started_at) VALUES(?,?,?,?,'draft',?)").run(no, a.patient_id, a.id, a.dentist_id, a.start_at);
  }
}
function managerConfirmation(db, input) {
  const id = Number(input.confirmedBy), at = time(input.confirmedAt, '负责人确认时间');
  if (new Date(at) > new Date()) fail(400, '确认时间不能晚于当前时间');
  if (!db.prepare("SELECT id FROM users WHERE id=? AND active=1 AND (','||roles||',') LIKE '%,manager,%'").get(id)) fail(400, '必须记录有效负责人的确认信息');
  const note = String(input.confirmationNote || '').trim();
  if (!note) fail(400, '必须记录负责人确认内容');
  return { id, at, note };
}
function listPriceVersions(db, serviceId) {
  return db.prepare(`SELECT v.*,s.name service_name,s.unit,u.display_name confirmed_name FROM service_price_versions v JOIN services s ON s.id=v.service_id JOIN users u ON u.id=v.confirmed_by ${serviceId ? 'WHERE v.service_id=?' : ''} ORDER BY s.id,v.effective_from DESC`).all(...(serviceId ? [Number(serviceId)] : []));
}
function createPriceVersion(db, input, user) {
  role(user, 'cashier');
  const serviceId = Number(input.serviceId), price = cents(input.unitPrice, '单价') / 100;
  if (!db.prepare('SELECT id FROM services WHERE id=? AND active=1').get(serviceId)) fail(400, '收费项目不存在或已停用');
  const from = time(input.effectiveFrom, '适用开始时间'), to = input.effectiveTo ? time(input.effectiveTo, '适用结束时间') : null;
  if (to && to <= from) fail(400, '适用结束必须晚于开始');
  const confirm = managerConfirmation(db, input);
  return transaction(db, () => {
    if (input.replacesVersionId) {
      const old = db.prepare('SELECT * FROM service_price_versions WHERE id=? AND service_id=?').get(Number(input.replacesVersionId), serviceId);
      if (!old || Number(input.expectedVersion) !== old.version || old.effective_from >= from || (old.effective_to && old.effective_to < from)) fail(409, '原价目已变化，请重新核对');
      if (db.prepare('SELECT id FROM treatments WHERE price_version_id=? AND confirmed_at>=?').get(old.id, from)) fail(409, '不能改变已确认诊疗使用的历史价目区间');
      db.prepare('UPDATE service_price_versions SET effective_to=?,version=version+1 WHERE id=?').run(from, old.id);
    }
    const conflict = db.prepare("SELECT id FROM service_price_versions WHERE service_id=? AND effective_from<? AND COALESCE(effective_to,'9999')>? LIMIT 1").get(serviceId, to || '9999', from);
    if (conflict) fail(409, '同一收费项目的适用区间不能重叠；可同时结束旧价目并建立新价目');
    const r = db.prepare(`INSERT INTO service_price_versions(service_id,unit_price,effective_from,effective_to,confirmed_by,confirmed_at,confirmation_note,recorded_by) VALUES(?,?,?,?,?,?,?,?)`).run(serviceId, price, from, to, confirm.id, confirm.at, confirm.note, user.id);
    const active = priceAt(db, serviceId, new Date().toISOString());
    if (active) db.prepare('UPDATE services SET current_price=? WHERE id=?').run(active.unit_price, serviceId);
    log(db, user, 'price.version.create', 'service_price_version', r.lastInsertRowid, null, { serviceId, price, from, to, confirmedBy: confirm.id });
    return db.prepare('SELECT * FROM service_price_versions WHERE id=?').get(r.lastInsertRowid);
  });
}
function endPriceVersion(db, id, input, user) {
  role(user, 'cashier'); const confirm = managerConfirmation(db, input), to = time(input.effectiveTo, '适用结束时间');
  return transaction(db, () => {
    const v = db.prepare('SELECT * FROM service_price_versions WHERE id=?').get(id);
    if (!v) fail(404, '价目不存在');
    if (Number(input.expectedVersion) !== v.version) fail(409, '价目已变化，请重新核对');
    if (to <= v.effective_from || (v.effective_to && to > v.effective_to)) fail(400, '结束时间不能扩大或清空原适用区间');
    if (db.prepare('SELECT id FROM treatments WHERE price_version_id=? AND confirmed_at>=?').get(id, to)) fail(409, '不能改变已确认诊疗使用的历史价目区间');
    db.prepare('UPDATE service_price_versions SET effective_to=?,version=version+1 WHERE id=?').run(to, id);
    log(db, user, 'price.version.end', 'service_price_version', id, null, confirm);
    return db.prepare('SELECT * FROM service_price_versions WHERE id=?').get(id);
  });
}
function priceAt(db, serviceId, at) {
  return db.prepare('SELECT * FROM service_price_versions WHERE service_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?) ORDER BY effective_from DESC LIMIT 1').get(serviceId, at, at);
}
function assignedEncounter(db, id, user, { editable = false } = {}) {
  role(user, 'dentist');
  const e = db.prepare('SELECT * FROM encounters WHERE id=?').get(id);
  if (!e) fail(404, '就诊记录不存在');
  if (e.dentist_id !== user.id) fail(403, '只能由本次接诊牙医办理');
  if (editable && e.status !== 'draft') fail(409, '已签署病历只能追加更正');
  return e;
}
function confirmation(db, encounterId, user, reason) {
  const e = db.prepare('SELECT * FROM encounters WHERE id=?').get(encounterId);
  const at = new Date().toISOString(), version = e.confirmation_version + 1;
  const rows = db.prepare("SELECT * FROM treatments WHERE encounter_id=? AND status='confirmed' ORDER BY id").all(encounterId);
  for (const row of rows) {
    const price = priceAt(db, row.service_id, at);
    db.prepare('UPDATE treatments SET price_version_id=?,price_missing=?,unit_price_snapshot=?,confirmed_at=? WHERE id=?').run(price?.id || null, price ? 0 : 1, price?.unit_price || 0, at, row.id);
    row.price_version_id = price?.id || null; row.price_missing = price ? 0 : 1; row.unit_price_snapshot = price?.unit_price || 0;
  }
  db.prepare('INSERT INTO treatment_confirmation_versions(encounter_id,version,confirmed_by,confirmed_at,reason,items_json) VALUES(?,?,?,?,?,?)').run(encounterId, version, user.id, at, reason || null, JSON.stringify(rows));
  db.prepare('UPDATE encounters SET confirmation_version=? WHERE id=?').run(version, encounterId);
  return { version, confirmedAt: at, items: rows };
}
function addTreatment(db, encounterId, input, user) {
  assignedEncounter(db, encounterId, user, { editable: true });
  const quantity = Number(input.quantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) fail(400, '诊疗数量必须为正整数');
  if (input.unitPrice != null) fail(400, '单价由适用价目确定，牙医不能修改收费价格');
  return transaction(db, () => {
    const e = assignedEncounter(db, encounterId, user, { editable: true });
    if (input.expectedVersion != null && Number(input.expectedVersion) !== e.confirmation_version) fail(409, '诊疗项目版本已变化，请重新核对');
    if (db.prepare('SELECT id FROM cash_receipts WHERE invoice_id IN (SELECT id FROM invoices WHERE encounter_id=?)').get(encounterId)) fail(409, '已经结清的项目不能覆盖');
    const service = db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(Number(input.serviceId));
    if (!service) fail(400, '诊疗项目不存在或已停用');
    const itemId = input.planItemId ? Number(input.planItemId) : null;
    if (itemId) {
      const item = db.prepare('SELECT i.*,p.patient_id,p.encounter_id FROM plan_items i JOIN treatment_plans p ON p.id=i.plan_id WHERE i.id=?').get(itemId);
      if (!item || item.patient_id !== e.patient_id || item.encounter_id !== e.id || item.service_id !== service.id || item.decision !== 'agreed') fail(409, '方案项目不属于本次患者或尚未同意治疗');
      if (item.tooth_code && item.tooth_code !== (input.toothCode || null)) fail(409, '实际治疗牙位与确认方案不一致');
      if (item.completed_quantity + quantity > item.planned_quantity) fail(409, '实际治疗数量超过已确认方案，请先核对方案');
    } else if (!String(input.outsidePlanReason || '').trim() || input.patientConfirmed !== true) fail(400, '方案外项目须记录原因及患者确认事实');
    const prior = db.prepare("SELECT * FROM treatments WHERE encounter_id=? AND service_id=? AND COALESCE(tooth_code,'')=? AND plan_item_id IS ? AND status='confirmed'").get(encounterId, service.id, input.toothCode || '', itemId);
    let treatmentId;
    if (prior) {
      treatmentId = prior.id;
      db.prepare('UPDATE treatments SET quantity=quantity+?,outcome=COALESCE(?,outcome) WHERE id=?').run(quantity, input.outcome || null, prior.id);
    } else {
      const r = db.prepare(`INSERT INTO treatments(encounter_id,plan_item_id,service_id,tooth_code,quantity,unit_price_snapshot,performed_by,outcome,outside_plan_reason,patient_confirmed) VALUES(?,?,?,?,?,0,?,?,?,1)`).run(encounterId, itemId, service.id, input.toothCode || null, quantity, user.id, input.outcome || null, input.outsidePlanReason || null);
      treatmentId = Number(r.lastInsertRowid);
    }
    if (itemId) db.prepare('UPDATE plan_items SET completed_quantity=completed_quantity+? WHERE id=?').run(quantity, itemId);
    const confirmed = confirmation(db, encounterId, user);
    log(db, user, 'treatment.confirm', 'encounter', encounterId, e.patient_id, { treatmentId, version: confirmed.version });
    return { treatmentId, confirmation: confirmed };
  });
}
function correctTreatments(db, encounterId, input, user) {
  const e=assignedEncounter(db,encounterId,user);
  if(!String(input.reason||'').trim())fail(400,'项目更正必须填写原因');
  if(!Array.isArray(input.items)||!input.items.length)fail(400,'实际完成项目不得为空');
  return transaction(db,()=>{
    const fresh=db.prepare('SELECT * FROM encounters WHERE id=?').get(encounterId);
    if(Number(input.expectedVersion)!==fresh.confirmation_version)fail(409,'项目版本已变化，请重新核对');
    if(db.prepare("SELECT id FROM invoices WHERE encounter_id=? AND (paid_amount>0 OR status='paid')").get(encounterId))fail(409,'已结清项目不能覆盖');
    const originals=db.prepare("SELECT * FROM treatments WHERE encounter_id=? AND status='confirmed'").all(encounterId);
    db.prepare("UPDATE treatments SET status='superseded' WHERE encounter_id=? AND status='confirmed'").run(encounterId);
    db.prepare('UPDATE plan_items SET completed_quantity=0 WHERE plan_id IN (SELECT id FROM treatment_plans WHERE encounter_id=?)').run(encounterId);
    const merged=new Map();
    for(const item of input.items){
      const serviceId=Number(item.serviceId),quantity=Number(item.quantity),planId=item.planItemId?Number(item.planItemId):null,tooth=item.toothCode||null;
      if(!Number.isSafeInteger(quantity)||quantity<=0||!db.prepare('SELECT id FROM services WHERE id=? AND active=1').get(serviceId))fail(400,'项目须有效，数量须为正整数');
      const original=item.treatmentId?originals.find(t=>t.id===Number(item.treatmentId)):originals.find(t=>t.service_id===serviceId&&(t.tooth_code||null)===tooth);
      if(item.treatmentId&&!original)fail(409,'更正的原项目不属于本次有效版本');
      const key=`${serviceId}:${tooth||''}:${planId||''}`;const prior=merged.get(key);
      if(prior)prior.quantity+=quantity;else merged.set(key,{...item,serviceId,quantity,planId,tooth,original});
    }
    for(const item of merged.values()){
      if(item.planId){
        const plan=db.prepare('SELECT i.*,p.patient_id,p.encounter_id FROM plan_items i JOIN treatment_plans p ON p.id=i.plan_id WHERE i.id=?').get(item.planId);
        if(!plan||plan.patient_id!==e.patient_id||plan.encounter_id!==e.id||plan.service_id!==item.serviceId||plan.decision!=='agreed'||(plan.tooth_code&&plan.tooth_code!==item.tooth))fail(409,'更正项目须有本次患者同意的同牙位方案依据');
        if(plan.completed_quantity+item.quantity>plan.planned_quantity)fail(409,'更正数量超过患者同意的方案数量');
        db.prepare('UPDATE plan_items SET completed_quantity=completed_quantity+? WHERE id=?').run(item.quantity,item.planId);
      }else if(!String(item.outsidePlanReason||input.outsidePlanReason||'').trim()||input.patientConfirmed!==true)fail(400,'方案外更正须留原因及患者确认事实');
      db.prepare('INSERT INTO treatments(encounter_id,plan_item_id,service_id,tooth_code,quantity,unit_price_snapshot,performed_by,outcome,outside_plan_reason,performed_at,patient_confirmed) VALUES(?,?,?,?,?,0,?,?,?,?,1)').run(encounterId,item.planId,item.serviceId,item.tooth,item.quantity,user.id,item.outcome||item.original?.outcome||null,item.planId?null:(item.outsidePlanReason||input.outsidePlanReason),item.original?.performed_at||new Date().toISOString());
    }
    const result=confirmation(db,encounterId,user,input.reason);log(db,user,'treatment.correct','encounter',encounterId,e.patient_id,{reason:input.reason,version:result.version});return result;
  });
}
function resolvePrices(db, e) {
  const latest = db.prepare('SELECT * FROM treatment_confirmation_versions WHERE encounter_id=? ORDER BY version DESC LIMIT 1').get(e.id);
  const rows = db.prepare("SELECT t.*,s.name service_name,s.unit FROM treatments t JOIN services s ON s.id=t.service_id WHERE encounter_id=? AND t.status='confirmed'").all(e.id);
  if (!rows.length) fail(409, '诊疗项目尚未确认');
  for (const t of rows) {
    if (t.price_missing) {
      const price = priceAt(db, t.service_id, latest?.confirmed_at || time(t.performed_at.includes('T') ? t.performed_at : t.performed_at.replace(' ', 'T') + 'Z'));
      if (!price) fail(409, `项目“${t.service_name}”缺少确认时点适用的价目，不能按零元结算`);
      db.prepare('UPDATE treatments SET price_missing=0,price_version_id=?,unit_price_snapshot=? WHERE id=?').run(price.id, price.unit_price, t.id);
      t.price_missing = 0; t.price_version_id = price.id; t.unit_price_snapshot = price.unit_price;
    }
    if (!Number.isSafeInteger(t.quantity) || t.quantity <= 0) fail(409, '实际项目数量不符合正整数要求，请牙医更正');
  }
  return rows;
}
function syncInvoice(db, id) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  if (!invoice) fail(404, '账单不存在');
  if (db.prepare('SELECT id FROM cash_receipts WHERE invoice_id=?').get(id) || invoice.paid_amount > 0) return invoice;
  const e = db.prepare('SELECT * FROM encounters WHERE id=?').get(invoice.encounter_id);
  if (!e || !['signed', 'amended'].includes(e.status)) fail(409, '请先由牙医确认并签署本次诊疗记录');
  const treatments = resolvePrices(db, e);
  if (invoice.confirmation_version !== e.confirmation_version || !db.prepare('SELECT id FROM invoice_lines WHERE invoice_id=?').get(id)) {
    db.prepare('DELETE FROM invoice_lines WHERE invoice_id=?').run(id);
    const add = db.prepare('INSERT INTO invoice_lines(invoice_id,treatment_id,service_name,unit,unit_price,quantity,line_amount) VALUES(?,?,?,?,?,?,?)');
    let total = 0;
    for (const t of treatments) { const amount = cents(t.unit_price_snapshot) * t.quantity; total += amount; add.run(id, t.id, t.service_name, t.unit, t.unit_price_snapshot, t.quantity, amount / 100); }
    db.prepare("UPDATE invoices SET gross_amount=?,balance=?,discount_amount=0,credited_amount=0,confirmation_version=?,version=version+1 WHERE id=?").run(total / 100, total / 100, e.confirmation_version, id);
  }
  return db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
}
function invoiceDetail(db, id) {
  const row = syncInvoice(db, id);
  const patient = db.prepare('SELECT full_name,patient_no FROM patients WHERE id=?').get(row.patient_id);
  return { ...row, ...patient, lines: db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=?').all(id), payments: db.prepare('SELECT * FROM payments WHERE invoice_id=? ORDER BY id').all(id), receipt: receiptDetail(db, id) };
}
function createInvoice(db, encounterId, user) {
  role(user, 'cashier');
  return transaction(db, () => {
    const e = db.prepare('SELECT * FROM encounters WHERE id=?').get(encounterId);
    if (!e) fail(404, '就诊记录不存在');
    if (!['signed', 'amended'].includes(e.status)) fail(409, '请先由牙医确认并签署本次诊疗记录');
    if (db.prepare('SELECT id FROM invoices WHERE encounter_id=?').get(encounterId)) fail(409, '本次就诊已有账单，请查询原账单');
    resolvePrices(db, e);
    const no = require('./db').nextNo(db, 'invoices', 'invoice_no', 'I');
    const r = db.prepare('INSERT INTO invoices(invoice_no,patient_id,encounter_id,created_by,confirmation_version) VALUES(?,?,?,?,?)').run(no, e.patient_id, e.id, user.id, -1);
    const result = invoiceDetail(db, Number(r.lastInsertRowid));
    log(db, user, 'invoice.create', 'invoice', result.id, e.patient_id, { version: result.version });
    return result;
  });
}
function receiptDetail(db, invoiceId) {
  const r = db.prepare('SELECT * FROM cash_receipts WHERE invoice_id=?').get(invoiceId);
  return r ? { id: r.id, receiptNo: r.receipt_no, dueAmount: r.due_amount, tenderedAmount: r.tendered_amount, changeAmount: r.change_amount, paidAt: r.paid_at } : null;
}
function receiveCash(db, id, input, user) {
  role(user, 'cashier');
  return transaction(db, () => {
    const prior = receiptDetail(db, id);
    if (prior) return { invoice: invoiceDetail(db, id), receipt: prior, replayed: true };
    const invoice = syncInvoice(db, id);
    if (invoice.paid_amount > 0 || invoice.discount_amount > 0 || invoice.credited_amount > 0 || invoice.refunded_amount > 0) fail(409, '既有非足额结算记录只能核对，不能再次登记本流程收款');
    if (Number(input.expectedVersion) !== invoice.version) fail(409, '项目或费用版本已变化，请重新查询核对');
    if (!['cash', '现金'].includes(input.method || 'cash')) fail(400, '本流程只登记现金足额结算');
    const tendered = cents(input.amount, '现金实收金额'), due = cents(invoice.gross_amount, '应收金额');
    if (tendered < due) fail(400, '现金实收不足应收，不能登记结清');
    const paidAt = new Date().toISOString(), no = require('./db').nextNo(db, 'cash_receipts', 'receipt_no', 'R');
    db.prepare('INSERT INTO cash_receipts(invoice_id,receipt_no,due_amount,tendered_amount,change_amount,received_by,paid_at) VALUES(?,?,?,?,?,?,?)').run(id, no, due / 100, tendered / 100, (tendered - due) / 100, user.id, paidAt);
    if (due > 0) db.prepare("INSERT INTO payments(invoice_id,amount,method,reference_no,received_by,paid_at) VALUES(?,?,'现金',?,?,?)").run(id, due / 100, no, user.id, paidAt);
    db.prepare("UPDATE invoices SET paid_amount=?,balance=0,status='paid',version=version+1 WHERE id=?").run(due / 100, id);
    log(db, user, 'cash.receive', 'invoice', id, invoice.patient_id, { due: due / 100, tendered: tendered / 100, change: (tendered - due) / 100, receiptNo: no });
    return { invoice: invoiceDetail(db, id), receipt: receiptDetail(db, id), replayed: false };
  });
}
function dailySummary(db, date) {
  day(date);
  const basis = require('./workflows').cashBasis(db,date);
  return { date, ...basis, encounterCount: db.prepare("SELECT COUNT(*) total FROM encounters WHERE date(started_at,'localtime')=?").get(date).total,
    invoiceCount: basis.basis.receipts.length, unsettledAmount: db.prepare("SELECT COALESCE(SUM(balance),0) total FROM invoices WHERE date(created_at,'localtime')=?").get(date).total };
}
function reconciliations(db, date) {
  return { summary: dailySummary(db, date), records: db.prepare('SELECT r.*,u.display_name recorded_name,c.display_name confirmed_name FROM daily_reconciliations r JOIN users u ON u.id=r.recorded_by LEFT JOIN users c ON c.id=r.confirmed_by WHERE r.date=? ORDER BY r.id DESC').all(date) };
}
function recordReconciliation(db, input, user) {
  role(user, 'cashier'); const w=require('./workflows'), date=day(input.date), counted=cents(input.countedCash,'实点现金净收')/100;
  return w.submission(db,'cash-reconcile',input,user,()=>{
    const summary=dailySummary(db,date);
    if (!input.basisHash) fail(400,'请先查询有效收款依据');
    if (input.basisHash!==summary.basisHash) fail(409,'收款依据已变化，请重新查询核对');
    const difference=(cents(counted)-Math.round(summary.expectedCash*100))/100;
    const reason=String(input.differenceReason||'').trim(), note=String(input.resolutionNote||'').trim();
    let proof={by:null,at:null,note:null};
    if (difference!==0) { if (!reason||!note) fail(400,'现金存在差异时须记录原因及处理意见'); proof=w.fact(db,input); }
    const row=db.prepare('INSERT INTO daily_reconciliations(date,expected_cash,counted_cash,difference,difference_reason,resolution_note,recorded_by,basis_json,basis_hash,confirmed_by,confirmed_at,confirmation_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(date,summary.expectedCash,counted,difference,reason||null,note||null,user.id,JSON.stringify(summary.basis),summary.basisHash,proof.by,proof.at,proof.note);
    log(db,user,'cash.reconcile','daily_reconciliation',row.lastInsertRowid,null,{date,difference,basisHash:summary.basisHash});
    return {record:db.prepare('SELECT * FROM daily_reconciliations WHERE id=?').get(row.lastInsertRowid),summary};
  });
}
function followupDetail(db, id) {
  const f = db.prepare(`SELECT f.*,p.full_name,p.patient_no,e.encounter_no,e.dentist_id,u.display_name assigned_name FROM followups f JOIN patients p ON p.id=f.patient_id LEFT JOIN encounters e ON e.id=f.encounter_id LEFT JOIN users u ON u.id=f.assigned_to WHERE f.id=?`).get(id);
  if (!f) fail(404, '复诊随访事项不存在');
  f.sourceEncounter = db.prepare('SELECT id,encounter_no,patient_id,dentist_id,status,appointment_id FROM encounters WHERE id=?').get(f.encounter_id) || null;
  f.appointment = f.appointment_id ? db.prepare('SELECT * FROM appointments WHERE id=?').get(f.appointment_id) : null;
  f.revisitEncounter = f.appointment_id ? db.prepare("SELECT id,dentist_id,status,encounter_no FROM encounters WHERE appointment_id=? ORDER BY id DESC LIMIT 1").get(f.appointment_id) || null : null;
  f.history = db.prepare('SELECT h.*,u.display_name changed_name FROM followup_history h JOIN users u ON u.id=h.changed_by WHERE followup_id=? ORDER BY h.id').all(id);
  return f;
}
function createFollowup(db, input, user) {
  const e = assignedEncounter(db, Number(input.encounterId), user);
  if (!['signed', 'amended'].includes(e.status)) fail(409, '请先确认并签署来源诊疗记录');
  if (Number(input.patientId) !== e.patient_id) fail(409, '复诊患者与来源诊疗记录不一致');
  const reason = String(input.reason || '').trim(), dueDate = day(input.dueDate);
  if (!reason) fail(400, '复诊或随访要求为必填');
  const front = input.assignedTo ? db.prepare("SELECT id FROM users WHERE id=? AND active=1 AND (','||roles||',') LIKE '%,frontdesk,%'").get(Number(input.assignedTo)) : db.prepare("SELECT id FROM users WHERE active=1 AND (','||roles||',') LIKE '%,frontdesk,%' ORDER BY id LIMIT 1").get();
  if (!front) fail(400, '须安排有效前台办理联系');
  const w=require('./workflows');
  if (!['revisit','followup'].includes(input.type)) fail(400,'请选择复诊或随访类型');
  return w.submission(db,'followup-create',input,user,() => {
    const r = db.prepare("INSERT INTO followups(patient_id,encounter_id,reason,due_date,status,assigned_to,created_by,type) VALUES(?,?,?,?,'pending',?,?,?)").run(e.patient_id, e.id, reason, dueDate, front.id, user.id, input.type);
    db.prepare("INSERT INTO followup_history(followup_id,status,result,changed_by) VALUES(?,'pending',?,?)").run(r.lastInsertRowid, reason, user.id);
    log(db, user, 'followup.create', 'followup', r.lastInsertRowid, e.patient_id, { encounterId: e.id, dueDate });
    return followupDetail(db, Number(r.lastInsertRowid));
  });
}
function updateFollowup(db, id, input, user) {
  role(user, input.status==='completed'?'dentist':'frontdesk');
  const w=require('./workflows');
  return w.submission(db,`followup-update:${id}`,input,user,() => {
    const f = followupDetail(db, id), status = String(input.status || ''), result = String(input.result || '').trim();
    if (!['pending', 'contacted', 'scheduled', 'completed', 'cancelled'].includes(status)) fail(400, '复诊随访状态无效');
    if (!result) fail(400, '须记录联系反馈或牙医处理意见');
    w.version(f,input);
    if (['completed', 'cancelled'].includes(f.status)) fail(409, '该事项已结束，原办理结果保留');
    if (!f.sourceEncounter || f.sourceEncounter.patient_id !== f.patient_id) fail(409, '缺少一致的诊疗来源，请由牙医核对');
    let appointmentId = f.appointment_id;
    if (status === 'completed') {
      role(user, 'dentist');
      const revisit = appointmentId ? db.prepare("SELECT * FROM encounters WHERE appointment_id=? AND patient_id=? AND status IN ('signed','amended') ORDER BY id DESC LIMIT 1").get(appointmentId, f.patient_id) : null;
      if (user.id !== f.sourceEncounter.dentist_id && user.id !== revisit?.dentist_id) fail(403, '须由来源或本次复诊的接诊牙医记录处理意见');
      if (appointmentId && !revisit) fail(409, '关联复诊尚未完成诊疗记录，请先核实');
      if (f.type==='revisit'&&!appointmentId) fail(409,'复诊评估须先关联已完成诊疗的复诊预约');
      const recovery=w.text(input.recovery,'恢复情况'),conclusion=w.text(input.conclusion,'评估结论'),opinion=w.text(input.opinion,'后续意见');
      db.prepare('UPDATE followups SET clinical_result=?,recovery=?,conclusion=?,opinion=?,completed_by=?,completed_at=CURRENT_TIMESTAMP WHERE id=?').run(result,recovery,conclusion,opinion,user.id,id);
    } else {
      role(user, 'frontdesk');
      if (input.appointmentId) {
        const a = db.prepare('SELECT * FROM appointments WHERE id=?').get(Number(input.appointmentId));
        if (!a || a.patient_id !== f.patient_id || !['confirmed', 'arrived'].includes(a.status)) fail(409, '须关联同一患者的有效复诊预约');
        if (a.id === f.sourceEncounter.appointment_id) fail(409, '复诊预约不能使用来源就诊的原预约');
        appointmentId = a.id;
      }
      if (status === 'scheduled' && !appointmentId) fail(400, '已安排复诊须关联预约');
      if (status==='scheduled' && !db.prepare("SELECT id FROM appointments WHERE id=? AND patient_id=? AND status IN ('confirmed','arrived')").get(appointmentId,f.patient_id)) fail(409,'关联复诊预约已失效，请重新核实');
      const contactAt=time(input.contactedAt,'实际联系时间');day(String(input.contactedAt).slice(0,10));if(Date.parse(contactAt)>Date.now())fail(400,'实际联系时间不能在未来');
      db.prepare('UPDATE followups SET last_contact_by=?,last_contact_at=? WHERE id=?').run(user.id,contactAt,id);
    }
    const nextDate = input.nextContactDate ? day(input.nextContactDate) : null;
    if (status === 'pending' && !nextDate) fail(400, '尚未联系成功时须记录下次联系日期');
    db.prepare('UPDATE followups SET status=?,result=?,appointment_id=?,next_contact_date=?,version=version+1 WHERE id=?').run(status, result, appointmentId || null, nextDate, id);
    db.prepare('INSERT INTO followup_history(followup_id,status,result,appointment_id,next_contact_date,changed_by,contacted_at) VALUES(?,?,?,?,?,?,?)').run(id, status, result, appointmentId || null, nextDate, user.id,status==='completed'?null:time(input.contactedAt));
    log(db, user, 'followup.update', 'followup', id, f.patient_id, { status, appointmentId });
    return followupDetail(db, id);
  });
}
function reportSummary(db, from, to) {
  day(from); day(to); if (from > to) fail(400, '统计结束日期不能早于开始日期');
  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE method IN ('cash','现金') AND date(paid_at,'localtime') BETWEEN ? AND ?").get(from, to).total;
  const refunded = db.prepare("SELECT COALESCE(SUM(r.amount),0) total FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.method IN ('cash','现金') AND date(r.processed_at,'localtime') BETWEEN ? AND ?").get(from,to).total;
  const invoices = db.prepare("SELECT COALESCE(SUM(gross_amount),0) gross,COALESCE(SUM(balance),0) balance FROM invoices WHERE date(created_at,'localtime') BETWEEN ? AND ?").get(from, to);
  return { from, to, appointments: db.prepare("SELECT status,COUNT(*) count FROM appointments WHERE date(start_at,'localtime') BETWEEN ? AND ? GROUP BY status").all(from, to),
    money: { gross: invoices.gross, balance: invoices.balance, paid: Math.round(paid * 100) / 100, refunded: Math.round(refunded*100)/100, net: Math.round((paid-refunded)*100)/100 },
    details: { unsettledInvoices:db.prepare("SELECT invoice_no,created_at,gross_amount,paid_amount,balance FROM invoices WHERE balance>0 AND date(created_at,'localtime') BETWEEN ? AND ? ORDER BY created_at,id").all(from,to),encounters: db.prepare("SELECT encounter_no,started_at,status FROM encounters WHERE date(started_at,'localtime') BETWEEN ? AND ? ORDER BY started_at").all(from,to),
      treatments: db.prepare("SELECT e.encounter_no,s.name service_name,s.unit,t.quantity,t.performed_at FROM treatments t JOIN encounters e ON e.id=t.encounter_id JOIN services s ON s.id=t.service_id WHERE t.status='confirmed' AND date(t.performed_at,'localtime') BETWEEN ? AND ? ORDER BY t.performed_at,t.id").all(from,to),
      receipts: db.prepare("SELECT receipt_no,paid_at,due_amount,tendered_amount,change_amount FROM cash_receipts WHERE date(paid_at,'localtime') BETWEEN ? AND ? ORDER BY paid_at,id").all(from,to),
      payments: db.prepare("SELECT id,invoice_id,reference_no,amount,paid_at FROM payments WHERE method IN ('cash','现金') AND date(paid_at,'localtime') BETWEEN ? AND ? ORDER BY paid_at,id").all(from,to),
      refunds: db.prepare("SELECT r.id,r.amount,r.processed_at FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.method IN ('cash','现金') AND date(r.processed_at,'localtime') BETWEEN ? AND ? ORDER BY r.id").all(from,to) },
    encounterCount: db.prepare("SELECT COUNT(*) count FROM encounters WHERE date(started_at,'localtime') BETWEEN ? AND ?").get(from, to).count,
    treatments: db.prepare("SELECT s.name service_name,s.unit,SUM(t.quantity) quantity FROM treatments t JOIN services s ON s.id=t.service_id WHERE t.status='confirmed' AND date(t.performed_at,'localtime') BETWEEN ? AND ? GROUP BY s.id").all(from, to) };
}
module.exports = { fail, role, cents, time, day, transaction, initializeRequirementsSchema, seedRequirements, listPriceVersions, createPriceVersion, endPriceVersion, priceAt, assignedEncounter, addTreatment, correctTreatments, createInvoice, invoiceDetail, receiveCash, dailySummary, reconciliations, recordReconciliation, followupDetail, createFollowup, updateFollowup, reportSummary };
