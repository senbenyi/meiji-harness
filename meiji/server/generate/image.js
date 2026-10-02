import { runStep } from '../data/task-store.js'
import { pictureOf, node, setContent } from '../../shared/drama-model.js'
import { characterFieldValues, characterLookText } from '../../shared/character-facts.js'
import { checkContext } from '../data/operation-context.js'
import { render } from '../prompts/skill-prompts.js'
import { imageSegments } from '../prompts/interfaces/registry.js'
import { savePicture, saveImageDraft } from '../data/pictures.js'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGatewayImage } from './gateway.js'

export function propImagePrompt(item, project, instruction = '') {
  return imageSkillPrompt('part-image', `道具：${item.name}（${item.id}）\n类别：${item.category}\n描述：${item.description}\n大纲依据：${item.evidence}${instruction ? `\n原图修改意见：${instruction}` : ''}`, project)
}

export function usableLook(text) {
  const look = String(text || '').replace(/\s+/g, ' ').trim()
  const han = look.match(/[\p{L}\p{N}]/gu) || []
  return han.length >= 12 ? look : ''
}

export function imageSeed(id) {
  return createHash('sha256').update(String(id)).digest().readUInt32BE(0)
}

export function imagePrompt(item) {
  const look = usableLook(item?.look)
  if (!look) throw Object.assign(new Error(`${item?.name || '资产'}还没有可用的画面提示词`), { status: 400 })
  return look
}

export function sceneStillPrompt(item) {
  const look = usableLook(item?.look) || String(item?.look || '').trim()
  if (!look) throw Object.assign(new Error(`${item?.name || '场景'}还没有可用的画面提示词`), { status: 400 })
  return look
}

// 旧导出保留为转发；人物图专属逻辑集中在对应提示词接口。
export { characterStillPrompt, characterImagePrompt, adultCharacter } from '../prompts/interfaces/character-image.js'

const stillExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export function assetImageUrl(projectId, itemId, version = Date.now(), episodeId = '') {
  return `/plugins/meiji/projects/${projectId}/images/${encodeURIComponent(itemId)}?${episodeId ? `episodeId=${encodeURIComponent(episodeId)}&` : ''}v=${version}`
}

export function pictureRecord(item) {
  if (!item || typeof item !== 'object') return item
  const localPath = item.localPath || null
  if (['role', 'scene', 'prop'].includes(item.type)) {
    const { localPath: _, assetId, assetCategory, prompt, ...card } = item
    const media = { ...pictureOf(item), ...(prompt ? { prompt } : {}), localPath: localPath || pictureOf(item).localPath || null, ...(assetId ? { assetId, assetCategory } : {}) }
    card.image = setContent(structuredClone(item.image || node(`image:${item.id}`)), media, { passed: Boolean(media.localPath || media.assetId), failures: [] })
    return card
  }
  return { ...item, localPath }
}

export function imageAsset(item) {
  if (!item || typeof item !== 'object') return null
  const id = String(item.id || '').trim()
  const name = String(item.name || '').trim()
  if (!id || !name) return null
  const pictured = pictureRecord(item)
  return { id, name, ...(pictured.prompt ? { prompt: pictured.prompt } : {}), ...(pictured.assetId ? { assetId: pictured.assetId, assetCategory: pictured.assetCategory } : {}), localPath: pictured.localPath || null }
}

export function imageAssets(list) {
  return (Array.isArray(list) ? list : []).map(imageAsset).filter(Boolean)
}

export const partSlots = {
  clothes: { mark: 'W', label: '衣服' },
  mounts: { mark: 'M', label: '坐骑' },
  props: { mark: 'P', label: '道具' },
  hairstyles: { mark: 'H', label: '发型' },
}

export function nextPartId(character, slot) {
  const spec = partSlots[slot]
  if (!spec || !character?.id) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const used = new Set(imageAssets(character[slot]).map(item => item.id))
  let index = used.size + 1
  let id = `${character.id}-${spec.mark}${String(index).padStart(2, '0')}`
  while (used.has(id)) {
    index += 1
    id = `${character.id}-${spec.mark}${String(index).padStart(2, '0')}`
  }
  return id
}

