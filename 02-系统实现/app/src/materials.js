function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function hasRole(user, role) {
  return String(user?.roles || '').split(',').includes(role);
}

function materialActor(db, user) {
  const actor = db.prepare('SELECT id,roles,active FROM users WHERE id=?').get(Number(user?.id) || 0);
  if (!actor?.active || (!hasRole(actor, 'assistant') && !hasRole(actor, 'manager'))) {
    fail(403, '只有诊疗助理或负责人可以办理材料业务');
  }
  return actor;
}

function numericInput(value, label, allowZero = false) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) {
    fail(400, `${label}必须填写有效数量`);
  }
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || (allowZero ? quantity < 0 : quantity <= 0)) {
    fail(400, `${label}必须为${allowZero ? '大于等于0' : '大于0'}的有限数值`);
  }
  return quantity;
}

function textInput(value, label, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > limit) fail(400, `${label}不能为空且不能超过${limit}字`);
  return text;
}

function writeAudit(db, actorId, action, materialId, details) {
  db.prepare(`INSERT INTO audit_events(user_id,action,target_type,target_id,patient_id,details,result)
    VALUES(?,?,'material',?,NULL,?,'success')`)
    .run(actorId, action, String(materialId), JSON.stringify(details));
}

function initializeMaterials(db) {
  const existed = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='materials'").get());
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        unit TEXT NOT NULL,
        stock_quantity REAL NOT NULL DEFAULT 0
          CHECK(stock_quantity >= 0 AND stock_quantity <= 1.7976931348623157e308),
        active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS material_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        material_id INTEGER NOT NULL REFERENCES materials(id),
        type TEXT NOT NULL CHECK(type IN ('inbound','issue','adjustment')),
        quantity REAL NOT NULL CHECK(quantity BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308),
        before_quantity REAL NOT NULL CHECK(before_quantity >= 0 AND before_quantity <= 1.7976931348623157e308),
        after_quantity REAL NOT NULL CHECK(after_quantity >= 0 AND after_quantity <= 1.7976931348623157e308),
        reason TEXT,
        actor INTEGER NOT NULL REFERENCES users(id),
        confirmed_by INTEGER REFERENCES users(id),
        confirmed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK(type='adjustment' OR quantity > 0),
        CHECK(type!='adjustment' OR (length(trim(reason)) > 0 AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS idx_material_movements_material ON material_movements(material_id,id);
      CREATE TRIGGER IF NOT EXISTS material_movements_no_update BEFORE UPDATE ON material_movements
        BEGIN SELECT RAISE(ABORT,'原始材料流水不能覆盖，请另记调整流水'); END;
      CREATE TRIGGER IF NOT EXISTS material_movements_no_delete BEFORE DELETE ON material_movements
        BEGIN SELECT RAISE(ABORT,'原始材料流水不能删除'); END;
    `);
    if (!existed) {
      const actor = db.prepare("SELECT id FROM users WHERE active=1 AND (','||roles||',') LIKE '%,assistant,%' ORDER BY id LIMIT 1").get()
        || db.prepare("SELECT id FROM users WHERE active=1 AND (','||roles||',') LIKE '%,manager,%' ORDER BY id LIMIT 1").get();
      if (actor) {
        const addMaterial = db.prepare('INSERT INTO materials(code,name,unit,stock_quantity,created_by) VALUES(?,?,?,?,?)');
        const addMovement = db.prepare(`INSERT INTO material_movements(material_id,type,quantity,before_quantity,after_quantity,reason,actor)
          VALUES(?,?,?,?,?,?,?)`);
        const gloves = Number(addMaterial.run('MAT-001', '一次性检查手套（演示）', '盒', 18, actor.id).lastInsertRowid);
        const cotton = Number(addMaterial.run('MAT-002', '棉卷（演示）', '袋', 12, actor.id).lastInsertRowid);
        addMovement.run(gloves, 'inbound', 20, 0, 20, '虚构演示材料入库', actor.id);
        addMovement.run(gloves, 'issue', 2, 20, 18, '虚构演示诊疗准备领用', actor.id);
        addMovement.run(cotton, 'inbound', 12, 0, 12, '虚构演示材料入库', actor.id);
        writeAudit(db, actor.id, 'material.demo.seed', gloves, { materials: [gloves, cotton], fictional: true });
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function listMaterials(db, input={}) {
  const rules=require('./requirements'), materialId=input.materialId?Number(input.materialId):null;
  if(materialId!=null&&(!Number.isInteger(materialId)||materialId<=0))fail(400,'材料查询编号无效');
  const from=input.from?rules.day(input.from):null,to=input.to?rules.day(input.to):null;
  if((from&&!to)||(!from&&to))fail(400,'查询期间须填写开始和结束日期');
  if(from>to&&to)fail(400,'结束日期不能早于开始日期');
  const items=db.prepare('SELECT * FROM materials WHERE active=1 AND (? IS NULL OR id=?) ORDER BY code').all(materialId,materialId);
  const movements=db.prepare(`SELECT m.*,s.code material_code,s.name material_name,s.unit,u.display_name actor_name,c.display_name confirmed_name
    FROM material_movements m JOIN materials s ON s.id=m.material_id JOIN users u ON u.id=m.actor LEFT JOIN users c ON c.id=m.confirmed_by
    WHERE (? IS NULL OR m.material_id=?) AND (? IS NULL OR date(m.created_at,'localtime') BETWEEN ? AND ?) ORDER BY m.id DESC`).all(materialId,materialId,from,from,to);
  return {items,movements,period:{from,to}};
}

function createMaterial(db, input, user) {
  const actor = materialActor(db, user);
  const code = textInput(input?.code, '材料编号', 40).toUpperCase();
  const name = textInput(input?.name, '材料名称', 100);
  const unit = textInput(input?.unit, '计量单位', 20);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare('INSERT INTO materials(code,name,unit,created_by) VALUES(?,?,?,?)').run(code, name, unit, actor.id);
    const id = Number(result.lastInsertRowid);
    writeAudit(db, actor.id, 'material.create', id, { code, name, unit });
    const material = db.prepare('SELECT * FROM materials WHERE id=?').get(id);
    db.exec('COMMIT');
    return material;
  } catch (error) {
    db.exec('ROLLBACK');
    if (String(error.message).includes('UNIQUE')) fail(409, '材料编号已存在');
    throw error;
  }
}

function recordMaterialMovement(db, id, input, user) {
  const actor=materialActor(db,user), w=require('./workflows');
  if(!hasRole(actor,'assistant')) fail(403,'材料收发由诊疗助理办理，负责人查询及确认');
  const materialId=Number(id),type=input?.type;
  if(!Number.isInteger(materialId)||materialId<=0)fail(400,'材料编号无效');
  if(!['inbound','issue','adjustment'].includes(type))fail(400,'材料办理类型无效');
  const entered=numericInput(type==='adjustment'?input.countedQuantity:input.quantity,type==='adjustment'?'实盘数量':'办理数量',type==='adjustment');
  const reason=textInput(input.reason,type==='adjustment'?'差异原因':'收发依据及用途',5000);
  return w.submission(db,`material:${materialId}`,input,actor,()=>{
    const material=db.prepare('SELECT * FROM materials WHERE id=? AND active=1').get(materialId);
    if(!material)fail(404,'材料不存在或已停用');
    w.version(material,input);
    const before=Number(material.stock_quantity);
    let after=type==='inbound'?before+entered:type==='issue'?before-entered:entered;
    if(type==='issue'&&after<0)fail(409,'领用数量超过可用库存');
    const quantity=type==='adjustment'?after-before:entered;
    if(!Number.isFinite(after)||after<0||!Number.isFinite(quantity))fail(400,'库存数量超出有效范围');
    const proof=type==='adjustment'?w.fact(db,input):{by:null,at:null,note:null};
    const row=db.prepare('INSERT INTO material_movements(material_id,type,quantity,before_quantity,after_quantity,reason,actor,confirmed_by,confirmed_at,confirmation_note) VALUES(?,?,?,?,?,?,?,?,?,?)').run(materialId,type,quantity,before,after,reason,actor.id,proof.by,proof.at,proof.note);
    db.prepare('UPDATE materials SET stock_quantity=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(after,materialId);
    writeAudit(db,actor.id,'material.movement',materialId,{movementId:Number(row.lastInsertRowid),type,quantity,before,after,reason,confirmedBy:proof.by,confirmedAt:proof.at});
    return {material:db.prepare('SELECT * FROM materials WHERE id=?').get(materialId),movement:db.prepare('SELECT * FROM material_movements WHERE id=?').get(row.lastInsertRowid)};
  });
}
module.exports = { initializeMaterials, listMaterials, createMaterial, recordMaterialMovement };
