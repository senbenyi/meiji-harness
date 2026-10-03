// 操作定义：每个操作（按钮或会话工具）做什么。操作只存在于代码中，每次执行生成一个任务。
//   label  显示名称
//   scope  作用范围：project / episode / shot（决定是否需要剧集作用域，以及与哪些任务冲突）
//   queue  队列类别：text / image / video（只有调用图片或视频接口的操作占用 image / video 名额）
//   plan   根据当前项目生成步骤计划 [{ kind, target }]，步骤由处理函数经 runStep 执行
//   step   没有 plan 的操作整体作为一个步骤由执行入口执行：返回 { kind, target }，默认 execute
//   agent  会话工具（agent）能否发起；人工专属操作为 false
//   task   能否经任务管理启动（排队执行）；false 的操作只能由面板直接执行
import { projectStore } from '../../data/project-store.js'
import { materialize } from '../../../shared/episode-rules.js'

const text = target => ['generate', 'review', 'revise', 're_review'].map(kind => ({ kind, target }))
// 文本分镜 = 以已通过每秒指令直接编排多模态引用（不再单独生成文本镜头）。
const storyboard = track => ['generate', 'review'].map(kind => ({ kind, target: `storyboard:${track}`, phase: 'reference-binding', label: `引用编排·${kind === 'generate' ? '生成' : '自审'}` }))
const video = track => ['video_submit', 'video_generate', 'tail_frame'].map(kind => ({ kind, target: `film:${track}` }))
const shotIds = project => (project?.shots?.items || []).map(shot => shot.id)
const edit = target => [{ kind: 'save', target }, { kind: 'review', target }]
const save = target => op => ({ kind: 'save', target: typeof target === 'function' ? target(op) : target })
// 单镜制作步骤：文本分镜 → 提交视频 → 生成视频 → 提取尾帧。单镜与逐镜成片共用。
const shotPlan = track => [...storyboard(track), ...video(track)]
const image = target => ['image_generate', 'image_download', 'image_save'].map(kind => ({ kind, target }))
const imagePlan = (_project, op) => image(`image:${op.itemId}`)

export const definitions = {
  create: { label: '创建项目', scope: 'project', queue: 'text', agent: true },
  open: { label: '打开项目', scope: 'project', queue: 'text', agent: true },
  overview: { label: '保存项目概要', scope: 'project', queue: 'text', agent: false, step: save(null) },
  'project-delete': { label: '删除项目', scope: 'project', queue: 'text', agent: false },
  'episode-delete': { label: '删除剧集', scope: 'episode', queue: 'text', agent: false },
  'episode-add': { label: '新增剧集', scope: 'project', queue: 'text', agent: false, step: save('summary') },
  'episode-edit': { label: '编辑剧集', scope: 'project', queue: 'text', agent: false, step: save('summary') },
  'episode-summary-draft': { label: 'AI 生成摘要草稿', scope: 'project', queue: 'text', agent: false, plan: () => [...text('summary'), { kind: 'save', target: 'summary-draft' }] },
  'episode-generate': { label: '生成本集剧情', scope: 'project', queue: 'text', agent: true, plan: () => text('summary') },
  'library-import': { label: '导入素材', scope: 'project', queue: 'text', agent: false },
  source: { label: '修改原始资料', scope: 'episode', queue: 'text', agent: false, step: save('summary') },
  'outline-text': { label: '修改大纲', scope: 'episode', queue: 'text', agent: false, plan: () => edit('story') },
  'scene-text': { label: '编辑场景文字', scope: 'episode', queue: 'text', agent: false, plan: () => edit('story') },
  'character-text': { label: '编辑人物文字', scope: 'episode', queue: 'text', agent: false, plan: () => edit('story') },
  'storyboard-text': { label: '编辑文本分镜', scope: 'shot', queue: 'text', agent: false, plan: (_, op) => edit(`storyboard:${op.track}`) },
  'shot-assets': { label: '修改镜头素材', scope: 'shot', queue: 'text', agent: false, step: save('shots') },
  characters: { label: '按意见修订人物卡', scope: 'episode', queue: 'text', agent: true, plan: () => text('characters') },
  props: { label: '提取道具', scope: 'episode', queue: 'text', agent: true, plan: () => text('props') },
  'prop-delete': { label: '删除道具', scope: 'episode', queue: 'text', agent: false, step: save('props') },
  scenes: { label: '按意见修订场景卡', scope: 'episode', queue: 'text', agent: true, plan: () => text('scenes') },
  outline: { label: '生成剧情（大纲、角色、场景、道具）', scope: 'episode', queue: 'text', agent: true, plan: () => ['outline', 'characters', 'scenes', 'props'].flatMap(text) },
  shots: { label: '写镜头表', scope: 'episode', queue: 'text', agent: true, plan: () => text('shots') },
  'revise-shot': { label: '按审核意见重写镜头', scope: 'shot', queue: 'text', agent: true, plan: () => text('shots') },
  seconds: { label: '生成每秒指令', scope: 'episode', queue: 'text', agent: true, plan: project => shotIds(project).flatMap(id => text(`seconds:${id}`)) },
  'shot-seconds': { label: '生成每秒指令', scope: 'shot', queue: 'text', agent: true, plan: (_, op) => text(`seconds:${op.track}`) },
  'shot-storyboard': { label: '生成这一镜的分镜', scope: 'shot', queue: 'text', agent: true, plan: (_, op) => storyboard(op.track) },
  'storyboard-bind': { label: '重新编排引用', scope: 'shot', queue: 'text', agent: true, plan: (_, op) => storyboard(op.track) },
  storyboard: { label: '生成全部分镜表', scope: 'episode', queue: 'text', agent: true, plan: project => shotIds(project).flatMap(storyboard) },
  'shot-boards': { label: '生成所有分镜', scope: 'episode', queue: 'text', agent: true, plan: project => [...shotIds(project).flatMap(id => text(`seconds:${id}`)), ...shotIds(project).flatMap(storyboard)] },
  pencil: { label: '生成铅笔分镜', scope: 'shot', queue: 'image', agent: true, plan: (_, op) => image(`pencil:${op.track}`) },
  image: { label: '生成图片', scope: 'episode', queue: 'image', agent: true, plan: imagePlan },
  'revise-image': { label: '按新需求重绘图片', scope: 'episode', queue: 'image', agent: true, plan: imagePlan },
  'import-image': { label: '导入图片', scope: 'episode', queue: 'text', agent: false, step: save(null) },
  'set-reference': { label: '设置参考图', scope: 'episode', queue: 'text', agent: false, step: save(null) },
  'clear-reference': { label: '移除参考图', scope: 'episode', queue: 'text', agent: false, step: save(null) },
  'clear-image': { label: '删除图片', scope: 'episode', queue: 'text', agent: false, step: save(null) },
  'part-import': { label: '导入图片', scope: 'episode', queue: 'text', agent: false, step: save(null) },
  'part-text': { label: '编辑图片描述', scope: 'episode', queue: 'text', agent: false, step: save(null) },
  'use-asset': { label: '关联图片素材', scope: 'episode', queue: 'text', agent: false, step: save(null) },
  'confirm-image': { label: '确认使用图片', scope: 'episode', queue: 'text', agent: false, task: false, step: () => ({ kind: 'confirm', target: null }) },
  'discard-image': { label: '放弃候选图片', scope: 'episode', queue: 'text', agent: false, task: false, step: () => ({ kind: 'confirm', target: null }) },
  film: { label: '提交成片', scope: 'shot', queue: 'video', agent: true, plan: (_, op) => video(op.track) },
  films: { label: '一键成片', scope: 'episode', queue: 'video', agent: true, plan: project => shotIds(project).flatMap(video) },
  produce: { label: '生成本镜文本和视频', scope: 'shot', queue: 'video', agent: true, plan: (_, op) => shotPlan(op.track) },
  'produce-all': { label: '依次生成文本和视频', scope: 'episode', queue: 'video', agent: true, plan: project => shotIds(project).flatMap(shotPlan) },
  'tail-frame': { label: '重新处理尾帧', scope: 'shot', queue: 'video', agent: true, step: op => ({ kind: 'tail_frame', target: `film:${op.track}` }) },
  assemble: { label: '全片拼接', scope: 'episode', queue: 'text', agent: true, step: () => ({ kind: 'assemble', target: 'assembly' }) },
  'review-override': { label: '忽略自审并通过', scope: 'episode', queue: 'text', agent: false, task: false, plan: (_, op) => [{ kind: 'override', target: op.key }] },
}

