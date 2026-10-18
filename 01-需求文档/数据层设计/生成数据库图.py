"""从完整逻辑结构生成PlantUML分区图，并汇总矢量总图。只生成文档工件。"""
from pathlib import Path
import argparse, json, hashlib, subprocess, tempfile, xml.etree.ElementTree as ET

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--java', default='java')
parser.add_argument('--plantuml', help='PlantUML jar 路径')
parser.add_argument('--node', default='node')
parser.add_argument('--browser', help='Chromium/Edge 可执行文件路径；提供时导出矢量PDF')
parser.add_argument('--sources-only', action='store_true', help='只更新PlantUML源文件')
args=parser.parse_args()
if not args.sources_only and not args.plantuml:
    parser.error('渲染SVG必须提供 --plantuml')
DOC=Path(__file__).resolve().parent.parent
OUT=DOC/'diagrams'
_temporary=tempfile.TemporaryDirectory(prefix='dental-diagrams-')
WORK=Path(_temporary.name)
data = json.loads((DOC/'数据层设计/新版完整逻辑结构.json').read_text(encoding='utf-8'))
tables = {t['table']:t for t in data['tables']}
groups = [
 ('患者与职员', 'patient staff patient_change patient_proxy clinical_handover'),
 ('预约、排班与到诊', 'dental_chair dated_schedule schedule_change resource_occupancy appointment appointment_change visit'),
 ('健康资料与病历', 'health_version health_item health_review clinical_record clinical_finding record_addendum'),
 ('方案、文件与执行', 'clinical_document document_version treatment_plan plan_version plan_item patient_decision treatment_execution decision_plan_item decision_file_version'),
 ('价目、应收与患者账户', 'service service_price bill bill_item patient_funds'),
 ('患者付款、调整与退款', 'patient_payment payment_allocation prepayment_offset fee_request fee_adjustment fee_adjustment_item patient_refund'),
 ('复诊与随访', 'followup_requirement contact_history clinical_assessment'),
 ('材料批次与库存', 'material material_batch batch_change stock_location batch_stock inventory_movement material_usage stock_count'),
 ('采购、验收与差异', 'supplier purchase_order purchase_order_item purchase_receipt purchase_receipt_item purchase_issue'),
 ('供应商资金结算', 'supplier_funds supplier_payment supplier_allocation supplier_refund'),
 ('器械处理与使用', 'instrument_pack processing_equipment instrument_processing instrument_pack_cycle processing_monitor instrument_use'),
 ('收支核对与差异跟进', 'cash_reconciliation reconciliation_item issue_followup'),
 ('身份、岗位与权限', 'user_account access_role access_permission staff_role_qualification account_role role_permission login_session authentication_event'),
 ('提交控制与审计', 'request_submission operation_audit audit_change'),
 ('备份与恢复验证', 'backup_run backup_artifact backup_copy restore_verification restore_check'),
]
owner = {name:i+1 for i,(_,names) in enumerate(groups) for name in names.split()}
assert len(owner)==85 and set(owner)==set(tables)
colors = ['#EDF5FA','#EFF5ED','#F7F0E6','#F0ECF7','#EAF4F4']
manifest = {'counts':{},'groups':[],'relations':[], 'source_sha256':hashlib.sha256((DOC/'数据层设计/新版完整逻辑结构.json').read_bytes()).hexdigest()}
for i,(title,names_string) in enumerate(groups,1):
    names = names_string.split()
    stem = f'd1-db-{i:02d}'
    lines = [f'@startuml {stem}',
      'skinparam defaultFontName Microsoft YaHei', 'skinparam defaultFontSize 15',
      'skinparam backgroundColor white','skinparam shadowing false',
      'skinparam classAttributeIconSize 0', 'hide circle', 'hide empty methods',
      'skinparam classFontSize 17','skinparam classAttributeFontSize 15',
      'skinparam ArrowColor #667788','skinparam ArrowThickness 1',
      'skinparam nodesep 55','skinparam ranksep 75',
      'skinparam linetype polyline','top to bottom direction',
      'skinparam class {',' BackgroundColor white',' BorderColor #526575',f' HeaderBackgroundColor {colors[(i-1)%5]}','}',
      f'title G{i:02d}  {title}  ·  {len(names)}张表']
    edges = set()
    for name in names:
        t = tables[name]
        lines.append(f'entity "{t["name"]}\\n{name}" as {name} {{')
        for f in t['fields']:
            tags=[]
            if f.get('primary_key'): tags.append('PK')
            if f.get('unique'): tags.append('UQ')
            if f.get('foreign_key'): tags.append('FK')
            tags.append('NULL' if f['nullable'] else 'NN')
            suffix=' ['+', '.join(tags)+']'
            if f.get('foreign_key'):
                target=f['foreign_key']
                assert target in tables and any(x['name']=='id' and x.get('primary_key') for x in tables[target]['fields'])
                suffix+=f'  → {target}.id'
                if owner[target]!=i: suffix+=f' (G{owner[target]:02d})'
                visible = target in names and target != name
                # Common staff references remain explicit in the field, like cross-section references.
                if target=='staff': visible=False
                if visible: edges.add((name,target))
                manifest['relations'].append({'table':name,'column':f['name'],'target_table':target,'target_column':'id','nullable':f['nullable'],'group':i,'target_group':owner[target],'drawn_edge':visible})
            lines.append('  {field} '+f['name']+' : '+f['type']+suffix)
        lines.append('}')
    for a,b in sorted(edges): lines.append(f'{a} --> {b}')
    # Disconnected staff is placed alongside the patient card.
    if i==1: lines.append('patient -[hidden]right- staff')
    lines.append('@enduml')
    source='\n'.join(lines)+'\n'
    (OUT/f'{stem}.puml').write_text(source,encoding='utf-8')
    manifest['groups'].append({'number':i,'title':title,'stem':stem,'tables':names,'fields':sum(len(tables[n]['fields']) for n in names),'edge_pairs':sorted(edges)})
