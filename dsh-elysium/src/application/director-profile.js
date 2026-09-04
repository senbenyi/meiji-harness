/**
 * 导演方法论参数：Producer Agent 规划提示词的唯一参数来源。
 *
 * 设计依据：蒸馏自 Toonflow-app 导演/分镜技能包的方法论，按本插件管线能力做了两处
 * 明确取舍（见文末「与源方法论的差异」），不是照搬。改任何一项都会改变下游 plan.json
 * 的内容，视为新的规划输入。
 */

export const DIRECTOR_PROFILE = {
  // 视觉风格
  style: {
    genre: '都市情感',
    visualTone: '电影质感，暖色调，浅景深',
    lighting: '自然光为主，夜景用霓虹补光',
  },

  // 镜头语言默认值
  camera: {
    defaultAngle: 'eye-level',
    motionPreference: 'slow dolly, gentle pan',
    forbiddenMotions: ['shaky cam', 'rapid zoom'],
  },

  // 节奏控制
  pacing: {
    emotionScale: '0-10',
    // 相邻章情绪浓度落差上限（源方法论无此数值，只要求"贴合剧情、不凭空拔高"）
    maxAdjacentEmotionDelta: 4,
  },

  // 转场偏好——仅在必要时使用，不为凑数而增补
  transitions: {
    preferred: ['动作衔接', '空镜过渡', '叠化淡入淡出'],
    avoid: ['硬切无关联场景', '跳轴'],
  },

  // 一致性约束
  consistency: {
    castPromptTemplate: '{character_name}: {age}岁{gender}, {appearance}, {clothing}',
    negativePromptBase: 'cartoon, 3d render, low quality, blurry, deformed hands, extra limbs, watermark, text, logo, child, minor',
  },
}

// 与源方法论的差异（刻意取舍，不是遗漏）：
//
// 1. imagePrompt 保留光影/色调描述，源方法论明确禁止。
//    原因：源项目的分镜图依赖场景资产参考图承载光影，模型只需描述内容；本插件每个锚点
//    只以定妆图作为角色一致性参考，没有场景参考图，光影必须写进 prompt 文本。
//
// 2. 不做 @图N 多资产编号绑定。
//    原因：源项目面向资产库（角色/道具/场景分别建档并按 ID 引用）；本插件当前只有单一
//    角色一致性参考（cast-main），绑定机制没有落地对象。
