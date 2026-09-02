# dsh-toonflow 插件实施计划

> DeepSeek Harness 的 AI 短剧导演插件。负责从剧情到成片的全流程编排，自身只管状态与资产，生成能力委托给 dsh-comfyui。

## 1. 定位

dsh-toonflow 是一个 **纯编排层插件**：

- 它是 DeepSeek Harness 的 Cordis 插件，不是独立应用；
- 它管理项目、角色、场景、分镜、资产和生产状态；
- 它不调用 LLM（Harness 本身就是 Agent）；
- 它不操作 ComfyUI 工作流 JSON（由 dsh-comfyui 负责）；
- 它不做 UI（由 DSH 前端和 dsh-better-sidebar 提供）。

从三个参考项目中提取的核心设计原则：

| 来源 | 提取 | 不提取 |
|---|---|---|
| Toonflow-app | 剧本→角色→分镜→视频的流水线思想；技能文件驱动 Agent 行为；角色参考图复用策略；分镜状态机 | Electron 桌面端；Express/SQLite；三层 Agent；无限画布；模型供应商管理；向量记忆 |
| dsh-comfyui | 合同驱动的工具设计模式；双重预检；结构化错误码；job 轮询机制；模板 inspect 接口 | HTTP 客户端；工作流扫描；节点分类；LoRA 管理（直接复用，不复制） |
| DSH-better-sidebar | Cordis 插件骨架；`cordis.patch.yml` 注册；settings API 模式；服务注入约定；client/host 分离 | 文件管理器；终端；Git 集成；浏览器沙盒（与 toonflow 无关） |

## 2. 系统边界

```
用户输入剧情
    ↓
DeepSeek Harness Agent（理解、推理、编排）
    ↓
dsh-toonflow（项目状态、角色、场景、分镜、提示词、生产计划）
    ↓
dsh-comfyui（工作流合同、预检、提交、轮询、输出文件）
    ↓
ComfyUI（GPU 推理：T2I / I2I / I2V）
    ↓
FFmpeg（镜头拼接、格式统一）
    ↓
输出 MP4
```

各层职责严格隔离。dsh-toonflow 通过 Harness Agent 编排 dsh-comfyui 工具，两个插件之间 **无硬编码调用**。

## 3. 插件骨架

参照 dsh-comfyui 和 DSH-better-sidebar 的成熟模式：

```
dsh-toonflow/
├── package.json              # @dsh-external/dsh-toonflow, ESM, Cordis 4+ 对等依赖
├── cordis.patch.yml          # DSH 自动注册，默认配置（workspace 路径）
├── lib/
│   ├── index.js              # Cordis 插件入口：apply(ctx, config)，注册工具 + settings API
│   └── lib/
│       ├── project.js        # 项目 CRUD + 目录初始化
│       ├── plan.js           # 结构化内容校验 + 落盘（角色/场景/分镜）
│       ├── assets.js         # 资产登记与路径管理
│       ├── shot.js           # 单镜头状态机 + 更新
│       ├── export.js         # FFmpeg 拼接
│       ├── schema.js         # JSON Schema 定义 + 校验函数
│       └── store.js          # 原子 JSON 读写（tmpfile + rename）
├── skills/
│   ├── screenplay.md         # 编剧规范技能文件
│   ├── character-bible.md    # 角色设定规范
│   ├── storyboard.md         # 分镜设计规范
│   └── visual-prompt.md      # 视觉提示词规范
├── tests/
│   ├── project.test.js
│   ├── plan.test.js
│   ├── shot.test.js
│   └── export.test.js
└── README.md
```

## 4. 工具设计

五个工具，遵循 dsh-comfyui 的 `defineTool` 模式注册。

### 4.1 toonflow_project

项目生命周期管理。

```
action: create | get | list | delete
project_id: string
title?: string          # create 时必填
description?: string
```

- `create`：创建项目目录结构 + project.json；
- `get`：返回项目元数据 + 各实体计数 + 生产进度摘要；
- `list`：列出所有项目（ID、标题、创建时间、镜头完成率）；
- `delete`：删除项目（需确认，保留 output/ 目录）。

### 4.2 toonflow_plan

接收 Agent 生成的结构化内容，负责 **校验、编号、引用完整性检查和落盘**。

```
action: set_characters | set_scenes | set_shots | get_plan | validate
project_id: string
data?: object           # 结构化内容
```

校验规则（硬性，不可跳过）：
- ID 全局唯一且符合命名规范；
- 镜头引用的角色/场景必须已存在；
- `order` 不重复且连续；
- 时长 1～30 秒；
- 每个镜头必须有 imagePrompt 和 videoPrompt；
- 状态只能按允许路径转换；
- 校验失败返回具体字段和原因，不做静默修正。

