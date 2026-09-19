# H3 Turbo 短剧生成路线调研

日期：2026-09-19

## 结论

- AC-1 — 已确认：当前 AutoDL 服务可选权重和最近成功视频任务均为 `DasiwaMinimaxH3_dasiwaHybrid4turboV1.safetensors`；实际使用 4 步、Euler/simple、24 fps 模型时间基准。这里的模型身份按服务返回的文件名确认，未做文件哈希来源认证。
- AC-2 — 已确认：服务器节点和本地导演模板包含 T2VA、I2VA、FL2VA、L2VA、REF2VA。项目制作入口仅允许 T2VA/I2VA，不能将这一产品限制解释为 Turbo 模型没有参考能力。
- AC-2 — 未验收：当前 4Turbo v1 权重的多角色、多参考图效果及跨片段身份稳定性。节点存在、模板连线存在不等于模型效果已通过验收。
- AC-3 — 工程建议：固定男女主的多 Segment 短剧优先采用共享角色素材与图片约束；空镜、试稿可用纯文生视频。当前主流程可走“图片生成/编辑模型制作片段首帧 → H3 I2VA”；REF2VA 应作为现有 Hybrid 的优先验证候选，不应先假设必须更换官方 Base。
- AC-3 — 未确认：T2VA、I2VA、REF2VA 在这台服务器、这份权重上的画质排序、成功率和每条可用视频的总成本，本轮没有做同场景对照生成。

## 规格

- 目标：核对用户正在使用的 H3 Turbo 能力，并比较直接文生视频与先生成图片再生成视频对恋爱短剧的适用性。
- 非目标：修改业务代码、升级模型、重启服务、提交新的 GPU 生成任务。
- AC-1：从运行服务及成功执行记录识别实际模型和采样设置。
- AC-2：区分底层节点能力、已接入接口及已经验证的实际效果。
- AC-3：给出角色一致性、画面控制、制作成本方面的路线建议，标明未实测的判断。

## 调用链

```text
项目 Scene / Segment / 分镜
  → production.js：inputValue，只接收 t2va/i2va
  → AutoDL validatePlan：标准入口限制 t2va/i2va
  → AutoDL executeJob → toDirectorPlan → executeDirectorVideo
  → director.js：text / image 组件 → MiniMaxH3Director
  → DaSiWa Hybrid 4Turbo v1 → 4 步采样 → 视频与音频解码

另一条已有低层入口：shots[].mode = reference
  → director.js：reference 组件 → REF2VA
  → 同名 Hybrid 权重 + reference 条件节点
  → 多参考质量尚未验收；现有 shots 字段只接一项 image_path，不能等同完整多图接入
```

## 证据表

