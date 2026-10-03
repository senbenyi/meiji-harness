// 步骤计划构造：任务与操作定义 plan 时共用。
import { textNodes } from '../../../shared/task-nodes.js'
// 文本任务只计划「生成 → 自审」；自审不通过时由执行器按 maxRevisions 动态追加「修订 → 复审」。
export const textSteps = textNodes
// 文本分镜 = 以已通过每秒指令直接编排多模态引用（不再单独生成文本镜头）。
export const storyboardSteps = track => ['generate', 'review'].map(kind => ({ kind, target: `storyboard:${track}`, phase: 'reference-binding', label: `引用编排·${kind === 'generate' ? '生成' : '自审'}` }))
export const videoSteps = track => ['video_submit', 'video_generate', 'tail_frame'].map(kind => ({ kind, target: `film:${track}` }))
export const shotIds = project => (project?.shots?.items || []).map(shot => shot.id)
export const editSteps = target => [{ kind: 'save', target }, { kind: 'review', target }]
export const saveStep = target => op => ({ kind: 'save', target: typeof target === 'function' ? target(op) : target })
// 单镜制作步骤：文本分镜 → 提交视频 → 生成视频 → 提取尾帧。单镜与逐镜成片共用。
export const shotSteps = track => [...storyboardSteps(track), ...videoSteps(track)]
export const imageSteps = target => ['image_generate', 'image_download', 'image_save'].map(kind => ({ kind, target }))
export const imagePlan = (_project, op) => imageSteps(`image:${op.itemId}`)
