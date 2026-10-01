// 引用编排和人工编辑审核共用本镜资料，不引入整集剧情或前镜最终提示词。
export function storyboardContext({ project, shot, video, characters = [], scenes = [], refs = '', task }) {
  const selected = (cards, names) => (cards || []).filter(card => names.includes(card.id) || names.includes(card.name))
  const clean = card => Object.fromEntries(['id', 'name', 'type', 'look', 'identity', 'space', 'landmark', 'light', 'description', 'clothes', 'props', 'hairstyles']
    .filter(key => card[key] != null).map(key => [key, Array.isArray(card[key]) ? card[key].map(clean) : card[key]]))
  const people = selected(project.plot?.characters?.items, characters).map(clean)
  const places = selected(project.plot?.scenes?.items, scenes).map(clean)
  return [
    '【本次任务】', task || `仅为 ${shot.id} 将已通过的每秒指令直接编排为时长 ${shot.duration}s 的最终视频提示词，不输出其他镜头。`,
    '【本次参数】', `镜头：${shot.id}；时长：${shot.duration}s；固定模式：${video}。`,
    project.style ? `视觉风格：${project.style}` : '',
    '【上游事实：本镜已通过每秒指令（唯一时间线来源）】', shot.seconds?.content || '（每秒指令通过后由程序提供）',
    people.length ? `【关联人物资料，仅用于身份与外观】\n${JSON.stringify(people)}` : '',
    places.length ? `【关联场景资料，仅用于环境与地标】\n${JSON.stringify(places)}` : '',
    '【程序确定的素材清单，顺序固定】', refs || '无参考图片',
  ].filter(Boolean).join('\n\n')
}
