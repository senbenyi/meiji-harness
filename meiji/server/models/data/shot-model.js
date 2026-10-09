import { node } from './content-node.js'

// 整集镜头表。seconds 是每秒分镜的汇总节点。
export function shotsModel() {
  return { ...node('shots'), seconds: node('seconds'), items: [] }
}

// 单镜。每秒分镜、分镜提示词、视频和尾帧各是一个内容节点。
export function shotModel(fields) {
  const { id, text = '', ...content } = fields
  return {
    ...node(id, text),
    ...content,
    seconds: node(`seconds:${id}`),
    storyboard: node(`storyboard:${id}`),
    video: node(`film:${id}`),
    tailFrame: node(`tailFrame:${id}`),
  }
}
