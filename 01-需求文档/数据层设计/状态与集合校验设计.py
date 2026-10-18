"""D1状态来源与提交门禁的可执行设计样例；由隔离验证调用，不是应用服务。

SQLite没有业务提交时触发器。无独立封存字段的追加聚合，由工作单元保存
事务开始时的成员集合并在提交前检查；所有写入口必须使用同一工作单元。
"""
from pathlib import Path
import hashlib
import re

HERE=Path(__file__).resolve().parent
STATE_TABLES={
    'appointment':'appointment','visit':'visit','clinical':'clinical_record',
    'plan':'plan_version','followup':'followup_requirement','price':'service_price',
    'payment':'patient_payment','request':'fee_request','refund':'patient_refund',
    'supply_payment':'supplier_payment','batch':'material_batch','count':'stock_count',
    'process':'instrument_processing','packcycle':'instrument_pack_cycle',
    'purchase_item':'purchase_order_item','file':'document_version',
}

def state_contracts():
    contracts=[]
    for key,table in STATE_TABLES.items():
        path=HERE.parent/'diagrams'/('c04-'+key+'.puml')
        source=path.read_text(encoding='utf-8')
        states=dict((alias,name) for name,alias in re.findall(r'^state "([^"]+)" as (\w+)\s*$',source,re.M))
        initial=[];edges=[]
        for a,b,label in re.findall(r'^(\[\*\]|\w+)\s+-[^\n>]*>\s+(\w+)\s*:\s*(.*)$',source,re.M):
            if a=='[*]':initial.append({'state':states[b],'condition':label})
            else:edges.append({'from':states[a],'to':states[b],'condition':label})
        assert states and initial and edges,table
        contracts.append({'table':table,'field':'status','source':'../diagrams/'+path.name,
            'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'states':list(states.values()),'initial':initial,'transitions':edges})
    return contracts


class DesignGateError(ValueError):pass


class AggregateTransaction:
    """设计验证工作单元：BEGIN、变更、末校验、COMMIT；任何错误ROLLBACK。

    事务开始已存在的四类头记录，其成员集合固定；新头可以在本事务内补齐。
    草稿方案等可跨事务编辑，另由SQL按发布状态冻结，不使用这一规则。
    """
    collections=[
        ('health_version','health_item','health_version_id'),
        ('patient_decision','decision_plan_item','decision_id'),
        ('patient_decision','decision_file_version','decision_id'),
        ('fee_adjustment','fee_adjustment_item','fee_adjustment_id'),
        ('cash_reconciliation','reconciliation_item','cash_reconciliation_id'),
    ]
    def __init__(self,db):self.db=db
    def rows(self,table):
        cur=self.db.execute('SELECT * FROM "'+table+'"')
        names=[d[0] for d in cur.description]
        return {r[0]:dict(zip(names,r)) for r in cur.fetchall()}
    def members(self,child,fk):
        fields={'decision_plan_item':'plan_item_id','decision_file_version':'document_version_id'}
        key=fields.get(child,'id');out={}
        for parent,value in self.db.execute(f'SELECT "{fk}","{key}" FROM "{child}"'):
            out.setdefault(parent,set()).add(value)
        return out
    def __enter__(self):
        if self.db.in_transaction:raise DesignGateError('nested_transaction')
        self.db.execute('BEGIN IMMEDIATE')
        try:
            names={p for p,_,_ in self.collections}|{'fee_request','purchase_receipt_item','supplier_payment'}
            self.before={p:self.rows(p) for p in names}
            self.before_members={c:self.members(c,f) for _,c,f in self.collections}
            return self
        except BaseException:self.db.execute('ROLLBACK');raise
    def check(self):
        db=self.db
        for parent,child,fk in self.collections:
            current=self.members(child,fk)
            for id in self.before[parent]:
                if current.get(id,set())!=self.before_members[child].get(id,set()):
                    raise DesignGateError('sealed_collection:'+child)
        for id in self.rows('health_version').keys()-self.before['health_version'].keys():
            categories={r[0] for r in db.execute('SELECT category FROM health_item WHERE health_version_id=?',(id,))}
            if categories!={'病史','过敏','用药'}:raise DesignGateError('health_snapshot_incomplete')
        for id,head in self.rows('patient_decision').items():
            if id not in self.before['patient_decision'] and head['decision']=='同意':
                if not db.execute('SELECT 1 FROM decision_plan_item WHERE decision_id=?',(id,)).fetchone():
                    raise DesignGateError('consent_scope_empty')
        for id,head in self.rows('fee_adjustment').items():
            if id not in self.before['fee_adjustment']:
                rows=db.execute('SELECT amount_cents FROM fee_adjustment_item WHERE fee_adjustment_id=?',(id,)).fetchall()
                approved=db.execute('SELECT approved_adjustment_cents FROM fee_request WHERE id=?',(head['fee_request_id'],)).fetchone()[0]
                if not rows or sum(x[0] for x in rows)!=approved:raise DesignGateError('adjustment_sum_mismatch')
        for id,head in self.rows('fee_request').items():
            if head['status']=='已同意' and self.before['fee_request'].get(id)!=head and head['approved_adjustment_cents']!=0:
                if not db.execute('SELECT 1 FROM fee_adjustment WHERE fee_request_id=?',(id,)).fetchone():
                    raise DesignGateError('approved_adjustment_missing')
        for id,head in self.rows('cash_reconciliation').items():
            if id not in self.before['cash_reconciliation']:
                amounts=[r[0] for r in db.execute('SELECT included_cents FROM reconciliation_item WHERE cash_reconciliation_id=?',(id,))]
                expected=sum(amounts)+(head['opening_cash_cents'] or 0)+head['cash_transfer_cents']
                if expected!=head['expected_cents']:raise DesignGateError('reconciliation_sum_mismatch')
                if head['actual_cents']!=expected and not db.execute('SELECT 1 FROM issue_followup WHERE cash_reconciliation_id=?',(id,)).fetchone():
                    raise DesignGateError('reconciliation_followup_missing')
        for id,head in self.rows('purchase_receipt_item').items():
            if self.before['purchase_receipt_item'].get(id)!=head:
                arrived=db.execute("SELECT delta_scaled FROM inventory_movement WHERE purchase_receipt_item_id=? AND movement_type='验收入库'",(id,)).fetchall()
                if sum(x[0] for x in arrived)!=head['accepted_quantity_scaled']:raise DesignGateError('receipt_stock_unbalanced')
                if head['accepted_quantity_scaled']>0:
                    order=db.execute('SELECT unit_price_cents,conversion_numerator,conversion_denominator,quantity_scale FROM purchase_order_item WHERE id=?',(head['purchase_order_item_id'],)).fetchone()
                    price,num,den,scale=order
                    numerator=head['accepted_quantity_scaled']*den*price;denominator=(10**scale)*num
                    cents=(numerator*2+denominator)//(denominator*2)
                    if head['accepted_amount_cents']!=cents:raise DesignGateError('receipt_amount_mismatch')
        for id,head in self.rows('supplier_payment').items():
            if self.before['supplier_payment'].get(id)!=head:
                uses=db.execute('SELECT amount_cents,allocation_state FROM supplier_allocation WHERE supplier_payment_id=?',(id,)).fetchall()
                if head['status'] in ('待付款','待核实'):
                    if sum(a for a,s in uses if s=='待生效')!=head['requested_cents']:raise DesignGateError('supplier_reservation_unbalanced')
                elif head['status']=='已确认付款':
                    if any(s=='待生效' for _,s in uses) or sum(a for a,s in uses if s=='已生效')!=head['actual_cents']:raise DesignGateError('supplier_effective_unbalanced')
                elif any(s!='已取消' for _,s in uses):raise DesignGateError('supplier_failure_still_reserved')
        # Python整数精确运算后检查最终及中间结果；不依赖SQLite溢出后转REAL。
        for table,column,parent in [('fee_adjustment_item','amount_cents','fee_adjustment_id'),('reconciliation_item','included_cents','cash_reconciliation_id')]:
            totals={}
            for owner,value in db.execute(f'SELECT "{parent}","{column}" FROM "{table}" ORDER BY id'):
                totals[owner]=totals.get(owner,0)+value
                if abs(totals[owner])>9007199254740991:raise DesignGateError('safe_integer_total:'+table)
    def __exit__(self,kind,error,tb):
        try:
            if error is None:self.check();self.db.execute('COMMIT')
            else:self.db.execute('ROLLBACK')
        except BaseException:
            if self.db.in_transaction:self.db.execute('ROLLBACK')
            raise
        return False
