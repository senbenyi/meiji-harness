import { shotSecondsReady } from '../../../../shared/shot-timing.js'
export const operation = { session: {"tool": "meiji_generate_seconds", "description": "逐镜生成每秒指令。", "episode": true, "params": {"track": {"type": "string"}}, "modes": ["generate", "regenerate", "modify"]}, label: '生成每秒指令', scope: 'episode', agent: true, kind: 'generate',
  precheck(project, op) { if (!project.shots.items.length || project.shots.check.passed !== true) throw Object.assign(new Error('请先生成并通过镜头表审核'), { status: 409 }); if (op.track && !project.shots.items.some(shot => shot.id === op.track)) throw new Error('镜头不存在') },
  tasks(project, op) { let shots = project.shots.items
    if (op.track) shots = shots.filter(shot => shot.id === op.track)
    else if ((op.mode === 'modify' || op.generationMode === 'modify') && !String(op.review ?? project.shots.seconds.review.text).trim()) { const index = shots.findIndex(shot => shot.seconds.check.passed !== true || !shotSecondsReady(shot)); shots = index < 0 ? shots : shots.slice(index) }
    return shots.map(shot => ({ type: 'shot-seconds', params: { track: shot.id, ...(op.mode === 'modify' || op.generationMode === 'modify' ? { review: [op.review ?? project.shots.seconds.review.text, shot.seconds.review.text].filter(Boolean).join('\n'), generationMode: shot.seconds.content ? 'modify' : 'regenerate' } : {}) } })) } }