export const partTextFields = {
  clothes: 'costume',
  mounts: 'mount',
  props: 'prop',
  hairstyles: 'hairstyle',
}

export function partNoteText(character, slot) {
  if (slot === 'clothes') return characterFieldValues(character).costume
  const key = partTextFields[slot]
  return key ? String(character?.[key] || '').trim() : ''
}

export function withPartText(character, slot, text) {
  const key = partTextFields[slot]
  if (!key) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const value = String(text ?? '').trim()
  if (value.length > 10000) throw Object.assign(new Error('描述不能超过10000字'), { status: 400 })
  const next = { ...character, [key]: value }
  if (slot === 'clothes') next.look = characterLookText({ ...characterFieldValues(character), costume: value })
  return next
}

export function partPrompt(character, slot) {
  const background = '灰白纯色背景'
  const note = partNoteText(character, slot)
  if (slot === 'clothes') return `${note || '衣服'}。单独展示这套衣服，不要画人，${background}`
  if (slot === 'mounts') return `${note || '坐骑'}。单独展示这只坐骑，不要画人，${background}`
  if (slot === 'props') return `${note || '道具'}。单独展示这件道具，不要画人，${background}`
  if (slot === 'hairstyles') return `${note || '发型'}。只画这款发型，不要画全身，${background}`
  throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
}

export function appendImageAsset(assets, characterId, slot, asset) {
  if (!partSlots[slot]) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const picture = imageAsset(asset)
  if (!picture) throw Object.assign(new Error('图片资源缺少编号或名称'), { status: 400 })
  let found = false
  const items = (assets?.items || []).map(entry => {
    if (entry.id !== characterId || entry.type !== 'role') return entry
    found = true
    const list = imageAssets(entry[slot]).filter(item => item.id !== picture.id)
    return { ...entry, [slot]: [...list, picture] }
  })
  if (!found) throw Object.assign(new Error('只有人物可以添加衣服、坐骑、道具或发型'), { status: 400 })
  return { ...assets, items }
}

export function pencilPrompt(item) {
  if (item?.format === 'text' && item.prompt?.text) return `一张黑白铅笔分镜，按以下提示词的时间顺序绘制关键画面，格子均匀排列并标注时间码，人物与场景保持一致，不新增剧情。镜头 ${item.id}，${item.duration} 秒。\n${item.prompt.text}`
  const panels = Array.isArray(item?.panels) ? item.panels : []
  if (!panels.length) throw Object.assign(new Error('请先写好这一镜的文本分镜'), { status: 409 })
  const lines = [
    '一张黑白铅笔分镜，所有格子画在同一张图里。细铅笔线，留白，不要上色，不要画成真人照片。',
    `一共 ${panels.length} 格，每格一样大，按时间从左到右、从上到下排列，格子之间留出间距。`,
    `${item.id || ''}，${item.duration || panels.length} 秒，场景：${item.scene || ''}`,
  ]
  for (const panel of panels) {
    lines.push(`${panel.time}：${panel.pose}。镜头：${panel.camera}。位置：${panel.space || '沿用这一镜的空间'}`)
  }
  lines.push('每格左上角用很小的字标时间码。不要大标题，不要水印，不要字幕。整张图的每一格都要完整落在画面内。整张图使用灰白纯色背景。')
  return lines.join('\n')
}

const imageStep = (target, kind, run) => target ? runStep(kind, run, { target }) : run()

async function saveGeneratedImage(target, run, onSaved, signal) {
  return imageStep(target, 'image_save', async () => {
    signal ??= checkContext.getStore()?.signal
    signal?.throwIfAborted()
    const result = await run()
    signal?.throwIfAborted()
    if (onSaved) await onSaved(result)
    return result
  })
}

