import { renderProductionNode } from '../../../../client/ui/production-node.js'

export const panel = {
  type: 'merge_video', key: 'episodes', title: '分集',
  render(root, project, options) {
    renderProductionNode(root, { ...options, title: this.title, nodeType: this.type, node: project.episodes, rows: project.episodes || [], generateLabel: '合成分集' })
  },
}
