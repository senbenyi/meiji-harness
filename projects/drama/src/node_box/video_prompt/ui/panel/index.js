import { renderProductionNode } from '../../../../client/ui/production-node.js'

export const panel = {
  type: 'video_prompt', key: 'video_prompt', title: '提示词',
  render(root, project, options) {
    renderProductionNode(root, { ...options, title: this.title, nodeType: this.type, node: project.video_prompt, rows: project.video_prompt?.items || [] })
  },
}