export async function submitPencilBoard({ directory, track, prompt, home, projectId, episodeId, aspectRatio = '1344x768', backend, fetchImpl, signal, seed = imageSeed(`${track}:${Date.now()}`), stepTarget, onSaved }) {
  const text = String(prompt || '').trim()
  if (!text) throw Object.assign(new Error('没有可提交的铅笔分镜提示词'), { status: 409 })
  await mkdir(directory, { recursive: true })
  const bytes = await generateGatewayImage({
    ...backend, prompt: text, aspectRatio, seed, fetchImpl, signal, stepTarget,
  })
  return saveGeneratedImage(stepTarget, async () => {
    if (!home) await replaceStill(directory, track, 'png', bytes)
    if (home) return saveImageDraft(home, bytes, 'image/png', 'scenes', `${track}-铅笔分镜`, { source: 'generated', projectId, episodeId, itemId: track, prompt: text })
  }, onSaved, signal)
}

export async function readStill(directory, itemId) {
  for (const [mime, ext] of Object.entries(stillExt)) {
    try {
      return { bytes: await readFile(join(directory, `${itemId}.${ext}`)), mime }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  throw Object.assign(new Error('图片不存在'), { code: 'ENOENT' })
}

export const stillByteLimit = 3 * 1024 * 1024

function runFfmpeg(args, spawnImpl) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args])
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.once('error', error => reject(Object.assign(new Error(error.code === 'ENOENT' ? '本机未安装 FFmpeg' : '图片无法压到 3MB 以内'), { status: error.code === 'ENOENT' ? 503 : 502 })))
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(Object.assign(new Error(stderr.trim() || '图片无法压到 3MB 以内'), { status: 502 }))
    })
  })
}

