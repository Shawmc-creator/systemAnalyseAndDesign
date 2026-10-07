# 青禾牙科诊所管理系统

Node.js内置HTTP与SQLite实现，前后端无第三方依赖。功能以当前需求文档的业务流程和UC-01至UC-20为标准。

## 启动

双击作业根目录的`01-一键启动系统.cmd`，浏览器打开`http://127.0.0.1:3000/`。网页需后端运行，直接打开`public/index.html`会跳转该地址。

在本app目录也可使用作业附带的便携Node运行：`node src/server.js`。

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
node scripts/seed-demo.js
node --test tests/*.test.js
node scripts/smoke-http.js
node scripts/run-demo-workflow.js
node scripts/export-demo.js
```

本仓库不附带本机运行数据库；首次运行按初始化脚本生成。种子脚本仅新增带当前规则标记的虚构案例，重复执行不重复创建；HTTP脚本须先启动系统。导出保存到作业目录`03-数据/示例导出`。

详细差异与验证见上级目录`文档与代码对齐检查.md`。新版代码验收共57项通过（含1个父测试容器）。运行`node scripts/acceptance.js`可生成本次TXT／JSON证据；逐用例与实际页面记录见`04-测试与验收/测试与验收.md`第7节。D阶段暂不开展。
