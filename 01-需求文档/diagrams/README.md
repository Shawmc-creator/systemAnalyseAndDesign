# 需求文档图表

当前版：2026年10月7日。图片由PlantUML绘制，LaTeX使用本目录中的PNG。对应的`.puml`为可编辑源文件。

| 内容 | 文件 |
|---|---|
| 业务用例、现状与改进序列 | `01-*`、`02*`、`03*` |
| 系统用例图及逐用例图 | `07-*`、`07uc-*` |
| 分析类图与分析序列图 | 当前文档引用的类图及序列图文件 |
| 分析状态机图 | 当前文档引用的状态机文件 |

文档包含20份系统用例规约、20张独立系统用例图、20组分析序列图及扩展、5张分析状态机图。具体编号与顺序以同级需求文档的LaTeX引用为准；D阶段暂不开展。

`business-actor.png`、`business-worker.png`和`business-entity.png`用于部分业务图的符号引用，渲染时保留在同目录。

## 重新渲染

准备Java和PlantUML，在本目录运行（将JAR路径改为实际位置）：

```shell
java -Dfile.encoding=UTF-8 -DPLANTUML_LIMIT_SIZE=16384 -jar /path/to/plantuml.jar -charset UTF-8 -tpng 01-business-use-case.puml
```

Windows可使用相应本地JAR路径。PDF已包含所有图，无需先渲染即可阅读。
