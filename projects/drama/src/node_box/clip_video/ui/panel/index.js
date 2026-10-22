import { renderProductionNode } from '../../../../client/ui/production-node.js'

export const panel = {
  type: 'clip_video', key: 'videos', title: '成片',
  render(root, project, options) {
    renderProductionNode(root, { ...options, title: this.title, nodeType: this.type, node: project.videos, rows: project.videos || [], generateLabel: '生成视频' })
  },
}
