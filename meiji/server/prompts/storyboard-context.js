// 引用编排和人工编辑审核共用本镜资料，不引入整集剧情或前镜最终提示词。
export function storyboardContext({ project, shot, video, characters = [], scenes = [], refs = '', task }) {
  const selected = (cards, names) => (cards || []).filter(card => names.includes(card.id) || names.includes(card.name))
  const clean = card => Object.fromEntries(['id', 'name', 'type', 'look', 'identity', 'space', 'landmark', 'light', 'description']
    .filter(key => card[key] != null).map(key => [key, Array.isArray(card[key]) ? card[key].map(clean) : card[key]]))
  const people = selected(project.plot?.characters?.items, characters).map(clean)
  const places = selected(project.plot?.scenes?.items, scenes).map(clean)
  // 结构化返回：任务、审核目标与本镜资料分开，由 prompt-request.js 组装。
  return {
    task: task || `仅为 ${shot.id} 将已通过的每秒指令直接编排为时长 ${shot.duration}s 的最终视频提示词，不输出其他镜头。`,
    review: task || '',
    facts: [
      { title: '【本次参数】', text: { shotId: shot.id, durationSeconds: shot.duration, mode: video } },
      { title: '【上游事实：本镜已通过每秒指令（唯一时间线来源）】', text: { seconds: shot.seconds?.content || null } },
      { title: '【关联人物资料，仅用于身份与外观】', text: people.length ? { characters: people } : '' },
      { title: '【关联场景资料，仅用于环境与地标】', text: places.length ? { scenes: places } : '' },
      { title: '【程序确定的素材清单，顺序固定】', text: { references: Array.isArray(refs) ? refs : refs ? [{ description: refs }] : [] } },
    ].filter(fact => fact.text),
  }
}
