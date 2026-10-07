# 视频连续性：形状、参考绑定与链式续接

> 状态：canonical。代码、schema、manifest 与本文冲突时，以机器契约为准并修正文档。

## 1. 当前结论

- `type` 必填，只允许 `r2v` 或 `i2v`；Skill 和工具契约不暴露模型名。
- r2v 负责角色/环境参考绑定；i2v 负责首帧或首末帧端点锚定。
- `continuity_from` 与 shape 正交；只有声明 `manifest.chain` 的实现能起链或续接。
- 续接负责“接着走”，不负责“认人”；r2v 续接仍须传角色卡/场景卡。
- 同场景逐镜续接；跨场景另起链，必要时用 i2v 双端转场。
- 角色参考默认单视图；三视图拼图和图内标签禁止。

## 2. 输入真值表

| 参数 | r2v | i2v |
| --- | --- | --- |
| capability | `video.reference2video` | `video.image2video` |
| `ref_nodes` | 可选；缺失告警 | 禁止 |
| `first_frame_node` | 禁止 | 普通 i2v 必需；链式 i2v 允许传入但 Motion Context 会丢弃 |
| `last_frame_node` | 禁止 | 可选；链式 i2v 保留 |
| `continuity_from` | 允许，但必须选 r2v chain manifest | 允许，但必须选 i2v chain manifest；普通实现显式拒绝 |

跨 shape 续接允许；运行时只校验上一镜 latent 的分辨率、通道和链式元数据，不要求上一镜与当前镜 shape 相同。

## 3. 选择规则

1. 同场景首镜：链式 r2v，不传 `continuity_from`，建立新链。
2. 同场景后续镜：链式 r2v + 上一镜节点；角色卡、场景卡照常传入。
3. 跨场景：下一场景首镜另起链；默认用 i2v 双端转场连接两场景视觉端点。
4. 下一场景首镜尚未就绪时，`r2v + continuity_from` 只能作为草稿，不算正式跨场景方案。
5. 锚点式重渲：普通 i2v 会切断 latent 链；链式 i2v 可继续成为下游来源。
6. 一次多镜、LTX 原生 multi-shot、H3 multiframe 仍是候选，不是默认生产路径。

H3 Ref2VA 是身份绑定的一等能力；LTX 依赖 IC-LoRA / Ingredients / MSR。该判断来自机制，不是本机同 prompt、图、seed 的公平质量 A/B。

## 4. Manifest 与运行时契约

```json
{
  "chain": {
    "source": "clip-latent",
    "sampleExtra": 22,
    "lengthGrid": [17, 5]
  }
}
```

- 关键参数：`context_clip_index`、`save_clip_index`。
- 未传 `continuity_from`：Load=0 起链；续接：Load=上一镜 `params.clipIndex`，Save=Load+1。
- chain manifest 使用 `priority: -100`，不得隐式成为默认；依赖通过 `requiresNodes` 预检。
- runner 不认识模型名；补帧、长度网格与注入点都来自 manifest。
- 请求 124 帧：加 22 帧后按 `17k+5` 上取整，采样 158 帧，裁剪后交付 136 帧；请求、采样、交付长度都必须写入节点。
- 同链首遍采样尺寸必须一致，二遍交付尺寸可以不同，因此链式续接可与 2K 二遍叠用。
- 上一节点不存在、非视频、缺 `clipIndex`、非 chain 实现、尺寸/通道不符时显式报错，不静默降级。
- 跨会话槽位随机 1–9000、会话内递增、上限 9999；这是概率规避，不是所有权隔离。

## 5. 规划与返工

镜头表必须显式记录 `续接`：`起链 | 接 S0x | 锚定 S0x↔S0y`。生成阶段不得临时猜测。

- 场景首镜起链；`接 S0x` 应引用相邻上游镜。
- 转场只放在场景边界。
- 续接继承约 22 帧/0.9s 画面与约 1s 音频；新角色、对白和烧录字幕放到第 1 秒后。
- 上游镜重渲会产生新 latent；下游依赖镜必须按链顺序重渲并更新节点 id。
- 要求开场全新画面时必须起新链。

## 6. 角色参考规则

- 默认单视图；需要多角度时可分槽传正/侧/背，不把三视图拼进一张图。
- 图内标签、水印、乱码都可能被模型当作内容生成，不能靠否定 prompt 清除。
- 三视图 A/C/E/F 均出现多角色；文字 prompt“只出现一只”无效；英文标签会烙入画面。
- 单视图 B/G 成功；三槽 H 成功；单正面 J 转身稳定，三槽 K 不优于 J。
- workflow `ImageCrop` I 与单视图 B 的 diff=0.0；`ref_image_size=max` D 与 B 的 diff=0.0，不能作为免费一致性提升。
- IPAdapter/InstantID 在当前机器无节点，不是可执行方案。

## 7. 实测证据

环境：ComfyUI 0.35.2、Motion Context 0.6.2、sm_80 单卡。

| 档位 | 接缝像素 MAD | 非续接 MAD | 接缝音频 | 非续接音频 | 接缝→非续接响度 |
| --- | ---: | ---: | ---: | ---: | ---: |
| fast 832×480 | 7.016 | 67.559 | 0.391 | 0.060 | +0.69→-19.83dB |
| balanced 1344×768 | 2.631 | 32.350 | 0.534 | 0.017 | -0.77→-8.78dB |
| balanced-pdd | 3.436 | 51.176 | 0.305 | 0.065 | -0.26→-14.62dB |
| quality | 2.605 | 35.546 | 0.552 | 0.096 | +0.09→-24.04dB |

裸机制验证：像素路径 MAD 11.1 vs 57.4；latent 路径 MAD 3.2；音乐包络 0.87 vs 0.25，1s 宽带 0.60 vs 0.17。噪声型声景的相关系数无判别力，只能辅助查看响度台阶。

i2v fast 链式机制：load/save 1259→1260，请求 124 / 采样 158 / 交付 136；首帧 anchor 丢弃、末帧保留。对照 MAD 8.473 vs 4.345，1s 音频 0.157 vs 0.313，包络 -0.198 vs -0.082，响度 +7.18 vs -10.13dB。该数据只证明机制可运行，不证明优于普通 i2v；其余档位仍待验证。

上述结论只证明接缝连续性改善，不代表整体画质提升。

## 8. 已撤销或未落地

- 三视图拼图、图内英文标签、“只出现一个”否定 prompt：实测失败。
- `ref_image_size=max`：当前实验无效。
- R1 `ref_videos`：只在语义上模仿上一镜，不是真续接。
- R2 Add Guide：能锚画面但不续音频，并引入解码→编码漂移；未跑。
- R4 混合 checkpoint、R5 multiframe：未跑。
- `balanced-pdd-sol`：`CUDA_ERROR_INVALID_VALUE ... cuMemFreeAsync`，带/不带 Motion Context 都硬崩，已撤销。
- “i2v 不支持链式 latent”只适用于普通 i2v；链式 i2v 已落地。

## 9. 风险与复现

尚未验证：超过 5 镜长链的画质/音质衰减、跨会话槽位冲突、缓存污染、freeze/color drift、i2v 其余档位、LTX/H3 公平 A/B。

原始本地产物已清理，因此本文数据可用于决策追溯，但不能声称仓库内可直接复核。复现入口以 H3 模板生成器、manifest 生成器、`bench-chain-continuity.mjs`、shape smoke 与当前 schema 为准；生成物不得手改。

