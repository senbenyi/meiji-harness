# AI 原生成人短剧工厂：分阶段执行计划

**日期：** 2026-09-05
**上游依据：** [`ai-native-factory-rollout.md`](./ai-native-factory-rollout.md)（方向与验收标准）
**本文件性质：** 执行计划。只规定**阶段顺序、每阶段职责边界和交付契约**；不在本文件中写业务代码。

---

## 0. 计划的组织原则

上游方案定了"做什么"，本计划补的是"谁做、按什么顺序做、每步做完算什么"。三条硬规则：

1. **阶段之间靠契约衔接，不靠代码可见性。** 每个阶段的交付物里必须有一份下游可以独立消费的契约（JSON schema 或目录约定），否则该阶段不算完成。
2. **每个阶段都写明"不负责什么"。** 阶段膨胀是这类重构最常见的失败方式——闸门做着做着变成 QC 平台，路径契约做着做着变成资产管理。
3. **决策门前不碰 UI。** 上游 §14 已定：第 1–4 项未通过前不进入 UI 重构和导演人格扩展。本计划把它落成 P0–P4，`P4 通过 = 决策门通过`。

---

## 1. 责任矩阵（跨阶段恒定）

这张表是"职责分离"的骨架。后续任何阶段，改动落点必须能对上其中一行；对不上说明阶段划错了。

| 组件 | 唯一职责 | 明确不承担 |
|---|---|---|
| `llm-ai-model` / `services/model_api` | **单个产物的技术真实性**：执行、探针、receipt、能力注册与可用性声明 | 剧集/章节/分镜语义、任务依赖、重试编排 |
| `llm-ai-model` / `scripts` + `workflows` | 模型执行本身 | 成功与否的判定 |
| `dsh-elysium` / `src/infrastructure` | 传输、路径解析、原子写入。**只搬运，不判断** | 质量判定、业务规则 |
| `dsh-elysium` / `src/application` | 编排：依赖拓扑、重试策略、失效传播、**跨产物 QC**（连续性、音画同步、全片时长）；本仓生产链路直连 ComfyUI，因此**每个产物的判定与 receipt 都由本层自产** | 判据阈值的定义（来自契约） |
| `dsh-elysium` / `src/domain` | 状态机、inputHash、失效规则。纯逻辑无 I/O | 任何 I/O 与探针 |
| `dsh-elysium` / `src/presentation` | 展示进度与证据、承接人工确认 | 质量判定、自动放行 |
| `.dsh/skills` | 意图入口，把一句话变成 manifest 请求 | 直接操作页面状态或自我批准 |

**仓库边界判断（需要明确记一笔）：** 输出健康闸门写进 `llm-ai-model` **不违反** CLAUDE.md 的"业务编排不进模型层"。闸门判定的是"这个文件是不是可解码的、非全黑的媒体"，属于模型能力层对自己输出的真实性负责；剧集/分镜/调度才是被禁止下沉的业务编排。

---

## 2. 现状基线（本计划的起点，已核对代码）

| 事实 | 位置 | 影响 |
|---|---|---|
| 成功判定只有"文件存在且非空" | `services/model_api/jobs.py:118` | 全黑图、坏视频、静音音频一律 `succeeded` —— 这是假成功的**唯一源头** |
| size 与 sha256 已计算并落 `result.json` | `services/model_api/jobs.py:121-125` | receipt 骨架已存在，P1 是扩展而非新建 |
| `*_path` 共享路径入参已实现 | `services/model_api/inputs.py:4`、`main.py:98` | **模型侧零上传已具备**，缺口在插件侧 |
| 插件仍向 ComfyUI 上传媒体 | `src/infrastructure/comfyui/engine.js:261` | 零上传指标的实际阻塞点 |
| 插件唯一技术 QC 只查时长与音频 codec | `src/application/production-service.js:260` | 无黑帧、无解码校验、无 receipt 校验 |
| `ffprobe` 封装已存在 | `src/application/production-service.js:187-233` | 插件侧探针可复用，不必新建进程层 |
| 任务放行点只有一处 | `src/application/production-service.js:341-346` | 插件侧闸门只需一个钩子，改动面可控 |
| 产物根是 `/root/autodl-fs/artifacts/projects/api-<job_id>` | `services/model_api/config.py:21` | 与上游方案提的 `/root/autodl-fs/productions/<episode-id>/` **冲突，P2 必须先裁决** |
| 7 个能力平铺注册，无可用性状态 | `services/model_api/capabilities.py:11` | 无法表达"未验证 → disabled"，路由无依据 |

