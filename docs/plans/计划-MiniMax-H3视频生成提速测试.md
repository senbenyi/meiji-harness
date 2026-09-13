# MiniMax H3 视频生成提速测试

- 状态：待执行
- 计划测试日期：2026-09-14
- 测试服务器：`ssh veo-comfyui`
- 目标：先解决视频生成慢的问题；本轮不处理文生图片、图片编辑或产品图片入口

## 结论与固定方案

测试采用双档方案，不直接覆盖现有质量模型：

- 质量基线：保留现有 `10Eros_Max_h3_TURBO-hybrid_beta3_int8_convrot_skip_edges.safetensors`。
- 提速候选：增加 `minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors`。
- 文本编码器：两组都使用现有 `qwen3vl_32b_heretic_minimax_h3_nvfp4.safetensors`，本轮不更换。
- VAE：两组都使用现有 video FP16、audio FP32，保持原生音频。
- 测试模式：第一轮只测 T2VA。I2VA、FL2VA、Ref2VA 留到速度方案通过后，不与本轮混测。
- 路由目标：候选通过后供 `preview`、`regular` 使用；`high-quality` 保留 10Eros，提供回退。

这样第一轮只改变视频主模型、采样器和与之配套的注意力工作流，避免同时更换编码器、VAE、分辨率或音频链导致无法归因。

## 已知基线

| 档位 | 模型与规格 | 已验证服务器耗时 | 证据 |
|---|---|---:|---|
| preview | 10Eros，384×512，73 帧，约 3.04 秒，8 步，24fps，有声 | 29.824–32.224 秒 | 三镜头真实生成 |
| regular | 10Eros，576×768，约 5 秒，8 步，24fps，有声 | 61.931 秒 | 一次真实生成 |
| high-quality | 10Eros，864×1184，约 10.10 秒，8 步，RIFE 48fps，有声 | 522.641 秒 | 完整性能基线 |

这些数字不是明日服务器的速度保证。GPU 功率、缓存、模型挂载和运行环境改变后必须重新测量。

## 当前阻塞状态

2026-09-13 只读检查结果：

- SSH 可以登录；
- ComfyUI 0.34.6 源码仍在；
- 8188 没有监听，ComfyUI 进程未运行；
- PyTorch 2.10.0+cu130 当前报告 CUDA 不可用、设备数为 0；
- `/workspace/runpod-slim/ComfyUI/models` 当前没有 H3、Qwen3VL 或 10Eros 权重。

因此明日第一步必须恢复 GPU 分配和模型卷。没有恢复前不下载新模型、不启动 A/B，也不把宿主机 `/proc` 中的显卡信息当作容器可用 GPU。

## 执行清单

### P0：恢复并确认服务器

- [ ] `ssh veo-comfyui` 能登录。
- [ ] 虚拟环境中 `torch.cuda.is_available()` 为 `true`，设备数至少为 1。
- [ ] 实际分配 GPU 为 RTX 3090 24 GB；若型号变化，停止沿用旧基线并记录新型号。
- [ ] 模型卷恢复，能找到现有 10Eros、Heretic 编码器及两个 VAE。
- [ ] ComfyUI 8188 启动，`GET /system_stats` 成功。
- [ ] 队列为空，没有其他用户任务；不取消未知任务。

P0 任一核心项失败时停止性能测试，先修复运行环境。

### P1：冻结可回退基线

- [ ] 记录 ComfyUI commit、PyTorch/CUDA 版本、启动参数和 custom node commits。
- [ ] 记录四个现有模型文件的绝对路径、字节数和 SHA-256。
- [ ] 保存当前 T2VA API 工作流副本，不改原文件。
- [ ] 用现有 10Eros 完成一次 576×768、5 秒基线，确认视频和音频都能播放。
- [ ] 记录 `prompt_id`、服务器总耗时、采样、视频 VAE、音频 VAE和编码耗时。

如果旧基线不能成功，不进入候选测试，避免把环境故障误判为模型差异。

### P2：安装提速候选

- [ ] 下载 [MATLOWAI Fused Turbo INT8 ConvRot](https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot) 的约 21 GB 主模型。
- [ ] 下载或复用发布者对应的 `01_reference_4step_sla` API 工作流。
- [ ] 安装工作流实际引用的 SLA/MAINodes 依赖，逐项记录仓库与 commit，不使用整合包覆盖现有 custom nodes。
- [ ] 继续使用现有 Heretic NVFP4 编码器和现有 VAE。
- [ ] 核对主模型字节数、SHA-256、loader 文件名和节点缺失情况。
- [ ] 不叠加现有 Turbo LoRA、Spectrum 或 DiffAid；候选模型已经融合 Turbo/Mystic，先按发布者最小配方测试。

### P3：候选冒烟测试

- [ ] 使用安全、可肉眼判断动作与声音的成年虚构人物提示词。
- [ ] 先生成一条 384×512、约 3 秒或发布者工作流允许的最小规格视频。
- [ ] 确认 4 步实际执行，而不是只改界面显示。
- [ ] 确认生成 H.264/可播放视频并包含有效音轨。
- [ ] 检查人物、动作、手脸、提示词语义和声音没有明显崩坏。

冒烟失败时保留日志和 `prompt_id`，停止扩大测试；不要通过同时开启多个加速节点碰运气。

### P4：同机 A/B

固定以下项目：

- 同一提示词、种子、576×768、约 5 秒、24fps；
- 同一 Heretic 编码器、video/audio VAE；
- 同一 GPU、功率条件、队列状态；
- 不使用 RIFE、超分或额外后处理；
- 分别记录冷启动和热启动，不把缓存命中组与冷启动组直接比较。

