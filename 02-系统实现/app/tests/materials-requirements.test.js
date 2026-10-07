const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const { initializeMaterials, listMaterials, createMaterial, recordMaterialMovement: rawMovement } = require('../src/materials');

const {randomUUID}=require('node:crypto');
function recordMaterialMovement(db,id,input,user){return rawMovement(db,id,{requestId:randomUUID(),expectedVersion:db.prepare('SELECT version FROM materials WHERE id=?').get(id).version,reason:'测试收发依据',confirmationNote:'确认盘点调整',...input},user);}

function setup(t) {
  const db = createDatabase(':memory:');
  initializeMaterials(db);
  t.after(() => db.close());
  const findUser = name => db.prepare('SELECT * FROM users WHERE username=?').get(name);
  return { db, assistant: findUser('assistant'), manager: findUser('manager'), frontdesk: findUser('frontdesk') };
}

function newMaterial(db, user, code = 'TEST-001') {
  return createMaterial(db, { code, name: '测试诊疗材料', unit: '袋' }, user);
}

function state(db, id) {
  return {
    stock: db.prepare('SELECT stock_quantity FROM materials WHERE id=?').get(id).stock_quantity,
    movements: db.prepare('SELECT COUNT(*) count FROM material_movements WHERE material_id=?').get(id).count,
    audits: db.prepare("SELECT COUNT(*) count FROM audit_events WHERE target_type='material' AND target_id=?").get(String(id)).count,
  };
}

test('材料入库、领用和已确认盘点保持原始凭证及库存一致', t => {
  const { db, assistant, manager } = setup(t);
  const material = newMaterial(db, assistant);
  assert.equal(material.stock_quantity, 0);
  const inbound = recordMaterialMovement(db, material.id, { type: 'inbound', quantity: 10, reason: '核对入库数量' }, assistant);
  assert.equal(inbound.movement.before_quantity, 0);
  assert.equal(inbound.material.stock_quantity, 10);
  recordMaterialMovement(db, material.id, { type: 'issue', quantity: 3, reason: '当日诊疗准备' }, assistant);
  const confirmedAt = new Date().toISOString();
  const adjusted = recordMaterialMovement(db, material.id, {
    type: 'adjustment', countedQuantity: 6, reason: '清点时发现一袋破损，负责人已确认', confirmedBy: manager.id, confirmedAt,
  }, assistant);
  assert.equal(adjusted.material.stock_quantity, 6);
  assert.equal(adjusted.movement.before_quantity, 7);
  assert.equal(adjusted.movement.after_quantity, 6);
  assert.equal(adjusted.movement.quantity, -1);
  assert.equal(adjusted.movement.actor, assistant.id);
  assert.equal(adjusted.movement.confirmed_by, manager.id);
  assert.equal(adjusted.movement.confirmed_at, confirmedAt);
  const listed = listMaterials(db);
  assert.ok(listed.items.some(item => item.id === material.id));
  assert.equal(listed.movements.filter(item => item.material_id === material.id).length, 3);
  assert.equal(state(db, material.id).audits, 4);
});

test('超过库存的领用被拒绝且不产生扣库、流水或成功审计', t => {
  const { db, assistant } = setup(t);
  const material = newMaterial(db, assistant);
  recordMaterialMovement(db, material.id, { type: 'inbound', quantity: 2 }, assistant);
  const before = state(db, material.id);
  assert.throws(() => recordMaterialMovement(db, material.id, { type: 'issue', quantity: 3 }, assistant),
    error => error.status === 409 && /库存/.test(error.message));
  assert.deepEqual(state(db, material.id), before);
});

test('材料数量必须是有限有效数值，前台不能办理材料', t => {
  const { db, assistant, frontdesk } = setup(t);
  const material = newMaterial(db, assistant);
  const before = state(db, material.id);
  for (const quantity of [0, -1, NaN, Infinity, null, '', ' ', true, {}, []]) {
    assert.throws(() => recordMaterialMovement(db, material.id, { type: 'inbound', quantity }, assistant),
      error => error.status === 400);
  }
  assert.throws(() => createMaterial(db, { code: 'NO-ROLE', name: '材料', unit: '袋' }, frontdesk), error => error.status === 403);
  assert.throws(() => recordMaterialMovement(db, material.id, { type: 'inbound', quantity: 1 }, frontdesk), error => error.status === 403);
  assert.deepEqual(state(db, material.id), before);
});

test('盘点差异必须有实盘数量、原因、有效负责人及合法确认时间', t => {
  const { db, assistant, manager, frontdesk } = setup(t);
  const material = newMaterial(db, assistant);
  recordMaterialMovement(db, material.id, { type: 'inbound', quantity: 2 }, assistant);
  const valid = { type: 'adjustment', countedQuantity: 1, reason: '负责人确认盘点差异', confirmedBy: manager.id, confirmedAt: new Date().toISOString() };
  const before = state(db, material.id);
  for (const change of [
    { countedQuantity: null }, { countedQuantity: -1 }, { countedQuantity: Infinity }, { reason: '' },
    { confirmedBy: null }, { confirmedBy: frontdesk.id }, { confirmedAt: null }, { confirmedAt: '错误日期' },
    { confirmedAt: '2026-02-31T12:00:00.000Z' },
  ]) {
    assert.throws(() => recordMaterialMovement(db, material.id, { ...valid, ...change }, assistant), error => error.status === 400);
    assert.deepEqual(state(db, material.id), before);
  }
  const zero = recordMaterialMovement(db, material.id, { ...valid, countedQuantity: 0 }, assistant);
  assert.equal(zero.material.stock_quantity, 0, '实盘为零是有效盘点结果');
});

test('办理中审计保存失败时库存和原始流水一起回滚', t => {
  const { db, assistant } = setup(t);
  const material = newMaterial(db, assistant);
  const before = state(db, material.id);
  db.exec(`CREATE TRIGGER reject_material_audit BEFORE INSERT ON audit_events
    WHEN NEW.action='material.movement' BEGIN SELECT RAISE(ABORT,'模拟审计保存失败'); END`);
  assert.throws(() => recordMaterialMovement(db, material.id, { type: 'inbound', quantity: 5 }, assistant), /模拟审计保存失败/);
  assert.deepEqual(state(db, material.id), before);
});

test('重复初始化不会重复演示收发或清除现有材料记录', t => {
  const { db, assistant } = setup(t);
  const material = newMaterial(db, assistant);
  recordMaterialMovement(db, material.id, { type: 'inbound', quantity: 4 }, assistant);
  const before = listMaterials(db);
  initializeMaterials(db);
  initializeMaterials(db);
  assert.deepEqual(listMaterials(db), before);
  assert.equal(state(db, material.id).stock, 4);
  assert.equal(before.items.filter(item => item.code.startsWith('MAT-')).length, 2);
  assert.equal(before.movements.filter(item => item.material_code.startsWith('MAT-')).length, 3);
});

test('原始材料流水不能被覆盖或删除', t => {
  const { db, assistant } = setup(t);
  const material = newMaterial(db, assistant);
  const { movement } = recordMaterialMovement(db, material.id, { type: 'inbound', quantity: 3 }, assistant);
  assert.throws(() => db.prepare('UPDATE material_movements SET quantity=99 WHERE id=?').run(movement.id), /不能覆盖/);
  assert.throws(() => db.prepare('DELETE FROM material_movements WHERE id=?').run(movement.id), /不能删除/);
  assert.equal(state(db, material.id).stock, 3);
  assert.equal(state(db, material.id).movements, 1);
});