export const labels = Object.fromEntries(Object.entries(definitions).map(([action, value]) => [action, value.label]))
// 需要剧集作用域的操作（剧集级与镜头级；项目级和一键成片类自行读取剧集）。
export const episodeScoped = new Set(Object.entries(definitions).filter(([action, value]) => value.scope !== 'project' && !['episode-delete', 'produce', 'produce-all'].includes(action)).map(([action]) => action))

export const queueOf = action => definitions[action]?.queue || 'text'

export function operationLabel(operation) { return `${labels[operation.action] || operation.action}${operation.track ? ' ' + operation.track : ''}${operation.generationMode ? '·' + (operation.generationMode === 'modify' ? '按意见修改' : '重新生成') : ''}` }

export function validateOperation(input) {
  if (input?.action === 'shot-seconds') throw Object.assign(new Error('每秒指令请从卡片集顶部统一提交'), { status: 400 })
  if (!Object.hasOwn(definitions, input?.action)) throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
  const definition = definitions[input.action]
  // 人工专属操作（忽略自审、确认图片、编辑与删除等）不允许由会话工具发起。
  if (input.origin === 'session' && definition.agent !== true) throw Object.assign(new Error('该操作只能由人在面板上执行'), { status: 403 })
  if (definition.task === false) throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
}

// 没有 plan 的操作由执行入口整体作为一个步骤执行；有 plan 的操作返回 null（步骤由处理函数执行）。
export function runnerStep(operation) {
  const definition = definitions[operation.action]
  if (definition?.plan) return null
  return definition?.step?.(operation) || { kind: 'execute', target: null }
}

// 按当前项目生成步骤计划；读取失败时退回单个 execute 步骤（错误在执行时报告）。
export async function planSteps(home, operation) {
  const single = runnerStep(operation)
  if (single) return [single]
  let project = null
  try {
    if (operation.projectId) {
      const root = await projectStore(home).read(operation.projectId)
      const episodeId = operation.episodeId || (root.episodes.length === 1 ? root.episodes[0].id : null)
      project = episodeId ? materialize(root, episodeId) : root
    }
  } catch { return [{ kind: 'execute', target: null }] }
  const steps = definitions[operation.action].plan(project, operation)
  return steps.length ? steps : [{ kind: 'execute', target: null }]
}
