import { renderProductionNode } from '../../../../client/ui/production-node.js'

export const panel = {
  type: 'character_extraction', key: 'character_extraction', title: '角色',
  render(root, project, options) {
    renderProductionNode(root, { ...options, title: this.title, nodeType: this.type, node: project.character_extraction, rows: project.character_extraction?.characters || [] })
  },
}