| 编号 | 来源 | 支持的结论与边界 |
|------|------|----------------|
| E1 | `ssh veo-comfyui`，ComfyUI `http://127.0.0.1:6016/object_info/UNETLoader` | H3 可选列表返回 `DasiwaMinimaxH3_dasiwaHybrid4turboV1.safetensors`。 |
| E2 | 同服务 `/history?max_items=150`，成功任务 `4af034ac-6874-4d6f-baed-fa95ed0c3d0d`、`12396b7a-b30c-43ff-8abf-457f9e801d21`、`87084fae-3fa8-4df3-b1d8-ee4b962e20dc` | 该权重、T2VA、4 步、Euler/simple、24 fps；前两项 512×864 / 10 秒，后一项 384×512 / 8 秒。执行成功不能证明主观质量。 |
| E3 | 同服务 `/object_info/MiniMaxH3Director`、`/object_info/MiniMaxH3ReferenceToVideo` | Director 模式包括 T2VA/I2VA/FL2VA/L2VA/REF2VA；原生参考节点有 ref_images/ref_videos/ref_video_audios/ref_audios。只确认接口存在。 |
| E4 | `dsh-elysium/src/models/providers/autodl/workflows/minimax-h3/director-templates/workflow_generate_video.json` | text/image/reference 组件使用同名 4Turbo 权重；reference 使用 ref2va_model。 |
| E5 | `dsh-elysium/src/server/projects/production.js:25`、`dsh-elysium/src/models/providers/autodl/workflows/minimax-h3/plan.js:42`、`dsh-elysium/src/models/providers/autodl/index.js:30` | 当前项目输入限制及实际执行路由；不能仅凭旧 profile.js 推断当前实际模型。 |
| E6 | [作者的 Director 文档](https://github.com/darksidewalker/ComfyUI-DaSiWa-Nodes/blob/main/docs/minimax_h3_director.md) | I2VA 以首帧约束，FL2VA 以首尾帧约束；REF2VA 用于引用身份、外观、动作、构图和声音。在线文档不替代当前权重实测。 |
| E7 | [LightX2V Turbo 发布方规格](https://github.com/ModelTC/Minimax-H3-Turbo) | Turbo 路线有 FL2VA/T2VA 和 Ref2VA 不同蒸馏版本；Turbo 表示少步推理路线，不代表仅支持文字输入。其参数及效果不能直接套到 DaSiWa 融合权重。 |
| E8 | `dsh-elysium/src/models/providers/autodl/workflows/image/plan.js:16`、`image/graph.js` | 现有图片路线为 RealVisXL，普通图片接口最多一张参考图；尚不能当作已实现男女主、场景、道具多图联合编辑。 |

## 路线比较

以下为基于输入控制方式的工程判断，不是本机 A/B 测试结果。

| 路线 | 合适用途 | 主要取舍 |
|------|----------|----------|
| 文字 → H3 T2VA | 氛围预览、空镜、无固定角色的独立短片 | 少一个制图步骤；各段只靠文字约束身份，不适合作为固定角色唯一手段。 |
| 共享角色素材 → 图片编辑模型生成场景首帧 → H3 I2VA | 已明确人物站位、服装、道具和构图的剧情片段 | 首帧可先审核；增加制图与校对成本，错误首帧也会传递到视频。只约束首帧不能保证后续镜头不漂移。 |
| 共享角色/场景/道具参考 + Prompt → H3 REF2VA | 同角色跨场景、多人物及不想固定开头构图的片段 | 不一定每段都要预生成首帧；需明确素材身份及保留属性，本项目多图传递与真实效果尚未验收。 |

建议语言模型负责剧情、分镜、素材映射与动作提示；图片生成/编辑模型负责角色定妆及场景首帧；H3 负责动态画面与音频。普通语言模型不能仅靠改写文字就固定角色长相。制作多个首帧时需要支持身份参考的图片编辑能力，不能每段独立文生图后假定是同一人。

角色母版在项目内复用，服装按场景绑定；关键道具与角色只传给实际出现的 Segment。多人、快速转身、遮挡、复杂手部互动、切镜后的脸以及声线连续性仍需检查，参考图不是完全一致的保证。连续镜头可考虑前段尾帧作为后段首帧，但应定期核对母版，避免累计偏差。

## 问题

| AC | 预期 | 实际 | 状态 | 根因 | 证据 |
|----|------|------|------|------|------|
| AC-2 | 区分软件开放范围与模型能力 | 当前 describeVideo 文案把“仅支持文字或单张首帧”与模型描述放在一起，容易误读 | 已确认 | 项目入口限制被混入模型能力说明 | E3–E6 |
| AC-3 | 对照判断哪种路线质量更好 | 只有运行配置、历史成功记录和接口文档，没有同场景对照 | 未验收 | 尚未进行质量评估 | E1–E8 |

## 人工介入

无。本轮为分析；没有更改运行配置或提交生成任务。

## 下一步

若后续实施，先用同一对角色及三个连续场景对照 T2VA、I2VA 和现有 Hybrid REF2VA，比较身份/服装/道具一致性、动作与口型、通过率和含重试的总耗时，再确定默认路线。
