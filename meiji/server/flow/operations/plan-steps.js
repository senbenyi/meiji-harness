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

// 任务划分：操作定义的 tasks(project, op) 返回 [{ type, label, targets }]，执行时步骤按 target 归入对应任务；
// 每个任务的状态由自身步骤推导，任一任务失败、审核不通过或被停止，其余未开始的任务记为已取消。
const task = (type, label, target) => ({ type, label, targets: [target] })
export const storyTasks = () => [['outline', '大纲'], ['characters', '角色'], ['scenes', '场景'], ['props', '道具']].map(([type, label]) => task(type, label, type))
export const secondsTasks = project => shotIds(project).map(id => task('shot-seconds', `每秒指令 ${id}`, `seconds:${id}`))
export const storyboardTasks = project => shotIds(project).map(id => task('storyboard-prompt', `分镜提示词 ${id}`, `storyboard:${id}`))
export const videoTasks = project => shotIds(project).map(id => task('video', `视频 ${id}`, `film:${id}`))
export const shotFilmTasks = id => [task('storyboard-prompt', `分镜提示词 ${id}`, `storyboard:${id}`), task('video', `视频 ${id}`, `film:${id}`)]
export const filmTasks = project => shotIds(project).flatMap(shotFilmTasks)
// 图片任务按卡片类型区分：角色图、场景图、道具图。
const imageKinds = [['characters', 'character-image', '角色图'], ['scenes', 'scene-image', '场景图'], ['props', 'prop-image', '道具图']]
export function imageTasks(project, op) {
  const kind = imageKinds.find(([key]) => (project?.plot?.[key]?.items || []).some(item => item.id === op.itemId)) || imageKinds[{ C: 0, E: 1, P: 2 }[String(op.itemId || '')[0]] ?? 0]
  return [task(kind[1], `${kind[2]} ${op.itemId}`, `image:${op.itemId}`)]
}
