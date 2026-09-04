# 产品能力对齐审核：Toonflow-app vs llm-ai-veo

> 基准产品：Toonflow-app（完整 AI 短剧生产工具链）
> 现有能力：llm-ai-brain（视频反推） + llm-ai-model（视频/图片生成）
> 审核日期：2026-09-04

## 功能对齐总表

### 1. 剧本/故事

| Toonflow 功能 | 状态 | 对应位置 |
|---|---|---|
| 小说导入 & 事件提取 | ❌ 缺失 | — |
| 故事骨架生成（三幕、冲突、人物弧线） | ❌ 缺失 | — |
| 改编策略（删减、压缩、世界观呈现） | ❌ 缺失 | — |
| 付费卡点规划 | ❌ 缺失 | — |

### 2. 导演

| Toonflow 功能 | 状态 | 对应位置 |
|---|---|---|
| 分镜场景拆解（情绪强度、对白分布） | ❌ 缺失 | — |
| 场景转场设计（动作桥、情绪接力） | ❌ 缺失 | — |
| 导演手册（视觉风格偏好存储） | ❌ 缺失 | — |
| 首帧规划 & 视觉钩子 | ❌ 缺失 | — |
| 镜头分解（机位、走位、对白节奏） | ❌ 缺失 | — |
| 角色在场验证（防角色消失） | ❌ 缺失 | — |

### 3. 角色

| Toonflow 功能 | 状态 | 对应位置 |
|---|---|---|
| 角色档案生成（从剧本提取） | ❌ 缺失 | — |
| 角色基础图生成 | ✅ 已有 | model: `image-generate-qwen-t2i/run_task.sh` |
| 角色衍生状态（换装、变身、特效） | ❌ 缺失 | — |
| 角色一致性锚定 | ⚠️ 部分 | brain: 42 帧 anchor 提取（反推）；model: 无正向一致性控制 |
| 角色资产库 | ❌ 缺失 | — |

### 4. 画面生成

| Toonflow 功能 | 状态 | 对应位置 |
|---|---|---|
| 资产自动发现（从剧本提取需求） | ❌ 缺失 | — |
| 批量资产生成 | ❌ 缺失 | — |
| 提示词生成 & 润色 | ⚠️ 部分 | brain: `run_video_analyze.py` 从视频反推提示词（非正向） |
| 多模型支持 | ⚠️ 部分 | model: factory/route.sh 有路由框架，仅启用 qwen-t2i |
| 场景/道具图生成 | ❌ 缺失 | — |
| 图片资产管理 | ❌ 缺失 | — |

### 5. 视频生成

| Toonflow 功能 | 状态 | 对应位置 |
|---|---|---|
| 分镜→视频工作流 | ⚠️ 部分 | model: block JSON → Wan2.2 Remix，无分镜编辑 |
| 多视频模型支持 | ⚠️ 部分 | model: factory 框架有，仅启用 wan22-remix |
| 单镜头视频生成 | ✅ 已有 | model: `run_short_task.sh` |
| 长视频 SVI 拼接 | ✅ 已有 | model: `run_long_task.sh` |
| 批量视频生成 | ⚠️ 部分 | model: pipeline 支持 episode 级批量，无并行调度 |
| 视频画布/轨道编辑 | ❌ 缺失 | — |

### 6. 音频

| Toonflow 功能 | 状态 | 对应位置 |
|---|---|---|
| TTS 配音 | ❌ 缺失 | — |
| 音效/BGM | ❌ 缺失 | — |
| 音频绑定到场景/角色 | ❌ 缺失 | — |

### 7. 后期

| Toonflow 功能 | 状态 | 对应位置 |
|---|---|---|
| 逐帧编辑 | ❌ 缺失 | — |
| ComfyUI 高级特效 | ✅ 已有 | model: workflow JSON + ComfyUI API |
| 时间线多轨合成 | ❌ 缺失 | — |
| 视频导出 | ⚠️ 部分 | model: 输出 MP4，无合成/字幕/混音 |

### 8. 质检/审核