### 4.3 toonflow_assets

资产登记。将外部生成的文件（dsh-comfyui 输出）绑定到项目实体。

```
action: register | get | list
project_id: string
asset_type: character | scene | shot_image | shot_video
entity_id: string
path?: string           # register 时必填，必须是已存在的本地文件
```

- 路径校验：文件必须存在，路径规范化，禁止跳出项目目录；
- 注册时复制文件到项目 assets/ 目录下的对应子目录；
- 自动更新对应实体的引用路径。

### 4.4 toonflow_shot

单镜头精细操作。

```
action: get | update | retry | batch_status
project_id: string
shot_id?: string
updates?: object        # 部分字段更新
```

状态机：

```
draft → prompt_ready → image_queued → image_ready → video_queued → video_ready
                                  ↘ failed ↙           ↘ failed ↙
```

- `update`：更新提示词、参考图、job ID、输出路径、状态；
- Agent 不得直接写 `image_ready`/`video_ready` 状态——必须同时提供有效的输出路径；
- `retry`：将 failed 状态回退到上一个有效状态，重试计数 +1，上限 3 次；
- `batch_status`：返回所有镜头的状态摘要（用于 Agent 决策下一步）。

### 4.5 toonflow_export

FFmpeg 拼接成片。

```
action: export | preview
project_id: string
shot_ids?: string[]     # 可选，默认按 order 拼接所有 video_ready 镜头
resolution?: string     # 默认 1280x720
fps?: number            # 默认 24
```

- 第一版仅支持顺序拼接 + 统一分辨率/编码/帧率；
- 镜头缺失视频时明确报错，不跳过；
- `preview`：返回将要拼接的镜头列表和预估时长，不执行；
- 保留 FFmpeg stderr 便于排错；
- 输出到项目 `output/` 目录。

## 5. 数据结构

### 5.1 项目目录

```
workspace/
└── projects/
    └── <project-id>/
        ├── project.json        # 元数据
        ├── characters.json     # 角色列表
        ├── scenes.json         # 场景列表
        ├── shots.json          # 分镜列表（含状态）
        ├── assets/
        │   ├── characters/     # 角色参考图
        │   ├── scenes/         # 场景图
        │   └── shots/          # 分镜首帧 + 视频
        └── output/             # 拼接成片
```

### 5.2 镜头结构

```json
{
  "id": "shot-001",
  "order": 1,
  "durationSec": 5,
  "characterIds": ["char-001"],
  "sceneId": "scene-001",
  "description": "女主推门进入昏暗房间",
  "camera": "中景，缓慢向前推进",
  "imagePrompt": "...",
  "videoPrompt": "...",
  "referenceImages": [],
  "imageJobId": null,
  "imagePath": null,
  "videoJobId": null,
  "videoPath": null,
  "status": "draft",
  "retryCount": 0,
  "lastError": null,
  "updatedAt": "2026-09-02T10:00:00Z"
}
```

### 5.3 写入规则

- 所有 JSON 写入采用 tmpfile + atomic rename；
- 写入前路径规范化 + 项目目录边界校验；
- 每次写入更新 `updatedAt` 时间戳。

## 6. 技能文件

四个 Markdown 技能文件，指导 Harness Agent 如何使用 toonflow 工具。参考 Toonflow-app 的技能文件思路，但大幅精简，适配 DSH Agent 交互模式。

### skills/screenplay.md
- 输入：小说片段或剧情梗概（300～3000 字）；
- 输出：结构化角色列表、场景列表、分镜列表；
- 约束：每集 4～12 个镜头，每个镜头 3～8 秒；
- 角色描述必须包含外貌特征（用于后续图片生成一致性）。

### skills/character-bible.md
- 角色命名、外貌、性格、关系的结构化规范；
- 外貌描述必须具体到发型、发色、瞳色、服装、体型；
- 为图片生成一致性服务。

### skills/storyboard.md
- 分镜设计规范：画面构图、镜头运动、角色站位、光影；
- 每个镜头的 description 和 camera 字段的写作规范。

### skills/visual-prompt.md
- imagePrompt 和 videoPrompt 的写作规范；
- 画风前缀模板（固定前缀 + 动态内容）；
- 提示词中必须包含角色外貌关键词（从 character-bible 提取）；
- 负面提示词模板。

## 7. 典型工作流

Agent 使用 dsh-toonflow 的完整流程（每步需用户确认后再进入下一步）：