---

## 3. 阶段总览

```text
P0  判据契约 + 样本集        离线，0 GPU        ── 定义"什么叫坏文件"      ✅ 已完成
P1  模型侧闸门 + receipt     llm-ai-model       ── 堵住假成功的源头
P2  目录契约 + 零上传        双侧，契约先行      ── 统一事实源的物理基础
P3  插件侧闸门 + receipt 消费 dsh-elysium        ── 编排层不再盲信 succeeded
P4  单意图端到端基线         联调              ── ★ 决策门
────────────────────────────────────────────────
P5  能力注册与默认路由       llm-ai-model       ── 未验证能力标 disabled
P6  一句话 MVP               skills + 单页      ── 待 P4 实测数据后细化
```

P0–P4 是本计划的详细部分。P5/P6 只给边界与交付物，**具体拆解等 P4 的实测数据**——上游方案的判断是对的：在闸门数据出来前细化 UI 就是围绕错误的复杂度打转。

---

## P0 · 判据契约与样本集 ✅ 已完成

**目标：** 把"坏文件"从形容词变成可执行、可测试、双侧共享的判据。

### 关键决策：判据实现放在哪一侧

三个选项：

| 方案 | 代价 |
|---|---|
| 只在模型侧实现，插件只验 receipt | 插件用本地 ffmpeg 合成的成片（`production-service.js` 的 `assemble`）**从不经过 model API**，这条路上没有 receipt 可验 |
| 两侧各实现一份 | 判据漂移，两边对同一文件给出不同结论 |
| **阈值写成一份共享 JSON 契约，两侧各自实现执行器，用同一套样本集做一致性测试** | 需维护一致性测试，但两侧都能独立判定且结论可比 |

**采用第三种。** 理由是硬约束而非偏好：成片由插件本地 ffmpeg 产生，插件必须具备独立判定能力；而阈值只有一份，漂移风险就落在一致性测试上，是可测的。

### 交付物

1. **`media-gate-contract.json`** —— 阈值与判据的唯一定义源：
   - 图像：最小尺寸、亮度均值下限、亮度方差下限、极值占比上限、可解码
   - 视频：可解码、时长区间、黑帧比例上限、静帧比例上限、帧率下限
   - 音频：codec 白名单、采样率、响度下限、静音比例上限
   - 每条判据带 `id`、`severity`（`fail` / `warn`）、`appliesTo`
2. **样本集**：正常图 / 全黑图 / 空文件 / 坏视频（截断）/ 静音音频，五类，每类附**期望判定结果**
3. **receipt schema v1**：字段对齐上游 §9（`taskId`/`inputHash`/`outputPath`/`outputHash`/`model`/`parameters`/`qc`/`attempt`/`createdAt`），其中 `qc.technical` 的结构由本阶段的契约决定

### 职责分离

- **负责**：判据定义、阈值取值、样本集及其期望结果
- **不负责**：任何探针实现、任何服务改动、语义 QC（依赖模型，属 P5 之后）
- **产出给谁**：P1 和 P3 各自实现执行器时的唯一依据

### 验收

样本集齐备，每个样本的期望判定已写死；契约文件能被两侧解析。**此阶段不需要任何代码跑通生产链路。**

### 交付结果

契约源放在 `llm-ai-model/contracts/`（理由：责任矩阵里单产物技术真实性归模型层）。本仓的跨仓指针见 [`media-gate-contract.md`](./media-gate-contract.md)。

