import { digest } from '../scene_extraction/state.js'
import { nodeRules } from '../../node_runtime/node_state.js'
export { digest }
export function sceneImageTarget(project, sceneId) {
  const scene = project.scene_extraction.scenes.find(row => row.id === sceneId)
  const image = project.scene_extraction.assets.find(row => row.scene_id === sceneId)?.image_generation
  return scene && image ? { scene, image } : null
}
export const sceneImageFingerprint = (project, target) => digest({ scene: target.scene, aspect_ratio: project.basic_info.aspect_ratio,
  reference_image: target.image.reference_image, opinion: target.image.node_state.opinion, rules: nodeRules(target.image.node_state) })
export function referenceImage(value) {
  if (typeof value !== 'string') throw new TypeError('参考图需为图片data URL')
  if (!value) return null
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!match || match[2].length > 12 * 1024 * 1024) throw new TypeError('参考图需为不超过8MB的PNG、JPEG或WebP图片')
  const bytes = Buffer.from(match[2], 'base64'), mime = match[1]
  if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.toString('base64') !== match[2]) throw new TypeError('参考图编码或大小无效')
  const valid = mime === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP'
  if (!valid) throw new TypeError('参考图格式与内容不符')
  return { mime, bytes }
}