| Toonflow 功能 | 状态 | 对应位置 |
|---|---|---|
| 故事质量审核（三密度、红线） | ❌ 缺失 | — |
| 分镜质量审核（连续性、180 度线） | ❌ 缺失 | — |
| 结构化 QC 报告（评级、修复建议） | ❌ 缺失 | — |
| 产物格式/schema 验证 | ✅ 已有 | brain + model: `validate_artifacts.py` |

---

## 四象限分类

### 必须补齐 — 缺了产品流程跑不通

| 功能 | 理由 |
|---|---|
| 导演：分镜场景拆解 | 从剧本到画面的核心桥梁，没有它无法正向生产 |
| 导演：镜头分解（机位、走位、时长） | 直接决定视频 prompt 质量，当前靠人工或反推补齐 |
| 角色档案生成 | 角色图生成能力已有，缺少从剧本自动提取角色描述的上游 |
| 提示词正向生成 | brain 只做反推，正向生产时无自动 prompt 生成链路 |

### 值得做 — 显著提升质量/效率

| 功能 | 理由 |
|---|---|
| 导演手册（风格偏好存储） | 低成本，一个 YAML/JSON 即可，保证多 episode 风格一致 |
| 角色一致性正向锚定 | 当前 anchor 帧是反推产物，正向生产需要独立的一致性方案 |
| 场景转场设计 | 提升长视频连贯性，可在 block JSON 层面增加转场标注 |
| 故事骨架生成 | LLM 擅长的任务，投入小收益大 |
| 批量资产生成 | factory 框架已有，补并行调度即可 |
| TTS 配音 | 成熟外部 API（如 CosyVoice），集成成本低 |

### 不需要 — 架构/场景不适用

| 功能 | 理由 |
|---|---|
| Web UI / 画布编辑器 | llm-ai-veo 是 CLI + Harness 驱动的管线，非桌面应用产品 |
| Electron 桌面端 | 同上，非面向终端用户的产品形态 |
| SQLite 项目数据库 | 当前用文件系统 + JSON 契约管理产物，够用且更透明 |
| 多语言 UI 本地化 | 无 UI，不适用 |
| 付费卡点规划 | 运营层面功能，不属于生产管线 |

### 代价太大 — 放弃或等外部方案成熟

| 功能 | 瓶颈 |
|---|---|
| 角色衍生状态（换装/变身） | 需要精细 ControlNet 或 IP-Adapter，当前模型不支撑稳定输出 |
| 逐帧编辑 & 时间线合成 | 需要完整视频编辑器，非 CLI 管线能承载 |
| 三层 Agent 自治架构 | 需要大量编排基础设施，当前 Harness Skill 模式足够 |
| 分镜质量审核（180 度线、连续性） | 需要空间推理能力，当前 VLM 不可靠 |
| 小说导入 & 事件图谱 | 完整 NLP 管线，与当前视频反推→生产的定位偏差大 |

---

## 导演模块专项分析

### Toonflow 的导演做了什么

1. **拆** — 剧本 → 场景列表（含情绪分、环境音提示、对白量）
2. **排** — 场景间转场设计（动作桥、情绪接力、空间连接）
3. **控** — 每场的机位、走位、角色空间关系、对白节奏（4 字/秒）
4. **存** — 导演手册，跨 episode 复用风格偏好

### 现有管线中隐含的导演能力

| 能力 | 位置 | 局限 |
|---|---|---|
| 42 锚点镜头描述（camera motion tag） | brain: `run_video_analyze.py` | 逆向分析，非正向创作 |
| 节奏重排（120 秒目标） | brain: `run_video_analyze.py` | 仅用于反推场景 |
| block JSON（7 × 6 video prompt） | brain → model | 数据结构可复用，内容来自反推 |

### 真正缺失的

| 缺失能力 | 说明 |
|---|---|
| 剧本→场景拆解器 | 输入文本剧本，输出结构化场景列表 |
| 场景→镜头 prompt 生成器 | 每个场景生成 camera angle、motion、duration |
| 风格一致性配置 | 面向镜头语言的偏好存储，非模型参数 |

### 最小可行导演方案（展开设计）

#### 设计原则

