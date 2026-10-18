# 测试维护

测试按功能归属维护，不再按开发阶段增加文件。修复问题时优先在所属文件扩展现有场景；只有独立功能才新建文件。

## 运行

在仓库根目录执行：

```sh
npm test --prefix meiji
node --test meiji/tests/dialogue.test.js
node --experimental-test-coverage --test meiji/tests/*.test.js
```

`*.test.js` 是正式入口，`fixtures/` 仅存测试资料和共用执行器。测试使用隔离的临时目录、模拟网关或本地 HTTP；媒体处理使用真实 FFmpeg，不调用付费模型。运行结束清理临时资源。

## 功能归属

| 范围 | 文件 |
|---|---|
| 数据契约、模型、节点状态与依赖失效 | `contracts`、`node-state`、`node-dependencies` |
| SQLite、事务恢复、迁移、历史持久化 | `storage`、`storage-migrations`、`step-records` |
| ID 与删除、人工导入 | `asset-identity`、`asset-operations` |
| 队列、取消、任务组、重启与完整制作链 | `task-queue`、`task-groups`、`runtime`、`film-pipeline` |
| 全集规划、分集改编、镜头角色服装绑定 | `planning`、`adaptation`、`shot-catalog` |
| 人物提取、场景、逐镜文字上下文、对白 | `character-extraction`、`scenes`、`shot-context`、`dialogue` |
| 文本执行、审核修订、提示词协议与规则源 | `text-execution`、`review-policy`、`prompt-contracts`、`prompt-rules` |
| HTTP、模型设置、GPU、图片与视频请求 | `gateway`、`model-settings`、`gpu`、`media-images`、`video-service` |
| 会话鉴权、通知与隔离 | `api-session` |
| 面板、导航、任务按钮、成片、历史、规则与刷新 | `ui-project`、`ui-navigation`、`ui-task-actions`、`ui-film`、`ui-history`、`ui-node-rules`、`ui-lifecycle` |

表中名称均省略 `.test.js`。同一文件中的 `describe` 区分具体子功能；有独立错误原因的输入分支仍单独保留，不为降低显示数量将其藏进一个大用例。

## 保留与合并原则

- 优先验证可观察行为：正确结果保存、真实错误拒绝、状态与历史一致、取消或迟到结果不能写回、输入输出顺序和关联正确。
- 全节点/动作/模型来源的通用渲染检查只在 `prompt-contracts` 维护；其他文件只测该功能独有的资料与协议边界。
- 提示词不锁定一般行文措辞。固定协议标记、语义边界、规则只注入一次等必要约束保留集中检查。
- JSON 错层、时长越界、对白丢失、服装归属错误、部分参考图缺失等真实故障保留回归用例。
- 合并或删除用例需说明已有覆盖位置，并跑相关测试及全量测试；覆盖率只能辅助判断，不能代替行为检查。
- 数据迁移和旧命令退役测试仍有保护作用，不因名字包含历史版本就删除。测试历史映射保存在本次实施记录中。