manifest['counts']={'tables':85,'fields':sum(len(t['fields']) for t in tables.values()),'foreign_key_columns':len(manifest['relations']),'groups':len(groups),'drawn_edge_pairs':sum(len(g['edge_pairs']) for g in manifest['groups'])}
assert manifest['counts']['fields']==1048 and manifest['counts']['foreign_key_columns']==254
(WORK/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
# This collection is rendered by the reproducible assembly script; no hand-drawn table or link.
(OUT/'24-database-overall.puml').write_text("' 85表总图的15个PlantUML分区；拼版脚本见数据层设计/生成数据库图.py\n"+'\n'.join((OUT/(g['stem']+'.puml')).read_text(encoding='utf-8') for g in manifest['groups']),encoding='utf-8')
print(json.dumps(manifest['counts'],ensure_ascii=False))

if args.sources_only:
    raise SystemExit(0)
for g in manifest['groups']:
    subprocess.run([args.java,'-Dfile.encoding=UTF-8','-DPLANTUML_LIMIT_SIZE=32768','-jar',args.plantuml,'-charset','UTF-8','-tsvg',str(OUT/(g['stem']+'.puml'))],check=True)
S='http://www.w3.org/2000/svg'
ET.register_namespace('',S)
ET.register_namespace('xlink','http://www.w3.org/1999/xlink')
manifest=json.loads((WORK/'manifest.json').read_text(encoding='utf-8'))
roots=[]
for g in manifest['groups']:
    root=ET.parse(OUT/(g['stem']+'.svg')).getroot()
    g['svg_width']=float(root.attrib['width'].removesuffix('px'))
    g['svg_height']=float(root.attrib['height'].removesuffix('px'))
    # Use untouched PlantUML graphs. The assembly changes only placement, not diagram geometry.
    for el in root.iter():
        if 'id' in el.attrib: el.attrib['id']=g['stem']+'-'+el.attrib['id']
    roots.append(root)
cols=5; gap=70; pad=75; top=245
widths=[max(g['svg_width'] for i,g in enumerate(manifest['groups']) if i%cols==c)+40 for c in range(cols)]
heights=[max(g['svg_height'] for g in manifest['groups'][r*cols:(r+1)*cols])+50 for r in range(3)]
W=2*pad+sum(widths)+gap*(cols-1); H=top+pad+sum(heights)+gap*2
outer=ET.Element(f'{{{S}}}svg',{'width':f'{W:g}px','height':f'{H:g}px','viewBox':f'0 0 {W:g} {H:g}','version':'1.1'})
ET.SubElement(outer,f'{{{S}}}rect',{'width':str(W),'height':str(H),'fill':'#FFFFFF'})
def text(x,y,s,size,weight='normal',fill='#24384B'):
    e=ET.SubElement(outer,f'{{{S}}}text',{'x':str(x),'y':str(y),'font-family':'Microsoft YaHei','font-size':str(size),'font-weight':weight,'fill':fill});e.text=s
text(pad,100,'牙科诊所管理系统 · 数据库关系总图',68,'bold')
text(pad,168,'85张表  /  69张业务表 + 16张运行支撑表  /  1048个字段  /  SQLite目标逻辑结构',32)
text(pad,214,'G01—G15 分区全字段视图',25,fill='#526575')
for i,(g,root) in enumerate(zip(manifest['groups'],roots)):
    c=i%cols;r=i//cols
    x=pad+sum(widths[:c])+gap*c;y=top+sum(heights[:r])+gap*r
    ET.SubElement(outer,f'{{{S}}}rect',{'x':str(x),'y':str(y),'width':str(widths[c]),'height':str(heights[r]),'rx':'14','fill':'#FFFFFF','stroke':'#CBD5DF','stroke-width':'2'})
    root.attrib['x']=str(x+(widths[c]-g['svg_width'])/2)
    root.attrib['y']=str(y+25)
    outer.append(root)
ET.ElementTree(outer).write(OUT/'24-database-overall.svg',encoding='utf-8',xml_declaration=True)
jobs=[{'svg':str(OUT/(g['stem']+'.svg')),'pdf':str(OUT/(g['stem']+'.pdf'))} for g in manifest['groups']]
jobs.append({'svg':str(OUT/'24-database-overall.svg'),'pdf':str(DOC/'数据层设计/数据库关系总图.pdf')})
(WORK/'pdf-jobs.json').write_text(json.dumps(jobs,ensure_ascii=False,indent=2),encoding='utf-8')
manifest['overall']={'width_px':W,'height_px':H,'layout':'5 columns × 3 rows; native PlantUML diagrams at equal scale','source':'24-database-overall.puml'}
(WORK/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'overall':manifest['overall'],'sizes':[(g['number'],g['svg_width'],g['svg_height']) for g in manifest['groups']]},ensure_ascii=False))

(DOC/'数据层设计/数据库图覆盖清单.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
if args.browser:
    subprocess.run([args.node,str(DOC/'数据层设计/数据库图转PDF.cjs'),str(WORK/'pdf-jobs.json'),args.browser],check=True)
print('数据库图生成完毕。源图与SVG已更新；PDF仅在提供 --browser 时更新。')