- 对齐 MVP 管线（vmp-1 schema，12 shot），这是正向生产的主线
- 不引入新基础设施，用 LLM Skill + 配置文件实现
- 产出直接被 `llm-ai-model/scripts/mvp/run_mvp.py` 消费，无需中间转换

#### 整体流程

```
剧本文本 + director.yaml
        ↓
   [导演 Skill]
        ↓
  ┌─────┴─────┐
  │  第一阶段  │  剧本 → 场景拆解
  │  scene     │  输出 scenes.json
  └─────┬─────┘
        ↓
  ┌─────┴─────┐
  │  第二阶段  │  场景 → 12 镜头分配
  │  shot      │  输出 episode.json (vmp-1)
  └─────┬─────┘
        ↓
   MVP 管线消费
   run_mvp.py
```

#### 组件一：导演配置 `director.yaml`

存放位置：`llm-ai-model/workflows/mvp/director.yaml`

```yaml
# 视觉风格
style:
  genre: "都市情感"                    # 类型基调
  visual_tone: "电影质感，暖色调，浅景深"  # 画面风格关键词
  lighting: "自然光为主，夜景用霓虹补光"

# 镜头语言默认值
camera:
  default_angle: "eye-level"           # 默认机位
  close_up_ratio: 0.4                  # 特写镜头占比目标
  motion_preference: "slow dolly, gentle pan"  # 偏好运镜
  forbidden_motions:                   # 禁用运镜
    - "shaky cam"
    - "rapid zoom"

# 节奏控制
pacing:
  target_duration_seconds: 60          # 单集目标时长
  shots_per_episode: 12                # 固定 12 镜头
  dialogue_chars_per_second: 4         # 对白节奏基准
  emotion_curve: "hook → build → climax → resolve"

# 转场偏好
transitions:
  preferred:
    - "动作桥接"       # 上一镜动作延续到下一镜
    - "情绪接力"       # 情绪递进过渡
    - "空间连接"       # 同场景不同角度
  avoid:
    - "硬切无关联场景"
    - "跳轴"

# 一致性约束
consistency:
  cast_prompt_template: >
    {character_name}: {age}岁{gender}, {appearance}, {clothing}
  negative_prompt_base: >
    cartoon, 3d render, low quality, blurry, deformed hands,
    extra limbs, watermark, text, logo, child, minor
```

#### 组件二：场景拆解（第一阶段输出）

Skill 读取剧本文本 + director.yaml → 输出 `scenes.json`

```json
{
  "title": "屋顶重逢",
  "total_scenes": 4,
  "scenes": [
    {
      "id": "scene-01",
      "summary": "女主在天台独自等待，手机反复亮起又熄灭",
      "characters": ["女主"],
      "location": "天台",
      "time_of_day": "黄昏",
      "emotion_start": "焦虑",
      "emotion_end": "期待",
      "emotion_intensity": 4,
      "estimated_duration_seconds": 12,
      "dialogue_count": 0,
      "transition_to_next": "动作桥接：女主转身 → 下一镜男主出现"
    },
    {
      "id": "scene-02",
      "summary": "男主推门上天台，两人四目相对",
      "characters": ["女主", "男主"],
      "location": "天台",
      "time_of_day": "黄昏",
      "emotion_start": "期待",
      "emotion_end": "震动",
      "emotion_intensity": 7,
      "estimated_duration_seconds": 18,
      "dialogue_count": 2,
      "transition_to_next": "情绪接力：震动 → 回忆闪回"
    }
  ]
}
```

**拆解规则（写入 Skill 提示词）：**
- 每个场景标注在场角色（防角色消失）
- 情绪强度 0-10，相邻场景变化不超过 4
- 估算时长总和 = director.yaml 中 target_duration_seconds ± 10%
- 转场必须从 director.yaml 的 preferred 列表中选择

#### 组件三：镜头分配（第二阶段输出）

Skill 读取 scenes.json + director.yaml → 输出 `episode.json`（vmp-1 schema）

