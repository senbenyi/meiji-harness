import { renderProductionNode } from '../../../../client/ui/production-node.js'

export const panel = {
  type: 'clip_composition', key: 'clip_arrangement', title: '分片编排',
  render(root, project, options) {
    renderProductionNode(root, { ...options, title: this.title, nodeType: this.type, node: project.clip_arrangement, rows: project.clip_arrangement?.clips || [] })
  },
}
