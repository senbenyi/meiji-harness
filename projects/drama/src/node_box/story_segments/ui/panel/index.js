import { renderProductionNode } from '../../../../client/ui/production-node.js'

export const panel = {
  type: 'story_segments', key: 'story_segments', title: '故事大纲',
  render(root, project, options) {
    renderProductionNode(root, { ...options, title: this.title, nodeType: this.type, node: project.story_segments, rows: project.story_segments?.segments || [] })
  },
}
