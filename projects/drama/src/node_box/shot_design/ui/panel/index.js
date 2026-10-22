import { renderProductionNode } from '../../../../client/ui/production-node.js'

export const panel = {
  type: 'shot_design', key: 'shot_design', title: '分镜',
  render(root, project, options) {
    renderProductionNode(root, { ...options, title: this.title, nodeType: this.type, node: project.shot_design, rows: project.shot_design?.shots || [] })
  },
}
