# 调研-MiniMax H3 文章与 veo-comfyui 现状差异

> 核对时间：2026-09-13，Asia/Shanghai。本文把“历史已验证生产基线”和“当前在线状态”分开记录。

## 结论

`veo-comfyui` 历史部署不是两篇文章中的原样方案，而是第三套、更偏质量与短剧生产的组合：**10Eros Turbo Hybrid Beta3 skip-edges INT8 ConvRot + Heretic NVFP4 编码器 + Spectrum + DiffAid + Sol Attention + RIFE**。

历史基线已经证明 10 秒、864×1184、有声、RIFE 48fps 输出能完成，但耗时约 8 分 43 秒。25385 的 4 步融合方案理论上更快、Ref2VA 功能更集中；25434 的 Ultra Heretic INT8/BF16 编码器理论上量化损失更小，但更吃 RAM/显存和加载时间。

当前实时状态则是：**SSH 可达，但模型服务不可用**。8188 未监听、ComfyUI 进程不存在、Torch 报告 CUDA 不可用且设备数为 0、当前挂载路径中没有 H3 权重。不能在恢复 GPU 和权重挂载前把任何新路线称为“已部署”。

## 当前服务器证据

| 检查项 | 2026-09-13 实时结果 | 判断 |
|---|---|---|
| SSH | `ssh veo-comfyui` 成功 | 管理入口可达 |
| ComfyUI 版本 | Git tag `v0.34.6`，commit `a5270a6` | 版本满足当前 H3 原生节点要求 |
| 进程/端口 | 无 `main.py --port 8188` 进程；`127.0.0.1:8188` 拒绝连接 | 服务未运行 |
| CUDA | venv 中 PyTorch `2.10.0+cu130`；`torch.cuda.is_available() == false`；设备数 0 | 当前容器没有可用 GPU |
| 主机可见硬件痕迹 | `/proc/driver/nvidia/gpus` 显示 4 张 RTX 3090 | 只是宿主机信息，不能当作容器已分配 4 卡 |
| H3 权重 | `/workspace/runpod-slim/ComfyUI/models` 未找到 H3、MiniMax、Qwen3VL 或 10Eros 权重 | 当前模型卷未挂载或权重不在该路径，原因未确认 |
| 工作流 | 留有 T2VA、I2VA、FL2VA、R2VA、Loop 五类 H3 工作流 | 只有图，不等于具备执行能力 |
| 自定义节点 | Spectrum、Sol Attention、RIFE、DiffAid 等目录仍在 | 软件组件部分保留 |

以上检查没有启动服务、没有修改服务器，也没有提交 GPU 任务。

## 历史已验证生产基线

仓库现有实测文档记录了以下配置：

| 项目 | 已验证值 |
|---|---|
| GPU | 单张 RTX 3090 24 GB |
| ComfyUI / PyTorch | 0.34.6 / 2.10.0+cu130 |
| 主模型 | `10Eros_Max_h3_TURBO-hybrid_beta3_int8_convrot_skip_edges.safetensors` |
| 文本编码器 | `qwen3vl_32b_heretic_minimax_h3_nvfp4.safetensors` |
| VAE | video FP16 / audio FP32 |
| 请求 | 10 秒，864×1184，243 个生成帧，8 步 Euler/simple |
| 后处理 | RIFE 243→485 帧，H.264 + AAC，48fps |
| 端到端服务耗时 | 522.641 秒 |
| 主要瓶颈 | 联合采样 425.855 秒；视频 VAE 77.547 秒；合计约 96.3% |

历史结果的限制：只验证了该 T2VA 场景，没有完成三套模型在同一提示词、种子、分辨率、帧数和功率条件下的盲评，因此下表的质量比较含“未确认”项。

## 三套路线逐项比较

