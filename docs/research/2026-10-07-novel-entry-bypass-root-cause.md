# 整书短剧唯一入口绕行根因

> 证据来源：3080 真实页面轨迹、仓库源码、`~/.dsh` 安装副本。  
> 结论：不是安装漂移；是入口能力不匹配、指令双轨和根 Agent 无硬门禁叠加。

## 1. 真实失败链

页面要求使用 `studio_novel_create` 和 Harness Workflow 完成 1 集、2–3 镜头 Pilot。Agent 加载 `elysium-generate-drama` 后实际调用：

```text
glob
→ studio_project_create
→ bash
→ studio_source_import
→ studio_source_read
```

Workflow 未启动，运行被人工停止。

## 2. 根因排序

### P0：唯一入口只有软约束

`lib/index.js:4419-4423` 把通用工具、Project 工具和 Script 工具合并后全部全局注册。根 Agent 同时看到：

- `studio_novel_create`；
- `studio_project_create`；
- `studio_source_import/read`；
- `studio_novel_orchestrate`；
- 宿主 `bash/glob/workflow`。

Skill 和 systemPrompt 只能建议模型走唯一入口，运行时没有拒绝其他路径。

### P0：现有隔离保护错了对象

`lib/index.js:4133-4137` 只给 novel Workflow 创建的 child Agent 安装 `installNovelChildPolicy`；`restrictedNovelParents` 又是在 `studio_novel_orchestrate` 已经开始后才设置（约 `4180`）。

因此：

```text
根 Agent 选择入口
  → 此时没有任何 hard gate
  → 根 Agent 绕过 novel_create
  → orchestrate 从未启动
  → child policy 永远不会生效
```

`lib/script/child-policy.js:1-12` 的实现本身只允许 child 调用 `structured_output`，但它不能约束根 Agent。

### P1：Pilot 与入口能力冲突

`studio_novel_create` 在 `lib/index.js:4241-4250` 被定义为整书入口，只接受 `sourcePath/title`，没有局部范围、最大集数或最大镜头数。

本次验证要求 1 集、2–3 镜头；Skill 又把单集/局部修改视为另一类流程。模型无法通过整书入口表达 Pilot 范围，因此转向底层工具。这也是验证方案自身的契约错误。

### P1：GUIDANCE 和 Skill 存在两套流程

- `lib/index.js:4439` 说整书必须调用 `studio_novel_create`，主 Agent 不直接调用 source/import/orchestrate/batch。
- `lib/guidance.js` 仍包含直接定位文件、直接 source import、文本结束后加载媒体 Skill 等旧流程。
- `skills/elysium-generate-drama/SKILL.md:46-47` 要求只调用一次 `studio_novel_create`。
- 同一 Skill 后续章节仍详细描述主 Agent 手工调用 analysis、episode、asset、shot、batch、status 的旧链路，并允许局部任务走其他方式。

模型同时收到“只走入口”和“按步骤手工做”的指令。

### P2：底层工具比入口更容易执行

底层工具描述公开、具体，`studio_project_create` 明确创建 Project，`studio_source_import/read` 明确导入和分块读取。相比之下，`studio_novel_create` 既只支持整书，又要求模型先提供正确的 workspace-relative sourcePath，进一步诱导模型先用 glob/bash 定位和检查文件。

## 3. 排除项

- 仓库 Skill 与 `~/.dsh` 安装 Skill SHA-256 均为 `431e3de9ba1eb124dca3078c2b5d7111b172a628e375891480bcc0f0c6316a8a`。
- 真实页面已成功加载该 Skill。
- `studio_novel_create` 已注册并存在。

因此不是旧插件、Skill 漂移、重启未生效或工具缺失；再次重装不会解决。

## 4. 最小修复边界

不扩建调度平台，只做四项：

1. 统一入口契约：要么 Pilot 使用一个截取好的独立源文件并仍按“整份源文”调用现有入口；要么给 `studio_novel_create` 增加明确的 `scope=full|pilot`，二选一，不能继续语义模糊。
2. 增加根 Agent 入口 guard：加载 `elysium-generate-drama` 后，`studio_novel_create` 完成前，服务端拒绝 project/source/orchestrate/batch/workflow/bash/glob 绕行。
3. `studio_novel_orchestrate` 改为私有函数，不再注册为根 Agent 可见工具。
4. 删除 GUIDANCE/Skill 中旧手工流程，只保留唯一入口；sourcePath 解析由入口内部完成，不要求模型用 shell 定位。

## 5. 修复后的第一条验收

3080 新会话加载 Skill 后：

- 第一项业务工具必须是 `studio_novel_create`；
- project/source/orchestrate/batch/workflow/bash/glob 应被服务端拒绝，而不是只靠 Prompt 禁止；
- 页面轨迹出现 Harness Workflow 后，才进入六阶段内容验收。