### Step 1：创建项目 + 生成计划
```
toonflow_project(create, "drama-001", "月光下的告别")
→ Agent 根据 screenplay.md 技能生成角色、场景、分镜
→ toonflow_plan(set_characters, ...)
→ toonflow_plan(set_scenes, ...)
→ toonflow_plan(set_shots, ...)
→ toonflow_plan(validate, ...)  ← 确认引用完整性
```

### Step 2：生成角色参考图
```
Agent 调用 dsh-comfyui generate（T2I，角色全身图）
→ 等待 job 完成
→ toonflow_assets(register, character, char-001, "/output/xxx.png")
```

### Step 3：单镜头验证
```
Agent 调用 dsh-comfyui generate（I2I，角色参考图 → 分镜首帧）
→ toonflow_shot(update, shot-001, { imageJobId, status: image_queued })
→ 等待 job 完成
→ toonflow_assets(register, shot_image, shot-001, "/output/xxx.png")
→ toonflow_shot(update, shot-001, { imagePath, status: image_ready })

Agent 调用 dsh-comfyui generate（I2V，首帧 → 视频）
→ toonflow_shot(update, shot-001, { videoJobId, status: video_queued })
→ 等待 job 完成
→ toonflow_assets(register, shot_video, shot-001, "/output/xxx.mp4")
→ toonflow_shot(update, shot-001, { videoPath, status: video_ready })
```

### Step 4：批量生产
```
toonflow_shot(batch_status, "drama-001")
→ 对所有 draft/prompt_ready 镜头重复 Step 3
→ 失败镜头：toonflow_shot(retry, ...) 最多重试 3 次
```

### Step 5：拼接成片
```
toonflow_export(preview, "drama-001")  ← 确认镜头列表
toonflow_export(export, "drama-001")   ← 输出 MP4
```

## 8. P0 前置条件

开发 dsh-toonflow 前必须先验证：

1. `dsh-comfyui list` 连通且 Anima T2I 模板可用；
2. 在 ComfyUI 中跑通至少一套 I2V 工作流；
3. 通过 `dsh-comfyui import` 导入该工作流；
4. `dsh-comfyui inspect` 正确识别 image、prompt、duration 等槽；
5. `dsh-comfyui generate` 实测 I2V 成功并返回本地路径。

**第一版只锁定一套 I2V 工作流**，不同时适配多个视频模型。

## 9. 实施阶段

### Phase 0：P0 验证（不写 toonflow 代码）
- 验证 dsh-comfyui 连通性；
- 导入并验证 I2V 工作流；
- 记录可用的模板 ID 和槽名。

### Phase 1：插件骨架 + 项目管理
- package.json + cordis.patch.yml；
- Cordis 插件入口 + 配置 schema；
- toonflow_project 工具；
- 原子 JSON 存储层；
- 单元测试。

### Phase 2：计划 + 资产 + 镜头
- toonflow_plan 工具 + JSON Schema 校验；
- toonflow_assets 工具；
- toonflow_shot 工具 + 状态机；
- 四个技能文件。

### Phase 3：单镜头闭环
- 创建项目 → 计划 → 角色图 → 首帧 → I2V → 回写状态；
- 手动走通完整流程，验证 Agent 编排可行性。

### Phase 4：多镜头 + 成片
- toonflow_export 工具；
- 失败重试；
- Harness 重启后状态恢复；
- 4 个镜头的完整短剧闭环。

## 10. MVP 验收标准

全部满足：

1. 输入 300～1000 字剧情，生成 ≥2 角色 + ≥4 镜头；
2. 每个角色有参考图，且在所有镜头中复用；
3. ≥1 个镜头成功从首帧转为视频；
4. 已完成镜头可拼接为 MP4；
5. Harness 重启后项目状态完整，可继续生产；
6. 单镜头失败不污染其他镜头状态；
7. 所有失败返回错误码 + 可执行的恢复建议；
8. 不伪造 job ID、输出路径或成功状态。

## 11. 明确不做

Electron 桌面端 · 无限画布 · 登录/权限/多人协作 · SQLite/MySQL · 模型供应商管理 · 向量记忆 · 三层 Agent · 长篇事件图谱 · 在线素材库 · 多语言 UI · 云端部署 · 多视频模型适配 · 复杂转场/BGM/字幕/TTS。

## 12. 停止条件

出现以下任一情况，停止业务开发，先解决底层问题：

- 无法导入或执行任何 I2V 工作流；
- 角色参考图在连续 3 个镜头中完全无法保持基本身份一致；
- ComfyUI 输出无法稳定保存为本地路径；
- Agent 无法在严格 Schema 下稳定生成有效分镜；
- 单个 5 秒验证镜头的时间或成本不可接受。
