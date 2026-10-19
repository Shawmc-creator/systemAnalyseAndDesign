# 青禾牙科诊所管理系统

Node.js内置HTTP与SQLite实现，前后端无第三方依赖。旧版程序与新版程序分别运行；新版继续对齐现行179页需求文档（25个系统用例及69表核心模型）。原32用例编号保留为代码中的历史技术编号。

## 新版进度与GitHub启动方式

新版保留85张既有实现表，本批新增文档中的3张资源业务表，运行库当前88表，使用独立`data/clinic-v2.db`，默认端口3001。已识别的旧新版库升级前自动备份；不升级旧版程序数据库。已接入患者、排班、预约到诊页面，以及临床、方案执行、患者资金、复诊随访、材料采购库存、退换差异和供应商结算后端。采购的单独补交差异跟踪、器械和运行管理等仍待后续完成。后端新增功能尚未全部接入网页；资源功能已沿用现有页面样式接入，Figma及视觉改版仍暂停。

从GitHub克隆后先安装Node.js 24或以上版本，在本目录运行：

```powershell
npm run demo:v2
# 浏览器打开 http://127.0.0.1:3001/
```

也可双击作业根目录`04-启动新版预约工作台.cmd`，启动脚本优先使用作业附带运行时，没有便携运行时时使用PATH中的Node。演示初始化只在新库首次建立账号；旧数据库不会自动转换。

```powershell
npm test
npm run demo:treatment:v2
npm run demo:fees:v2
npm run demo:followups:v2
npm run demo:inventory:v2
npm run demo:supply:v2
npm run demo:resources:v2
```

完整自动化检查228项通过，其中新版171项、旧版回归57项。六条演示命令均使用内存隔离库，不改运行数据。最新资源演示覆盖设备冲突、实际延时、签署不释放、结束交接和清洁恢复；网页入口、接口及待办见上级`资源协调实施与验收.md`。

## 旧版启动

双击作业根目录的`01-一键启动系统.cmd`，浏览器打开`http://127.0.0.1:3000/`。网页需后端运行，直接打开`public/index.html`会跳转该地址。

在本app目录也可使用作业附带的便携Node运行：`../runtime/node.exe src/server.js`。

## 六名演示工作人员

| 账号 | 岗位 |
|---|---|
| manager | 负责人兼牙医 |
| dentist | 牙医 |
| frontdesk | 前台 |
| cashier | 收费人员 |
| assistant、assistant2 | 两名诊疗助理 |

演示密码均为`Clinic123!`。

## 当前功能

预约与牙医确认安排、患者资料及当日到诊；临床病历、牙位、方案与患者决定、实际项目确认和有原因更正；负责人确认的价目版本；现金足额结算、找零及原收据；有来源的复诊随访；接诊排班；材料入库领用盘点；负责人业务统计及收费人员日常核对。

患者由前台、牙医及收费人员办理业务。旧患者页保留联系说明，患者自助、非现金及部分付款、折扣退款审批、模拟通知接口已停用。历史记录保留，旧结算不能通过新流程改写。

## 演示与验证

```powershell
../runtime/node.exe scripts/seed-demo.js
../runtime/node.exe --test tests/*.test.js
../runtime/node.exe scripts/smoke-http.js
../runtime/node.exe scripts/run-demo-workflow.js
../runtime/node.exe scripts/export-demo.js
```

种子脚本仅新增带当前规则标记的虚构案例，重复执行不重复创建；HTTP脚本须先启动系统。导出保存到作业目录`03-数据/示例导出`。

旧版差异与验证见上级目录`文档与代码对齐检查.md`。旧版回归共57项通过（含1个父测试容器）。运行`node scripts/acceptance.js`可生成旧版TXT／JSON证据；逐用例与页面记录见`04-测试与验收/测试与验收.md`第7节。需求文档ABCD已完成，新版实现进度以上方及根目录README为准。
