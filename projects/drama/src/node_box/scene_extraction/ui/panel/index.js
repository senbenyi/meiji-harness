import { renderProductionNode } from '../../../../client/ui/production-node.js'

export const panel = {
  type: 'scene_extraction', key: 'scene_extraction', title: '场景',
  render(root, project, options) {
    renderProductionNode(root, { ...options, title: this.title, nodeType: this.type, node: project.scene_extraction, rows: project.scene_extraction?.scenes || [] })
  },
}
