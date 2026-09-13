import { readFile } from 'node:fs/promises'
import { MODE_MEDIA, VIDEO_MODES, VIDEO_PROFILES, validateVideoPlan } from '../workflows/video-plan.js'

const fail = message => { throw new Error(`生产清单无效：${message}`) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, allowed, label) => {
  const unknown = Object.keys(value).find(key => !allowed.includes(key))
  if (unknown) fail(`${label} 包含未知字段 ${unknown}`)
}
const identifier = (value, label) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) fail(`${label} 必须是安全标识符`)
}

export async function loadProductionManifest(path) {
  let value
  try { value = JSON.parse(await readFile(path, 'utf8')) } catch (error) { fail(`无法读取 ${path}：${error.message}`) }
  return validateProductionManifest(value)
}

export function validateProductionManifest(value) {
  if (!object(value)) fail('根节点必须为对象')
  exactKeys(value, ['version', 'project_id', 'profile', 'max_attempts', 'shots'], '根节点')
  if (value.version !== 1) fail('version 必须为 1')
  identifier(value.project_id, 'project_id')
  if (!VIDEO_PROFILES.includes(value.profile)) fail(`profile 仅支持 ${VIDEO_PROFILES.join('、')}`)
  const maxAttempts = value.max_attempts ?? 3
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) fail('max_attempts 必须为 1..10 的整数')
  if (!Array.isArray(value.shots) || value.shots.length < 1 || value.shots.length > 1000) fail('shots 数量必须为 1..1000')
  const shotIds = new Set(), anchors = new Set()
  const shots = value.shots.map((shot, index) => {
    const label = `shots[${index}]`
    if (!object(shot)) fail(`${label} 必须为对象`)
    exactKeys(shot, ['id', 'request', 'media', 'produces_anchor'], label)
    identifier(shot.id, `${label}.id`)
    if (shotIds.has(shot.id)) fail(`镜头 ID 重复：${shot.id}`)
    shotIds.add(shot.id)
    if (!object(shot.request)) fail(`${label}.request 必须为对象`)
    if (!VIDEO_MODES.includes(shot.request.mode)) fail(`${label}.request.mode 无效`)
    if (typeof shot.request.prompt !== 'string' || !shot.request.prompt.trim()) fail(`${label}.request.prompt 必须为非空字符串`)
    if ('profile' in shot.request) fail(`${label}.request.profile 应使用根节点 profile`)
    const media = shot.media ?? {}
    if (!object(media)) fail(`${label}.media 必须为对象`)
    const requiredMedia = MODE_MEDIA[shot.request.mode]
    exactKeys(media, requiredMedia, `${label}.media`)
    for (const name of requiredMedia) {
      const source = media[name]
      if (typeof source === 'string') continue
      if (!object(source) || Object.keys(source).length !== 1 || typeof source.anchor !== 'string') fail(`${label}.media.${name} 必须为服务器 URL 或 {"anchor":"..."}`)
      if (!anchors.has(source.anchor)) fail(`${label}.media.${name} 引用了尚未产出的锚点 ${source.anchor}`)
    }
    if (Object.keys(media).length !== requiredMedia.length) fail(`${label}.media 必须提供 ${requiredMedia.join('、') || '空对象'}`)
    let producesAnchor
    if (shot.produces_anchor !== undefined) {
      if (!object(shot.produces_anchor)) fail(`${label}.produces_anchor 必须为对象`)
      exactKeys(shot.produces_anchor, ['id', 'frame_index'], `${label}.produces_anchor`)
      identifier(shot.produces_anchor.id, `${label}.produces_anchor.id`)
      if (anchors.has(shot.produces_anchor.id)) fail(`锚点重复：${shot.produces_anchor.id}`)
      if (!Number.isInteger(shot.produces_anchor.frame_index) || shot.produces_anchor.frame_index < 0) fail(`${label}.produces_anchor.frame_index 必须为非负整数`)
      producesAnchor = { ...shot.produces_anchor }
      anchors.add(producesAnchor.id)
    }
    return { id: shot.id, request: { ...shot.request }, media: { ...media }, ...(producesAnchor ? { produces_anchor: producesAnchor } : {}) }
  })
  return { version: 1, project_id: value.project_id, profile: value.profile, max_attempts: maxAttempts, shots }
}

export async function resolveShotRequest(manifest, shot, anchors) {
  const media = Object.fromEntries(Object.entries(shot.media).map(([name, source]) => {
    if (typeof source === 'string') return [name, source]
    const anchor = anchors[source.anchor]
    if (!anchor?.url) throw new Error(`${shot.id}: 缺少锚点 ${source.anchor}`)
    return [name, anchor.url]
  }))
  const request = { profile: manifest.profile, ...shot.request, ...media }
  await validateVideoPlan(request)
  return request
}
