const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
process.env.CLINIC_DB = ':memory:';
const { server, db } = require('../src/server');
const rules = require('../src/requirements');
const w = require('../src/workflows');
const materialRules = require('../src/materials');

test('新版20用例：分岗办理、原始依据、过期保护及失败恢复', async t => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, session, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: {
      'Content-Type': 'application/json', Cookie: session.cookie,
      ...(method === 'GET' ? {} : { 'X-CSRF-Token': session.csrf })
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function login(username) {
    const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Clinic123!' }) });
    assert.equal(res.status, 200);
    return { ...await res.json(), cookie: res.headers.get('set-cookie').split(';')[0] };
  }
  const front = await login('frontdesk'), doc = await login('dentist'), owner = await login('manager'), cash = await login('cashier'), assist = await login('assistant');
  const today = db.prepare("SELECT date('now','localtime') day").get().day;
  const future = new Date(); future.setDate(future.getDate() + 2); future.setHours(10, 0, 0, 0);
  const weekday = future.getDay(), now = new Date().toISOString();
  db.exec("UPDATE clinic_hours SET active=1,open_time='00:00',close_time='23:59'");
  for (const u of [doc.user, owner.user]) db.prepare("INSERT OR IGNORE INTO dentist_schedules(dentist_id,weekday,start_time,end_time,active) VALUES(?,?,'09:00','17:00',1)").run(u.id, weekday);
  const key = () => randomUUID();
  const ok = (response, status) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
  let patient, appointment, encounter, plan, item, invoice, followup, material, scheduleBody, movementBody, assessmentBody, reconciliationBody;
  const appointmentBody = () => ({ patientId: patient.id, dentistId: doc.user.id, chairId: 1, serviceId: 1, startAt: future.toISOString(), endAt: new Date(future.getTime() + 1800000).toISOString(), arrangementConfirmedBy: doc.user.id, arrangementConfirmedAt: now });
  const readEncounter = async () => ok(await call(`/api/encounters/${encounter.id}`, doc), 200).encounter;

  await t.test('UC-08 患者必填、疑似重复、修改原因、原值及过期版本', async () => {
    const input = { fullName: '新版验收患者', phone: '13800007101', birthDate: '1998-02-28', requestId: key() };
    assert.equal((await call('/api/patients', front, 'POST', { ...input, phone: '' })).status, 400);
    assert.equal((await call('/api/patients', owner, 'POST', input)).status, 403);
    patient = ok(await call('/api/patients', front, 'POST', input), 201).patient;
    const replay = ok(await call('/api/patients', front, 'POST', input), 201); assert.equal(replay.patient.id, patient.id); assert.equal(replay.replayed, true);
    const duplicate = await call('/api/patients', front, 'POST', { ...input, requestId: key() }); assert.equal(duplicate.status, 409); assert.equal(duplicate.body.duplicates[0].id, patient.id);
    const update = { ...input, requestId: key(), fullName: '新版验收患者（核实）', reason: '核实姓名', expectedVersion: patient.version };
    patient = ok(await call(`/api/patients/${patient.id}`, front, 'PUT', update), 200).patient;
    assert.equal(patient.changes.length, 1); assert.equal(JSON.parse(patient.changes[0].old_json).full_name, input.fullName);
    assert.equal((await call(`/api/patients/${patient.id}`, front, 'PUT', { ...update, requestId: key() })).status, 409);
  });
  await t.test('UC-15 接诊牙医确认、原安排、变更历史与过期保护', async () => {
    const old = db.prepare('SELECT * FROM dentist_schedules WHERE dentist_id=? AND weekday=?').get(doc.user.id, weekday);
    scheduleBody = { requestId: key(), expectedVersion: old.version, dentistId: doc.user.id, weekday, startTime: '09:00', endTime: '18:00', active: true, reason: '延长下午接诊时段', confirmedBy: doc.user.id, confirmedAt: now, confirmationNote: '牙医已确认周接诊安排' };
    assert.equal((await call('/api/admin/dentist-schedules', front, 'POST', scheduleBody)).status, 403);
    assert.equal((await call('/api/admin/dentist-schedules', owner, 'POST', { ...scheduleBody, startTime: '99:00' })).status, 400);
    ok(await call('/api/admin/dentist-schedules', owner, 'POST', scheduleBody), 200);
    const history = ok(await call('/api/admin/settings', owner), 200).scheduleHistory;
    assert.equal(JSON.parse(history[0].old_json).end_time, old.end_time);
    assert.equal((await call('/api/admin/dentist-schedules', owner, 'POST', { ...scheduleBody, requestId: key() })).status, 409);
  });
  await t.test('UC-16 可用接诊时段只读、牙医仅本人、无患者身份泄露', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM appointments').get().n;
    const route = `/api/availability?dentistId=${doc.user.id}&chairId=1&date=${future.toLocaleDateString('en-CA')}&duration=30`;
    const data = ok(await call(route, front), 200); assert.ok(data.slots.length); assert.ok(!JSON.stringify(data).includes(patient.full_name));
    ok(await call(route, doc), 200); assert.equal((await call(route, owner)).status, 403); assert.equal((await call(route, assist)).status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM appointments').get().n, before);
  });
  await t.test('UC-01 预约创建、冲突及排班发布不得破坏已有预约', async () => {
    appointment = ok(await call('/api/appointments', front, 'POST', appointmentBody()), 201).appointment;
    assert.equal((await call('/api/appointments', front, 'POST', appointmentBody())).status, 409);
    const current = db.prepare('SELECT * FROM dentist_schedules WHERE dentist_id=? AND weekday=?').get(doc.user.id, weekday);
    assert.equal((await call('/api/admin/dentist-schedules', owner, 'POST', { ...scheduleBody, requestId: key(), expectedVersion: current.version, startTime: '11:00' })).status, 409);
    assert.equal(db.prepare('SELECT start_time FROM dentist_schedules WHERE id=?').get(current.id).start_time, '09:00');
  });
  await t.test('UC-02 查询预约不修改记录，前台可查已确认安排', async () => {
    const day = future.toLocaleDateString('en-CA');
    const rows = ok(await call(`/api/appointments?from=${day}&to=${day}`, front), 200).appointments;
    assert.ok(rows.some(x => x.id === appointment.id && x.status === 'confirmed'));
    assert.equal(ok(await call(`/api/appointments?from=${day}&to=${day}&q=找不到的姓名`,front),200).appointments.length,0);
    assert.ok(ok(await call(`/api/appointments?from=${day}&to=${day}&q=${patient.phone}`,front),200).appointments.some(x=>x.id===appointment.id));
    assert.equal((await call(`/api/appointments?from=${day}&to=${day}`,doc)).status,403);
    assert.equal(db.prepare('SELECT version FROM appointments WHERE id=?').get(appointment.id).version, appointment.version);
  });
  await t.test('UC-03 到诊生成唯一就诊，重复办理返回原编号', async () => {
    // Simulate the booked day's arrival; no test writes to the running clinic database.
    db.prepare('UPDATE appointments SET start_at=?,end_at=? WHERE id=?').run(`${today}T02:00:00Z`, `${today}T02:30:00Z`, appointment.id);
    encounter = ok(await call(`/api/appointments/${appointment.id}/status`, front, 'POST', { status: 'arrived' }), 200).encounter;
    const second = ok(await call(`/api/appointments/${appointment.id}/status`, front, 'POST', { status: 'arrived' }), 200);
    assert.equal(second.encounter.id, encounter.id); assert.equal(encounter.status, 'draft');
  });
  await t.test('UC-09 临床仅接诊范围，既往病历需同患者就诊依据', async () => {
    ok(await call(`/api/encounters/${encounter.id}`, doc), 200);
    for (const user of [front, cash, assist, owner]) assert.equal((await call(`/api/encounters/${encounter.id}`, user)).status, 403);
    const past = Number(db.prepare("INSERT INTO encounters(encounter_no,patient_id,dentist_id,status,started_at,diagnosis) VALUES('E-PAST',?,?,'signed','2000-01-01','既往所见')").run(patient.id, owner.user.id).lastInsertRowid);
    assert.equal((await call(`/api/encounters/${past}`, doc)).status, 403);
    ok(await call(`/api/encounters/${past}?currentEncounterId=${encounter.id}`, doc), 200);
    db.prepare('UPDATE encounters SET patient_id=1 WHERE id=?').run(past);
    assert.equal((await call(`/api/encounters/${past}?currentEncounterId=${encounter.id}`, doc)).status, 403);
    const list = ok(await call('/api/encounters', doc), 200).encounters; assert.ok(list.every(e => e.dentist_id === doc.user.id));
  });
  await t.test('UC-10 保存检查诊断、方案和患者决定，方案不冒充实际项目', async () => {
    const draft = { expectedVersion: encounter.version, chiefComplaint: '检查口腔情况', relevantHistory: '相关病史已核实', diagnosis: '本次检查结果', clinicalNotes: '完成本次检查', instructions: '按诊后指导维护', findings: [{ toothCode: '11', finding: '检查所见已记录' }] };
    ok(await call(`/api/encounters/${encounter.id}`, doc, 'PUT', draft), 200);
    assert.equal((await call(`/api/encounters/${encounter.id}`, doc, 'PUT', draft)).status, 409);
    encounter = await readEncounter();
    plan = ok(await call(`/api/encounters/${encounter.id}/plans`, doc, 'POST', { expectedVersion: encounter.version, summary: '已向患者说明方案及费用', items: [{ serviceId: 1, toothCode: '11', quantity: 2, decision: 'deferred' }] }), 201);
    const data = ok(await call(`/api/plans/${plan.planId}`, doc), 200).plan; item = data.items[0];
    assert.equal(db.prepare('SELECT COUNT(*) n FROM treatments WHERE encounter_id=?').get(encounter.id).n, 0);
    ok(await call(`/api/plans/${plan.planId}/decision`, doc, 'POST', { expectedVersion: data.clinicalVersion, items: [{ id: item.id, decision: 'agreed' }] }), 200);
  });
  await t.test('UC-04 实际项目按同意方案核验，更正保留方案及完成日期', async () => {
    const input = { expectedVersion: 0, planItemId: item.id, serviceId: 1, toothCode: '11', quantity: 2 };
    assert.equal((await call(`/api/encounters/${encounter.id}/treatments`, doc, 'POST', { ...input, toothCode: '12' })).status, 409);
    ok(await call(`/api/encounters/${encounter.id}/treatments`, doc, 'POST', input), 201);
    const old = db.prepare("SELECT * FROM treatments WHERE encounter_id=? AND status='confirmed'").get(encounter.id);
    ok(await call(`/api/encounters/${encounter.id}/treatment-confirmation`, doc, 'PUT', { expectedVersion: 1, reason: '核实本次实际完成一次', items: [{ treatmentId: old.id, planItemId: item.id, serviceId: 1, toothCode: '11', quantity: 1 }] }), 200);
    const current = db.prepare("SELECT * FROM treatments WHERE encounter_id=? AND status='confirmed'").get(encounter.id);
    assert.equal(current.plan_item_id, item.id); assert.equal(current.performed_at, old.performed_at);
    assert.equal(db.prepare('SELECT completed_quantity FROM plan_items WHERE id=?').get(item.id).completed_quantity, 1);
    assert.equal(db.prepare('SELECT status FROM treatments WHERE id=?').get(old.id).status, 'superseded');
  });
  await t.test('UC-11 签署保留原事实，重复返回原签署，签署后不能覆盖正文', async () => {
    encounter = await readEncounter();
    const input = { expectedVersion: encounter.version };
    assert.equal((await call(`/api/encounters/${encounter.id}/sign`, doc, 'POST', {})).status, 400);
    const first = ok(await call(`/api/encounters/${encounter.id}/sign`, doc, 'POST', input), 200);
    const retry = ok(await call(`/api/encounters/${encounter.id}/sign`, doc, 'POST', input), 200); assert.equal(retry.replayed, true); assert.equal(retry.signedAt, first.signedAt);
    assert.equal((await call(`/api/encounters/${encounter.id}`, doc, 'PUT', { ...input, diagnosis: '覆盖原诊断' })).status, 409);
    ok(await call(`/api/encounters/${encounter.id}/amend`, doc, 'POST', { text: '补充患者自述', reason: '签署后补记遗漏内容' }), 201);
    assert.equal(db.prepare('SELECT diagnosis FROM encounters WHERE id=?').get(encounter.id).diagnosis, '本次检查结果');
  });
  await t.test('UC-05 价目有负责人确认及有效期，收费人员维护', async () => {
    const input = { serviceId: 1, unitPrice: 110, effectiveFrom: '2045-01-01T00:00:00Z', confirmedBy: owner.user.id, confirmedAt: now, confirmationNote: '负责人确认未来价目' };
    assert.equal((await call('/api/price-versions', front, 'POST', input)).status, 403);
    assert.equal((await call('/api/price-versions', cash, 'POST', input)).status, 409);
    const old = rules.listPriceVersions(db, 1)[0]; ok(await call('/api/price-versions', cash, 'POST', { ...input, replacesVersionId: old.id, expectedVersion: old.version }), 201);
    assert.equal(rules.priceAt(db, 1, now).unit_price, 100); assert.equal(rules.priceAt(db, 1, '2045-01-01T00:00:00Z').unit_price, 110);
  });
  await t.test('UC-06 按实际完成项目查询费用，保留价目版本和单位', async () => {
    invoice = ok(await call('/api/invoices', cash, 'POST', { encounterId: encounter.id }), 201).invoice;
    assert.equal(invoice.gross_amount, 100); assert.equal(invoice.lines.length, 1); assert.equal(invoice.lines[0].quantity, 1); assert.ok(invoice.lines[0].unit);
    assert.equal((await call(`/api/invoices/${invoice.id}`, front)).status, 403);
  });
  await t.test('UC-07 足额现金、找零、禁止部分结算、原收据重试', async () => {
    const input = { expectedVersion: invoice.version, amount: 120, method: 'cash' };
    assert.equal((await call(`/api/invoices/${invoice.id}/payments`, cash, 'POST', { ...input, amount: 50 })).status, 400);
    const first = ok(await call(`/api/invoices/${invoice.id}/payments`, cash, 'POST', input), 201);
    assert.equal(first.receipt.changeAmount, 20); assert.equal(first.invoice.balance, 0);
    const retry = ok(await call(`/api/invoices/${invoice.id}/payments`, cash, 'POST', input), 200); assert.equal(retry.receipt.receiptNo, first.receipt.receiptNo);
  });
  await t.test('UC-12 牙医提出来源明确的随访，重复发送仅一项待办', async () => {
    const input = { requestId: key(), type: 'followup', patientId: patient.id, encounterId: encounter.id, reason: '检查后了解恢复情况', dueDate: today, assignedTo: front.user.id };
    followup = ok(await call('/api/followups', doc, 'POST', input), 201).followup;
    const retry = ok(await call('/api/followups', doc, 'POST', input), 201); assert.equal(retry.followup.id, followup.id); assert.equal(retry.followup.history.length, 1);
    assert.equal((await call('/api/followups', doc, 'POST', { ...input, reason: '更换提交内容' })).status, 409);
  });
  await t.test('UC-13 前台追加联系历史，重复不追加、旧版本不覆盖', async () => {
    const input = { requestId: key(), expectedVersion: followup.version, contactedAt:now,status: 'pending', result: '第一次未接通', nextContactDate: today };
    followup = ok(await call(`/api/followups/${followup.id}`, front, 'PATCH', input), 200).followup;
    const retry = ok(await call(`/api/followups/${followup.id}`, front, 'PATCH', input), 200).followup; assert.equal(retry.history.length, 2);
    assert.equal((await call(`/api/followups/${followup.id}`, front, 'PATCH', { ...input, requestId: key() })).status, 409);
    followup = ok(await call(`/api/followups/${followup.id}`, front, 'PATCH', { requestId: key(), expectedVersion: followup.version, contactedAt:now,status: 'contacted', result: '患者已反馈恢复正常' }), 200).followup;
  });
  await t.test('UC-14 牙医记录恢复、结论和后续意见，纯随访不虚构就诊', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM encounters').get().n;
    assessmentBody = { requestId: key(), expectedVersion: followup.version, status: 'completed', result: '已完成诊后评估', recovery: '患者反馈无不适', conclusion: '本次随访结束', opinion: '继续口腔维护，异常时联系诊所' };
    assert.equal((await call(`/api/followups/${followup.id}`, front, 'PATCH', assessmentBody)).status, 403);
    followup = ok(await call(`/api/followups/${followup.id}`, doc, 'PATCH', assessmentBody), 200).followup;
    const retry = ok(await call(`/api/followups/${followup.id}`, doc, 'PATCH', assessmentBody), 200); assert.equal(retry.followup.replayed, true); assert.equal(retry.followup.history.length, followup.history.length);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM encounters').get().n, before);
  });
  await t.test('UC-17 助理及负责人查询材料单位、余额、原始流水', async () => {
    const data = ok(await call('/api/materials', assist), 200); material = data.items[0]; assert.ok(material.unit); assert.ok(data.movements.length);
    const empty=ok(await call('/api/materials?from=1990-01-01&to=1990-01-02',assist),200);assert.equal(empty.movements.length,0);assert.equal(empty.items[0].stock_quantity,material.stock_quantity);
    ok(await call('/api/materials', owner), 200); assert.equal((await call('/api/materials', front)).status, 403);
  });
  await t.test('UC-18 材料领用原子记账，重复不扣两次，过期不覆盖', async () => {
    movementBody = { requestId: key(), expectedVersion: material.version, type: 'issue', quantity: 1, reason: '当次诊疗准备领用' };
    const first = ok(await call(`/api/materials/${material.id}/movements`, assist, 'POST', movementBody), 201);
    const retry = ok(await call(`/api/materials/${material.id}/movements`, assist, 'POST', movementBody), 201); assert.equal(retry.movement.id, first.movement.id); assert.equal(retry.material.stock_quantity, material.stock_quantity - 1);
    assert.equal((await call(`/api/materials/${material.id}/movements`, assist, 'POST', { ...movementBody, requestId: key() })).status, 409);
    material = first.material;
  });
  await t.test('UC-19 按实际业务日期统计，现金净收非交入现金，明细可追溯', async () => {
    db.prepare("UPDATE invoices SET created_at='2000-01-01' WHERE id=?").run(invoice.id);
    const report = ok(await call(`/api/reports/summary?from=${today}&to=${today}`, cash), 200);
    assert.equal(report.money.net, 100); assert.equal(report.money.gross, 0); assert.ok(report.details.receipts.some(c => c.due_amount === 100 && c.tendered_amount === 120));
    assert.equal(report.treatments[0].quantity, 1); assert.ok(report.details.treatments.some(t => t.encounter_no === encounter.encounter_no));
    assert.ok(!JSON.stringify(report).includes('本次检查结果')); assert.equal((await call('/api/reports/summary', front)).status, 403);
  });
  await t.test('UC-20 原收款依据校验、差异负责人确认、重复原核对', async () => {
    const summary = ok(await call(`/api/reconciliations?date=${today}`, cash), 200).summary;
    assert.equal(summary.expectedCash, 100); assert.equal(summary.basis.receipts[0].change_amount, 20);
    reconciliationBody = { requestId: key(), basisHash: summary.basisHash, date: today, countedCash: 90, differenceReason: '复点现金发现少10元', resolutionNote: '负责人要求保留原收据并复核交接', confirmedBy: owner.user.id, confirmedAt: now, confirmationNote: '负责人已确认差异及处理安排' };
    assert.equal((await call('/api/reconciliations', cash, 'POST', { ...reconciliationBody, basisHash: 'old-basis' })).status, 409);
    assert.equal((await call('/api/reconciliations', cash, 'POST', { ...reconciliationBody, confirmedBy: front.user.id })).status, 400);
    const first = ok(await call('/api/reconciliations', cash, 'POST', reconciliationBody), 201);
    const retry = ok(await call('/api/reconciliations', cash, 'POST', reconciliationBody), 201); assert.equal(retry.record.id, first.record.id); assert.equal(first.record.difference, -10);
    assert.equal(JSON.parse(first.record.basis_json).receipts[0].receipt_no, summary.basis.receipts[0].receipt_no);
    assert.throws(() => db.prepare('UPDATE daily_reconciliations SET difference=0 WHERE id=?').run(first.record.id), /不能覆盖/);
    assert.equal(rules.invoiceDetail(db, invoice.id).receipt.dueAmount, 100);
  });

  await t.test('失败恢复：患者审计失败同时回滚正文、原值历史及提交凭据', async () => {
    const old = db.prepare('SELECT * FROM patients WHERE id=?').get(patient.id);
    const count = db.prepare('SELECT COUNT(*) n FROM patient_changes').get().n;
    db.exec("CREATE TRIGGER reject_patient_audit BEFORE INSERT ON audit_events WHEN NEW.action='patient.update' BEGIN SELECT RAISE(ABORT,'模拟资料审计失败'); END");
    const input = { requestId: key(), fullName: old.full_name, phone: '13800007102', reason: '变更联系电话', expectedVersion: old.version };
    assert.throws(() => w.savePatient(db, patient.id, input, front.user), /模拟资料审计失败/);
    assert.equal(db.prepare('SELECT version FROM patients WHERE id=?').get(patient.id).version, old.version);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM patient_changes').get().n, count);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mutation_requests WHERE request_id=?').get(input.requestId).n, 0);
    db.exec('DROP TRIGGER reject_patient_audit');
    assert.equal(w.savePatient(db, patient.id, input, front.user).patient.phone, input.phone);
  });
  await t.test('失败恢复：盘点必须确认意见和非未来时间，零库存有效', async () => {
    const input = { requestId: key(), expectedVersion: material.version, type: 'adjustment', countedQuantity: 0, reason: '确认已用完', confirmedBy: owner.user.id, confirmedAt: now, confirmationNote: '负责人核实实盘为零' };
    assert.equal((await call(`/api/materials/${material.id}/movements`, assist, 'POST', { ...input, confirmationNote: '' })).status, 400);
    assert.equal((await call(`/api/materials/${material.id}/movements`, assist, 'POST', { ...input, confirmedAt: '2099-01-01T00:00:00Z' })).status, 400);
    const result = ok(await call(`/api/materials/${material.id}/movements`, assist, 'POST', input), 201); assert.equal(result.material.stock_quantity, 0);
    assert.throws(() => db.prepare('DELETE FROM material_movements WHERE id=?').run(result.movement.id), /不能删除/);
  });
  await t.test('失败恢复：材料审计失败不扣库、不留流水、不占用提交编号', () => {
    const current = db.prepare('SELECT * FROM materials WHERE id=?').get(material.id);
    const count = db.prepare('SELECT COUNT(*) n FROM material_movements').get().n;
    const input = { requestId: key(), expectedVersion: current.version, type: 'inbound', quantity: 2, reason: '核对入库实物' };
    db.exec("CREATE TRIGGER reject_movement_audit BEFORE INSERT ON audit_events WHEN NEW.action='material.movement' BEGIN SELECT RAISE(ABORT,'模拟流水审计失败'); END");
    assert.throws(() => materialRules.recordMaterialMovement(db,material.id,input,assist.user), /模拟流水审计失败/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM material_movements').get().n,count);
    assert.equal(db.prepare('SELECT version FROM materials WHERE id=?').get(material.id).version,current.version);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mutation_requests WHERE request_id=?').get(input.requestId).n,0);
    db.exec('DROP TRIGGER reject_movement_audit');
    assert.equal(materialRules.recordMaterialMovement(db,material.id,input,assist.user).material.stock_quantity,2);
  });
  await t.test('失败恢复：新收款使核对依据失效，即使现金数值未变也拒绝旧依据', async () => {
    const summary = rules.dailySummary(db,today);
    // A zero-value valid settlement still changes the set of original receipts.
    const zero = Number(db.prepare("INSERT INTO invoices(invoice_no,patient_id,encounter_id,gross_amount,balance,status,created_by) VALUES('I-ZERO',?,NULL,0,0,'paid',?)").run(patient.id,cash.user.id).lastInsertRowid);
    db.prepare("INSERT INTO cash_receipts(invoice_id,receipt_no,due_amount,tendered_amount,change_amount,received_by,paid_at) VALUES(?,'R-ZERO',0,0,0,?,?)").run(zero,cash.user.id,new Date().toISOString());
    assert.equal(rules.dailySummary(db,today).expectedCash,summary.expectedCash);
    assert.equal((await call('/api/reconciliations',cash,'POST',{requestId:key(),date:today,countedCash:summary.expectedCash,basisHash:summary.basisHash})).status,409);
  });
  await t.test('失败恢复：终结的随访不能用新提交改写，已取消预约不能关联复诊', async () => {
    assert.equal((await call(`/api/followups/${followup.id}`,doc,'PATCH',{...assessmentBody,requestId:key(),expectedVersion:followup.version})).status,409);
    const input={requestId:key(),type:'revisit',patientId:patient.id,encounterId:encounter.id,reason:'复查本次情况',dueDate:today,assignedTo:front.user.id};
    const f=ok(await call('/api/followups',doc,'POST',input),201).followup;
    const a=ok(await call('/api/appointments',front,'POST',appointmentBody()),201).appointment;
    ok(await call(`/api/appointments/${a.id}/status`,front,'POST',{status:'cancelled',reason:'患者取消本次时段',expectedVersion:a.version}),200);
    assert.equal((await call(`/api/followups/${f.id}`,front,'PATCH',{requestId:key(),expectedVersion:f.version,contactedAt:now,status:'scheduled',result:'不能关联已取消预约',appointmentId:a.id})).status,409);
    assert.equal((await call(`/api/followups/${f.id}`,doc,'PATCH',{...assessmentBody,requestId:key(),expectedVersion:f.version})).status,409);
  });
  await t.test('失败恢复：签署旧版本被拒绝，其他患者附件不能通过文件接口读取', async () => {
    const id=Number(db.prepare("INSERT INTO encounters(encounter_no,patient_id,dentist_id,chief_complaint,diagnosis,instructions,version) VALUES('E-STALE',1,?,'检查','所见','医嘱',2)").run(doc.user.id).lastInsertRowid);
    assert.equal((await call(`/api/encounters/${id}/sign`,doc,'POST',{expectedVersion:1})).status,409);
    assert.equal((await call(`/api/encounters/${id}/sign`,doc,'POST',{expectedVersion:2})).status,400);
    const file=Number(db.prepare("INSERT INTO clinical_attachments(patient_id,encounter_id,category,original_name,mime_type,file_size,file_data,uploaded_by) VALUES(1,?,'report','test.pdf','application/pdf',1,X'01',?)").run(id,doc.user.id).lastInsertRowid);
    const res=await fetch(`${base}/api/attachments/${file}/file`,{headers:{Cookie:owner.cookie}}); assert.equal(res.status,403);
  });
});
