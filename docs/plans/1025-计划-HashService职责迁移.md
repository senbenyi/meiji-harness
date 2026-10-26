# HashService职责迁移

- 类型：完整流程，盒子执行与保存、内容指纹及过期职责调整。
- 目标：盒子内部不计算/校验内容hash；结果后的跨盒子hash流程归独立HashService，本次不接入。
- 非目标：不改变模型协议、审核规则、字段校验、任务取消、会话/项目归属；不删除用户数据。

## 验收标准与证据
| AC | 状态 → 结果 | 证据 |
|---|---|---|
| AC-1 | 模型返回字段顺序不同 → 保存、审核不再被hash拦截 | 剧本executor对JSON.stringify摘要比较；真实失败任务三个字段完全相等但顺序不同 |
| AC-2 | 所有文本/图片盒子 → 不产出或使用input_hash/output_hash/内容指纹，不在盒子内触发下游过期 | 检索定位6类文本盒子、2类生图及项目/规则入口 |
| AC-3 | 独立HashService → 移入现有指纹与过期处理，可独立验证，无生产import/调用 | 新增project_runtime/hash-service.js，不注册/实例化 |
| AC-4 | 请求幂等/消息ID/文件身份 → 保持现有标识，盒子内审核重复检测用直接内容比较 | 请求ID、签名与通知ID属于身份用途，移除的是内容校验用途 |
| AC-5 | 项目/任务归属、取消、已保存内容 → 正常保留 | 现有项目写队列及TaskManager边界保留 |

## 调用链与影响
Service受理 → Executor生成/审核/修订 → Service保存：现均混入内容指纹和下游过期。项目编辑、规则修改、资产reconcile也会触发过期，须同次退出。
移到HashService的指纹/过期函数删去原出口，不保留新旧双轨；资产reconcile仅保留按ID创建与保留历史资源的职责。
原记录input_hash/output_hash/dependency_hash仍为历史事实，不删除历史任务；新执行不读写内容hash。请求身份算法移入项目运行层，保持已有ID，不更换持久化键，不引入兼容分支。
图谱已刷新：ScriptRevisionService、ProjectService、reconcileSceneAssets为CRITICAL，expireGroupDependents为HIGH；已告知用户。未知符号已按源码补查。

## 改动
1. projects/drama/src/project_runtime/hash-service.js：集中原内容指纹、下游过期、资产过期逻辑；哈希对象按键排序，避免字段顺序误判。无生产调用。
2. projects/drama/src/project_runtime/request-identity.js：集中原请求幂等ID算法，不承担内容校验。
3. projects/drama/src/node_box各文本/图片Service/Executor/state/规则执行器：删除hash检查、metadata生成及下游过期调用；保留投影、校验、资产对应关系与身份/取消校验。
4. 项目Service：移走编辑时的内容指纹/过期联动及摘要hash比较。
5. 受影响测试按新设计更新；新增真实字段乱序生成与审核回归及HashService未接入验证；同步开发文档与目录清单。

验证：drama基线292通过；分阶段跑drama，再执行npm test、git diff --check；检查HashService无生产引用，图谱变更/更新并重启drama。

## 验证结果
- AC-1通过：新增模型字段乱序集成用例，任务正常生成、保存并审核completed；步骤为generate/review，无input_hash/output_hash。
- AC-2通过：src/node_box全量检索无hash/Fingerprint/digest/expire*Depend引用；6个文本盒子及2个图片盒子的输入变化不再触发hash拒绝；编辑、规则和资产映射不再触发依赖过期。
- AC-3通过：HashService独立对象/数组内容比较测试通过；架构测试确认无生产import/实例化；原过期函数已删除并迁入类。
- AC-4通过：现有任务幂等及文件导入用例通过；审核重复检测使用isDeepStrictEqual；用户继续/重生授权仍按终态显式校验，不依赖hash。
- AC-5通过：取消/运行状态、项目归属和字段校验等原测试通过；原稿/图片历史资源保留，现有持久化ID算法不变。
- drama基线292通过；最终npm test共1113通过、0失败、0取消（drama295）。清理最后两处身份变量/废弃字段后，相关35项再次通过。
- git diff --check通过；无新旧内容hash双轨或运行时兼容分支，历史任务字段不删除、不再读取。
- 最终图谱索引更新成功；检查覆盖本会话累积未提交改动，风险critical，已完成全量回归。修改源码无未使用命名import。
- drama已用新代码重启，PID44995，3080正常监听并返回HTTP401鉴权响应。
