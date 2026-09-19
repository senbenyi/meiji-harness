# Scene 与 Segment 创作流程

- 类型：新功能与存储结构调整。
- 状态：已确认并实施，验证结果见末节。
- 目标：以 Scene 组织故事、Segment 组织 H3 单次生成，分离创作资料、分镜审核、最终 H3 输入和视频生成。
- 用户明确要求：第 5 步总览提交全部 Segment，详情提交当前 Segment；第 5 步仅展示最终 H3 输入，不重复配置素材。

## 现有代码依据
- `dsh-elysium/src/database/managers/projects.js` 将 episodes/workflow 放在 project.json，分镜汇总至 storyboard.json，产物汇总至 deliverables.json。
- `dsh-elysium/src/server/projects/workflow.js` 当前 submit-series 依次启动任务，但没有等待前一段完成；Prompt 在提交时由 compile 拼装，没有独立审核版本。
- `dsh-elysium/src/server/workflows/videos/service.js` 通过 episode_id 查审核授权，需要更换为 Segment 和已审核的 H3 输入版本。
- `dsh-elysium/src/models/providers/runpod/workflows/minimax-h3/profile.js` 常规档默认 5 秒、固定宽高并对齐帧数；生成参数必须与项目画幅/片段时长绑定。
- Runpod 当前只有单任务生成，没有现成的项目多视频合片接口；Autodl 的导演工作流是在单张图中拼接图像/音频，不能直接当作已有 100 段视频的剪辑服务。
- 工作区已有新建项目表单、画幅、时长等未提交变更，实施时保留并衔接，不回滚或覆盖。

## 页面及行为
1. 项目描述：原始输入只读保留；创作要求、画幅、风格和目标总时长可编辑。
2. 生成剧情：完整故事及按顺序排列的 Scene，包含地点、时间、事件、对白与预计时长。
3. Segment 规划：AI 按场景及动作边界拆分，默认以 15 秒为上限；允许更短。人物数量由人物引用计算。服装、道具、场景、音乐、环境声分别保存描述、指定资源以及自动/指定/无三种意图。
4. Segment 与分镜：片段详情上方编辑创作信息，下方生成分镜、横向展示镜头，点击镜头编辑并保存。所需实际素材在本阶段准备和审核，共用同一素材版本避免跨段重复生成。
5. H3 输入结果：每个 Segment 一张横向卡，详情可修改最终 Prompt 并查看生成模式、时长、画幅、实际参考资源。没有第二套人物/服装/道具选择器。
   - 总览提交：校验所有目标 Segment 的最新 H3 输入，建立一个持久化串行队列；等待当前任务完成、刷新列表后再启动下一段。
   - 详情提交：只提交当前 Segment，不批准或触发其他片段。
   - 首次总览推进要求全部片段资料、素材、分镜、H3 输入就绪；后续批量提交跳过已有当前版本成功结果，已有运行任务复用。
   - 串行任务失败时保留结果并暂停队列，修复后继续，避免依赖前段的后续片段使用错误画面。
6. Segment 视频：每完成一段立即出现可播放结果；保留旧版本，明确当前选用版本，支持局部重做。
7. 时间线与成片：Scene/Segment 稳定 ID 决定顺序，选择采用版本、裁切、转场、字幕、统一音乐及音量，使用实际视频时长合片。100 段采用分页/按需加载，避免同时解码所有视频封面。

修改上游只使依赖结果过期，不删除历史视频；使用前段尾帧的后段需要重新核对。已提交任务冻结输入快照，运行中的修改不得悄悄改变任务。

## 本地存储设计

根路径保持 `~/.dsh/storages/elysium`，本地仅存结构化数据、引用与任务记录，媒体继续使用服务器 URL。

```text
projects/<project-id>/
  project.json                 # 元数据和 production_snapshot 原子指针
  production/revisions/<snapshot>/
    state.json                 # 原始需求、创作要求、画幅风格、阶段及修订号
    story.json                 # 完整剧情与有序 Scene
    assets.json                # 共享素材版本和服务器引用
    segments/index.json        # 片段稳定 ID 与排列
    segments/<segment-id>/
      segment.json
      storyboard.json
      h3-inputs/index.json
      h3-inputs/<version-id>.json
      generations.json
    queue.json
    timeline.json
    exports.json
  jobs/<job-id>/               # 既有任务输入、执行与恢复记录
```

完整不可变快照写入后，最后原子发布 `production_snapshot`，避免跨文件中途失败暴露不完整阶段。媒体文件留在服务器。

- 稳定 ID 不依赖编号，Scene1/Segment1 是显示顺序，重排不改变引用。
- 单文件原子替换，项目级串行写入；跨文件结果先保存不可变版本，最后更新索引，保证失败后可以恢复，不发布半完成的阶段。
- 当前旧项目保留并备份，不自动删除；旧 episodes 不直接改名为 Segment，因为其时长与故事层级不等价。实施提供明确的旧项目归档/重新规划入口，重新规划以旧剧情为输入生成新 Scene/Segment。
- schema_version 防止新旧工具写入错误结构；不维持旧剧集详情 UI。

