# 调研-MiniMax H3 生产方案 TOP3

> 结论基于 2026-09-13 的公开模型卡、两篇目标文章、仓库已有 3090 实测和当日服务器只读检查。评分用于当前短剧生产场景，不代表通用排行榜。

## 总结推荐

**TOP1：双档生产——保留 10Eros 质量档，新增 MATLOWAI 4 步预览档。** 这是能力、速度、功能和回滚风险最均衡的方式。

**TOP2：纯加速单档——采用 25385 的 MATLOWAI Fused Turbo 4 步方案。** 适合吞吐优先，但必须先在 RTX 3090 上验证画质、声音和真实耗时。

**TOP3：最大开放/精度实验档——采用 25434 的 Ultra Heretic INT8/BF16 编码器路线。** 更适合 48/80/96 GB 级硬件或离线研究，不适合当前 24 GB 服务器作为唯一生产默认。

服务器当前没有可用 CUDA、ComfyUI 未运行且 H3 权重路径为空。以下 TOP3 是恢复 GPU/模型卷后的部署顺序，不是当前已在线能力。

## 评分口径

| 指标 | 权重 | 定义 |
|---|---:|---|
| 低拒绝/本地自主性 | 30% | 本地执行、无在线逐请求过滤、编码器低拒绝倾向；不代表无许可或法律约束 |
| 生成能力/质量 | 30% | 提示词跟随、人物/动作/音画稳定、量化保真；未做同机盲评的项目降置信度 |
| 性能 | 25% | 当前 3090 上预期吞吐、步骤数、显存和 offload；外部异构硬件成绩只作参考 |
| 功能 | 15% | T2VA、FL2VA/I2V、Ref2VA、音频、运动修复、长视频衔接和现有 Harness 接入 |

## 排名

| 排名 | 方案 | 低拒绝/自主性 | 能力/质量 | 性能 | 功能 | 加权分 | 结论置信度 |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | 双档：10Eros 质量档 + MATLOWAI 预览档 | 9.0 | 9.0 | 8.5 | 9.5 | **8.93** | 中；需恢复后同机 A/B |
| 2 | MATLOWAI Fused Turbo 4 步单档 | 9.0 | 8.0 | 9.0 | 9.5 | **8.78** | 中低；3090 数据未确认 |
| 3 | Ultra Heretic INT8/BF16 最大开放档 | 9.5 | 9.0 | 4.5 | 8.5 | **7.95** | 中低；视频收益未同机盲评 |

分数不是已测 benchmark。已确认的本机数字只有现有历史质量档 10 秒、864×1184、8 步总耗时 522.641 秒；其余性能是基于模型结构和异构硬件公开数据形成的待验证排序。

## TOP1：双档生产

### 组合

**质量档（保留历史基线）**

- `10Eros_Max_h3_TURBO-hybrid_beta3_int8_convrot_skip_edges.safetensors`
- `qwen3vl_32b_heretic_minimax_h3_nvfp4.safetensors`
- video VAE FP16 + audio VAE FP32
- 现有 Spectrum、DiffAid、Sol Attention、RIFE 链

**预览档（新增候选）**

- `minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors`
- 先复用同一 Heretic NVFP4 编码器，避免首轮同时改变两个变量
- 发布者的 4 步 `res_multistep`/simple + SLA 标准工作流
- de-rope 作为单独的“运动修复”档，不默认叠加到快速预览

### 为什么排第一

- 保留已验证输出和现有 Harness 绑定，出现画质回退时可快速切回。
- 预览阶段优先利用 4 步融合模型提升吞吐，定稿阶段仍能选择偏质量的 10Eros skip-edges。
- 同时覆盖 T2VA、I2V/FL2VA 和 Ref2VA，不把所有任务压到一套未经本机验证的权重上。
- “无审查”编码器可共享；第一轮 A/B 只比较主模型、采样器和注意力链，归因更清楚。

### 验收门槛

1. 同一提示词、种子和素材，各跑至少 3 次交替顺序测试。
2. 固定 10 秒、864×1184、最终 48fps，分别记录冷/热启动、峰值显存、RAM、S3/S4/总耗时。
3. 人工盲评人物一致性、手脸畸变、运动连续性、台词清晰度、口型、环境音和同步。
4. 快速档只有在中位总耗时至少下降 30%，且严重缺陷率不高于质量档时才进入默认预览路由。
5. Ref2VA 必须用同一组 3–5 张角色参考图单独验收，不能拿 T2VA 结果代替。

