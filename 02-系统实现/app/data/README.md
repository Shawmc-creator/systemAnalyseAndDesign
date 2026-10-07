# 运行数据库

`clinic.db`为SQLite运行库，已包含六名工作人员及当前需求的虚构演示记录。前台和收费人员使用独立账号。

迁移保留既有患者、诊疗与结算历史。当前业务种子标记为`demo.requirements.v2`，重复运行`../scripts/seed-demo.js`不重复建例。

修改前备份在作业根目录`03-数据/运行备份/clinic-before-alignment-20261005.db`。数据库运行时可能存在`clinic.db-wal`和`clinic.db-shm`，不要单独删除活动日志文件。
