# HashService职责迁移实施记录

## 已修改文件
- projects/drama/src/project_runtime/hash-service.js：集中8类内容指纹、6类下游过期及2类资产过期处理；新增按对象键排序的内容比较，暂未接入生产执行链。
- projects/drama/src/project_runtime/request-identity.js：原请求/任务ID与原稿文件身份算法迁出盒子，保持持久化标识不变。
- projects/drama/src/node_box下script_revision、story_segments、scene_extraction、group_setting、character_extraction、shot_design的Service/Executor/state/规则执行器：移除内容hash校验、输入/输出hash元数据、下游过期调用；审核重复检测直接比较内容；删除已无职责的script_revision/state.js。
- projects/drama/src/node_box下costume_image、scene_image的Service/Executor/state：移除生成前/保存时的输入指纹检查；保留目标归属、Task运行和取消校验。
- projects/drama/src/node_box/project/service.js、executor.js、edit_project.js、script_files.js：退出编辑及摘要hash校验/过期联动，使用运行层身份函数，不更新内容依赖hash。
- projects/drama/tests/hash-service.test.js、script-optimization.test.js：HashService未接入/比较语义与字段乱序优化审核回归。
- projects/drama/tests/characters.test.js、main-planning.test.js、original-summary.test.js、scene-images.test.js、scenes.test.js、shots.test.js、story-outline.test.js：按暂不接入HashService的新行为更新旧拦截与过期断言，保留字段校验/取消/身份/授权及资源保存覆盖。
- projects/drama/AGENTS.md、docs/开发方向.md及本次计划：同步职责与接入状态。

## 验收标准核对
AC-1至AC-5通过：盒子无内容hash，乱序字段正常保存审核，HashService独立且无生产调用，请求身份不变，任务/项目/字段/取消边界保留。

## 测试
基线drama292通过、0失败、0取消。首次回归的旧内容拦截/过期预期已按新设计更新。
最终npm test共1113通过、0失败、0取消（drama295）；最后清理相关35项通过。git diff --check通过。
最终图谱索引更新成功；累积改动风险critical，已完成全量回归。无未使用命名import。drama重启PID44995，3080监听及HTTP鉴权响应正常。

## 人工待办
HashService接入盒子结果后的跨盒子流程留待后续明确要求，本次不接入。
