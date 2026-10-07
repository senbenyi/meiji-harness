# 3080 真实页面 Pilot 验证记录

> 时间：2026-10-07 13:49（Asia/Shanghai）  
> 页面：`http://127.0.0.1:3080/`  
> 会话：`都市生日夜短剧基础流程验收`  
> 判定：`FAIL`（首个入口门禁失败，已主动停止）

## 用户输入

要求使用工作区《都市生日夜.md》，只取一个完整故事单元生成 1 集、2–3 镜头，完成小说分析、正式剧本、资产及图片提示词、分镜图片提示词、视频提示词、真实媒体、合成和 Deliverable；明确要求使用短剧唯一入口和 Harness Workflow，不得使用 shell 或其他工具绕行。

## 页面实际轨迹

页面先加载了 `elysium-generate-drama` Skill，但随后没有调用 `studio_novel_create`，实际调用顺序为：

1. `glob {"pattern":"生日夜"}`；
2. `studio_project_create {"title":"都市生日夜 Pilot（单故事单元）"}`；
3. `bash {"command":"wc -c 都市生日夜.md; wc -l 都市生日夜.md"}`；
4. `studio_source_import`；
5. `studio_source_read`。

已产生 Project：`20261007134926939`，源文 hash 为 `4cb636e19b1d88410a172e5d5066db4a4d5c283aed7ea7b794274067397ccb78`。

## 判定

- 唯一入口：FAIL；
- Harness Workflow 启动：未发生；
- 六阶段验证：未进入；
- Deliverable：未生成；
- 会话在首个偏离点后人工停止，避免继续产生不可作为验收证据的数据。

## 根因证据

即使用户 Prompt 和已加载 Skill 都明确禁止绕行，主 Agent 仍可直接看到并调用内部 Project/Source/Shell 工具。因此当前流程正确性仍依赖模型纪律，尚未形成 Harness 强制编排。

这证明 Prompt/Skill 无法解决入口稳定性；下一步必须在工具暴露或入口实现上强制：整书短剧会话只能提交 `studio_novel_create`，内部 Project/Source 操作由入口或 Harness Workflow 执行，不能继续暴露给主 Agent 自由选择。