## 执行步骤

### 阶段 1：领域模型和存储
1. 修改 `dsh-elysium/src/database/paths.js`：集中定义上述项目子路径。AC-1。
2. 新增 `dsh-elysium/src/database/schemas/production.js`：Scene、Segment、素材意图、H3 输入、时间线校验。AC-1/2/3。
3. 修改 `dsh-elysium/src/database/managers/projects.js`、`schemas/projects.js`；新增 `managers/production.js`：新格式、版本读写、旧数据保留、轻量摘要。AC-1/5。
验证：隔离目录测试创建、读写重启、稳定 ID、版本过期与故障恢复；原未提交表单测试不回退。

### 阶段 2：AI 创作与 H3 输入
1. 修改 `dsh-elysium/src/server/projects/workflow.js`、`src/tools/project/workflow.js`、`src/tools/prompts/creation.js`：Scene/Segment/分镜/H3 输入分阶段请求和回写，人工边界。AC-2/3。
2. 新增 `dsh-elysium/src/server/projects/segment-assets.js`：按意图复用或生成缺失必要素材，保存锁定引用；描述足够的文字模式不强制生成图片。AC-2。
3. 修改 `src/models/protocols/comfyui/plan.js`、`src/models/providers/runpod/plan.js`、`workflows/minimax-h3/{graph,profile}.js`：画幅、时长、H3 输入校验；核对实际部署模型与 Base 模式，不将不支持的参考输入静默丢弃。AC-3。
验证：所有 AI 返回可无损 JSON 序列化；未指定素材不伪造 ID；镜头总时长符合片段；人工编辑后的输入与提交内容一致。

### 阶段 3：单段与串行队列
1. 修改 `dsh-elysium/src/server/workflows/videos/service.js`：从当前 Segment 审核版本验证授权，保留现有 jobs 执行记录。AC-4。
2. 新增 `dsh-elysium/src/server/projects/segment-queue.js`：持久化串行队列、单段提交、任务复用、完成后推进与失败暂停；接入启动恢复和状态刷新。AC-4。
3. 修改 `src/index.js`、`src/server/routes/projects.js`、`src/client/api/projects.js`：阶段、详情、队列、状态与版本接口。AC-2/3/4。
验证：两个以上 Segment 严格等待前段完成；内层只启动指定段；重复点击、并发提交、断线及重启不重复启动任务。

### 阶段 4：服务器合片
1. 新增 `dsh-elysium/src/server/projects/composition.js`：根据时间线建立导出任务，记录输入版本、进度及结果引用。AC-5。
2. 新增 `dsh-elysium/src/models/providers/runpod/composition.js` 及对应服务器执行脚本；按现有平台连接接入服务器 ffmpeg，媒体不下载到用户电脑。AC-5。
3. 按需修改 `src/models/managers/runtime/` 和 provider 导出：提供合片能力，不影响其他模型生成。AC-5。
验证：服务器能力检查，小样本裁切/音轨/顺序合成；100 段清单与任务恢复测试。若服务器缺少必要能力，明确报告缺项，不能伪造合片成功。

### 阶段 5：七步 UI 与端到端
1. 替换 `src/client/workbench/episode-ui.js`、`episode-workflow.js` 的旧剧集流程为 `production-ui.js`、`production-workflow.js`，新增 `segment-editor.js`。AC-2/3/4/5。
2. 修改 `src/client/workbench/{projects,project-generation,project-configuration,delivery,styles}.js`、`scripts/loader.js`：七卡片、横向列表、逐级详情、单段/批量按钮、局部更新和虚拟/分页加载；保留四区布局及对话关联。AC-2/4/5。
3. 更新对应测试、README、实施记录及进度。构建打包后重启 Harness。
验证：真实 AI 文本阶段，浏览器逐步审核与切换；视频提交默认模拟，实际视频生成不在 UI 回归中批量消耗计算资源。

## 验收标准
- AC-1：本地结构围绕 Scene/Segment/版本/时间线，旧数据和现有未提交修改保留。
- AC-2：七步页面符合用户流程，素材只在第 4 步及其上游创作编辑，支持 AI 生成和导演修改。
- AC-3：第 5 步展示真正提交 H3 的输入，可修改并审核；实际后端输入不得与审核版本不同。
- AC-4：外层一次提交全队列、内层只提交当前段；串行完成更新、复用、失败恢复及重启恢复正确。
- AC-5：最多 100 个 Segment 可组织、编辑、逐段替换并按时间线导出；使用真实产物 URL 与实际时长。

## 验证结果
已完成实施和专项验证；详细结果、当前模型限制与实际服务器合片证据见 `docs/implement/实施-Scene与Segment创作流程.md`。
