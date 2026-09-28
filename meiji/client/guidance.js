export const guidanceTypes = [['expression', '表情'], ['action', '动作'], ['effect', '特效'], ['sound', '声音'], ['dialogue', '对白'], ['music', '配乐'], ['other', '其他']]

export function guidanceModule(stage, type) {
  if (stage === 'outline') return ({ expression: '人物情绪与反应', action: '人物行为与事件推进', effect: '场景与事件表现', sound: '环境与声音氛围', dialogue: '人物对白创作', music: '情绪与节奏参考', other: '剧情表达参考' })[type]
  if (stage === 'shots') return ({ expression: '镜头人物情绪', action: '镜头事件与动作起止', effect: '镜头视觉表现', sound: '镜头声场', dialogue: '对白归属与切段', music: '镜头节奏与配乐', other: '镜头表达参考' })[type]
  if (stage === 'seconds') return ({ expression: '表情变化时间线', action: '动作与空间调度时间线', effect: '特效触发与消退时间线', sound: '声音时点、声源与强弱', dialogue: '说话人、对白时点与语气', music: '配乐进出与节奏', other: '分镜表达参考' })[type]
  return ({ expression: '画面表演 → detailed_description / integrated_multimodal_description', action: '动作调度 → detailed_description / integrated_multimodal_description', effect: '视觉特效 → detailed_description / integrated_multimodal_description', sound: '环境音与音效 → overall_soundscape', dialogue: '对白表演 → detailed_description / integrated_multimodal_description', music: '非画内配乐 → non_diegetic_music', other: '综合参考 → 按语义融入对应模块' })[type]
}