| 产出 | 位置 |
|---|---|
| 判据与阈值（20 条规则 / 16 项指标） | `llm-ai-model/contracts/media-gate-contract.json` |
| receipt schema v1 | `llm-ai-model/contracts/receipt-schema-v1.json` |
| 所有权与实现须知 | `llm-ai-model/contracts/README.md` |
| 样本生成脚本（18 个样本，确定性、不入库） | `llm-ai-model/tests/fixtures/media-gate/generate.sh` |
| 期望判定（4 正例 / 14 反例） | `llm-ai-model/tests/fixtures/media-gate/expectations.json` |

阈值全部由实测推导，未拍脑袋。已用一次性脚本验证 **18/18 样本的期望判定与契约阈值完全自洽**——避免把错的规格交给 P1。契约当前标记 `provisional`：样本是合成的，P4 拿到真实模型产物分布后必须复标定才能升 `stable`。

### 推导过程中发现的三个坑（直接改变了阈值设计）

这三条是 P0 最有价值的产出，写错任何一条闸门都会形同虚设：

1. **signalstats 的 Y 值是 limited/TV range，纯黑是 16 不是 0。** 用 `YAVG <= 0` 判空对全黑图**完全无效**——实测 `image-black.png` 的 YAVG 正好 16.0。契约改用 `YAVG <= 20`，同时覆盖 `0x030303` 近黑（实测 19.0）。
2. **`decodable` 单独用不可靠。** 截断的 PNG 会让 `ffprobe` **返回成功**，但 `width=height=0` 且解不出帧。必须与 `frameCount >= 1`、尺寸下限联合校验。
3. **整片均值会掩盖局部失败。** 前 1 秒正常、后 3 秒全黑的视频，`YAVG_max` 完全正常，只有逐帧占比抓得到（实测 `darkFrameRatio=0.75`）。所有视频判据因此都是**比例**而非均值。

### 超出原定 5 类样本的部分

上游只要求"正常图 / 全黑图 / 空文件 / 坏视频 / 静音音频"5 类。实际做了 18 个，多出来的是**朴素闸门恰好漏掉的那些**：近黑图、纯灰图、纯白图、截断 PNG、静帧视频、局部黑视频、极低音量、缺失音轨。另加 4 个正例做**误杀护栏**——其中 `image-dark-valid.png`（低调打光，YAVG 69.75）专门用来防止暗部阈值定得过紧而误杀合法暗场。

---

## P1 · 模型侧闸门与 receipt ✅ 已完成

**归属：** `llm-ai-model`，仅 `services/model_api/`

**目标：** `succeeded` 从"进程退出 0 且文件非空"升级为"通过 P0 契约的技术判据"。

### 落点

- `jobs.py:118` 的判定替换为契约驱动的探针调用
- `jobs.py:121-125` 的 `result` 扩展为完整 receipt（size/sha256 已有，补探针结果与判据明细）
- 未通过判据 → `failed`，且 `error` 必须携带**失败判据 id**，供后续重试改参数使用

### 职责分离

- **负责**：单个产物的技术真实性判定、receipt 落盘、失败原因结构化
- **不负责**：
  - 重试（重试是编排，属 `dsh-elysium/src/application`）
  - 换模型/换路由（属 P5）
  - 语义 QC（角色/场景/构图满足度，依赖模型）
  - 目录结构变更（属 P2）
- **依赖**：P0 契约 + 样本集

### 验收

`tests/model_api/` 中新增用例：五类样本逐个过闸门，判定与 P0 期望值全部一致。**全黑图和坏视频必须 `failed`。**

### 交付结果

| 产出 | 位置 |
|---|---|
| 契约驱动的探针与判定 | `services/model_api/media_gate.py` |
| 放行点替换 + receipt 落盘 | `services/model_api/jobs.py`（原 `is_file() and st_size` 判定） |
| 能力自声明输出媒体类型 | `services/model_api/capabilities.py` 的 `output` 字段与 `output_kinds()` |
| 样本回归与契约覆盖测试 | `tests/model_api/test_media_gate.py` |

模型侧 12 项测试全部通过。要点：

- **失败也落 receipt。** 失败判据是重试时调整参数的唯一依据，丢掉就等于让重试瞎猜。
- **`taskId` 与 `inputHash` 恒为 null。** model API 不认识编排层的任务身份，由 dsh-elysium 补齐。这是责任分离，不是遗漏。
- 顺带补了 `tests/__init__.py`：Python 3.14 的 `unittest discover` 要求起始目录可导入，既有测试在本机原本跑不起来。

