# 短剧流程门禁修复与验证

## 结论

根因是执行流程缺少业务门禁，子 Agent 的失败又被上游编排静默吞掉并用模板补缺；画布投影同时遗漏领域中的文本。问题不能归结为某个 Agent 写作能力差。

已实施服务端阶段校验、持久文本任务、图片前置任务图及领域画布投影。缺分析、正式剧本、有效参考图或当前分镜图的短剧无法提交视频生成；子 Agent 无结果或结果无效时保留失败任务，不再批准模板补缺。后台排队与整剧完成明确分开。

代码验证通过，尚未完成真实 ComfyUI 端到端生成验证。本次没有重做现有视频、修改项目记录、同步安装副本或重启运行中的 host；运行服务是否已加载其他会话的变化未确认，不能把仓库验证称为上线验证。

## 文件及改动

| 文件 | 改动 |
| --- | --- |
| `lib/domain/policies.js` | 当前源文和已批准分析／剧本校验；参考素材及分镜版本签名；正式交付覆盖门禁 |
| `lib/domain/commands/index.js` | 视频 Attempt 创建／恢复门禁；图片绑定；剧本事件覆盖；整剧完成检查 |
| `lib/domain/production.js` | 开始与登记视频／分镜任务时重验阶段；跨 Run 已完成依赖；失败递归阻断 |
| `lib/production/drama.js` | 参考图、分镜图、视频、分集合成、整剧交付依赖图；局部生成不声明整剧完成 |
| `lib/script/novel-production.js` | 子任务结果即时持久化与恢复；全部原文区间、规划事件和剧本镜头关联检查 |
| `lib/index.js` | 固定子 Agent 编排保留错误；移除模板补缺；图片与交付 worker；实际镜头时长；复用项目重新绑定会话；生成入口门禁 |
| `lib/media/generation.js` | 外部提交之前重新检查视频上游 |
| `lib/domain/read-models.js` | 投影内容分析、角色／场景设定、正式剧本及真实图片；展示缺失原因；合并兼容画布 |
| `lib/compat/legacy-canvas-adapter.js`、`studio/app.js`、`studio/stages.js` | 领域投影不重复写入兼容画布；只读展示与明确阶段分类 |
| `lib/prompts/compiler.js` | 移除本次重复加入的原始对白拼接，沿用当前已有的原生对白编译路径 |
| `skills/elysium-generate-drama/SKILL.md` | 与持久任务、前置图片、失败停止及正式交付规则对齐 |
| `tests/domain/production-stages.test.js`、`tests/domain/novel-production.test.js`、`tests/plugin/drama-stage-entrypoints.test.js` | 新增阶段、恢复、覆盖、交付和真实注册工具入口回归 |
| `tests/domain/project-service.test.js`、`tests/media/generation.test.js`、`tests/delivery/export.test.js` | 原有裸媒体测试夹具明确为独立画布创作 |

工作区已有其他会话的原生对白修改，保留，没有覆盖。

## 验证结果

- 递归收集全部 `tests/**/*.test.js`：25 个测试文件，107 项通过，0 项失败。
- `npm run smoke:all`：通过。
- `node --check lib/index.js`：通过；新增编排模块的语法检查已通过。
- `git diff --check`：通过。
- 真实注册入口测试：空上游分别调用 batch 和 render 均被阻断，远程请求数为 0，没有创建视频 Attempt 或生产 Run。
- 子任务恢复测试：成功输出复用，失败分集单独重做；缺失及语义覆盖错误保留失败状态。
- 交付测试：缺正式镜头、交付文件登记未完成或分镜已失效时不能完成 Project；有效全覆盖交付可完成且重复调用幂等。
- 当前只读项目验证：存储中现有 `20261006213635859` 为 draft，有 12 个正式镜头、0 个图片资产；使用修复后的门禁检查，12 个镜头全部阻塞。画布可投影既有文本及缺失说明，其中“分镜”节点是缺失说明，不能算作已生成分镜图。
- 调查时的 `20261006205109724`、`20261006210821751` 文件已不在当前存储目录；历史证据保留在根因报告。本次未删除它们。

## 验证限制

事件覆盖检查确认声明的事件 ID、源文范围及镜头引用关系，不能自动证明改编忠实、人物连续性或成片视觉质量。自动媒体批准基于可解码媒体、元数据与业务关联，不是人工视觉审核；交付质量记录明确 `visualReview: not_performed`。

真实图片生成、MiniMax H3 视频生成及正式成片交付未运行，不据此宣称新任务已生产成功。现有不合格项目不会由本次代码变更自动修复或补图。
