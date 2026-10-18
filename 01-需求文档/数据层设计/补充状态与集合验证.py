"""真实85表上的状态与聚合提交场景，由主验证器调用。"""
from 状态与集合校验设计 import AggregateTransaction,DesignGateError

NOW='2026-10-18T08:00:00Z'
LATER='2026-10-18T09:00:00Z'
HASH='a'*64

def verify(db,row,update,good,bad,scalar,f,results):
    staff,p,v,bill,payment,req,ref,pv,pi,stock,ri,supfund,po,receipt,cycle,proc,follow,price,sp = [f[k] for k in (
        'staff','p','v','bill','payment','req','current_ref','pv','pi','stock','ri','supplier_fund','po','receipt','cycle','proc','follow','price','supplier_pay')]
    cases=[('appointment',f['a'],'已到诊','已预约'),('visit',f['v2'],'诊疗结束','候诊'),
        ('clinical_record',f['rec'],'草稿','已签署'),('plan_version',pv,'已确认','草稿'),
        ('followup_requirement',follow,'待联系','已完成'),('service_price',price,'价目草稿','已确认可适用'),
        ('patient_payment',payment,'待核实','到账已确认'),('fee_request',req,'待审核','已同意'),
        ('patient_refund',ref,'待办理','已确认退款'),('supplier_payment',sp,'待付款','已确认付款'),
        ('material_batch',f['batch'],'待检','可用'),('instrument_processing',proc,'处理中','已放行'),
        ('instrument_pack_cycle',cycle,'已使用','可用')]
    # 已预约->已到诊本来允许，改测终态回退：同一SAVEPOINT中先合法到诊再回退。
    bad('预约终态不能回到已预约',lambda:(update('appointment',f['a'],status='已到诊'),update('appointment',f['a'],status='已预约')),'state_transition')
    for t,id,target,_ in cases[1:]:bad('C状态方向拒绝：'+t,lambda t=t,id=id,target=target:update(t,id,status=target),'state_transition')
    count=row('stock_count',batch_stock_id=stock,snapshot_quantity_scaled=80,counted_quantity_scaled=80,reason='实点一致',stock_revision=scalar('SELECT revision FROM batch_stock WHERE id=?',stock),counted_at=NOW,operator_id=staff,status='待确认差异')
    update('stock_count',count,status='待重新核对')
    bad('盘点待重核不能跳过新快照直接批准',lambda:update('stock_count',count,status='差异已确认',confirmed_at=NOW,confirmed_by=staff,review_note='跳步'),'state_transition')
    good('盘点重核可重新提交后拒绝调整',lambda:(update('stock_count',count,status='待确认差异'),update('stock_count',count,status='不予调整',confirmed_at=NOW,confirmed_by=staff,review_note='保持原账')))
    good('采购项目一次全部合格可直接完成',lambda:update('purchase_order_item',f['poi'],status='履行已完成'))
    bad('采购完成不能复活为履行中',lambda:update('purchase_order_item',f['poi'],status='履行中'),'state_transition')
    doc=row('clinical_document',patient_id=p,visit_id=v,document_type='影像',source='院内采集',ownership_note='本次患者',created_by=staff)
    dv=row('document_version',clinical_document_id=doc,original_name='image.png',size_bytes=100,sha256=HASH,change_reason='首传',version_no=1,storage_key='clinical/test-image-1.png',media_type='image/png',uploaded_by=staff,status='原件待确认')
    bad('文件待确认不能直接标缺失',lambda:update('document_version',dv,status='缺失或不可读'),'state_transition')
    good('文件确认后缺失可按原摘要恢复',lambda:(update('document_version',dv,status='原件已确认',confirmed_at=NOW,confirmed_by=staff),update('document_version',dv,status='缺失或不可读',verification_note='核实缺失'),update('document_version',dv,status='原件已确认',verification_note='原摘要恢复')))
    # INSERT初态在真实表验证，其他字段取合法现有预约，只有状态违反模型。
    fields=[d[1] for d in db.execute('PRAGMA table_xinfo(appointment)') if d[1]!='id']
    source=dict(zip(fields,db.execute('SELECT '+','.join(fields)+' FROM appointment WHERE id=?',(f['a'],)).fetchone()))
    source['record_no']='illegal-arrived-initial';source['status']='已到诊'
    bad('新预约不能直接使用已到诊初态',lambda:db.execute('INSERT INTO appointment('+','.join(fields)+') VALUES ('+','.join('?' for _ in fields)+')',list(source.values())),'state_initial')
    bad('发布后方案不得后补项目',lambda:(update('plan_version',pv,status='待确认'),row('plan_item',plan_version_id=pv,item_description='后补项目',planned_quantity=1,sequence_no=9)),'plan_scope_frozen')
    bad('空方案不能发布待确认',lambda:(lambda id:update('plan_version',id,status='待确认'))(row('plan_version',treatment_plan_id=f['plan'],diagnostic_basis='复查',change_reason='新草稿',planned_schedule='分期',version_no=3,created_by=staff,status='草稿')),'plan_publish_empty')
    bad('放行后不能补进新的监测结果',lambda:row('processing_monitor',instrument_processing_id=proc,monitor_item='事后补入',result='通过',obtained_at=NOW,evidence='另记录',recorded_by=staff),'processing_scope_frozen')
    bad('放行后不能修改包装效期',lambda:update('instrument_pack_cycle',cycle,expires_at='2027-01-01T00:00:00Z'),'released_pack_identity_frozen')

    def rejected(name,action,message):
        watched=['health_version','health_item','patient_decision','decision_plan_item','decision_file_version','fee_request','fee_adjustment','fee_adjustment_item','cash_reconciliation','reconciliation_item','purchase_receipt_item','inventory_movement','batch_stock','supplier_payment','supplier_allocation']
        before={t:db.execute('SELECT * FROM '+t+' ORDER BY 1,2').fetchall() for t in watched}
        try:
            with AggregateTransaction(db):action()
        except DesignGateError as e:
            assert message in str(e),(name,message,str(e))
            assert not db.in_transaction
            assert before=={t:db.execute('SELECT * FROM '+t+' ORDER BY 1,2').fetchall() for t in watched},name
            results.append({'name':name,'result':'通过','rejected_by':str(e),'whole_transaction_rolled_back':True})
        else:raise AssertionError('提交门禁没有拒绝：'+name)
    def accepted(name,action):
        def run():
            with AggregateTransaction(db):action()
        good(name,run)
    def newhealth(categories):
        n=scalar('SELECT max(version_no) FROM health_version WHERE patient_id=?',p)+1
        id=row('health_version',patient_id=p,formed_at=NOW,change_reason='复核新版本',version_no=n,effective_at=NOW,created_by=staff,previous_version_id=f['h'])
        for c in categories:row('health_item',health_version_id=id,category=c,content='未取得信息，待核实',certainty='未知',reported_at=NOW,source='患者本次陈述')
        return id
    rejected('健康完整快照缺少用药类别时整笔回滚',lambda:newhealth(['病史','过敏']),'health_snapshot_incomplete')
    created={}
    accepted('健康快照允许三类明确未知并整体提交',lambda:created.update(health=newhealth(['病史','过敏','用药'])))
    rejected('未被复核引用的已提交健康版本也不能后补条目',lambda:row('health_item',health_version_id=created['health'],category='用药',content='后补变化',certainty='有',reported_at=NOW,source='后续取得'),'sealed_collection:health_item')
    def decision(scope=True):
        id=row('patient_decision',plan_version_id=pv,decision='同意',decided_at=NOW,explanation_basis='沟通记录',scope_note='本项目',explained_by=staff,recorded_by=staff)
        if scope:row('decision_plan_item',decision_id=id,plan_item_id=pi,linked_at=NOW,linked_by=staff)
        return id
    rejected('同意决定没有具体范围时主记录共同回滚',lambda:decision(False),'consent_scope_empty')
    accepted('同意与具体项目在同一事务形成',lambda:created.update(decision=decision()))
    pi2=row('plan_item',plan_version_id=pv,item_description='另一项目',planned_quantity=1,sequence_no=2)
    rejected('已提交同意不能悄悄扩大范围',lambda:row('decision_plan_item',decision_id=created['decision'],plan_item_id=pi2,linked_at=NOW,linked_by=staff),'sealed_collection:decision_plan_item')
    rejected('已提交同意不能后补另一份确认文件',lambda:row('decision_file_version',decision_id=created['decision'],document_version_id=dv,linked_at=NOW,linked_by=staff),'sealed_collection:decision_file_version')
    def approve(with_adjustment=True,amount=100):
        request=row('fee_request',patient_funds_id=f['fund'],bill_id=bill,reason='补正应收',proposed_adjustment_cents=100,proposed_refund_cents=0,evidence='原应收',submitted_at=NOW,submission_no=1,approved_adjustment_cents=100,approved_refund_cents=0,reviewed_at=NOW,created_by=staff,reviewed_by=staff,review_note='同意补正',status='已同意')
        if with_adjustment:
            adj=row('fee_adjustment',fee_request_id=request,bill_id=bill,reason='批准补正',effective_at=NOW,approved_by=staff)
            row('fee_adjustment_item',fee_adjustment_id=adj,bill_item_id=scalar('SELECT id FROM bill_item WHERE bill_id=?',bill),amount_cents=amount,note='原项目更正')
    rejected('批准应收调整却缺少调整记录时回滚审批',lambda:approve(False),'approved_adjustment_missing')
    rejected('调整明细99分不等于批准100分时整体回滚',lambda:approve(amount=99),'adjustment_sum_mismatch')
    accepted('批准100分与100分调整明细共同提交',approve)
    def reconcile(include=True,expected=10000,actual=10000):
        head=row('cash_reconciliation',business_date='2026-10-18',channel='现金',cutoff_at=LATER,actual_cents=actual,opening_cash_cents=0,cash_transfer_cents=0,reconciliation_basis='现金余额',source_digest=HASH,expected_cents=expected,operator_id=staff)
        if include:row('reconciliation_item',cash_reconciliation_id=head,patient_payment_id=payment,source_type='患者付款',included_cents=10000,source_at=NOW,source_revision=1)
        return head
    rejected('核对头10000分而无来源集合时整体回滚',lambda:reconcile(False),'reconciliation_sum_mismatch')
    rejected('核对存在差异却未指定跟进时整体回滚',lambda:reconcile(actual=9999),'reconciliation_followup_missing')
    accepted('核对头与原款集合一致可提交',lambda:created.update(recon=reconcile()))
    rejected('已提交核对快照不能后补供货支出',lambda:row('reconciliation_item',cash_reconciliation_id=created['recon'],supplier_payment_id=sp,source_type='供货付款',included_cents=-10000,source_at=NOW,source_revision=1),'sealed_collection:reconciliation_item')
    rejected('后改验收价款与精确换算结果不符时回滚',lambda:update('purchase_receipt_item',ri,accepted_amount_cents=9999),'receipt_amount_mismatch')
    def receiptitem():return row('purchase_receipt_item',purchase_receipt_id=receipt,purchase_order_item_id=f['poi'],material_batch_id=f['batch'],arrived_quantity_scaled=5,accepted_quantity_scaled=5,rejected_quantity_scaled=0,pending_quantity_scaled=0,accepted_amount_cents=500,inspection_note='追加到货场景',stock_location_id=f['loc'])
    rejected('合格验收已保存但未入库时整体回滚',receiptitem,'receipt_stock_unbalanced')
    def supplier_payment():return row('supplier_payment',supplier_funds_id=supfund,requested_cents=1000,channel='现金',initiated_at=NOW,authorization_basis='批准1000分测试单',authorized_by=staff,operator_id=staff,status='待付款')
    rejected('供货付款主记录缺少待生效用途时回滚',supplier_payment,'supplier_reservation_unbalanced')
    def reserve():
        id=supplier_payment();use=row('supplier_allocation',supplier_payment_id=id,purchase_order_id=po,amount_cents=1000,allocation_state='待生效',reason='预付占用',operator_id=staff)
        created.update(pay=id,allocation=use)
    accepted('拟付1000分与1000分待生效用途整体保存',reserve)
    def confirm():update('supplier_payment',created['pay'],status='已确认付款',actual_cents=1000,verified_at=NOW,verified_by=staff,transaction_evidence='当面付款')
    rejected('实际付款确认但用途未生效时整笔回滚',confirm,'supplier_effective_unbalanced')
    accepted('实际付款与全部用途确认在同一事务提交',lambda:(confirm(),update('supplier_allocation',created['allocation'],allocation_state='已生效',effective_at=NOW)))
    bad('已放行时间与责任证据不能覆盖',lambda:update('instrument_processing',proc,released_at=LATER),'release_evidence_frozen')
    good('放行后发现异常可隔离并保留原放行时间',lambda:(update('instrument_processing',proc,status='隔离停用',exception_reason='发现后续异常',isolated_by=staff),assert_value(scalar('SELECT released_at FROM instrument_processing WHERE id=?',proc),NOW)))

def assert_value(actual,expected):assert actual==expected,(actual,expected)