---

## P2 · 目录契约与零上传

**归属：** 双侧，但**契约先定，实现分别做**

**目标：** 一份 manifest 一个事实源；媒体只在服务器共享区流转。

### 必须先裁决的冲突

上游方案写 `/root/autodl-fs/productions/<episode-id>/`，现状是 `/root/autodl-fs/artifacts/projects/api-<job_id>/`（`config.py:21`）。两者语义不同：前者按**业务实体**组织，后者按**任务**组织。

建议：**两者并存，职责分离**——
- `artifacts/projects/api-<job_id>/` 保持不动，是 model API 的**执行工作区**，归模型侧
- `productions/<episode-id>/` 是**业务产物区**，归插件侧，通过引用（路径 + sha256）指向执行工作区的产物或从中固化副本

这样 model API 不需要知道 episode 的存在，符合责任矩阵。若强行让模型侧按 episode 组织目录，就是把业务编排下沉到模型层。

### 交付物

1. 目录契约文档（两个根各自的所有权、生命周期、清理策略）
2. `production-manifest.json` schema v1
3. 插件侧改走 `*_path` 入参：`engine.js:261` 的 `ingestMedia` 上传路径在共享路径可用时旁路

### 职责分离

- **模型侧负责**：接受 `*_path`（已具备）、维护执行工作区
- **插件侧负责**：manifest 落盘、产物引用与固化、不再上传字节流
- **不负责**：资产复用与 bible（属 31–60 天）、manifest 的 Agent 生成逻辑（属 P6）

### 验收

一条链路上传次数为 0；manifest 可被两侧解析；产物路径解析拒绝越界（复用 `inputs.py:4` 的既有校验）。

---

## P3 · 插件侧闸门与自产 receipt ✅ 已完成

**归属：** `dsh-elysium`

**目标：** 编排层不再盲信远端 `succeeded`，并对自己本地产出的成片同样把关。

### 落点

- `production-service.js:341-346`（`stableCopy` 之后、置 `succeeded` 之前）——**唯一放行点**，闸门钩在这里
- `validateAudioFinal`（:260）扩展为契约驱动，复用 `runProcess` / `durationOf` / `audioCodecOf`（:187-233），不新建进程层
- 远端产物：校验 receipt 存在、`outputHash` 与本地文件一致
- 本地成片：跑插件侧执行器（P0 契约的第二个实现）
- 失败判据 id 进 `addIssue` 的 `code`，让重试有可解释变量

### 职责分离

- **负责**：放行决策、receipt 校验、跨产物 QC（全片黑帧、音画同步、连续性时长）、重试策略
- **不负责**：单文件技术探针的**判据定义**（来自 P0）、模型选择（P5）
- **层内边界**：探针执行放 `infrastructure`，放行决策放 `application`，状态转换规则放 `domain`——不要在 `production-service.js` 里同时写这三件事
- **约束**：`pnpm check:source-imports` 必须继续通过

### 交付结果

| 产出 | 位置 | 层 |
|---|---|---|
| 契约内联模块 + 漂移 hash | `src/domain/media-gate-contract.js` | domain |
| 判定规则（纯逻辑无 I/O） | `src/domain/media-gate.js` | domain |
| 探针（只采集不判断） | `src/infrastructure/media/probe.js` | infrastructure |
| 放行决策 + receipt 落盘 | `src/application/media-gate-service.js` | application |
| 两个放行点接线 | `src/application/production-service.js` | application |
| 契约同步脚本 | `scripts/sync-media-gate-contract.mjs` | — |
| 样本回归 + 漂移检测 | `tests/production/media-gate.test.js` | — |
| 闸门拦截的集成测试 | `tests/production/episodes-v2.test.js` | — |

`pnpm typecheck`、`pnpm check:source-imports`（202 文件）、`pnpm check:consumer-types`、`pnpm test`（138 项）全部通过。两侧执行器在**同一套 19 个样本**上判定一致。

### 实施中推翻的一个前提

