/** 画布二级页签：只负责把现有节点投影到制作阶段，不产生新的业务状态。 */
export const CANVAS_STAGES = [
  { key: 'overview', label: '制作总览' },
  { key: 'analysis', label: '内容分析' },
  { key: 'assets', label: '资产设定' },
  { key: 'scripts', label: '分集剧本' },
  { key: 'storyboard', label: '分镜图' },
  { key: 'media', label: '视频' },
  { key: 'delivery', label: '审核交付' },
]

const DELIVERY_RE = /(审核|交付|成片|剪映|时间线|review|delivery|final|timeline)/i
const STORYBOARD_RE = /(分镜|宫格|storyboard)/i
const SCRIPT_RE = /(分集|剧本|场次|镜头表|episode|script|shotlist)/i
const ASSET_RE = /(角色|场景|地点|道具|资产|设定|定妆|character|scene|location|prop|asset)/i
const ANALYSIS_RE = /(分析|简报|规划|大纲|故事圣经|story.?bible|brief|analysis|plan)/i

export function canvasStageForNode(node = {}) {
  if (node.kind === 'audio') return null
  if (CANVAS_STAGES.some((stage) => stage.key !== 'overview' && stage.key === node.stage)) {
    return node.stage === 'media' && node.kind !== 'video' ? null : node.stage
  }
  const params = node.params || {}
  if (CANVAS_STAGES.some((stage) => stage.key === params.canvasStage && stage.key !== 'overview')) {
    return params.canvasStage === 'media' && node.kind !== 'video' ? null : params.canvasStage
  }
  const text = [node.group, node.title, params.capability, params.assetType, params.type]
    .filter(Boolean)
    .join(' ')
  if (DELIVERY_RE.test(text)) return 'delivery'
  if (node.kind === 'video') return 'media'
  if (STORYBOARD_RE.test(text)) return 'storyboard'
  if (SCRIPT_RE.test(text)) return 'scripts'
  if (ASSET_RE.test(text) || node.kind === 'image') return 'assets'
  if (ANALYSIS_RE.test(text)) return 'analysis'
  return null
}

export function nodesForCanvasStage(nodes, stageKey) {
  if (stageKey === 'overview') return [...nodes]
  return nodes.filter((node) => canvasStageForNode(node) === stageKey)
}

export function canvasStageCounts(nodes) {
  const counts = Object.fromEntries(CANVAS_STAGES.map(({ key }) => [key, 0]))
  counts.overview = nodes.length
  for (const node of nodes) {
    const key = canvasStageForNode(node)
    if (key) counts[key] += 1
  }
  return counts
}
