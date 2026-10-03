export const operation = { label: '生成道具图', scope: 'episode', agent: true, kind: 'generate',
  precheck(project, op) { if (!project.plot?.props.items.some(item => item.id === op.itemId)) throw Object.assign(new Error('图片卡片不存在或类型不匹配'), { status: 404 }) }, tasks: () => [{ type: 'prop-image' }] }
