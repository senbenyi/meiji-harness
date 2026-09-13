# 调研-MiniMax H3 两篇文章核心差异

> 调研日期：2026-09-13。本文比较的是两篇文章实际链接的模型、工作流和部署路线，不把文章标题中的宣传语当成实测结论。

## 结论

- [25385](https://www.freedidi.com/25385.html) 的核心是 **一套偏生产加速的固定组合**：MATLOWAI 约 21 GB 的 Fused Turbo INT8 ConvRot 主模型、4 步工作流、SLA 稀疏注意力、可选 de-rope、I2V 和 Ref2VA，再用 Heretic NVFP4 文本编码器降低显存占用。
- [25434](https://www.freedidi.com/25434.html) 的核心是 **一份偏“开放性优先”的选型总览**：重点介绍 Ultra Heretic 文本编码器、GGUF/INT8/NVFP4 多种量化、官方原生与社区工作流，但没有收敛成一套唯一、可复现的生产配置。
- 如果只在二者中选一套作为当前 24 GB 级 ComfyUI 生产候选，**25385 更合适**；如果目标是研究最低拒绝率、不同量化和最大精度，25434 更适合作为实验资料。

## 两篇文章分别在解决什么问题

| 维度 | 25385：加速模型 | 25434：最开放模型 |
|---|---|---|
| 首要目标 | 4 步生成、降低显存、提供完整工作流 | 解释 H3 能力并罗列“越狱”编码器及多种量化路线 |
| 主模型 | `minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors`，约 21 GB | 没有唯一主模型；正文混合 GGUF、官方 INT8、NVFP4 等选择 |
| 文本编码器 | `qwen3vl_32b_heretic_minimax_h3_nvfp4.safetensors`，约 15.7 GB | Ultra Heretic BF16 约 47.97 GiB，或 INT8 ConvRot 约 24.55 GiB，也提到更小量化 |
| “无审查”落点 | 主要发生在 Heretic NVFP4 文本编码器；主模型是 Turbo/Mystic 融合路线 | 主要发生在 Ultra Heretic 文本编码器；BF16/INT8 比 NVFP4 更少量化 |
| 推理加速 | 4 步 Turbo、SLA、融合权重；模型卡在 96 GB 卡上报告 10 秒 1152×640 单遍约 76 秒 | 低显存主要依赖量化和 offload；文章自己的 8–12 GB 示例约 8–15 分钟/5 秒 480p |
| 功能覆盖 | T2VA、I2V/FL2VA、Ref2VA、de-rope、AMD/低显存工作流 | T2VA、I2V、V2V、Ref2VA 的概念和多种部署入口，但组合兼容性由用户自己判断 |
| 适用人群 | 想快速落成 ComfyUI 生产工作流的人 | 想研究编码器拒绝行为、量化和官方/社区生态的人 |

## 核心技术差异

### 1. 二者所谓“无审查”主要不是同一个视频主模型

H3 使用 Qwen3-VL-32B 的前 50 层作为条件编码器。两篇文章都主要通过社区修改过的 Heretic/abliterated 文本编码器降低提示词拒绝，而不是证明 H3 视频 Transformer 本身完全没有安全或能力边界。

- 25434 链接的 [Ultra Heretic H3 编码器](https://huggingface.co/ethanfel/Qwen3-VL-32B-Ultra-Heretic-H3-ComfyUI-INT8-ConvRot) 提供 BF16 和 INT8 ConvRot。其模型卡报告源模型在一组 100 条测试中的拒绝数由 99 降到 4，但同时明确说明不能保证消除所有拒绝，并可能影响质量。
- 25385 链接的 [Heretic NVFP4 编码器](https://huggingface.co/Momoking/Qwen3-VL-32B-Heretic-MiniMax-H3-NVFP4) 是上述路线的再次量化版本，体积更小，但继承上游 INT8 舍入误差，且其验证硬件是 Blackwell。

所以“无审查”应理解为 **本地推理没有在线平台逐请求拦截，且条件编码器拒绝倾向更低**，不等于没有模型能力边界，也不免除 [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE) 和所在地法律责任。

### 2. 25385 的优势来自整套推理配方，不只是量化

[MATLOWAI Fused Turbo 模型卡](https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot)说明其将 FL2VA、Ref2VA delta、Turbo 和 Mystic 权重合并后再做 INT8 ConvRot，并提供 4 步 SLA 工作流。它把多个功能放进同一个约 21 GB 主模型，减少切换模型和动态 LoRA 备份的成本。

模型卡中的 76 秒成绩来自 RTX PRO 6000 96 GB、1152×640、243 帧、4 步、全部驻留显存；这不能直接外推到 RTX 3090，更不能据此证明 8 GB 显卡也有同等速度。模型卡只给出 16 GB 受限环境约 59–65 秒的特定模拟结果，没有给出真实 8 GB 卡的同规格生产数据。

### 3. 25434 的优势是选择多，代价是容易把不兼容选项拼在一起

25434 同时介绍 GGUF、INT8 ConvRot、NVFP4、官方原生和社区工作流。它适合建立知识地图，但部署时必须先固定：

1. FL2VA 还是 Ref2VA；
2. Ampere/Ada 还是 Blackwell；
3. 原生 ComfyUI loader、GGUF loader 还是特定量化 loader；
4. 精度优先还是显存/速度优先。

例如 [NVFP4 模型卡](https://huggingface.co/lilcheaty/MiniMax-H3-NVFP4)明确指出 NVFP4 需要 Blackwell 原生支持，在 Ampere 等旧架构上属于模拟路径，应优先考虑 INT8 ConvRot。把“文件更小”直接等同于“RTX 3090 更快”是不成立的。

## 对文章宣传点的校正

| 宣传点 | 可确认事实 | 生产判断 |
|---|---|---|
| “8 GB 显存即可” | 依靠 CPU/RAM offload、低分辨率、少帧数和量化，有机会启动 | 没有两篇文章同规格、真实 8 GB、含音视频全流程的充分证据，不应写入生产 SLA |
| “最高 2K” | 官方系统支持 2K，但官方文档把本地 H3-Base 768p 和 H3-Regenerate-2K/API 分成不同阶段 | 本地开源 H3-Base 不能直接等同于完整的官方 2K 在线链路 |
| “完全无审查” | 本地权重没有在线平台请求过滤；社区编码器降低拒绝率 | 不能证明零拒绝、零限制或零法律/许可约束 |
| “功能都在一个模型里” | MATLOWAI 融合模型覆盖 FL2VA 与 Ref2VA；官方模型仍分 FL2VA、Ref2VA 两个任务族 | 必须以具体 checkpoint 和工作流连线为准 |

## 选择结论

- **生产速度、功能覆盖、部署收敛：选 25385 路线。**
- **最低拒绝倾向、BF16/INT8 编码器精度研究：选 25434 路线。**
- **当前 RTX 3090：优先 INT8 ConvRot 主模型；NVFP4 只作为已实测可用的编码器方案，不把 Blackwell 基准当作 3090 性能依据。**

## 依据

- [MiniMax H3 官方模型卡](https://huggingface.co/MiniMaxAI/MiniMax-H3)
- [MiniMax H3 官方仓库](https://github.com/MiniMax-AI/MiniMax-H3)
- [25385 原文](https://www.freedidi.com/25385.html)
- [25434 原文](https://www.freedidi.com/25434.html)
- [MATLOWAI Fused Turbo INT8 ConvRot](https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot)
- [Ultra Heretic H3 编码器](https://huggingface.co/ethanfel/Qwen3-VL-32B-Ultra-Heretic-H3-ComfyUI-INT8-ConvRot)
- [Heretic NVFP4 编码器](https://huggingface.co/Momoking/Qwen3-VL-32B-Heretic-MiniMax-H3-NVFP4)
- [MiniMax H3 NVFP4](https://huggingface.co/lilcheaty/MiniMax-H3-NVFP4)
