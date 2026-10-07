# 视频放大与 2K：唯一实施指南

> 状态：canonical。代码、schema、manifest 与本文冲突时，以机器契约为准并修正文档。
> 范围：生成内 latent 精修（U1）、独立视频超分（U3）、SeedVR2 恢复、hires 兼容路线与 PDD 二遍加速。

## 1. 当前决策

- 默认交付超分使用 U3 / RealESRGAN；它逐镜处理，输出保持帧数、FPS 与音轨。
- U1 是生成图内的 latent 精修，不是默认提分辨率手段。当前 ctx 2K 图可与链式续接叠用。
- PDD 只能进入 U1 的 pass 2；不得接 pass 1，也不得继续引用旧的 2.53× 口径。
- SeedVR2 是 `video.upscale` 的显式第三实现，细节恢复更强但约为 U3 的 7× 耗时，不做动画默认值。
- hires 1.5× 是零额外权重的兼容路线，只把 16:9 拉回原生 1344×768，不等于 2K。
- Sol-Attn、首遍 PDD、PDD 再叠第三蒸馏/step cache、Lanczos、RTX VSR 均不进入当前生产路径。

## 2. 路线选择

| 路线 | 适用场景 | 优点 | 代价 / 限制 |
| --- | --- | --- | --- |
| U3 / RealESRGAN | 默认交付超分 | 快、稳定、可由 caller 分块 | 主要放大已有纹理，不重建语义细节 |
| U1 / latent 2K | 生成内精修 | 在扩散空间补细节，可保留音轨 | 慢、显存高、denoise 过大会漂移 |
| SeedVR2 | 需要恢复或重塑细节 | 有效宽接近目标 2× | 约 U3 的 7×；动画可能颗粒化、过锐 |
| hires 1.5× | 无额外权重的低成本兼容 | 图简单、风险低 | 只回到原生分辨率，不是 2K |

同一批次先按用途选择路线，不要叠加所有增强：默认 U3；只有明确需要生成内修复时用 U1；只有 U3 无法恢复的素材才显式选 SeedVR2。

## 3. `video.upscale` 契约

Manifest 必须同时说清尺寸来源和显存归属：

```json
{
  "upscale": {
    "sizing": "factor | short-side",
    "chunking": "caller | internal"
  }
}
```

- `factor`：交付尺寸 = 源尺寸 × 倍率，适用于 RealESRGAN。
- `short-side`：由目标短边推导交付尺寸，必须注入 `out_short_side`，不得同时声明 factor。
- `caller`：逐帧独立，runner 可按像素-帧预算分块。
- `internal`：实现自带跨帧先验，外层不得切分，只能在预算超限时告警。
- 输出帧数、FPS、时间顺序与音轨必须不变；音轨不进入模型。
- caller 分块同时切分帧与对应音频区间，合并后做帧数守恒校验。

安全阀：`PIXEL_FRAME_WARN=3e9`，`CHUNK=2e9`。124 帧拆成 4 块的实测额外耗时约 11%。

## 4. U1 latent 2K 参数

当前配方：

```text
steps=20
steps2=6
denoise=0.3
scale=2
seed2=seed+2000000
lock_audio=true
latent_weight=minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors
```

- `resolutionLock` 只锁 `scale`；首遍尺寸仍由比例和档位决定。
- 支持 16:9、9:16、1:1。fast 1:1 的 `maxDurationFramesByRatio=56`；balanced/quality 1:1 尚未验证。
- ctx 链只要求同链首遍采样尺寸一致；二遍交付尺寸可以不同，所以 2K 与续接可以共存。
- 长片注意 32px 网格、OOM 与 denoise 引发的人物漂移。

已验证：56 帧 2688×1536 用时 269.3s，无 OOM、音轨保留，高频大于 0.25 的能量提升 6.6–7×。124 帧有效宽约 1949；长片 grid32 与短片口径不同，仍需眼判。9:16 fast 124 帧 638.5s；1:1 fast 124 帧 992.8s、峰值约 72.6/79.2GiB，另一次运行中断。

## 5. PDD 只加速 pass 2

PDD 参数独立于普通二遍参数：

```text
pdd_nfe=8
pdd_denoise=0.3
```

当前 denoise 0.3 对应 2 个 block。不得复用 `steps2`；ref2v/i2v 使用各自 PDD assets，`requiresNodes` 预检失败时必须 fail-closed。

当前 `-ctx-quality-pdd2-2k` 结论：二遍 3.06×，端到端 124 帧口径 1.66×（2120.9s → 1277.8s），有效宽 1.029×，闪烁略好，PCM md5 一致。表中某次请求 124 帧实际按网格采样/交付为 158 帧，引用耗时时必须同时写出口径。

禁止项：

- PDD 接 pass 1：实测 942s → 1462.3s，且闪烁约 +150%。
- PDD 再叠第三套蒸馏或 step caching：收益与稳定性未证明。
- Sol-Attn：当前 allocator 下两次拖垮共享服务，不进入生产。
- i2v 尚无同口径 A/B，不把 ref2v 结论外推。

## 6. U3 与 SeedVR2 实测

同源 124 帧、1344×768 → 2688×1536：

| 实现 | 用时 | 有效宽 | 结论 |
| --- | ---: | ---: | --- |
| U3 / RealESRGAN ×2 | 69.0s（另一基准会话 155.7s） | 约 2218 / ×1.65 | 默认 |
| SeedVR2 | 483.4s | 2654 / ×1.975 | 仅显式恢复 |

耗时必须带测试会话口径，不能把 69.0s 与 155.7s 混为同一环境。U3 ×4 为 241.3s；248 帧 5376×3072 已验证无 OOM。SeedVR2 真机链路通过，但平坦动画色块可能颗粒化或过锐。

同网格比较中，U3 的有效宽 ×1.65（约 2218）高于 U1 的 ×1.425（约 1915），且便宜约 10.7×。因此“生成内放大天然优于独立超分”不成立。

## 7. 已撤销或失败路线

- 只优化首遍：二遍仍主导总耗时，端到端收益不足。
- Lanczos：约 310s，未获得有效指标收益。
- RTX VSR：出现 OOM / CUDA 崩溃。
- U3 ×4 与 SeedVR2：可能过锐，只能显式选择。
- 高 denoise U1：人物与构图漂移。
- “ctx 不能和两阶段 2K 共存”：已被当前链式清单与实测推翻。

## 8. 验收

每次改配方至少验证：实际输出尺寸、帧数/FPS、音轨 md5 或时长、峰值显存、端到端耗时、有效分辨率、闪烁与人物漂移。单帧、单 seed 或不同会话耗时只能作为局部证据，不能直接升级为默认策略。

复现入口以 `scripts/probes/`、workflow manifest 和 schema 为准；生成物清单不得手改。