| 维度 | veo-comfyui 历史方案 | 25385 加速方案 | 25434 开放方案 |
|---|---|---|---|
| 视频主模型 | 10Eros Turbo Hybrid Beta3 skip-edges INT8，约 22.5 GB | MATLOWAI Fused Turbo INT8，约 21 GB | 多选；GGUF、官方 INT8/NVFP4 或其他社区模型 |
| 编码器 | Heretic NVFP4，约 15.7 GB | 同一 Heretic NVFP4 路线 | Ultra Heretic INT8 24.55 GiB 或 BF16 47.97 GiB |
| 拒绝倾向 | 低；已采用社区 Heretic 编码器 | 与当前编码器路线基本相同 | BF16/INT8 路线量化更少，但实际视频差异未确认 |
| 速度 | 已测 10 秒约 522.6 秒 | 4 步 + SLA，发布者在 96 GB 卡测约 76 秒；3090 未确认 | 低显存文章示例约 8–15 分钟/5 秒 480p；强依赖具体量化 |
| 画质取向 | skip-edges 保留边界块 BF16，偏质量与稳定 | 融合 Turbo/Mystic，偏速度和运动平滑 | BF16/INT8 可偏最大精度，低量化 GGUF/NVFP4 会增加画质风险 |
| T2VA/FL2VA | 有工作流，T2VA 已实测 | 支持 | 取决于选中的任务模型 |
| Ref2VA | 有 R2VA 工作流，但当前权重组合的实时可执行性未确认 | 融合进同一主模型，工作流明确 | 官方/社区 Ref2VA 可选，通常需选对独立任务权重 |
| 运动修复 | Spectrum、DiffAid、Sol、RIFE | 可选 de-rope、DyRoPE、Motion Adapter | 没有固定统一方案 |
| 维护复杂度 | 中高，自定义节点较多 | 中高，但发布者给出成套工作流 | 最高，需要自行解决格式和工作流组合 |
| 3090 匹配度 | 已历史实测 | INT8 主模型匹配；NVFP4 编码器在 3090 的性能需重测 | INT8/GGUF 可用；NVFP4 主模型不适合作为 3090 首选 |

## 与当前生产链的实际差别

### 对比 25385

25385 不是简单替换一个 checkpoint。它会同时改变：

- 主模型：10Eros skip-edges → MATLOWAI Fused Turbo；
- 采样：8 步 Euler/simple → 4 步 `res_multistep`/simple；
- 注意力：现有 Sol/Spectrum 链 → 发布者的 SLA 配方；
- 功能：单一融合权重直接覆盖 FL2VA/Ref2VA；
- 运动修复：由 Spectrum/RIFE 主导 → 可选 de-rope 二阶段修复。

这条路线最有希望显著降低采样耗时，但发布者的 96 GB/16 GB 条件与当前 3090 不同，必须做本机 A/B 后才能给生产 SLA。

### 对比 25434

当前历史方案已经使用了 Heretic NVFP4 编码器，所以与 25434 所追求的“降低拒绝倾向”并非从零开始。25434 真正可能带来的升级是：

- 换成 24.55 GiB Ultra Heretic INT8，减少一次 NVFP4 再量化；
- 或在更大显存设备上使用 47.97 GiB BF16 编码器；
- 增加 GGUF/原生任务模型作为实验分支。

这些变化更偏精度和研究，不直接解决当前 522.6 秒的主要瓶颈。历史测量中联合采样和视频 VAE 占 96.3%，而文本编码在基线中命中缓存；只换编码器不能推导出显著端到端加速。

## 生产判断

1. 当前第一阻塞不是模型选型，而是 GPU 分配/挂载和权重恢复。
2. 恢复后不建议覆盖现有 10Eros 路线；应保留为质量基线，并并行加入 25385 的 4 步融合候选。
3. 25434 的 Ultra Heretic INT8/BF16 只适合做编码器精度 A/B，不适合优先替代整套生产链。
4. 所有比较必须固定提示词、参考素材、种子、帧数、分辨率、输出帧率、功率条件和缓存状态；分别记录冷启动与热启动。

## 本地复查入口

- [H3 性能对照测试](../implement/实施-H3性能对照测试.md)
- [H3 服务器执行流程与耗时](调研-H3服务器执行流程与耗时.md)
- [RunPod 模型服务说明](../../runpod/README.md)

## 外部依据

- [MiniMax H3 官方模型卡](https://huggingface.co/MiniMaxAI/MiniMax-H3)
- [MATLOWAI Fused Turbo INT8 ConvRot](https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot)
- [10Eros Max H3 INT8 ConvRot](https://huggingface.co/cicalooo/10Eros-Max-h3-int8-convrot)
- [Ultra Heretic H3 编码器](https://huggingface.co/ethanfel/Qwen3-VL-32B-Ultra-Heretic-H3-ComfyUI-INT8-ConvRot)
- [Heretic NVFP4 编码器](https://huggingface.co/Momoking/Qwen3-VL-32B-Heretic-MiniMax-H3-NVFP4)
