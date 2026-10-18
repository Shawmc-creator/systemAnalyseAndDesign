"""只在临时目录验证D1设计；不接受运行数据库路径。
python 验证数据库设计.py [--report 输出JSON]
"""
from pathlib import Path
import argparse, hashlib, json, sqlite3, tempfile
from contextlib import ExitStack
from collections import deque
from 状态与集合校验设计 import state_contracts

HERE=Path(__file__).resolve().parent
Q=lambda s:'"'+s.replace('"','""')+'"'
NOW='2026-10-18T08:00:00Z'
LATER='2026-10-18T09:00:00Z'
HASH='a'*64

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--report',type=Path);args=ap.parse_args()
    model=json.loads((HERE/'新版完整逻辑结构.json').read_text(encoding='utf-8'))
    tables={t['table']:t for t in model['tables']}
    manifest=json.loads((HERE/'DDL实施边界.json').read_text(encoding='utf-8'))
    support=json.loads((HERE/'新版运行支撑设计.json').read_text(encoding='utf-8'))
    sql=(HERE/'SQLite-建表设计.sql').read_text(encoding='utf-8')
    assert hashlib.sha256(sql.encode()).hexdigest()==manifest['sql_sha256']
    results=[]
    with tempfile.TemporaryDirectory(prefix='dental-d1-design-') as temp, ExitStack() as cleanup:
        path=Path(temp)/'isolated.sqlite'
        def connect():
            c=sqlite3.connect(path,isolation_level=None,timeout=.05)
            cleanup.callback(c.close)
            c.execute('PRAGMA foreign_keys=ON');c.execute('PRAGMA recursive_triggers=ON');return c
        db=connect();db.executescript(sql);seq={}
        contracts={c['table']:c for c in state_contracts()}
        def eq(a,b):assert a==b,(a,b)
        def scalar(query,*params):return db.execute(query,params).fetchone()[0]
        def row(t,**v):
            seq[t]=seq.get(t,0)+1;names={f['name'] for f in tables[t]['fields']}
            for k,x in [('created_at',NOW),('updated_at',NOW),('revision',1),('record_no',t+'-'+str(seq[t]))]:
                if k in names:v.setdefault(k,x)
            route=[]
            # 构造既有场景也走C状态路径；有证据直接到账为模型允许的初态。
            if t in contracts:
                c=contracts[t];desired=v['status'];starts=[x['state'] for x in c['initial']]
                if desired not in starts:
                    pending=deque([[x] for x in starts]);seen=set()
                    while pending:
                        route=pending.popleft()
                        if route[-1]==desired:break
                        if route[-1] in seen:continue
                        seen.add(route[-1]);pending.extend(route+[e['to']] for e in c['transitions'] if e['from']==route[-1])
                    else:raise AssertionError((t,desired))
                    v['status']=route[0]
            id=db.execute('INSERT INTO '+Q(t)+' ('+','.join(map(Q,v))+') VALUES ('+','.join('?' for _ in v)+')',list(v.values())).lastrowid
            for state in route[1:]:update(t,id,status=state)
            return id
        def update(t,id,**v):return db.execute('UPDATE '+Q(t)+' SET '+','.join(Q(k)+'=?' for k in v)+' WHERE id=?',list(v.values())+[id])
        def good(name,fn):fn();results.append({'name':name,'result':'通过'})
        def bad(name,fn,message):
            db.execute('SAVEPOINT reject_case')
            try:fn()
            except sqlite3.IntegrityError as e:
                assert message in str(e),(name,message,str(e))
                results.append({'name':name,'result':'通过','rejected_by':str(e)})
            else:raise AssertionError('没有拒绝：'+name)
            finally:db.execute('ROLLBACK TO reject_case');db.execute('RELEASE reject_case')
        good('85表1048列281组外键与目标元数据一致',lambda:(
            eq({r[0] for r in db.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")},set(tables)),
            eq(sum(len(db.execute('PRAGMA table_xinfo('+Q(t)+')').fetchall()) for t in tables),1048),
            eq(sum(len({r[0] for r in db.execute('PRAGMA foreign_key_list('+Q(t)+')')}) for t in tables),281)))
        for t in tables:
            actual=db.execute('PRAGMA table_xinfo('+Q(t)+')').fetchall()
            expected=tables[t]['fields']
            eq([(f[1],f[2],bool(f[3]),bool(f[6])) for f in actual],[(f['name'],f['type'],not f['nullable'],bool(f.get('generated_expression'))) for f in expected])
            db.execute('EXPLAIN INSERT INTO '+Q(t)+' DEFAULT VALUES').fetchall()
            assignments=','.join(Q(f['name'])+'='+Q(f['name']) for f in tables[t]['fields'] if not f.get('generated_expression'))
            db.execute('EXPLAIN UPDATE '+Q(t)+' SET '+assignments+' WHERE 0').fetchall()
        results.append({'name':'85表INSERT及UPDATE全部准备成功，无无效字段和外键错配','result':'通过'})
        good('五岗位50权限与源矩阵一致',lambda:(eq(scalar('SELECT count(*) FROM access_role'),5),eq(scalar('SELECT count(*) FROM access_permission'),50),eq(
            set(db.execute('SELECT r.code,p.code FROM role_permission x JOIN access_role r ON r.id=x.role_id JOIN access_permission p ON p.id=x.permission_id')),
            {(role,p['code']) for p in support['permissions'] for role in p['roles']})))
        good('经营查询及临床追溯按查询权限初始化',lambda:eq(scalar("SELECT count(*) FROM access_permission WHERE code IN ('uc19.funds','uc19.management','uc31.clinical_trace') AND operation_kind='查询'"),3))
        staff=row('staff',name='周医生',employed_from='2026-01-01')
        staff2=row('staff',name='林医生',employed_from='2026-01-01')
        def patient(name='陈晨',**kw):return row('patient',name=name,phone='13800000000',phone_owner='本人',created_by=staff,**kw)
        p=patient();p2=patient('陈晨')
        good('患者同名同电话合法，稳定业务号不同',lambda:eq(scalar('SELECT count(*) FROM patient WHERE name=?','陈晨'),2))
        bad('没有联系方式且未说明原因',lambda:row('patient',name='未留电话',created_by=staff),'CHECK constraint')
        bad('非法日历日期',lambda:patient(birth_date='2026-02-30'),'CHECK constraint')
        bad('整数超过安全上界',lambda:update('patient',p,revision=9007199254740992),'CHECK constraint')
        bad('历史患者物理删除',lambda:db.execute('DELETE FROM patient WHERE id=?',(p2,)),'delete_forbidden')
        fund=row('patient_funds',patient_id=p,opened_at=NOW,opened_by=staff)
        fund2=row('patient_funds',patient_id=p2,opened_at=NOW,opened_by=staff)
        def visit(patient):return row('visit',patient_id=patient,dentist_id=staff,arrived_at=NOW,arrival_source='现场',registered_by=staff,status='候诊')
        v=visit(p);v2=visit(p2)
        a=row('appointment',patient_id=p,planned_start=NOW,planned_end=LATER,reason='复查',due_at=LATER,arrangement_revision=1,created_by=staff,status='已预约')
        bad('跨患者预约登记到诊',lambda:row('visit',patient_id=p2,appointment_id=a,dentist_id=staff,arrived_at=NOW,arrival_source='预约',registered_by=staff,status='候诊'),'FOREIGN KEY')
        chair=row('dental_chair',name='一号椅',available_from='2026-01-01T00:00:00Z',created_by=staff)
        chair2=row('dental_chair',name='二号椅',available_from='2026-01-01T00:00:00Z',created_by=staff)
        def schedule(d=staff,ch=chair,start=NOW,end=LATER):return row('dated_schedule',dentist_id=d,dental_chair_id=ch,business_date='2026-10-18',starts_at=start,ends_at=end,confirmed_at=NOW,confirmed_by=staff,created_by=staff,status='已确认')
        s=schedule();s2=schedule(staff2,chair2)
        bad('不同安排同牙医时段重叠',lambda:schedule(staff,chair2),'schedule_overlap')
        good('半开安排区间首尾相接',lambda:schedule(start=LATER,end='2026-10-18T10:00:00Z'))
        def occupy(sid=s,rev=1):return row('resource_occupancy',dated_schedule_id=sid,appointment_id=a,starts_at=NOW,ends_at=LATER,arrangement_revision=rev,created_by=staff)
        bad('过时安排版本占用',lambda:occupy(s2,2),'occupancy_schedule')
        occ=occupy()
        bad('患者跨牙医跨诊椅重复占用',lambda:occupy(s2),'occupancy_overlap')
        bad('有占用直接停诊',lambda:update('dated_schedule',s,status='已停诊',closure_reason='检修'),'schedule_has_active_occupancy')
        good('先释放旧占用再建立新占用',lambda:(update('resource_occupancy',occ,released_at=LATER,released_by=staff,release_reason='改约'),occupy(s2)))
        bad('已释放占用复活',lambda:update('resource_occupancy',occ,released_at=None,released_by=None,release_reason=None),'released_occupancy_frozen')
        def health(patient):return row('health_version',patient_id=patient,formed_at=NOW,change_reason='首次记录',version_no=1,effective_at=NOW,created_by=staff)
        h=health(p);h2=health(p2)
        bad('健康复核引用另一患者版本',lambda:row('health_review',visit_id=v,health_version_id=h2,reviewed_at=NOW,conclusion='核实',reviewed_by=staff),'health_patient')
        rec=row('clinical_record',visit_id=v,status='草稿')
        def sign():return update('clinical_record',rec,status='已签署',chief_complaint='牙齿疼痛',diagnosis='待进一步检查',treatment_advice='复查',signed_at=NOW,signed_by=staff,signed_revision=1,content_hash=HASH)
        bad('没有检查与健康复核不能签署',sign,'sign_missing_evidence')
        finding=row('clinical_finding',clinical_record_id=rec,finding_text='检查已完成',sequence_no=1,recorded_by=staff)
        row('health_review',visit_id=v,health_version_id=h,reviewed_at=NOW,conclusion='病史过敏已核对',reviewed_by=staff)
        good('资料完整后签署并结束就诊',lambda:(sign(),update('visit',v,status='接诊中',started_at=NOW),update('visit',v,status='诊疗结束',ended_at=LATER)))
        bad('签署正文不可覆盖',lambda:update('clinical_record',rec,diagnosis='替换'),'terminal_frozen')
        bad('签署所见不可覆盖',lambda:update('clinical_finding',finding,finding_text='替换'),'signed_findings')
        good('签后独立补充保留原文',lambda:row('record_addendum',clinical_record_id=rec,content='补充检查',reason='补充结果',added_at=LATER,content_hash=HASH,signed_by=staff))
        bad('诊疗文件不能挂另一患者就诊',lambda:row('clinical_document',patient_id=p,visit_id=v2,document_type='影像',source='院内',ownership_note='就诊资料',created_by=staff),'context_patient')
        plan=row('treatment_plan',patient_id=p,goal='改善口腔健康',established_at=NOW,created_by=staff,status='进行中')
        def version(n,**kw):return row('plan_version',treatment_plan_id=plan,diagnostic_basis='本次检查',change_reason='方案形成',planned_schedule='分期完成',version_no=n,created_by=staff,status='草稿',**kw)
        pv=version(1);pv2=version(2,previous_version_id=pv)
        def item(ver):return row('plan_item',plan_version_id=ver,item_description='检查处理',planned_quantity=1,sequence_no=1)
        pi=item(pv);pi2=item(pv2)
        decision=row('patient_decision',plan_version_id=pv,decision='同意',decided_at=NOW,explanation_basis='已沟通',scope_note='本项',explained_by=staff,recorded_by=staff)
        good('决定关联同版本项目',lambda:row('decision_plan_item',decision_id=decision,plan_item_id=pi,linked_at=NOW,linked_by=staff))
        bad('决定关联其他版本项目',lambda:row('decision_plan_item',decision_id=decision,plan_item_id=pi2,linked_at=NOW,linked_by=staff),'decision_wrong_version')
        svc=row('service',name='口腔检查',billing_unit='次',is_active=1,created_by=staff)
        def newprice():return row('service_price',service_id=svc,unit_price_cents=10000,valid_from='2026-01-01T00:00:00Z',change_reason='标准价',confirmed_at=NOW,created_by=staff,confirmed_by=staff,status='已确认可适用')
        price=newprice();bad('有效价目区间重叠',newprice,'price_overlap')
        execution=row('treatment_execution',visit_id=v,service_id=svc,completed_quantity=1,procedure_note='完成检查',completed_at=NOW,execution_kind='首次记录',performed_by=staff)
        def newbill(patient,account):return row('bill',patient_id=patient,patient_funds_id=account,formed_at=NOW,period_start=NOW,period_end=LATER,created_by=staff)
        bill=newbill(p,fund);bill2=newbill(p2,fund2)
        def billitem(b=bill):return row('bill_item',bill_id=b,treatment_execution_id=execution,service_price_id=price,quantity=1,unit_price_cents=10000,priced_at=NOW,pricing_note='标准价',pricing_status='已核价',priced_by=staff)
        bad('账目计入另一患者执行',lambda:billitem(bill2),'bill_execution_patient');billitem()
        execution2=row('treatment_execution',visit_id=v2,service_id=svc,completed_quantity=1,procedure_note='另一患者检查',completed_at=NOW,execution_kind='首次记录',performed_by=staff)
        row('bill_item',bill_id=bill2,treatment_execution_id=execution2,service_price_id=price,quantity=1,unit_price_cents=10000,priced_at=NOW,pricing_note='标准价',pricing_status='已核价',priced_by=staff)
        bad('已引用价目改写历史金额',lambda:update('service_price',price,unit_price_cents=1),'referenced_price_frozen')
        payment=row('patient_payment',patient_funds_id=fund,received_cents=12000,change_cents=2000,channel='现金',received_at=NOW,transaction_evidence='当面收款',verified_at=NOW,operator_id=staff,verified_by=staff,status='到账已确认')
        good('现金实收减找零自动生成净额',lambda:eq(scalar('SELECT net_cents FROM patient_payment WHERE id=?',payment),10000))
        def allocate(n=6000,b=bill,t='payment_allocation',**kw):return row(t,patient_payment_id=payment,bill_id=b,amount_cents=n,effective_at=NOW,reason='结算用途',operator_id=staff,**kw)
        allocation=allocate()
        bad('原款分配另一患者账目',lambda:allocate(100,bill2),'allocation_owner')
        bad('两用途入口共同限制余额',lambda:allocate(5000,t='prepayment_offset'),'payment_budget')
        req=row('fee_request',patient_funds_id=fund,bill_id=bill,patient_payment_id=payment,reason='退回未用预付',proposed_adjustment_cents=0,proposed_refund_cents=4000,evidence='原收款',submitted_at=NOW,submission_no=1,approved_adjustment_cents=0,approved_refund_cents=4000,reviewed_at=NOW,created_by=staff,reviewed_by=staff,review_note='同意',status='已同意')
        def refund(n=4000,**kw):return row('patient_refund',fee_request_id=req,patient_payment_id=payment,patient_funds_id=fund,requested_cents=n,initiated_at=NOW,channel='现金',recipient_verification='本人核实',operator_id=staff,status='待核实',**kw)
        ref=refund()
        bad('未知退款占用不能再分配',lambda:allocate(1,t='prepayment_offset'),'payment_budget')
        bad('同批准不能重复退款占用',lambda:refund(1),'refund_budget')
        bad('未知退款不能作为失败原单重办',lambda:refund(100,previous_attempt_id=ref),'refund_retry_not_failed')
        good('明确失败释放占用，新编号重办',lambda:(update('patient_refund',ref,status='已失败',verified_at=LATER,verified_by=staff,transaction_evidence='未交付现金',verification_note='核实未退'),refund(previous_attempt_id=ref)))
        bad('成功收款不能覆盖为失败',lambda:update('patient_payment',payment,status='未到账已核实'),'state_transition')
        bad('负向用途超过原额',lambda:allocate(-6001,original_allocation_id=allocation,fee_request_id=req),'release_budget')
        good('审批释放追加负向事实',lambda:(allocate(-1000,original_allocation_id=allocation,fee_request_id=req),eq(scalar('SELECT sum(amount_cents) FROM payment_allocation WHERE patient_payment_id=?',payment),5000)))
        bad('已生效用途不能原位改金额',lambda:update('payment_allocation',allocation,amount_cents=1),'immutable_fact')
        current_ref=scalar('SELECT max(id) FROM patient_refund')
        good('退款确认按实际额占用，多余拟退释放',lambda:update('patient_refund',current_ref,status='已确认退款',actual_cents=3000,verified_at=LATER,verified_by=staff,transaction_evidence='现金交付',verification_note='确认实际退回'))
        bad('已确认退款不能改回待核实',lambda:update('patient_refund',current_ref,status='待核实',actual_cents=None),'state_transition')
        material=row('material',name='检查耗材',specification='标准包装',base_unit='个',purchase_unit='包',conversion_numerator=10,conversion_denominator=1,quantity_scale=0,requires_trace=1,requires_expiry=1,confirmed_at=NOW,is_active=1,created_by=staff,confirmed_by=staff)
        batch=row('material_batch',material_id=material,batch_no='20261018-A',expiry_date='2027-10-18',source_note='原包装',created_by=staff,status='可用')
        loc=row('stock_location',name='合格材料柜',purpose='合格存放',is_active=1,created_by=staff)
        stock=row('batch_stock',material_batch_id=batch,stock_location_id=loc,quantity_scaled=0)
        bad('库存无流水带初始余额',lambda:row('batch_stock',material_batch_id=batch,stock_location_id=loc,quantity_scaled=10),'stock_starts_zero')
        sup=row('supplier',name='器材供应商',contact_name='供应联系人',phone='13900000000',settlement_basis='核实账户',is_active=1,created_by=staff,verified_by=staff)
        po=row('purchase_order',supplier_id=sup,agreed_at=NOW,delivery_terms='到店验收',request_reason='补库存',created_by=staff,status='待确认')
        bad('无明细采购不能确认',lambda:update('purchase_order',po,status='已确认',confirmed_at=NOW,confirmed_by=staff),'order_without_items')
        poi=row('purchase_order_item',purchase_order_id=po,material_id=material,ordered_quantity_scaled=100,unit_price_cents=1000,purchase_unit='包',conversion_numerator=10,conversion_denominator=1,quantity_scale=0,sequence_no=1,status='待交付')
        update('purchase_order',po,status='已确认',confirmed_at=NOW,confirmed_by=staff)
        receipt=row('purchase_receipt',purchase_order_id=po,arrived_at=NOW,delivery_evidence='随货单',accepted_at=NOW,operator_id=staff,confirmed_by=staff,status='部分待检')
        ri=row('purchase_receipt_item',purchase_receipt_id=receipt,purchase_order_item_id=poi,material_batch_id=batch,arrived_quantity_scaled=100,accepted_quantity_scaled=60,rejected_quantity_scaled=0,pending_quantity_scaled=40,accepted_amount_cents=6000,inspection_note='其余待检',stock_location_id=loc)
        def move(kind,delta,before,after,**kw):return row('inventory_movement',batch_stock_id=stock,movement_type=kind,delta_scaled=delta,before_scaled=before,after_scaled=after,reason='核实原单',occurred_at=NOW,operator_id=staff,**kw)
        good('合格60入库同步余额及版本',lambda:(move('验收入库',60,0,60,purchase_receipt_item_id=ri),eq(scalar('SELECT quantity_scaled FROM batch_stock WHERE id=?',stock),60),eq(scalar('SELECT revision FROM batch_stock WHERE id=?',stock),2)))
        bad('同一合格量重复入库',lambda:move('验收入库',60,60,120,purchase_receipt_item_id=ri),'receipt_stock_context')
        good('待检40转合格只追加40入库',lambda:(update('purchase_receipt_item',ri,accepted_quantity_scaled=100,pending_quantity_scaled=0,accepted_amount_cents=10000),move('验收入库',40,60,100,purchase_receipt_item_id=ri)))
        bad('旧库存快照覆盖新余额',lambda:move('领用',-20,60,40),'stock_stale')
        issue=move('领用',-30,100,70)
        def use(n):return row('material_usage',inventory_movement_id=issue,visit_id=v,quantity_scaled=n,used_at=NOW,note='实际使用',operator_id=staff)
        use(20)
        good('实际使用不重复扣库',lambda:eq(scalar('SELECT quantity_scaled FROM batch_stock WHERE id=?',stock),70))
        move('未用退回',10,70,80,original_movement_id=issue)
        bad('使用加退回超过领用',lambda:use(1),'usage_over_issue')
        bad('未用退回重复超量',lambda:move('未用退回',1,80,81,original_movement_id=issue),'return_over_issue')
        bad('应用直接再扣库存',lambda:update('batch_stock',stock,quantity_scaled=79),'stock_ledger_mismatch')
        bad('已有流水改材料精度',lambda:update('material',material,quantity_scale=1),'material_units_frozen')
        bad('入库后直接减少合格量',lambda:update('purchase_receipt_item',ri,accepted_quantity_scaled=90,rejected_quantity_scaled=10),'accepted_below_stocked')
        update('material_batch',batch,status='隔离')
        bad('隔离批次不能正常领用',lambda:move('领用',-1,80,79),'issue_batch_unavailable')
        update('material_batch',batch,status='可用')
        supplier_fund=row('supplier_funds',supplier_id=sup,opened_at=NOW,opened_by=staff)
        supplier_pay=row('supplier_payment',supplier_funds_id=supplier_fund,requested_cents=10000,channel='现金',initiated_at=NOW,authorization_basis='采购约定版本1金额10000分',authorized_by=staff,operator_id=staff,status='待付款')
        supplier_use=row('supplier_allocation',supplier_payment_id=supplier_pay,purchase_order_id=po,amount_cents=10000,allocation_state='待生效',reason='采购预付款',operator_id=staff)
        bad('供货未确认实付不能生效用途',lambda:update('supplier_allocation',supplier_use,allocation_state='已生效',effective_at=NOW),'supplier_payment_budget')
        good('供货确认实际付款后原预占用途生效',lambda:(update('supplier_payment',supplier_pay,status='已确认付款',actual_cents=10000,verified_at=NOW,verified_by=staff,transaction_evidence='现金交付'),update('supplier_allocation',supplier_use,allocation_state='已生效',effective_at=NOW)))
        def supplier_allocate(n,**kw):return row('supplier_allocation',supplier_payment_id=supplier_pay,amount_cents=n,allocation_state='已生效',effective_at=NOW,reason='预付转结算',operator_id=staff,**kw)
        bad('供货用途不能重复花费实付金额',lambda:supplier_allocate(1,purchase_receipt_id=receipt),'supplier_payment_budget')
        bad('供货释放不能超过原分配',lambda:supplier_allocate(-10001,purchase_order_id=po,original_allocation_id=supplier_use),'supplier_release')
        db.execute('BEGIN IMMEDIATE')
        supplier_allocate(-10000,purchase_order_id=po,original_allocation_id=supplier_use)
        supplier_allocate(10000,purchase_receipt_id=receipt)
        db.execute('COMMIT')
        good('采购预付转验收结算只变用途，不新增实际付款',lambda:(eq(scalar('SELECT count(*) FROM supplier_payment'),1),eq(scalar("SELECT sum(amount_cents) FROM supplier_allocation WHERE allocation_state='已生效'"),10000)))
        sup2=row('supplier',name='另一供应商',contact_name='另一联系人',phone='13900000001',settlement_basis='核实',is_active=1,created_by=staff,verified_by=staff)
        po2=row('purchase_order',supplier_id=sup2,agreed_at=NOW,delivery_terms='验收',request_reason='测试归属',created_by=staff,status='待确认')
        supplier_pay2=row('supplier_payment',supplier_funds_id=supplier_fund,requested_cents=1000,channel='现金',initiated_at=NOW,authorization_basis='测试归属',authorized_by=staff,operator_id=staff,status='待付款')
        bad('供货原款不能关联另一供应商采购',lambda:row('supplier_allocation',supplier_payment_id=supplier_pay2,purchase_order_id=po2,amount_cents=1000,allocation_state='待生效',reason='测试',operator_id=staff),'supplier_allocation_owner')
        follow=row('followup_requirement',patient_id=p,source_visit_id=v,purpose='复查恢复',followup_type='复诊',target_start='2026-10-20',target_end='2026-10-22',requires_assessment=1,created_by=staff,responsible_frontdesk_id=staff,status='待联系')
        update('followup_requirement',follow,status='待到诊或评估')
        def close():return update('followup_requirement',follow,status='已完成',closed_at=LATER,closed_by=staff,closure_basis='核实完成')
        bad('联系成功不能代替临床评估关闭',close,'assessment_required')
        row('clinical_assessment',followup_requirement_id=follow,visit_id=v,method='到诊检查',assessed_at=LATER,result='评估完成',advice='完成',assessed_by=staff)
        good('完成临床评估后关闭要求',close)
        equipment=row('processing_equipment',name='处理设备',available_from='2026-01-01T00:00:00Z',created_by=staff)
        pack=row('instrument_pack',name='检查器械包',composition_note='按清单核对',is_active=1,created_by=staff)
        proc=row('instrument_processing',processing_equipment_id=equipment,preparation_note='完成清洗',started_at=NOW,operator_id=staff,status='处理中')
        cycle=row('instrument_pack_cycle',instrument_processing_id=proc,instrument_pack_id=pack,packaging_check='包装完整',expires_at='2026-10-19T00:00:00Z',checked_by=staff,status='待放行')
        update('instrument_processing',proc,status='待核对放行',ended_at=NOW)
        def release():return update('instrument_processing',proc,status='已放行',ended_at=NOW,released_at=NOW,released_by=staff,release_basis='核对记录')
        bad('无监测结果不能放行',release,'release_missing_checks')
        row('processing_monitor',instrument_processing_id=proc,monitor_item='示例监测项目',result='通过',obtained_at=NOW,evidence='记录',recorded_by=staff)
        release();update('instrument_pack_cycle',cycle,status='可用')
        def issuepack():return row('instrument_use',visit_id=v,instrument_pack_cycle_id=cycle,issued_at=NOW,physical_check='核实包号效期',use_status='已发放',operator_id=staff)
        packuse=issuepack();bad('器械包次重复正常占用',issuepack,'UNIQUE constraint')
        good('未用退回后再次发放',lambda:(update('instrument_use',packuse,use_status='未用退回',returned_at=LATER),issuepack()))
        recon=row('cash_reconciliation',business_date='2026-10-18',channel='现金',cutoff_at=LATER,actual_cents=10000,opening_cash_cents=0,cash_transfer_cents=0,reconciliation_basis='现金余额',source_digest=HASH,expected_cents=10000,operator_id=staff)
        def recitem(n=10000):return row('reconciliation_item',cash_reconciliation_id=recon,patient_payment_id=payment,source_type='患者付款',included_cents=n,source_at=NOW,source_revision=1)
        bad('核对不能人工修改原款金额',lambda:recitem(9999),'reconcile_patient_payment');recitem()
        bad('同次核对重复选择原款',recitem,'UNIQUE constraint')
        account=row('user_account',staff_id=staff,login_name='dentist.test',password_hash='isolated-test-only-not-a-login-credential',status='启用',auth_version=1,password_changed_at=NOW,revision=1)
        role=scalar("SELECT id FROM access_role WHERE code='dentist'")
        def qualification():return row('staff_role_qualification',staff_id=staff,role_id=role,valid_from=NOW,verified_by=staff,verification_basis='隔离任职依据')
        q=qualification();bad('岗位资格区间重叠',qualification,'qualification_overlap')
        def grant():return row('account_role',account_id=account,role_id=role,qualification_id=q,granted_by=account,granted_at=NOW,grant_reason='隔离授权')
        grant();bad('账号岗位授权有效区间重叠',grant,'grant_overlap')
        permission=scalar("SELECT id FROM access_permission WHERE code='uc08.maintain'")
        def command(key):return row('request_submission',account_id=account,permission_id=permission,request_key=key,payload_digest=HASH,command_version=1,status='已提交',committed_at=NOW,result_kind='patient',result_key=str(p),result_revision=1,result_code='created',correlation_id=key)
        db.execute('BEGIN IMMEDIATE');command('rollback');patient('回滚对象');db.execute('ROLLBACK')
        good('业务事实和幂等结果共同回滚',lambda:(eq(scalar("SELECT count(*) FROM patient WHERE name='回滚对象'"),0),eq(scalar("SELECT count(*) FROM request_submission WHERE request_key='rollback'"),0)))
        command('same');bad('同账号同命令键重复提交',lambda:command('same'),'UNIQUE constraint')
        bad('处理中本地命令落库',lambda:row('request_submission',account_id=account,permission_id=permission,request_key='processing',payload_digest=HASH,command_version=1,status='处理中',correlation_id='processing'),'CHECK constraint')
        br=row('backup_run',run_no='backup-test',trigger_kind='每日计划',responsible_staff_id=staff,status='运行中',started_at=NOW)
        bad('无完整清单及异机副本不能备份成功',lambda:update('backup_run',br,status='成功',snapshot_at=NOW,finished_at=LATER,schema_version='20261018',application_version='test',manifest_key='backup/manifest.json',manifest_sha256=HASH),'backup_success_gate')
        from 补充状态与集合验证 import verify
        verify(db,row,update,good,bad,scalar,locals(),results)
        other=connect()
        try:
            db.execute('BEGIN IMMEDIATE');move('领用',-60,80,20)
            try:other.execute('BEGIN IMMEDIATE')
            except sqlite3.OperationalError as e:
                eq(e.sqlite_errorcode,sqlite3.SQLITE_BUSY)
                results.append({'name':'两独立连接写竞争，第二连接返回SQLITE_BUSY','result':'通过'})
            else:raise AssertionError('第二连接不应取得写锁')
            db.execute('COMMIT');other.execute('BEGIN IMMEDIATE')
            eq(other.execute('SELECT quantity_scaled FROM batch_stock WHERE id=?',(stock,)).fetchone()[0],20)
            try:other.execute('INSERT INTO inventory_movement(batch_stock_id,movement_type,delta_scaled,before_scaled,after_scaled,reason,occurred_at,operator_id,created_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?)',(stock,'领用',-60,80,20,'过时读值',NOW,staff,NOW,NOW,1))
            except sqlite3.IntegrityError as e:
                assert 'stock_stale' in str(e)
                results.append({'name':'竞争后重读余额20，旧80快照再次领用被拒绝','result':'通过'})
            else:raise AssertionError('过时快照未被拒绝')
            other.execute('ROLLBACK');eq(scalar('SELECT quantity_scaled FROM batch_stock WHERE id=?',stock),20)
            db.execute('BEGIN IMMEDIATE');allocate(1500,t='prepayment_offset')
            try:other.execute('BEGIN IMMEDIATE')
            except sqlite3.OperationalError as e:
                eq(e.sqlite_errorcode,sqlite3.SQLITE_BUSY)
                results.append({'name':'两连接同时使用同一原付款，第二连接等待写锁','result':'通过'})
            else:raise AssertionError('第二资金事务不应取得写锁')
            db.execute('COMMIT');other.execute('BEGIN IMMEDIATE')
            try:other.execute('INSERT INTO prepayment_offset(patient_payment_id,bill_id,amount_cents,effective_at,reason,operator_id,created_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?)',(payment,bill,1000,NOW,'第二笔竞争抵扣',staff,NOW,NOW,1))
            except sqlite3.IntegrityError as e:
                assert 'payment_budget' in str(e)
                results.append({'name':'首笔抵扣提交后剩余500分，竞争的1000分抵扣被拒绝','result':'通过'})
            else:raise AssertionError('原款被竞争重复消费')
            other.execute('ROLLBACK')
            good('并发拒绝后资金事实保持6500用途与3000实际退款',lambda:(eq(scalar('SELECT sum(amount_cents) FROM payment_allocation')+scalar('SELECT sum(amount_cents) FROM prepayment_offset'),6500),eq(scalar("SELECT sum(actual_cents) FROM patient_refund WHERE status='已确认退款'"),3000)))
        finally:
            if db.in_transaction:db.execute('ROLLBACK')
            if other.in_transaction:other.execute('ROLLBACK')
            other.close()
        good('有业务数据时外键为空及完整性ok',lambda:(eq(db.execute('PRAGMA foreign_key_check').fetchall(),[]),eq(scalar('PRAGMA integrity_check'),'ok')))
        plans=[]
        for name,query,params in [
            ('患者电话','SELECT id FROM patient WHERE phone=?',('13800000000',)),
            ('患者预约','SELECT id FROM appointment WHERE patient_id=? AND status=? AND planned_start>=?',(p,'已预约',NOW)),
            ('牙医日期安排','SELECT id FROM dated_schedule WHERE dentist_id=? AND status=? AND starts_at>=?',(staff,'已确认',NOW)),
            ('原付款用途','SELECT sum(amount_cents) FROM payment_allocation WHERE patient_payment_id=?',(payment,)),
            ('批次流水','SELECT id FROM inventory_movement WHERE batch_stock_id=?',(stock,)),
            ('供应商用途','SELECT amount_cents FROM supplier_allocation WHERE supplier_payment_id=?',(supplier_pay,)),
            ('文件版本','SELECT id FROM document_version WHERE clinical_document_id=? ORDER BY version_no',(1,)),
        ]:
            detail=[r[3] for r in db.execute('EXPLAIN QUERY PLAN '+query,params)]
            assert any('SEARCH ' in x and 'INDEX' in x for x in detail),(name,detail)
            plans.append({'name':name,'sql':query,'plan':detail,'result':'使用索引SEARCH'})
        fixture={t:scalar('SELECT count(*) FROM '+Q(t)) for t in tables};db.close()
    report={'version':'2026-10-18-D1-state-collections-tests','sqlite_version':sqlite3.sqlite_version,'sql_sha256':manifest['sql_sha256'],'passed':len(results),'failed':0,'cases':results,'fixture_rows':fixture,'query_plan_checks':plans,'state_source_sha256':{c['table']:c['source_sha256'] for c in contracts.values()},'scope':'真实85表上的指定正反例、16类代表性非法方向、聚合工作单元提交门禁及两个连接竞争；另有7类索引入口核对，不是容量性能测量；未穷举全部事件警戒条件或应用入口。','remaining':manifest['service_gates_pending']}
    if args.report:
        args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':len(results),'failed':0,'sqlite':sqlite3.sqlite_version,'fixture_tables':sum(v>0 for v in fixture.values())},ensure_ascii=False))

if __name__=='__main__':main()
