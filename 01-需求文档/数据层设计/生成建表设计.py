"""从已审阅的 D1 元数据生成空库设计；不访问运行库，不执行迁移。

运行：python 生成建表设计.py
新增业务规则必须同时更新需求文档、下方规则清单与隔离验证。
"""
from pathlib import Path
import hashlib
import json
import sqlite3
from 状态与集合校验设计 import state_contracts

HERE = Path(__file__).resolve().parent
MAX = 9007199254740991
Q = lambda x: '"' + x.replace('"', '""') + '"'
L = lambda x: "'" + x.replace("'", "''") + "'"


def generate():
    logical = json.loads((HERE/'新版完整逻辑结构.json').read_text(encoding='utf-8'))
    physical = json.loads((HERE/'新版物理约束与索引设计.json').read_text(encoding='utf-8'))
    support = json.loads((HERE/'新版运行支撑设计.json').read_text(encoding='utf-8'))
    assert hashlib.sha256((HERE/'新版完整逻辑结构.json').read_bytes()).hexdigest() == physical['source_sha256']
    tables = {t['table']: t for t in logical['tables']}
    enums = {}
    def enum(table, field, values):
        enums[table, field] = values.split('|')
    for t in tables:
        if any(f['name']=='channel' for f in tables[t]['fields']):
            enum(t,'channel','现金|银行卡|微信|支付宝')
    for t,f,values in [
        ('schedule_change','change_kind','调整|停诊'),('appointment_change','change_kind','改约|取消|通知'),
        ('visit','arrival_source','预约|现场'),('health_item','category','病史|过敏|用药'),
        ('health_item','certainty','有|无|未知'),('clinical_document','document_type','影像|同意文书|诊疗附件'),
        ('patient_decision','decision','同意|暂缓|拒绝|撤回'),('treatment_execution','execution_kind','首次记录|更正记录'),
        ('bill_item','pricing_status','待核价|已核价'),('followup_requirement','followup_type','复诊|随访'),
        ('contact_history','result','已联系|未联系上|拒绝|待跟进'),('clinical_assessment','method','到诊检查|远程沟通'),
        ('clinical_assessment','advice','完成|继续跟进|另行处置'),
        ('inventory_movement','movement_type','验收入库|领用|未用退回|盘点|退供'),
        ('purchase_issue','issue_kind','未交付|拒收|已入库退供|结算调整'),
        ('purchase_issue','resolution','补交|换货|退货|取消剩余|价款调整'),
        ('supplier_allocation','allocation_state','待生效|已生效|已取消'),
        ('processing_monitor','result','通过|未通过|未取得'),('instrument_use','use_status','已发放|已使用|未用退回|异常补录'),
        ('reconciliation_item','source_type','患者付款|患者退款|供货付款|供货退款'),
        ('issue_followup','status','待处理|处理中|已完成'),('user_account','status','启用|停用'),
        ('access_role','code','frontdesk|dentist|cashier|assistant|manager'),
        ('access_permission','operation_kind','查询|业务写入|运行管理'),
        ('authentication_event','event_type','成功|失败|注销|失效|限流'),
        ('request_submission','status','处理中|已提交'),('operation_audit','actor_kind','职员|计划任务|初始化'),
        ('operation_audit','event_type','变更|查询|拒绝|失败|运行事件'),('audit_change','value_type','text|integer|boolean'),
        ('backup_run','trigger_kind','每日计划|手工|升级前'),('backup_run','status','待执行|运行中|成功|失败'),
        ('backup_artifact','artifact_kind','database|attachment'),('backup_artifact','verification_status','待检|通过|缺失|不符'),
        ('backup_copy','location_kind','本地|异机'),('backup_copy','status','复制中|已验证|失败|已移除'),
        ('restore_verification','trigger_kind','每月|升级前|故障恢复'),('restore_verification','status','待执行|运行中|通过|失败'),
        ('restore_check','status','待检|通过|失败'),
    ]: enum(t,f,values)
    for f in ('old_status','new_status'):enum('batch_change',f,'待检|可用|隔离|停用|过期')

    extra = {}
    def ck(t, expression): extra.setdefault(t,[]).append(expression)
    def required(t, condition, *fields):
        ck(t, f'NOT ({condition}) OR ('+' AND '.join(Q(f)+' IS NOT NULL' for f in fields)+')')
    def pair(t,a,b):ck(t,f'({Q(a)} IS NULL) = ({Q(b)} IS NULL)')
    ck('patient', '(phone IS NOT NULL AND phone_owner IS NOT NULL) OR (phone IS NULL AND contact_unavailable_reason IS NOT NULL)')
    ck('staff','employed_until IS NULL OR employed_until >= employed_from')
    for t in ('patient_proxy','clinical_handover','service_price','staff_role_qualification'):
        ck(t,'valid_until IS NULL OR valid_until > valid_from')
    for t in ('dental_chair','processing_equipment'):ck(t,'available_until IS NULL OR available_until > available_from')
    required('dated_schedule',"status = '已确认'",'confirmed_at','confirmed_by')
    required('dated_schedule',"status = '已停诊'",'closure_reason')
    required('appointment',"status IN ('已取消','未到')",'status_reason')
    pair('appointment','notified_at','notified_by')
    pair('appointment_change','new_start','new_end')
    ck('appointment_change','new_end IS NULL OR new_end > new_start')
    ck('visit',"(arrival_source = '预约') = (appointment_id IS NOT NULL)")
    required('visit',"status IN ('接诊中','诊疗结束')",'started_at')
    required('visit',"status = '诊疗结束'",'ended_at')
    required('clinical_record',"status = '已签署'",'chief_complaint','diagnosis','treatment_advice','signed_at','signed_by','signed_revision','content_hash')
    for t in ('clinical_finding','plan_item','treatment_execution'):ck(t,'surface_code IS NULL OR tooth_code IS NOT NULL')
    required('document_version',"status = '原件已确认'",'confirmed_at','confirmed_by')
    pair('treatment_plan','closed_at','closed_by')
    required('treatment_plan',"status IN ('已完成','已终止')",'closed_at','closed_by')
    required('treatment_plan',"status = '已终止'",'termination_reason')
    pair('plan_version','explained_at','explained_by')
    required('plan_version',"status = '停止后续执行'",'stopped_at','stop_reason')
    ck('treatment_execution',"(execution_kind='首次记录' AND original_execution_id IS NULL) OR (execution_kind='更正记录' AND original_execution_id IS NOT NULL AND correction_reason IS NOT NULL)")
    required('service_price',"status = '已确认可适用'",'confirmed_at','confirmed_by')
    ck('bill','period_end > period_start')
    required('bill_item',"pricing_status='已核价'",'unit_price_cents','priced_by','pricing_note')
    ck('patient_payment',"channel='现金' OR change_cents=0")
    required('patient_payment',"status <> '待核实'",'verified_by','verified_at')
    required('patient_payment',"status = '到账已确认'",'received_at')
    required('patient_payment',"status = '到账已确认' AND channel <> '现金'",'external_reference')
    required('fee_request',"status IN ('已同意','已拒绝','已退回')",'reviewed_by','reviewed_at','review_note')
    required('fee_request',"status='已同意'",'approved_adjustment_cents','approved_refund_cents')
    ck('fee_request','approved_refund_cents IS NULL OR approved_refund_cents>=0')
    for t,field in [('supplier_refund','received_cents'),('plan_item','planned_quantity'),('treatment_execution','completed_quantity'),('bill_item','quantity'),('material_usage','quantity_scaled'),('document_version','size_bytes')]:
        ck(t,field+'>0')
    ck('bill_item',f'unit_price_cents IS NULL OR unit_price_cents<={MAX}/quantity')
    ck('reconciliation_item','included_cents<>0')
    for t,success in [('patient_refund','已确认退款'),('supplier_payment','已确认付款')]:
        required(t,f"status IN ('{success}','已失败')",'verified_by','verified_at','transaction_evidence')
        required(t,f"status='{success}'",'actual_cents')
        ck(t,f"status='{success}' OR actual_cents IS NULL")
        required(t,f"status='{success}' AND channel <> '现金'",'external_reference')
    required('patient_refund',"status IN ('已确认退款','已失败')",'verification_note')
    required('supplier_refund',"channel <> '现金'",'external_reference')
    required('followup_requirement',"status IN ('已完成','已撤销')",'closed_at','closed_by','closure_basis')
    required('followup_requirement',"status='已撤销'",'cancellation_reason')
    required('contact_history',"result IN ('未联系上','待跟进')",'next_contact_date')
    required('clinical_assessment',"advice='继续跟进'",'next_date','responsible_staff_id')
    pair('material','confirmed_at','confirmed_by')
    required('stock_count',"status IN ('差异已确认','不予调整')",'confirmed_at','confirmed_by','review_note')
    required('purchase_order',"status='已确认'",'confirmed_at','confirmed_by')
    required('purchase_receipt',"status='已确认'",'accepted_at','confirmed_by')
    required('purchase_issue',"status IN ('待处理','已完成')",'confirmed_at','confirmed_by')
    required('purchase_issue',"issue_kind='已入库退供'",'purchase_receipt_item_id')
    required('instrument_processing',"status='已放行'",'ended_at','released_at','released_by','release_basis')
    required('instrument_processing',"status='隔离停用'",'exception_reason','isolated_by')
    required('processing_monitor',"result <> '未取得'",'obtained_at','evidence')
    required('instrument_use',"use_status='异常补录'",'exception_note')
    ck('cash_reconciliation',"(channel='现金' AND opening_cash_cents IS NOT NULL AND opening_cash_cents>=0 AND actual_cents>=0) OR (channel<>'现金' AND opening_cash_cents IS NULL AND cash_transfer_cents=0)")
    required('cash_reconciliation','cash_transfer_cents<>0','cash_transfer_evidence')
    required('issue_followup',"status='已完成'",'completed_at','completed_by','result_basis')
    required('user_account',"status='停用'",'disabled_at','disabled_reason')
    ck('user_account',"length(login_name) BETWEEN 3 AND 64 AND login_name=lower(login_name) AND login_name NOT GLOB '*[^a-z0-9_.-]*'")
    for t in ('staff_role_qualification','account_role'):
        pair(t,'revoked_at','revoked_by');pair(t,'revoked_at','revocation_reason')
    ck('account_role','valid_until IS NULL OR valid_until > granted_at')
    ck('login_session','created_at <= last_seen_at AND last_seen_at < expires_at AND expires_at <= strftime(\'%Y-%m-%dT%H:%M:%SZ\',created_at,\'+8 hours\')')
    # 处理态留在服务内存；数据库仅在本地业务事务的末尾写入完成命令。
    ck('request_submission',"status='已提交'")
    required('request_submission',"status='已提交'",'committed_at','result_kind','result_key','result_revision','result_code')
    ck('request_submission','length(request_key)<=128')
    ck('operation_audit','json_valid(authority_snapshot)')
    for f in ('before_value','after_value'):
        ck('audit_change',f"{f} IS NULL OR CASE WHEN json_valid({f}) THEN json_type({f}) IN ('null','text','integer','true','false') ELSE 0 END")
    required('backup_run',"status IN ('成功','失败')",'finished_at')
    required('backup_run',"status='成功'",'started_at','snapshot_at','schema_version','application_version','manifest_key','manifest_sha256')
    required('backup_run',"status='失败'",'error_code')
    required('backup_copy',"status='已验证'",'verified_at')
    required('backup_copy',"status='已移除'",'removed_at','removal_reason')
    required('backup_copy',"status='失败'",'error_code')
    required('restore_verification',"status IN ('通过','失败')",'started_at','finished_at','result_note')
    required('restore_check',"status IN ('通过','失败')",'checked_at','actual_value')
    required('restore_check',"status='失败'",'failure_note')

    sql = ['-- D1 85表空库建表设计 / 2026-10-18',
           '-- 仅用于隔离设计验证；禁止在现有运行库执行；不是迁移脚本。',
           '-- SQLite >= 3.38（STRICT、内置JSON）；连接须开启foreign_keys、recursive_triggers。',
           '-- 时间、授权、集合完整性及外部凭据仍须服务事务门禁，见DDL实施边界.json。',
           'PRAGMA foreign_keys=ON;', 'PRAGMA recursive_triggers=ON;', 'PRAGMA busy_timeout=3000;', 'BEGIN IMMEDIATE;']
    check_count = 0
    keys_by_table = {}
    for t,r in zip(logical['tables'],physical['tables']):
        name=t['table'];assert name==r['table'];clauses=[]
        single=len(r['primary_key'])==1
        for f in t['fields']:
            n=f['name'];col=Q(n);s=col+' '+f['type']
            if single and f.get('primary_key'):s+=' PRIMARY KEY AUTOINCREMENT'
            if f.get('generated_expression'):s+=' GENERATED ALWAYS AS ('+f['generated_expression']+') STORED'
            if not f['nullable']:s+=' NOT NULL'
            if 'default' in f:s+=' DEFAULT '+(str(f['default']) if isinstance(f['default'],int) else L(f['default']))
            checks=[]
            if f['type']=='INTEGER':
                checks.append(f'{col} BETWEEN {-MAX} AND {MAX}')
                if f.get('primary_key') or f.get('foreign_key') or n in ('revision','auth_version','command_version','config_version') or '正整数' in f['description'] or '版本号' in f['description']:
                    checks.append(f'{col}>0')
                if '非负' in f['description']:checks.append(f'{col}>=0')
                if '0或1' in f['description']:checks.append(f'{col} IN (0,1)')
                if n=='quantity_scale':checks.append(f'{col} BETWEEN 0 AND 6')
            else:
                checks.append(f'length(trim({col}))>0')
                if n.endswith('_at') or n in ('planned_start','planned_end','valid_from','valid_until','available_from','available_until','period_start','period_end','old_start','old_end','new_start','new_end'):
                    checks.append(f"length({col})=20 AND {col} GLOB '????-??-??T??:??:??Z' AND strftime('%Y-%m-%dT%H:%M:%SZ',{col},'+0 seconds') IS {col}")
                elif n.endswith('_date') or n in ('employed_from','employed_until','target_start','target_end','next_date','old_business_date','new_business_date'):
                    checks.append(f"length({col})=10 AND date({col},'+0 days') IS {col}")
                if n in ('sha256','manifest_sha256','content_hash','payload_digest','token_hash','csrf_hash'):
                    checks.append(f"length({col})=64 AND {col} NOT GLOB '*[^0-9a-f]*'")
            values=f.get('enum') or enums.get((name,n))
            if values:checks.append(col+' IN ('+','.join(map(L,values))+')')
            for expr in checks:
                # SQLite CHECK allows NULL; explicit nullable alternative also handles IS-based date checks.
                s+=' CHECK ('+(f'{col} IS NULL OR ('+expr+')' if f['nullable'] else expr)+')';check_count+=1
            clauses.append(s)
        if not single:clauses.append('PRIMARY KEY ('+','.join(map(Q,r['primary_key']))+')')
        keys=[]
        for key in r['unique_keys']+physical['composite_parent_unique_keys'].get(name,[]):
            if key not in keys:keys.append(key);clauses.append('UNIQUE ('+','.join(map(Q,key))+')')
        keys_by_table[name]=[r['primary_key']]+keys
        for f in r['foreign_keys']:
            target,col=f['references'].split('.')
            clauses.append('FOREIGN KEY ('+Q(f['column'])+') REFERENCES '+Q(target)+'('+Q(col)+') ON DELETE RESTRICT ON UPDATE RESTRICT')
        for f in physical['composite_foreign_keys']:
            if f['table']==name:clauses.append('FOREIGN KEY ('+','.join(map(Q,f['columns']))+') REFERENCES '+Q(f['parent'])+'('+','.join(map(Q,f['parent_columns']))+') ON DELETE RESTRICT ON UPDATE RESTRICT')
        for expr in [c['predicate'] for c in physical['checks'] if c['table']==name]+extra.get(name,[]):
            clauses.append('CHECK ('+expr+')');check_count+=1
        sql.append('-- '+t['name']+'\nCREATE TABLE '+Q(name)+' (\n  '+',\n  '.join(clauses)+'\n) STRICT;')

    indexes=[]
    for ix in physical['partial_unique_indexes']+physical['query_indexes']:
        if ix.get('reuse_constraint_index'):continue
        unique=ix in physical['partial_unique_indexes']
        stmt='CREATE '+('UNIQUE ' if unique else '')+'INDEX '+Q(ix['name'])+' ON '+Q(ix['table'])+' ('+','.join(map(Q,ix['columns']))+')'
        if ix.get('where'):stmt+=' WHERE '+ix['where']
        else:keys_by_table[ix['table']].append(ix['columns'])
        sql.append(stmt+';');indexes.append({**ix,'kind':'partial_unique' if unique else 'query'})
    # 完整历史行外键入口：只复用无WHERE索引，较长复合子键优先。
    for r in physical['tables']:
        t=r['table'];children=[[f['column']] for f in r['foreign_keys']]
        children += [f['columns'] for f in physical['composite_foreign_keys'] if f['table']==t]
        for cols in sorted(children,key=lambda x:-len(x)):
            if any(k[:len(cols)]==cols for k in keys_by_table[t]):continue
            name='ix_fk_'+t+'_'+'_'.join(cols)
            sql.append('CREATE INDEX '+Q(name)+' ON '+Q(t)+' ('+','.join(map(Q,cols))+');')
            keys_by_table[t].append(cols);indexes.append({'name':name,'table':t,'columns':cols,'kind':'foreign_key'})

    triggers=[]
    def guard(t,key,bad,events=('INSERT','UPDATE'),rule='字段字典'):
        for event in events:
            name='tr_'+t+'_'+key+'_'+event.lower()
            sql.append(f'CREATE TRIGGER {Q(name)} BEFORE {event} ON {Q(t)} WHEN ({bad}) BEGIN SELECT RAISE(ABORT,{L(key)}); END;')
            triggers.append({'name':name,'table':t,'rule':rule,'error':key})
    def freeze(t,when='1',fields=None,key='immutable_fact',rule='历史保护'):
        diff='1' if fields is None else '('+' OR '.join('NEW.'+Q(f)+' IS NOT OLD.'+Q(f) for f in fields)+')'
        guard(t,key,'('+when+') AND '+diff,('UPDATE',),rule)
    # 不提供历史物理删除入口；有草稿取消/状态记录，未来归档另行设计。
    for t in tables:
        guard(t,'delete_forbidden','1',('DELETE',),'历史保护')
        if any(f['name']=='id' for f in tables[t]['fields']):freeze(t,fields=['id'],key='stable_id')
    immutable='patient_change schedule_change appointment_change health_version health_item health_review record_addendum patient_decision treatment_execution payment_allocation prepayment_offset fee_adjustment fee_adjustment_item inventory_movement material_usage supplier_refund contact_history clinical_assessment cash_reconciliation reconciliation_item decision_plan_item decision_file_version authentication_event operation_audit audit_change request_submission'.split()
    for t in immutable:freeze(t)
    # 可变聚合也不允许换所有者绕过已有子表的患者/账目归属。
    ownership={
        'appointment':['patient_id'],'visit':['patient_id','appointment_id'],
        'clinical_record':['visit_id'],'clinical_document':['patient_id','visit_id','plan_version_id'],
        'document_version':['clinical_document_id','version_no','storage_key','sha256','size_bytes','media_type','original_name','previous_version_id'],
        'treatment_plan':['patient_id'],'plan_version':['treatment_plan_id','source_visit_id','version_no','previous_version_id'],
        'plan_item':['plan_version_id'],'bill':['patient_id','patient_funds_id'],'patient_funds':['patient_id'],
        'patient_payment':['patient_funds_id'],'bill_item':['bill_id','treatment_execution_id'],
        'fee_request':['patient_funds_id','bill_id','patient_payment_id'],
        'patient_refund':['fee_request_id','patient_payment_id','patient_funds_id','requested_cents','previous_attempt_id'],
        'followup_requirement':['patient_id','source_visit_id','source_plan_version_id'],
        'material_batch':['material_id','batch_no'],'batch_stock':['material_batch_id','stock_location_id'],
        'purchase_order':['supplier_id'],'purchase_order_item':['purchase_order_id','material_id'],
        'purchase_receipt':['purchase_order_id'],'purchase_receipt_item':['purchase_receipt_id','purchase_order_item_id'],
        'supplier_funds':['supplier_id'],'supplier_payment':['supplier_funds_id','requested_cents','previous_attempt_id'],
        'supplier_allocation':['supplier_payment_id','purchase_order_id','purchase_receipt_id','original_allocation_id'],
        'user_account':['staff_id'],'account_role':['account_id','role_id','qualification_id','granted_at'],
        'staff_role_qualification':['staff_id','role_id','valid_from'],
        'instrument_pack_cycle':['instrument_processing_id','instrument_pack_id'],
        'instrument_use':['visit_id','instrument_pack_cycle_id','issued_at'],
    }
    for t,fields in ownership.items():freeze(t,fields=fields,key='immutable_ownership')
    for t,state,terminal in [('patient_payment','status',"'到账已确认','未到账已核实'"),('patient_refund','status',"'已确认退款','已失败'"),('supplier_payment','status',"'已确认付款','已失败'"),('supplier_allocation','allocation_state',"'已生效','已取消'"),('fee_request','status',"'已同意','已拒绝','已撤回'"),('clinical_record','status',"'已签署'")]:
        freeze(t,f'OLD.{state} IN ({terminal})',key='terminal_frozen')

    guard('dated_schedule','schedule_overlap',"NEW.status='已确认' AND EXISTS (SELECT 1 FROM dated_schedule x WHERE x.id<>NEW.id AND x.status='已确认' AND (x.dentist_id=NEW.dentist_id OR x.dental_chair_id=NEW.dental_chair_id) AND x.starts_at<NEW.ends_at AND NEW.starts_at<x.ends_at)",rule='R-01')
    guard('dated_schedule','schedule_has_active_occupancy',"EXISTS (SELECT 1 FROM resource_occupancy WHERE dated_schedule_id=OLD.id AND released_at IS NULL) AND (NEW.starts_at IS NOT OLD.starts_at OR NEW.ends_at IS NOT OLD.ends_at OR NEW.dentist_id IS NOT OLD.dentist_id OR NEW.dental_chair_id IS NOT OLD.dental_chair_id OR NEW.status <> '已确认')",('UPDATE',),'R-02')
    guard('resource_occupancy','occupancy_schedule',"NEW.released_at IS NULL AND NOT EXISTS (SELECT 1 FROM dated_schedule s WHERE s.id=NEW.dated_schedule_id AND s.status='已确认' AND s.revision=NEW.arrangement_revision AND s.starts_at<=NEW.starts_at AND NEW.ends_at<=s.ends_at)",rule='R-01')
    patient_new='COALESCE((SELECT patient_id FROM appointment WHERE id=NEW.appointment_id),(SELECT patient_id FROM visit WHERE id=NEW.visit_id))'
    guard('resource_occupancy','occupancy_overlap',f"NEW.released_at IS NULL AND EXISTS (SELECT 1 FROM resource_occupancy o JOIN dated_schedule s ON s.id=o.dated_schedule_id JOIN dated_schedule n ON n.id=NEW.dated_schedule_id WHERE o.id<>NEW.id AND o.released_at IS NULL AND o.starts_at<NEW.ends_at AND NEW.starts_at<o.ends_at AND (s.dentist_id=n.dentist_id OR s.dental_chair_id=n.dental_chair_id OR COALESCE((SELECT patient_id FROM appointment WHERE id=o.appointment_id),(SELECT patient_id FROM visit WHERE id=o.visit_id))={patient_new}))",rule='R-01')
    freeze('resource_occupancy',fields=['dated_schedule_id','appointment_id','starts_at','ends_at','arrangement_revision'],key='occupancy_move_requires_new')
    freeze('resource_occupancy','OLD.released_at IS NOT NULL',key='released_occupancy_frozen')
    for t,parent in [('health_version','patient_id'),('document_version','clinical_document_id'),('plan_version','treatment_plan_id')]:
        guard(t,'version_order',f'NEW.previous_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM {t} p WHERE p.id=NEW.previous_version_id AND p.{parent}=NEW.{parent} AND p.version_no<NEW.version_no AND p.id<>NEW.id)',rule='R-03/R-05/R-07')
    guard('health_review','health_patient',"(SELECT patient_id FROM visit WHERE id=NEW.visit_id) IS NOT (SELECT patient_id FROM health_version WHERE id=NEW.health_version_id)",rule='R-03')
    guard('clinical_record','sign_missing_evidence',"NEW.status='已签署' AND (NOT EXISTS (SELECT 1 FROM clinical_finding WHERE clinical_record_id=NEW.id) OR NOT EXISTS (SELECT 1 FROM health_review WHERE visit_id=NEW.visit_id))",rule='R-04')
    guard('clinical_finding','signed_findings_frozen',"EXISTS (SELECT 1 FROM clinical_record WHERE id=NEW.clinical_record_id AND status='已签署')",rule='R-04')
    guard('clinical_finding','signed_findings_move',"EXISTS (SELECT 1 FROM clinical_record WHERE id=OLD.clinical_record_id AND status='已签署')",('UPDATE',),'R-04')
    guard('record_addendum','addendum_unsigned',"NOT EXISTS (SELECT 1 FROM clinical_record WHERE id=NEW.clinical_record_id AND status='已签署')",rule='R-04')
    guard('visit','visit_end_unsigned',"NEW.status='诊疗结束' AND NOT EXISTS (SELECT 1 FROM clinical_record WHERE visit_id=NEW.id AND status='已签署')",rule='R-04')
    for t,v,pl in [('clinical_document','visit_id','plan_version_id'),('followup_requirement','source_visit_id','source_plan_version_id')]:
        guard(t,'context_patient',f'(NEW.{v} IS NOT NULL AND NEW.patient_id IS NOT (SELECT patient_id FROM visit WHERE id=NEW.{v})) OR (NEW.{pl} IS NOT NULL AND NEW.patient_id IS NOT (SELECT p.patient_id FROM plan_version v JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE v.id=NEW.{pl}))',rule='R-05/R-12')
    guard('plan_version','plan_source_patient',"NEW.source_visit_id IS NOT NULL AND (SELECT patient_id FROM visit WHERE id=NEW.source_visit_id) IS NOT (SELECT patient_id FROM treatment_plan WHERE id=NEW.treatment_plan_id)",rule='R-07')
    guard('decision_plan_item','decision_wrong_version',"(SELECT plan_version_id FROM patient_decision WHERE id=NEW.decision_id) IS NOT (SELECT plan_version_id FROM plan_item WHERE id=NEW.plan_item_id)",rule='R-06')
    guard('decision_file_version','decision_file_patient',"(SELECT p.patient_id FROM patient_decision d JOIN plan_version v ON v.id=d.plan_version_id JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE d.id=NEW.decision_id) IS NOT (SELECT c.patient_id FROM document_version v JOIN clinical_document c ON c.id=v.clinical_document_id WHERE v.id=NEW.document_version_id)",rule='R-06')
    guard('patient_decision','proxy_wrong_patient_or_time',"NEW.patient_proxy_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patient_proxy x JOIN plan_version v ON v.id=NEW.plan_version_id JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE x.id=NEW.patient_proxy_id AND x.patient_id=p.patient_id AND x.valid_from<=NEW.decided_at AND (x.valid_until IS NULL OR NEW.decided_at<x.valid_until))",rule='R-06')
    guard('treatment_execution','execution_patient',"NEW.plan_item_id IS NOT NULL AND (SELECT v.patient_id FROM visit v WHERE v.id=NEW.visit_id) IS NOT (SELECT p.patient_id FROM plan_item i JOIN plan_version v ON v.id=i.plan_version_id JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE i.id=NEW.plan_item_id)",rule='R-07')
    guard('treatment_execution','correction_chain',"NEW.original_execution_id IS NOT NULL AND (NEW.original_execution_id=NEW.id OR NOT EXISTS (SELECT 1 FROM treatment_execution e WHERE e.id=NEW.original_execution_id AND e.visit_id=NEW.visit_id))",rule='R-07')
    guard('service_price','price_overlap',"NEW.status='已确认可适用' AND EXISTS (SELECT 1 FROM service_price x WHERE x.id<>NEW.id AND x.service_id=NEW.service_id AND x.status='已确认可适用' AND x.valid_from<COALESCE(NEW.valid_until,'9999') AND NEW.valid_from<COALESCE(x.valid_until,'9999'))",rule='R-08')
    freeze('service_price',"EXISTS (SELECT 1 FROM bill_item WHERE service_price_id=OLD.id)",['service_id','unit_price_cents','valid_from','valid_until'],key='referenced_price_frozen')
    freeze('bill_item',"OLD.pricing_status='已核价'",key='priced_item_frozen')
    guard('bill_item','bill_execution_patient',"(SELECT patient_id FROM bill WHERE id=NEW.bill_id) IS NOT (SELECT v.patient_id FROM treatment_execution e JOIN visit v ON v.id=e.visit_id WHERE e.id=NEW.treatment_execution_id)",rule='R-08')
    guard('bill_item','bill_price_source',"NEW.service_price_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM service_price p JOIN treatment_execution e ON e.id=NEW.treatment_execution_id WHERE p.id=NEW.service_price_id AND p.service_id=e.service_id AND p.valid_from<=NEW.priced_at AND (p.valid_until IS NULL OR NEW.priced_at<p.valid_until) AND p.status IN ('已确认可适用','不再用于新计费') AND (NEW.pricing_status<>'已核价' OR NEW.unit_price_cents=p.unit_price_cents))",rule='R-08')

    def used(payment):
        return f'(COALESCE((SELECT sum(amount_cents) FROM payment_allocation WHERE patient_payment_id={payment}),0)+COALESCE((SELECT sum(amount_cents) FROM prepayment_offset WHERE patient_payment_id={payment}),0))'
    def reserved(payment,exclude='-1'):
        return f"COALESCE((SELECT sum(CASE WHEN status='已确认退款' THEN actual_cents WHEN status IN ('待办理','待核实') THEN requested_cents ELSE 0 END) FROM patient_refund WHERE patient_payment_id={payment} AND id<>{exclude}),0)"
    def owed(bill):
        return f"(COALESCE((SELECT sum(quantity*unit_price_cents) FROM bill_item WHERE bill_id={bill} AND pricing_status='已核价'),0)+COALESCE((SELECT sum(i.amount_cents) FROM fee_adjustment_item i JOIN fee_adjustment a ON a.id=i.fee_adjustment_id WHERE a.bill_id={bill}),0)-COALESCE((SELECT sum(amount_cents) FROM payment_allocation WHERE bill_id={bill}),0)-COALESCE((SELECT sum(amount_cents) FROM prepayment_offset WHERE bill_id={bill}),0))"
    for t,original in [('payment_allocation','original_allocation_id'),('prepayment_offset','original_offset_id')]:
        guard(t,'allocation_owner',"NOT EXISTS (SELECT 1 FROM patient_payment p JOIN bill b ON b.id=NEW.bill_id WHERE p.id=NEW.patient_payment_id AND p.patient_funds_id=b.patient_funds_id AND p.status='到账已确认')",('INSERT',),'R-09')
        guard(t,'payment_budget',f"NEW.amount_cents>0 AND (NEW.amount_cents+{used('NEW.patient_payment_id')}+{reserved('NEW.patient_payment_id')}>(SELECT net_cents FROM patient_payment WHERE id=NEW.patient_payment_id) OR NEW.amount_cents>{owed('NEW.bill_id')})",('INSERT',),'R-09')
        guard(t,'release_budget',f"NEW.amount_cents<0 AND (NOT EXISTS (SELECT 1 FROM {t} a WHERE a.id=NEW.{original} AND a.amount_cents>0) OR -NEW.amount_cents-COALESCE((SELECT sum(amount_cents) FROM {t} WHERE {original}=NEW.{original}),0)>(SELECT amount_cents FROM {t} WHERE id=NEW.{original}) OR NOT EXISTS (SELECT 1 FROM fee_request r JOIN bill b ON b.id=NEW.bill_id WHERE r.id=NEW.fee_request_id AND r.status='已同意' AND r.patient_funds_id=b.patient_funds_id AND (r.bill_id IS NULL OR r.bill_id=NEW.bill_id) AND (r.patient_payment_id IS NULL OR r.patient_payment_id=NEW.patient_payment_id)))",('INSERT',),'R-09')
    guard('fee_adjustment','adjustment_approval',"NOT EXISTS (SELECT 1 FROM fee_request r WHERE r.id=NEW.fee_request_id AND r.status='已同意' AND r.bill_id=NEW.bill_id AND r.reviewed_by=NEW.approved_by)",('INSERT',),'R-10')
    guard('fee_adjustment_item','adjustment_wrong_bill',"(SELECT bill_id FROM fee_adjustment WHERE id=NEW.fee_adjustment_id) IS NOT (SELECT bill_id FROM bill_item WHERE id=NEW.bill_item_id)",('INSERT',),'R-10')
    guard('fee_adjustment_item','adjustment_negative_receivable',f"NEW.amount_cents+{owed('(SELECT bill_id FROM fee_adjustment WHERE id=NEW.fee_adjustment_id)')}<0",('INSERT',),'R-10')
    refund_amount="CASE WHEN NEW.status='已确认退款' THEN NEW.actual_cents WHEN NEW.status IN ('待办理','待核实') THEN NEW.requested_cents ELSE 0 END"
    guard('patient_refund','refund_approval',"NOT EXISTS (SELECT 1 FROM fee_request r JOIN patient_payment p ON p.id=NEW.patient_payment_id WHERE r.id=NEW.fee_request_id AND r.status='已同意' AND r.patient_funds_id=p.patient_funds_id AND p.status='到账已确认' AND (r.patient_payment_id IS NULL OR r.patient_payment_id=p.id))",rule='R-11')
    guard('patient_refund','refund_budget',f"({refund_amount})+{reserved('NEW.patient_payment_id','NEW.id')}+{used('NEW.patient_payment_id')}>(SELECT net_cents FROM patient_payment WHERE id=NEW.patient_payment_id) OR ({refund_amount})+COALESCE((SELECT sum(CASE WHEN status='已确认退款' THEN actual_cents WHEN status IN ('待办理','待核实') THEN requested_cents ELSE 0 END) FROM patient_refund WHERE fee_request_id=NEW.fee_request_id AND id<>NEW.id),0)>(SELECT approved_refund_cents FROM fee_request WHERE id=NEW.fee_request_id)",rule='R-11')
    guard('patient_refund','refund_retry_not_failed',"NEW.previous_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patient_refund p WHERE p.id=NEW.previous_attempt_id AND p.id<>NEW.id AND p.status='已失败' AND p.patient_payment_id=NEW.patient_payment_id AND p.fee_request_id=NEW.fee_request_id)",rule='R-11')
    for t,foreign,target in [('contact_history','appointment_id','appointment'),('clinical_assessment','visit_id','visit')]:
        guard(t,'followup_patient',f'NEW.{foreign} IS NOT NULL AND (SELECT patient_id FROM {target} WHERE id=NEW.{foreign}) IS NOT (SELECT patient_id FROM followup_requirement WHERE id=NEW.followup_requirement_id)',rule='R-12')
    guard('followup_requirement','assessment_required',"NEW.status='已完成' AND NEW.requires_assessment=1 AND NOT EXISTS (SELECT 1 FROM clinical_assessment WHERE followup_requirement_id=NEW.id AND advice='完成')",rule='R-12')

    freeze('material',"EXISTS (SELECT 1 FROM inventory_movement m JOIN batch_stock s ON s.id=m.batch_stock_id JOIN material_batch b ON b.id=s.material_batch_id WHERE b.material_id=OLD.id)",['base_unit','purchase_unit','conversion_numerator','conversion_denominator','quantity_scale'],key='material_units_frozen')
    guard('material_batch','expiry_required',"NEW.status='可用' AND NEW.expiry_date IS NULL AND EXISTS (SELECT 1 FROM material WHERE id=NEW.material_id AND requires_expiry=1)",rule='R-13')
    guard('batch_stock','stock_starts_zero','NEW.quantity_scaled<>0',('INSERT',),'R-13')
    guard('inventory_movement','stock_stale',"NEW.before_scaled IS NOT (SELECT quantity_scaled FROM batch_stock WHERE id=NEW.batch_stock_id)",('INSERT',),'R-14')
    guard('inventory_movement','issue_batch_unavailable',"NEW.movement_type='领用' AND NOT EXISTS (SELECT 1 FROM batch_stock s JOIN material_batch b ON b.id=s.material_batch_id JOIN material m ON m.id=b.material_id JOIN stock_location l ON l.id=s.stock_location_id WHERE s.id=NEW.batch_stock_id AND b.status='可用' AND m.is_active=1 AND m.confirmed_at IS NOT NULL AND m.confirmed_by IS NOT NULL AND l.is_active=1)",('INSERT',),'R-13')
    guard('inventory_movement','movement_type_source',"(NEW.movement_type IN ('验收入库','未用退回') AND NEW.delta_scaled<=0) OR (NEW.movement_type IN ('领用','退供') AND NEW.delta_scaled>=0) OR (NEW.movement_type='验收入库' AND NEW.purchase_receipt_item_id IS NULL) OR (NEW.movement_type='未用退回' AND NEW.original_movement_id IS NULL) OR (NEW.movement_type='盘点' AND NEW.stock_count_id IS NULL) OR (NEW.movement_type='退供' AND NEW.purchase_issue_id IS NULL)",('INSERT',),'R-14')
    guard('inventory_movement','count_stale',"NEW.movement_type='盘点' AND NOT EXISTS (SELECT 1 FROM stock_count c JOIN batch_stock s ON s.id=c.batch_stock_id WHERE c.id=NEW.stock_count_id AND c.status='差异已确认' AND c.stock_revision=s.revision AND c.snapshot_quantity_scaled=NEW.before_scaled AND c.counted_quantity_scaled=NEW.after_scaled)",('INSERT',),'R-13')
    guard('inventory_movement','receipt_stock_context',"NEW.movement_type='验收入库' AND NOT EXISTS (SELECT 1 FROM purchase_receipt_item r JOIN batch_stock s ON s.id=NEW.batch_stock_id JOIN purchase_receipt h ON h.id=r.purchase_receipt_id WHERE r.id=NEW.purchase_receipt_item_id AND r.material_batch_id=s.material_batch_id AND r.stock_location_id=s.stock_location_id AND h.accepted_at IS NOT NULL AND h.confirmed_by IS NOT NULL AND r.accepted_quantity_scaled>=NEW.delta_scaled+COALESCE((SELECT sum(delta_scaled) FROM inventory_movement WHERE purchase_receipt_item_id=r.id AND movement_type='验收入库'),0))",('INSERT',),'R-14')
    guard('inventory_movement','return_over_issue',"NEW.movement_type='未用退回' AND (NOT EXISTS (SELECT 1 FROM inventory_movement WHERE id=NEW.original_movement_id AND movement_type='领用') OR NEW.delta_scaled+COALESCE((SELECT sum(delta_scaled) FROM inventory_movement WHERE original_movement_id=NEW.original_movement_id AND movement_type='未用退回'),0)+COALESCE((SELECT sum(quantity_scaled) FROM material_usage WHERE inventory_movement_id=NEW.original_movement_id),0)>-(SELECT delta_scaled FROM inventory_movement WHERE id=NEW.original_movement_id))",('INSERT',),'R-14')
    guard('material_usage','usage_over_issue',"NOT EXISTS (SELECT 1 FROM inventory_movement WHERE id=NEW.inventory_movement_id AND movement_type='领用') OR NEW.quantity_scaled+COALESCE((SELECT sum(quantity_scaled) FROM material_usage WHERE inventory_movement_id=NEW.inventory_movement_id),0)+COALESCE((SELECT sum(delta_scaled) FROM inventory_movement WHERE original_movement_id=NEW.inventory_movement_id AND movement_type='未用退回'),0)>-(SELECT delta_scaled FROM inventory_movement WHERE id=NEW.inventory_movement_id)",('INSERT',),'R-14')
    # 流水写入即维护余额；禁止应用再次扣减。直接改余额必须与整本账一致。
    sql.append('CREATE TRIGGER tr_inventory_movement_post AFTER INSERT ON inventory_movement BEGIN UPDATE batch_stock SET quantity_scaled=NEW.after_scaled,revision=revision+1,updated_at=NEW.created_at WHERE id=NEW.batch_stock_id; END;')
    triggers.append({'name':'tr_inventory_movement_post','table':'inventory_movement','rule':'R-14','error':None})
    guard('batch_stock','stock_ledger_mismatch','NEW.quantity_scaled IS NOT COALESCE((SELECT sum(delta_scaled) FROM inventory_movement WHERE batch_stock_id=NEW.id),0)',('UPDATE',),'R-14')
    guard('purchase_receipt_item','receipt_order_material',"(SELECT purchase_order_id FROM purchase_receipt WHERE id=NEW.purchase_receipt_id) IS NOT (SELECT purchase_order_id FROM purchase_order_item WHERE id=NEW.purchase_order_item_id) OR (NEW.material_batch_id IS NOT NULL AND (SELECT material_id FROM material_batch WHERE id=NEW.material_batch_id) IS NOT (SELECT material_id FROM purchase_order_item WHERE id=NEW.purchase_order_item_id))",rule='R-15')
    guard('purchase_receipt_item','accepted_below_stocked',"NEW.accepted_quantity_scaled<COALESCE((SELECT sum(delta_scaled) FROM inventory_movement WHERE purchase_receipt_item_id=NEW.id AND movement_type='验收入库'),0)",rule='R-15')
    guard('purchase_order','order_without_items',"NEW.status='已确认' AND NOT EXISTS (SELECT 1 FROM purchase_order_item WHERE purchase_order_id=NEW.id)",rule='R-15')
    freeze('purchase_order_item',"EXISTS (SELECT 1 FROM purchase_order WHERE id=OLD.purchase_order_id AND status='已确认')",['ordered_quantity_scaled','unit_price_cents','purchase_unit','conversion_numerator','conversion_denominator','quantity_scale'],key='confirmed_order_terms_frozen')

    supplier_target="COALESCE((SELECT supplier_id FROM purchase_order WHERE id=NEW.purchase_order_id),(SELECT o.supplier_id FROM purchase_receipt r JOIN purchase_order o ON o.id=r.purchase_order_id WHERE r.id=NEW.purchase_receipt_id))"
    guard('supplier_allocation','supplier_allocation_owner',f"{supplier_target} IS NOT (SELECT f.supplier_id FROM supplier_payment p JOIN supplier_funds f ON f.id=p.supplier_funds_id WHERE p.id=NEW.supplier_payment_id)",rule='R-16')
    guard('supplier_allocation','supplier_release',"NEW.amount_cents<0 AND NOT EXISTS (SELECT 1 FROM supplier_allocation a WHERE a.id=NEW.original_allocation_id AND a.amount_cents>0 AND a.allocation_state='已生效' AND a.purchase_order_id IS NEW.purchase_order_id AND a.purchase_receipt_id IS NEW.purchase_receipt_id AND -NEW.amount_cents-COALESCE((SELECT sum(amount_cents) FROM supplier_allocation WHERE original_allocation_id=a.id AND id<>NEW.id AND allocation_state='已生效'),0)<=a.amount_cents)",rule='R-16')
    guard('supplier_allocation','supplier_payment_budget',"NEW.allocation_state<>'已取消' AND (NEW.amount_cents+COALESCE((SELECT sum(amount_cents) FROM supplier_allocation WHERE supplier_payment_id=NEW.supplier_payment_id AND id<>NEW.id AND allocation_state<>'已取消'),0)+COALESCE((SELECT sum(received_cents) FROM supplier_refund WHERE supplier_payment_id=NEW.supplier_payment_id),0)>(SELECT CASE WHEN status='已确认付款' THEN actual_cents ELSE requested_cents END FROM supplier_payment WHERE id=NEW.supplier_payment_id) OR (NEW.allocation_state='已生效' AND NOT EXISTS (SELECT 1 FROM supplier_payment WHERE id=NEW.supplier_payment_id AND status='已确认付款')))",rule='R-16')
    guard('supplier_refund','supplier_refund_owner_budget',"NOT EXISTS (SELECT 1 FROM purchase_issue i JOIN purchase_order_item j ON j.id=i.purchase_order_item_id JOIN purchase_order o ON o.id=j.purchase_order_id JOIN supplier_funds f ON f.supplier_id=o.supplier_id WHERE i.id=NEW.purchase_issue_id AND f.id=NEW.supplier_funds_id AND i.status IN ('待处理','已完成')) OR NOT EXISTS (SELECT 1 FROM supplier_payment p WHERE p.id=NEW.supplier_payment_id AND p.status='已确认付款' AND p.actual_cents>=NEW.received_cents+COALESCE((SELECT sum(received_cents) FROM supplier_refund WHERE supplier_payment_id=p.id),0)+COALESCE((SELECT sum(amount_cents) FROM supplier_allocation WHERE supplier_payment_id=p.id AND allocation_state='已生效'),0))",('INSERT',),'R-16')
    guard('instrument_processing','release_missing_checks',"NEW.status='已放行' AND (NOT EXISTS (SELECT 1 FROM instrument_pack_cycle WHERE instrument_processing_id=NEW.id) OR NOT EXISTS (SELECT 1 FROM processing_monitor WHERE instrument_processing_id=NEW.id) OR EXISTS (SELECT 1 FROM processing_monitor WHERE instrument_processing_id=NEW.id AND (result<>'通过' OR evidence IS NULL)) OR EXISTS (SELECT 1 FROM instrument_pack_cycle WHERE instrument_processing_id=NEW.id AND (expires_at IS NULL OR expires_at<=NEW.released_at)))",rule='R-17')
    guard('instrument_use','pack_not_released',"NEW.use_status IN ('已发放','已使用') AND NOT EXISTS (SELECT 1 FROM instrument_pack_cycle c JOIN instrument_processing p ON p.id=c.instrument_processing_id WHERE c.id=NEW.instrument_pack_cycle_id AND p.status='已放行' AND c.status IN ('可用','已发放待确认','已使用') AND p.released_at<=NEW.issued_at AND c.expires_at>COALESCE(NEW.used_at,NEW.issued_at))",rule='R-17')
    freeze('instrument_use',"OLD.use_status IN ('已使用','未用退回','异常补录')",key='use_history_frozen')
    for field,table,kind,amount,when,status in [
        ('patient_payment_id','patient_payment','患者付款','s.net_cents','s.received_at',"s.status='到账已确认'"),
        ('patient_refund_id','patient_refund','患者退款','-s.actual_cents','s.verified_at',"s.status='已确认退款'"),
        ('supplier_payment_id','supplier_payment','供货付款','-s.actual_cents','s.verified_at',"s.status='已确认付款'"),
        ('supplier_refund_id','supplier_refund','供货退款','s.received_cents','s.received_at','1')]:
        guard('reconciliation_item','reconcile_'+table,f"NEW.{field} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM {table} s JOIN cash_reconciliation r ON r.id=NEW.cash_reconciliation_id WHERE s.id=NEW.{field} AND {status} AND NEW.source_type={L(kind)} AND NEW.included_cents={amount} AND NEW.source_at={when} AND NEW.source_revision=s.revision AND s.channel=r.channel AND {when}<=r.cutoff_at)",('INSERT',),'R-18')
    guard('staff_role_qualification','qualification_overlap',"EXISTS (SELECT 1 FROM staff_role_qualification q WHERE q.id<>NEW.id AND q.staff_id=NEW.staff_id AND q.role_id=NEW.role_id AND q.valid_from<min(COALESCE(NEW.valid_until,'9999'),COALESCE(NEW.revoked_at,'9999')) AND NEW.valid_from<min(COALESCE(q.valid_until,'9999'),COALESCE(q.revoked_at,'9999')))",rule='R-19')
    guard('account_role','qualification_account',"NOT EXISTS (SELECT 1 FROM staff_role_qualification q JOIN user_account a ON a.staff_id=q.staff_id WHERE q.id=NEW.qualification_id AND a.id=NEW.account_id AND q.role_id=NEW.role_id AND q.valid_from<=NEW.granted_at AND NEW.granted_at<min(COALESCE(q.valid_until,'9999'),COALESCE(q.revoked_at,'9999')) AND COALESCE(NEW.valid_until,'9999')<=min(COALESCE(q.valid_until,'9999'),COALESCE(q.revoked_at,'9999')))",rule='R-19')
    guard('account_role','grant_overlap',"EXISTS (SELECT 1 FROM account_role a WHERE a.id<>NEW.id AND a.account_id=NEW.account_id AND a.role_id=NEW.role_id AND a.granted_at<min(COALESCE(NEW.valid_until,'9999'),COALESCE(NEW.revoked_at,'9999')) AND NEW.granted_at<min(COALESCE(a.valid_until,'9999'),COALESCE(a.revoked_at,'9999')))",rule='R-19')
    guard('backup_run','backup_success_gate',"NEW.status='成功' AND (NOT EXISTS (SELECT 1 FROM backup_artifact WHERE backup_id=NEW.id AND artifact_kind='database' AND verification_status='通过') OR EXISTS (SELECT 1 FROM backup_artifact WHERE backup_id=NEW.id AND verification_status<>'通过') OR NOT EXISTS (SELECT 1 FROM backup_copy WHERE backup_id=NEW.id AND location_kind='本地' AND status='已验证' AND manifest_sha256=NEW.manifest_sha256) OR NOT EXISTS (SELECT 1 FROM backup_copy WHERE backup_id=NEW.id AND location_kind='异机' AND status='已验证' AND manifest_sha256=NEW.manifest_sha256))",rule='R-21')

    guard('plan_version','plan_publish_empty',"OLD.status='草稿' AND NEW.status='待确认' AND NOT EXISTS (SELECT 1 FROM plan_item WHERE plan_version_id=NEW.id)",('UPDATE',),'R-06/R-07')
    guard('plan_item','plan_scope_frozen',"EXISTS (SELECT 1 FROM plan_version WHERE id=NEW.plan_version_id AND status<>'草稿')",rule='R-06/R-07')
    guard('plan_item','plan_old_scope_frozen',"EXISTS (SELECT 1 FROM plan_version WHERE id=OLD.plan_version_id AND status<>'草稿')",('UPDATE',),'R-06/R-07')
    freeze('plan_version',"OLD.status<>'草稿'",['diagnostic_basis','planned_schedule','change_reason'],key='published_plan_content_frozen')
    guard('health_item','reviewed_health_frozen',"EXISTS (SELECT 1 FROM health_review WHERE health_version_id=NEW.health_version_id)",('INSERT',),'R-03')
    for t in ('processing_monitor','instrument_pack_cycle'):
        guard(t,'processing_scope_frozen',"EXISTS (SELECT 1 FROM instrument_processing WHERE id=NEW.instrument_processing_id AND status IN ('已放行','隔离停用'))",('INSERT',),'R-17')
    freeze('processing_monitor',"EXISTS (SELECT 1 FROM instrument_processing WHERE id=OLD.instrument_processing_id AND status IN ('已放行','隔离停用'))",key='released_monitor_frozen')
    freeze('instrument_pack_cycle',"EXISTS (SELECT 1 FROM instrument_processing WHERE id=OLD.instrument_processing_id AND status IN ('已放行','隔离停用'))",['packaging_check','expires_at','checked_by'],key='released_pack_identity_frozen')
    freeze('instrument_processing','OLD.released_at IS NOT NULL',['processing_equipment_id','previous_processing_id','started_at','ended_at','released_at','release_basis','released_by','operator_id'],key='release_evidence_frozen')
    for t in ('stock_count','followup_requirement'):
        terminal="'差异已确认','不予调整'" if t=='stock_count' else "'已完成','已撤销'"
        freeze(t,f'OLD.status IN ({terminal})',key='completed_workflow_frozen')
    contracts=state_contracts()
    for contract in contracts:
        t=contract['table'];field=contract['field']
        assert set(contract['states'])==set(next(f['enum'] for f in tables[t]['fields'] if f['name']==field)),t
        starts=[x['state'] for x in contract['initial']]
        guard(t,'state_initial','NEW.'+field+' NOT IN ('+','.join(map(L,starts))+')',('INSERT',),'C状态机:'+contract['source'])
        pairs=' OR '.join('(OLD.'+field+'='+L(e['from'])+' AND NEW.'+field+'='+L(e['to'])+')' for e in contract['transitions'])
        guard(t,'state_transition','NEW.'+field+'<>OLD.'+field+' AND NOT ('+pairs+')',('UPDATE',),'C状态机:'+contract['source'])

    roles=[('frontdesk','前台'),('dentist','牙医'),('cashier','收费人员'),('assistant','诊疗助理'),('manager','诊所负责人')]
    for code,name in roles:
        sql.append('INSERT INTO access_role(code,name,description,created_at) VALUES('+','.join(map(L,[code,name,name+'固定业务岗位','2026-10-18T00:00:00Z']))+');')
    for permission in support['permissions']:
        code=permission['code'];uc=permission.get('usecase')
        query_codes={'uc02.query','uc06.query','uc09.query','uc16.query','uc17.query','uc19.funds','uc19.management','uc31.clinical_trace'}
        kind='运行管理' if not uc else ('查询' if code in query_codes else '业务写入')
        # 对象规则绑定固定权限代码，由D2逐操作实现；不宣称SQL已实现对象授权。
        sql.append('INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('+','.join([L(code),L(f'UC-{uc:02}') if uc else 'NULL',L(permission['name']),L(kind),L(code), '1'])+');')
        for role in permission['roles']:
            sql.append(f'INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,\'2026-10-18T00:00:00Z\' FROM access_role r,access_permission p WHERE r.code={L(role)} AND p.code={L(code)};')
    sql.append('PRAGMA user_version=20261018;\nCOMMIT;')
    output='\n\n'.join(sql)+'\n'
    db=sqlite3.connect(':memory:');db.executescript(output)
    assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
    fk=[]
    for t in tables:
        for row in db.execute('PRAGMA foreign_key_list('+Q(t)+')'):
            fk.append({'table':t,'group':row[0],'sequence':row[1],'parent':row[2],'column':row[3],'parent_column':row[4],'on_update':row[5],'on_delete':row[6]})
    manifest={'version':'2026-10-18-D1-state-collections','scope':'85表结构、16类状态转移与集合提交门禁样例；全用例服务与迁移验收待完成',
        'source_sha256':physical['source_sha256'],'sql_sha256':hashlib.sha256(output.encode()).hexdigest(),
        'counts':{'tables':len(tables),'fields':sum(len(t['fields']) for t in tables.values()),'foreign_key_groups':len({(r['table'],r['group']) for r in fk}),'check_expressions':check_count,'indexes':len(indexes),'triggers':len(triggers),'seed_roles':len(roles),'seed_permissions':len(support['permissions'])},
        'indexes':indexes,'triggers':triggers,'state_contracts':contracts,
        'aggregate_work_unit':'状态与集合校验设计.py：无封存列聚合由工作单元保护，直接SQL不会执行提交门禁。',
        'service_gates_pending':[
            '全部32用例的授权、接诊范围、实时钟/营业日期、乐观revision及审计原子性；16类转移方向已生成SQL保护，事件警戒条件仍需服务验证。',
            '临床签署摘要计算、同意/撤回时间线与有效执行链数量；集合提交门禁已形成隔离设计样例，须由D2各写入口强制调用，不能仅依赖直接SQL。',
            '资金安全整数逐步运算；批准调整明细总和与审批额一致；供应商各原单预占上限及批准退换上限；部分实付后用途重分配；原授权版本核验。',
            '采购累计交付/取消剩余和精确换算取整；确认合格量与入库量最终相等；批次实时效期、退供依据和已用材料核验。',
            '器械完整必检项目集合、当前时钟与实物；收支核对完整来源集合、摘要、营业日期和差异跟进。',
            '资格撤销的反向授权处理、auth_version与会话失效；固定权限对象规则、审计字段白名单及敏感数据屏蔽。',
            '备份快照附件集合完整性、真实文件摘要/异机副本、恢复必检集合与RPO/RTO；不能由SQL登记状态自证。',
            '16类状态集与转移来源逐一核对，代表性非法方向与新增业务反例已验证；全部事件警戒、反向修改与故障注入继续验收；旧库迁移、旧数据清洗、应用衔接及回退另做。'
        ]}
    # 固定UTF-8与LF，使跨平台重建及报告摘要匹配文件实际字节。
    (HERE/'SQLite-建表设计.sql').write_bytes(output.encode('utf-8'))
    (HERE/'数据库外键清单.json').write_text(json.dumps({'version':manifest['version'],'groups':manifest['counts']['foreign_key_groups'],'rows':fk},ensure_ascii=False,indent=2),encoding='utf-8')
    (HERE/'DDL实施边界.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    contract={'version':manifest['version'],'sql_sha256':manifest['sql_sha256'],
        'state_machines':contracts,
        'state_scope':'SQL检查初态和转移方向；事件、警戒条件、责任与副作用仍由服务操作逐项核对。内部动作不等于允许修改冻结事实。',
        'collections':[
            {'parent':'health_version','children':['health_item'],'source':'UC-21/R-03','gate':'新版本必须明确病史、过敏、用药三类，有、无、未知分别记录；同事务补齐，提交后集合固定。'},
            {'parent':'patient_decision','children':['decision_plan_item','decision_file_version'],'source':'UC-22/R-06','gate':'同意至少一项具体范围；同事务形成关联，提交后不得扩大或更换集合。'},
            {'parent':'fee_adjustment','children':['fee_adjustment_item'],'source':'UC-25/R-10','gate':'批准非零调整同时建立调整；明细合计等于批准额，事务末共同确认，之后集合固定。'},
            {'parent':'cash_reconciliation','children':['reconciliation_item'],'source':'UC-20/R-18','gate':'所选来源、开班及有据存取的合计与头快照一致；有差异必须有跟进；提交后集合固定。'},
            {'parent':'purchase_receipt_item','children':['inventory_movement'],'source':'UC-28/R-14/R-15','gate':'本次新增或变化条目：累计验收入库等于认可合格量，价款按采购单位精确换算并取整；头与流水整体提交。'},
            {'parent':'supplier_payment','children':['supplier_allocation'],'source':'UC-29/R-16','gate':'付款变化时：待付/未知的预占合计等于拟付；确认后生效合计等于实付，无遗留待生效；失败取消全部预占。'},
        ],
        'work_unit':'状态与集合校验设计.py/AggregateTransaction',
        'integration_required':'隔离设计样例；D2必须让所有相关写入口经过工作单元。直接SQL不会自动执行事务末集合门禁，文件和真实支付不由此样例验证。'}
    (HERE/'状态转移与集合提交设计.json').write_text(json.dumps(contract,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(manifest['counts'],ensure_ascii=False))


if __name__=='__main__':generate()
