# 清理分散README

- 类型：文档清理与发布配置同步，完整流程。
- 目标：删除当前仓库各目录README，消除维护负担及失效引用，不再默认新增分散README。
- 非目标：不删除AGENTS、SKILL、开发文档、依赖目录或外部仓库资料；不修改业务执行逻辑。

## 验收标准与调研结论

| AC | 输入/状态 → 可观测结果 | 状态 | 依据 |
|---|---|---|---|
| AC-1 | 当前仓库源码及文档目录 → 13份README删除，其他类型文档保留 | 已确认待实施 | rg --files清单，含根、四公共包、drama四目录和meiji四目录 |
| AC-2 | 当前开发文档 → 不指向已删文件，维护约定归AGENTS及既有开发文档 | 已确认待实施 | 根AGENTS、drama、meiji开发指引和接口文档 |
| AC-3 | 公共包发布 → files清单无README条目，安装和复制验收正常 | 已确认待实施 | 四个package.json发布清单 |

## 调用链与证据

README不参与运行；npm pack读取四个公共包files清单，删除相应条目后应保留原源码、exports、示例和UI。测试里的README路径是文档豁免的临时夹具，并非待删文件，不改动。

已对当前仓库执行GitNexus状态、查询和配置目标impact；配置关系以发布清单、verify-install/verify-copy及源码补查。现有未提交改动保留，仅按本任务删除README和同步引用。

## 待用户决定

无。

## 改动

1. 删除根README、packages四份、drama四份和meiji四份README → AC-1。
2. 清理当前文档引用，把node_runtime文件职责放入现有开发方向，维护约定集中到开发入口 → AC-2。
3. 四个公共包发布清单移除README，保留其他配置 → AC-3。

验证：工程测试基线/改后、verify:install、verify:copy -- drama、剩余README清单和链接检查、git diff --check、完整detect_changes及最终索引。

## 验证结果

- 已删除13份README，源码/文档文件清单无剩余README；未删除依赖或外部仓库资料。
- 当前开发文档无指向已删README的链接；保留测试中的临时文件名与上游技能对其README的文字说明。
- 四包files清单已移除README，工程测试基线和改后均7通过、0失败、0取消。
- verify:install及verify:copy -- drama均通过，git diff --check通过。
- 完整detect_changes：10符号、489影响、60已跟踪文件，风险critical，包含此前未提交改动，无partial/truncated字段；本次发布变化以安装/复制验收补查。
- 最终索引及状态日志：/tmp/readme-clean-index.log、/tmp/readme-clean-final-status.log。