本计划原先写"插件侧校验远端 receipt"。实际核对代码后发现**这个前提不成立**：插件的生产链路只通过 `comfy` 服务直连 ComfyUI（见 `submitRemoteTask`），**从不经过 model API**，因此这条路上根本没有 receipt 可校验。

修正后的做法：插件对**每一个**产物自产 receipt（`producedBy: "plugin-local"`），并自行判定。这也让 P0 的"两侧各自实现执行器"从"因为成片不过 model API"升级为"因为整条生产链路都不过 model API"——那个决策比当初论证的更有必要。

受影响的下游：模型侧 receipt 的消费要等插件真正走 model API 路由，属于 P2 目录契约与 P5 路由的范畴，不在 P3。

### 另外两个实现取舍

- **契约以 JS 模块内联，不是 vendor 一份 JSON。** `package.json` 的 `files` 不含 `contracts/`，插件安装后读不到外部 JSON。内联随 `src` 打包，运行时零文件 I/O；漂移风险由 `CONTRACT_HASH` 与同步脚本兜住，测试会比对定义源。
- **时长规则不在插件侧驱动。** 契约的 `video.duration` 需要请求侧期望值，而成片时长已由 `validateAudioFinal` 按既有口径校验（`max(2, 5%)`）。两套口径并存会冲突，因此插件不传 `durationSec`，该规则留给模型侧与 P4。

### 验收

`tests/production/` 用例：19 个样本判定与模型侧一致；全黑产物在编排链路上进入 `needs_attention` 并留下带规则 id 的 `QC_GATE_FAILED`；`pnpm typecheck` + `pnpm test` 通过。

---

## P4 · 单意图端到端基线 ★ 决策门

**归属：** 联调，需要真实 GPU 环境

**目标：** 用一个固定短剧意图跑通"规划 → 一个镜头 → QC → 结果"，产出实测数据。

### 职责分离

- **负责**：跑通、记录、判定决策门
- **不负责**：任何新功能。这一阶段**只允许修 bug，不允许加能力**——这是决策门有意义的前提

### 必须量化产出（上游 §11）

- 黑帧 / 空输出泄漏率（**目标 0**）
- 首次通过率、单镜头平均重试次数、自动恢复率
- 一句话到预览的 P50/P95
- 每分钟视频的 GPU 时间

### 决策门判据

- 不再出现"全黑文件却 succeeded"
- 一次链路上传次数为 0
- 失败镜头可单独重做，已通过资产不重复生成

**未通过则回到 P1–P3 修复，不进入 P5/P6。**

---

## P5 · 能力注册与默认路由（待 P4 数据）

**归属：** `llm-ai-model` / `capabilities.py:11`

- **负责**：给每个能力加可用性状态，未经真实输出验证的一律 `disabled`；路由依据显存、时长、队列、历史失败率、QC 分数
- **不负责**：把模型名称暴露给用户；未验证前承诺对白/配音/音乐

---

## P6 · 一句话 MVP（待 P4 数据）

**归属：** `.dsh/skills` + `dsh-elysium/src/presentation`

- **负责**：一句话入口、六状态内部机、单页进度与结果视图
- **不负责**：`approve_consent` / `approve_final` **必须是界面按钮或宿主事件**，不进聊天工具 action 表——防止模型自我批准
- **前置**：P4 决策门通过

---

## 4. 阶段依赖图

```text
P0 判据契约 ──┬──> P1 模型侧闸门 ──┐
              │                    ├──> P4 端到端基线 ★ ──> P5 路由 ──> P6 MVP
              └──> P3 插件侧闸门 ──┤
                       ▲           │
P2 目录契约与零上传 ────┴───────────┘
```

P1 与 P3 在 P0 交付后**可并行**（不同仓库、不同语言、共享契约）。P2 的契约裁决要早于 P3 的实现。

---

## 5. 本计划明确不做

- 不在 P4 之前动 UI、导演人格、创作步骤
- 不把判据阈值散落进代码常量——只有 P0 契约一个源
- 不让模型侧感知 episode / 章节 / 分镜
- 不用"接口返回成功"代替质量证明