**分配规则：**
- 总共 12 个 shot，按场景时长比例分配
- 每个 shot 生成 `image_prompt`（关键帧描述）和 `video_prompt`（运镜动作）
- image_prompt 注入 director.yaml 的 visual_tone + lighting
- video_prompt 注入 director.yaml 的 camera motion_preference
- cast_prompt 按 director.yaml 的 cast_prompt_template 拼接所有角色
- negative_prompt 使用 director.yaml 的 negative_prompt_base

**镜头类型分配逻辑：**

| 叙事位置 | 镜头类型 | 用途 |
|---|---|---|
| shot-01 | 建立镜头（wide/establishing） | 交代场景 |
| shot-02~03 | 中景 → 近景 | 引入角色 |
| shot-04~06 | 交叉特写 | 对话/互动 |
| shot-07~09 | 动态跟拍 | 情节推进 |
| shot-10~11 | 特写 | 情绪高潮 |
| shot-12 | 远景/留白 | 收束 |

实际分配根据 scenes.json 的情绪曲线动态调整，以上为默认模板。

#### 组件四：Skill 实现

位置：`llm-ai-model/.dsh/skills/mvp-director/`

```
.dsh/skills/mvp-director/
├── SKILL.md              # Skill 入口定义
├── prompts/
│   ├── scene-breakdown.md    # 第一阶段：剧本→场景 的 LLM 提示词
│   └── shot-assignment.md    # 第二阶段：场景→镜头 的 LLM 提示词
└── examples/
    ├── scenes.example.json   # 场景拆解示例
    └── episode.example.json  # 最终输出示例（复用现有 vmp-1 示例）
```

**SKILL.md 核心逻辑：**

```markdown
## 触发条件
用户提供剧本文本并要求"导演分镜"或"生成 episode"

## 执行步骤
1. 读取 workflows/mvp/director.yaml
2. 第一阶段：将剧本 + director.yaml 传入 scene-breakdown.md 提示词
   → 输出 scenes.json，验证：角色在场、情绪连续、时长合理
3. 第二阶段：将 scenes.json + director.yaml 传入 shot-assignment.md 提示词
   → 输出 episode.json，验证：符合 vmp-1 schema、12 shot、compliance 字段
4. 将 episode.json 写入 workflows/mvp/episodes/{episode_id}.json
5. 报告完成，提示用户可执行 run_mvp.py

## 输出状态
- scenes.json → 中间产物，保留在 workflows/mvp/episodes/ 供审查
- episode.json → 最终产物，直接被 run_mvp.py 消费
```

#### 验证清单

导演 Skill 输出的 episode.json 必须通过以下检查才能交付：

| 检查项 | 规则 |
|---|---|
| schema_version | 必须为 `"vmp-1"` |
| episode_id | 匹配 `^mvp-[a-z0-9]+(?:-[a-z0-9]+)*$` |
| shots 数量 | 恰好 12 |
| shot ID 连续性 | shot-01 到 shot-12 |
| image_prompt | 每条 ≥ 20 字符 |
| video_prompt | 每条 ≥ 20 字符，包含运镜标签 |
| cast_prompt | ≥ 40 字符，包含所有在场角色 |
| negative_prompt | ≥ 20 字符 |
| compliance | 四个字段全部为 `true` |
| 情绪连续性 | 相邻 shot 的情绪不跳跃（来自 scenes.json） |
| 角色在场 | 每个场景的角色在对应 shot 的 image_prompt 中出现 |

#### 不做的事

- 不生成音频/配音（独立模块，不属于导演）
- 不做 180 度线检测（需要空间推理，VLM 不可靠）
- 不管理角色衍生状态（依赖上游角色模块）
- 不自动执行 run_mvp.py（导演只产出 episode.json，执行由用户触发）

---

## 统计

| 项目 | 数量 |
|---|---|
| Toonflow 功能总计 | ~40 项 |
| ✅ 已有 | 5 项 |
| ⚠️ 部分有 | 7 项 |
| ❌ 缺失 | ~28 项 |
| 必须补齐 | 4 项 |
| 值得做 | 6 项 |
| 不需要 | 5 项 |
| 代价太大 | 5 项 |

**核心结论**：llm-ai-veo 的优势在视频反推和生成执行层，最大缺口是从剧本到分镜的正向导演能力。补齐导演模块是打通正向生产流程的关键一步。
