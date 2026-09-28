// 操作元数据：合法操作、需要剧集作用域的操作、显示名称与校验。


export const supportedActions = new Set(['tail-frame', 'produce', 'produce-all', 'create', 'open', 'overview', 'episode-add', 'episode-edit', 'project-delete', 'episode-delete', 'episode-generate', 'source', 'characters', 'scenes', 'scene-text', 'outline-text', 'storyboard-text', 'shot-assets', 'outline', 'shots', 'seconds', 'revise-shot', 'shot-seconds', 'shot-storyboard', 'shot-boards', 'storyboard', 'pencil', 'image', 'revise-image', 'import-image', 'clear-image', 'use-asset', 'part-image', 'part-import', 'film', 'films', 'assemble', 'library-import'])
export const episodeScoped = new Set(['tail-frame', 'confirm-image', 'discard-image', 'source', 'characters', 'scenes', 'scene-text', 'outline-text', 'storyboard-text', 'shot-assets', 'outline', 'shots', 'seconds', 'revise-shot', 'shot-seconds', 'shot-storyboard', 'shot-boards', 'storyboard', 'pencil', 'image', 'revise-image', 'import-image', 'clear-image', 'use-asset', 'part-image', 'part-import', 'film', 'films', 'assemble'])
export const labels = {
  create: '创建项目',
  open: '打开项目',
  overview: '保存项目概要',
  'project-delete': '删除项目',
  'episode-delete': '删除剧集',
  'episode-add': '新增剧集',
  'episode-edit': '编辑剧集',
  'episode-generate': '生成本集剧情',
  source: '修改原始资料',
  'outline-text': '修改大纲',
  characters: '按意见修订人物卡',
  scenes: '按意见修订场景卡',
  'scene-text': '编辑场景文字',
  outline: '生成剧情（大纲、角色、场景）',
  shots: '写镜头表',
  'tail-frame': '重新处理尾帧',
  produce: '生成本镜文本和视频',
  'produce-all': '依次生成文本和视频',
  seconds: '生成每秒指令',
  'revise-shot': '按审核意见重写镜头',
  'shot-seconds': '生成每秒指令',
  'shot-storyboard': '生成这一镜的分镜',
  'shot-boards': '生成所有分镜',
  pencil: '生成铅笔分镜',
  storyboard: '生成全部分镜表',
  image: '生成图片',
  'revise-image': '按新需求重绘图片',
  'import-image': '导入图片',
  'clear-image': '删除图片',
  'part-image': '生成图片',
  'part-import': '导入图片',
  film: '提交成片',
  films: '一键成片',
  assemble: '全片拼接',
  'library-import': '导入素材',
  'use-asset': '关联图片素材',
}

export function operationLabel(operation) { return `${labels[operation.action] || operation.action}${operation.track ? ' ' + operation.track : ''}${operation.generationMode ? '·' + (operation.generationMode === 'modify' ? '按意见修改' : '重新生成') : ''}` }

export function validateOperation(input) {
  if (input?.action === 'shot-seconds') throw Object.assign(new Error('每秒指令请从卡片集顶部统一提交'), { status: 400 })
  if (!supportedActions.has(input?.action)) throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
}