export async function limitStillBytes(bytes, spawnImpl = spawn) {
  if (!bytes?.length) throw Object.assign(new Error('图片是空的'), { status: 502 })
  if (bytes.length < stillByteLimit) return { ext: 'png', bytes }
  const directory = await mkdtemp(join(tmpdir(), 'meiji-still-'))
  const input = join(directory, 'in.bin')
  const output = join(directory, 'out.jpg')
  try {
    await writeFile(input, bytes)
    for (const quality of [8, 12, 16, 20, 28]) {
      await runFfmpeg(['-i', input, '-q:v', String(quality), output], spawnImpl)
      const next = await readFile(output)
      if (next.length && next.length < stillByteLimit) return { ext: 'jpg', bytes: next }
    }
    throw Object.assign(new Error('图片无法压到 3MB 以内'), { status: 502 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function replaceStill(directory, itemId, ext, bytes) {
  await mkdir(directory, { recursive: true })
  await Promise.all(Object.values(stillExt).filter(name => name !== ext).map(name => rm(join(directory, `${itemId}.${name}`), { force: true })))
  await writeFile(join(directory, `${itemId}.${ext}`), bytes, { mode: 0o600 })
}

export async function generateStillFile({ directory, itemId, aspectRatio, backend, projectId, episodeId, home, category = 'props', prompt, seed, fetchImpl, signal, stepTarget, onSaved }) {
  const text = String(prompt || '').trim()
  if (!text) throw Object.assign(new Error('没有可提交的画面提示词'), { status: 400 })
  await mkdir(directory, { recursive: true })
  const bytes = await generateGatewayImage({
    ...backend, prompt: text, aspectRatio, seed, fetchImpl, signal, stepTarget,
  })
  return saveGeneratedImage(stepTarget, async () => {
    const fitted = await limitStillBytes(bytes)
    if (!home) await replaceStill(directory, itemId, fitted.ext, fitted.bytes)
    if (home) return saveImageDraft(home, fitted.bytes, 'image/' + (fitted.ext === 'jpg' ? 'jpeg' : fitted.ext), category, itemId, { source: 'generated', projectId, episodeId, itemId, prompt: text })
    return assetImageUrl(projectId, itemId, seed, episodeId)
  }, onSaved, signal)
}

export async function submitAssetImage({ assets, itemId, aspectRatio, backend, projectId, episodeId, directory, fetchImpl, signal, prepare, referenceBytes, referenceMime, referenceBase64, seed = imageSeed(`${itemId}:${Date.now()}`), home, prompt, stepTarget, onSaved }) {
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || !['role', 'scene', 'prop'].includes(item.type)) throw Object.assign(new Error('只有角色、场景和道具可以生图'), { status: 400 })
  const prepared = prepare ? await prepare(assets) : assets
  const current = prepared.items.find(entry => entry.id === itemId)
  await mkdir(directory, { recursive: true })
  const bytes = await generateGatewayImage({
    ...backend,
    prompt: prompt || imagePrompt(current), aspectRatio, seed, references: referenceBytes ? [{ bytes: referenceBytes, mime: referenceMime }] : [], referenceBase64, fetchImpl, signal, stepTarget,
  })
  return saveGeneratedImage(stepTarget, async () => {
    const fitted = await limitStillBytes(bytes)
    if (!home) await replaceStill(directory, itemId, fitted.ext, fitted.bytes)
    const reference = home ? { pendingImage: await saveImageDraft(home, fitted.bytes, 'image/' + (fitted.ext === 'jpg' ? 'jpeg' : fitted.ext), current.type === 'prop' ? 'props' : current.type === 'role' ? 'characters' : 'scenes', current.name || itemId, { source: 'generated', projectId, episodeId, itemId, prompt: prompt || imagePrompt(current) }) } : { localPath: assetImageUrl(projectId, itemId, seed, episodeId) }
    const items = prepared.items.map(entry => entry.id === itemId ? pictureRecord({ ...entry, ...reference, file: null }) : entry)
    return { ...prepared, items }
  }, onSaved, signal)
}

export async function importAssetImage({ assets, itemId, projectId, episodeId, directory, bytes, mime, home }) {
  const ext = stillExt[mime]
  if (!ext) throw Object.assign(new Error('请上传 PNG、JPG 或 WebP'), { status: 400 })
  if (!bytes?.length) throw Object.assign(new Error('图片是空的'), { status: 400 })
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || !['role', 'scene', 'prop'].includes(item.type)) throw Object.assign(new Error('只有角色、场景和道具可以导入图片'), { status: 400 })
  const version = Date.now()
  await replaceStill(directory, itemId, ext, bytes)
  await rm(join(directory, `${itemId}.job.json`), { force: true })
  const url = assetImageUrl(projectId, itemId, version, episodeId)
  const reference = home ? await savePicture(home, bytes, mime, item.type === 'prop' ? 'props' : item.type === 'role' ? 'characters' : 'scenes', item.name || itemId, { source: 'import', projectId, episodeId, itemId }) : { localPath: url }
  const items = assets.items.map(entry => entry.id === itemId ? pictureRecord({ ...entry, ...reference }) : entry)
  return { ...assets, items }
}

export function clearCharacterImage(assets, itemId) {
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || item.type !== 'role') throw Object.assign(new Error('只有人物可以删除绑定图片'), { status: 400 })
  const items = assets.items.map(entry => {
    if (entry.id !== itemId) return entry
    return { ...entry, image: node(`image:${entry.id}`) }
  })
  return { ...assets, items }
}

export async function saveCharacterReference({ assets, itemId, projectId, episodeId, directory, bytes, mime }) {
  const ext = stillExt[mime]
  if (!ext) throw Object.assign(new Error('请上传 PNG、JPG 或 WebP'), { status: 400 })
  if (!bytes?.length) throw Object.assign(new Error('图片是空的'), { status: 400 })
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || item.type !== 'role') throw Object.assign(new Error('只有人物可以设置参考图'), { status: 400 })
  await replaceStill(directory, `${itemId}-ref`, ext, bytes)
  const reference = { localPath: assetImageUrl(projectId, `${itemId}-ref`, Date.now(), episodeId), mime }
  return { ...assets, items: assets.items.map(entry => entry.id === itemId ? { ...entry, reference } : entry) }
}

export function clearCharacterReference(assets, itemId) {
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || item.type !== 'role') throw Object.assign(new Error('只有人物可以移除参考图'), { status: 400 })
  return { ...assets, items: assets.items.map(entry => entry.id === itemId ? { ...entry, reference: null } : entry) }
}

// 图片接口只负责选取对应的独立组装模块；段落结构由该模块决定。
export function imageSkillPrompt(stage, prompt, project) {
  return render(imageSegments({ stage, project, request: prompt }))
}
