# 清理分散README实施记录

## 已修改文件

- 删除13份README：根1份、公共包4份、drama的client/harness_server/node_box/node_runtime共4份、meiji根/skills/tests/references/minimax-h3共4份。完整清单在/tmp/readme-clean-deleted.json。
- packages/{http-client,prompt-composer,setting,task}/package.json：仅同步移除files清单README条目，保留之前的exports等改动。
- 根AGENTS与.agents/agent-harness-dev.md：入口改为AGENTS/开发指引，明确不再默认创建分散README。
- drama AGENTS及开发方向：移除README链接，将节点运行文件职责集中到现有开发方向文档。
- meiji开发指引及调用接口文档：移除失效README引用，工作区指向实际开发指引。

## 验收标准核对

| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 文件清单不再含README，实际删除13份；AGENTS/SKILL和业务文档保留 |
| AC-2 | 通过 | 当前引用检索仅剩不新增README的约定、测试夹具文件名及上游技能说明，无指向已删文件的链接 |
| AC-3 | 通过 | 四包发布清单已同步，隔离离线安装和项目复制验收通过 |

## 测试

- 工程测试基线与改后均7通过、0失败、0取消。
- verify:install通过：四包tarball在隔离目录离线安装，运行独立接入示例成功。
- verify:copy -- drama通过。
- README文件及引用检索、JSON解析和git diff --check通过；不运行无关业务测试。
- GitNexus配置impact为UNKNOWN，已通过发布清单、安装/复制流程补查；完整detect_changes为10符号、489影响、60已跟踪文件，风险critical，包含此前未提交改动，无partial/truncated字段。
- 最终索引及状态日志：/tmp/readme-clean-index.log、/tmp/readme-clean-final-status.log。

## 人工待办

无。已有历史计划/实施记录保留历史文件名，不作为现有入口；未修改业务执行逻辑或用户数据。