测试顺序采用交替方式：

1. 10Eros 基线 A1；
2. MATLOWAI 候选 B1；
3. MATLOWAI 候选 B2；
4. 10Eros 基线 A2；
5. 10Eros 基线 A3；
6. MATLOWAI 候选 B3。

每次生成后记录：

| 序号 | 模型 | prompt_id | 冷/热 | 总耗时 | 采样 | 视频 VAE | 音频 VAE | 编码 | 峰值显存 | 平均/范围功率 | 成功 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| A1 | 10Eros |  |  |  |  |  |  |  |  |  |  |
| B1 | MATLOWAI |  |  |  |  |  |  |  |  |  |  |
| B2 | MATLOWAI |  |  |  |  |  |  |  |  |  |  |
| A2 | 10Eros |  |  |  |  |  |  |  |  |  |  |
| A3 | 10Eros |  |  |  |  |  |  |  |  |  |  |
| B3 | MATLOWAI |  |  |  |  |  |  |  |  |  |  |

### P5：人工质量检查

隐藏模型名称后比较 A/B 输出：

| 项目 | A | B | 观察 |
|---|---|---|---|
| 提示词跟随 |  |  |  |
| 人脸稳定 |  |  |  |
| 手部和身体结构 |  |  |  |
| 动作连续与物理感 |  |  |  |
| 台词/环境音清晰 |  |  |  |
| 口型与音画同步 |  |  |  |
| 明显闪烁、拖影或重复 |  |  |  |
| 总体可用性 |  |  |  |

人工检查由用户确认。自动成功、文件可解码或存在音轨都不能代替内容验收。

## 通过标准

候选同时满足以下条件才进入 Harness：

1. 三次 576×768、约 5 秒测试全部成功；
2. 候选热启动总耗时中位数比 10Eros 至少降低 30%；
3. 目标为不高于 45 秒，理想目标为不高于 30 秒；
4. 输出规格、帧数、时长和音轨正确；
5. 没有比基线更严重的人物崩坏、语义偏离或音画不同步；
6. 用户确认候选质量可用于预览/常规创作。

如果只达到速度门槛但质量不足，候选只进入 `preview`；如果速度和质量都通过，再进入 `regular`。`high-quality` 本轮不替换。

## 通过后的代码范围

只有 P0–P5 通过后才修改本地代码：

- 新增 `dsh-elysium/src/video/templates/minimax-h3/t2va-fast.json`，保存已验证 API/UI 工作流及来源信息；
- 修改 `dsh-elysium/src/video/graph.js`，仅让 `preview`、`regular` 选择快速模板；
- 将 `dsh-elysium/src/video/profiles/preview.json` 和 `regular.json` 的步骤与已验证 4 步工作流对齐；
- 保留 `high-quality` 和 `standard` 使用现有 10Eros 模板；
- 更新 `dsh-elysium/src/jobs/diagnostics.js` 的模板诊断清单；
- 更新现有视频图构建、模板同步和参数测试；
- 新增实施报告，写入模型 SHA-256、测试 ID、耗时、质量结论和回退方法。

不修改图片模式、无审查编码器、媒体 HTTP 合同、任务恢复和去重逻辑。

## 本地验证

代码接入后执行：

```sh
cd dsh-elysium
COREPACK_HOME=/tmp/elysium-corepack pnpm test
COREPACK_HOME=/tmp/elysium-corepack pnpm build
COREPACK_HOME=/tmp/elysium-corepack pnpm run package:registry
```

随后验证：

- `preview` 和 `regular` 构建出的 graph 使用 MATLOWAI 模型、4 步和对应 sampler；
- `high-quality`、`standard` 仍使用 10Eros，API/UI 工作流没有变化；
- 已完成任务恢复继续读取原保存图，不因默认模板改变而重新提交；
- 在运行中的本机 Harness 分别执行一次 preview、regular、high-quality，核对服务器 `prompt_id`、输出 URL 和实际耗时。

本地测试和打包通过不等于 GPU、浏览器或人工内容验收通过，四类证据分别记录。

## 停止条件

出现以下任一情况立即停止，不继续叠加优化：

- 当前 Pod 没有 CUDA 或模型卷；
- 候选工作流需要覆盖/降级现有 ComfyUI；
- 队列中有未知用户任务；
- 三次候选有一次 OOM、黑屏、静音或损坏文件；
- 性能提升低于 30%；
- 速度提高但用户认为画质不可接受；
- 需要同时更换编码器、VAE 或 GPU 才能继续比较。

## 回退

- 服务器保留现有 10Eros 权重和原 T2VA 工作流，不覆盖、不删除。
- Harness 的 `high-quality`/`standard` 始终保留原路径。
- 快速档异常时只把 `preview`、`regular` 路由切回原 T2VA 模板。
- 不用全仓库 reset/clean，不覆盖测试开始前已有的工作区改动。

## 关联资料

- [两篇文章核心差异](../research/调研-MiniMax-H3两篇文章核心差异.md)
- [文章与 veo-comfyui 现状差异](../research/调研-MiniMax-H3文章与veo-comfyui现状差异.md)
- [生产方案 TOP3](../research/调研-MiniMax-H3生产方案TOP3.md)
- [现有 H3 性能对照](../implement/实施-H3性能对照测试.md)
- [现有快速预览实测](../implement/实施-AI短剧快速预览.md)
- [三档入口与调用链](../implement/实施-视频创作三档入口与全链路.md)

本计划写入时没有修改服务器、下载模型、启动 ComfyUI、产生 GPU 任务或修改现有生产默认值。