## TOP2：25385 的 4 步融合单档

### 适合

- GPU 成本和吞吐优先；
- 希望单一主模型覆盖 FL2VA 与 Ref2VA；
- 接受 Turbo/Mystic 融合模型的画面风格和潜在质量取舍。

### 优点

- 主模型约 21 GB，4 步工作流和 SLA 的组合比当前 8 步链更有明确的性能目标。
- 提供 T2VA/参考/I2V、低显存、AMD、de-rope 等成套工作流。
- 融合 LoRA 避免 ComfyUI 为动态 LoRA 保存整份未修改权重所产生的额外内存。

### 风险

- 76 秒成绩来自 RTX PRO 6000 96 GB，不是 RTX 3090。
- 文章“8 GB 可用”不等于当前分辨率、时长和声音规格下达到生产速度。
- 4 步可能降低细节或改变运动/声音；de-rope 的两阶段流程会重新增加耗时。
- 依赖 SLA、MAINodes 等社区节点，版本冻结和复现成本高于 ComfyUI 原生模板。

## TOP3：25434 的 Ultra Heretic 最大开放/精度档

### 组合优先级

1. 24.55 GiB Ultra Heretic INT8 ConvRot 编码器；
2. 现有 10Eros skip-edges INT8 或官方/社区 pruned INT8 主模型；
3. 48 GB 以上硬件再评估 47.97 GiB BF16 编码器；
4. GGUF Q4/Q3 只用于显存受限实验，不作为最高质量默认。

### 为什么只排第三

- 它最直接改善的是条件编码器拒绝倾向和量化精度，而当前生产瓶颈是视频联合采样与视频 VAE。
- 当前历史方案已经用了 Heretic NVFP4，升级到 INT8/BF16 的实际视频收益未确认。
- 24 GB 3090 必须频繁 offload 24.55/47.97 GiB 编码器，冷启动和 RAM 压力更大。
- 25434 是多路线指南，不是已经固定版本、节点和参数的生产物料清单。

## 不推荐作为前三的方式

- **在 RTX 3090 上把 NVFP4 视频主模型当作默认加速方案：** NVFP4 原生优势面向 Blackwell，Ampere 上不能从文件大小直接推导速度收益。
- **为了 2K 改用官方在线 H3-Context-IR/Regenerate-2K：** 官方链路包含托管服务和内容审核，与“本地自主、低拒绝”的首要目标冲突；本地放大也不等于官方 H3-Regenerate-2K。
- **直接覆盖当前工作流：** 当前服务尚未恢复，且两篇文章都没有给出与现有 3090 同规格的可比结果。

## 推荐执行顺序

1. 恢复当前 Pod 的 GPU 分配、模型卷和 8188 服务，先复现历史质量档。
2. 冻结恢复后的模型 SHA-256、ComfyUI/custom node commit、启动参数和一条基准任务。
3. 新增 MATLOWAI 4 步预览档，不替换质量档。
4. 完成同机 A/B 和人工盲评后再决定预览默认路由。
5. 最后单独比较 Heretic NVFP4 与 Ultra Heretic INT8；只有条件理解或拒绝率有可见收益才升级编码器。

本调研没有安装模型、修改工作流、启动服务或产生 GPU 费用。

## 依据

- [两篇文章核心差异](调研-MiniMax-H3两篇文章核心差异.md)
- [文章与 veo-comfyui 现状差异](调研-MiniMax-H3文章与veo-comfyui现状差异.md)
- [MiniMax H3 官方模型卡](https://huggingface.co/MiniMaxAI/MiniMax-H3)
- [MATLOWAI Fused Turbo INT8 ConvRot](https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot)
- [10Eros Max H3 INT8 ConvRot](https://huggingface.co/cicalooo/10Eros-Max-h3-int8-convrot)
- [Ultra Heretic H3 编码器](https://huggingface.co/ethanfel/Qwen3-VL-32B-Ultra-Heretic-H3-ComfyUI-INT8-ConvRot)
- [Heretic NVFP4 编码器](https://huggingface.co/Momoking/Qwen3-VL-32B-Heretic-MiniMax-H3-NVFP4)
