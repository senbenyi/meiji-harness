// 职责：新任务的后端选择：自有模型优先，未连接时回退到用户选定的三方渠道模型；旧任务只认快照，不经过此处。
import { runtimeConfig } from '../../config.js'
import { canGenerate, channelBackend, listChannels, probeBackend, readSelection, resolveServer, validateBackend, writeSelection } from '../models/index.js'

const channelModels = (channel, kind) => {
  const models = channel.models[kind]
  return models ? Array.isArray(models) ? models : [models] : []
}
const modelKey = (channel, model) => `${channel.id}:${model.id}`
function catalog(channelList) {
  const result = {}
  for (const channel of channelList) if (channel.enabled) for (const kind of Object.keys(channel.models)) {
    const models = channelModels(channel, kind).map(model => ({ ...model, id: modelKey(channel, model), provider: channel.id }))
    if (models.length) (result[kind] ||= []).push(...models)
  }
  return result
}
export function thirdPartySelection(models, selection = readSelection()) {
  return Object.fromEntries(['image', 'video'].map(kind => {
    const entries = models?.[kind] || [], saved = selection.third_party[kind]
    return [kind, entries.some(model => model.id === saved) ? saved : entries[0]?.id || '']
  }))
}
// 新任务优先自有模型；三方排序读取提供者声明。probe 仅供测试替换连通性探测。
export async function resolveGenerationBackend(kind, { probe } = {}) {
  if (runtimeConfig().ELYSIUM_BACKEND) return runtimeConfig().ELYSIUM_BACKEND
  const channelList = await listChannels(), selected = thirdPartySelection(catalog(channelList))[kind]
  const preferred = channelList.find(channel => channelModels(channel, kind).some(model => modelKey(channel, model) === selected))
  const third = preferred && await channelBackend(preferred.id, kind, selected.slice(selected.indexOf(':') + 1))
  if (!third) return resolveServer(kind)
  try {
    const own = resolveServer(kind)
    if (!await canGenerate(own, kind)) throw new Error('自有图片模型尚未实现生成能力')
    if (probe ? await probe(own) : await probeBackend(own)) return own
  } catch {}
  await validateBackend(third)
  return third
}
export async function thirdPartyModels() {
  const result = catalog(await listChannels())
  return Object.keys(result).length ? result : null
}
export async function thirdPartyChannels() {
  const channelList = await listChannels(), selected = thirdPartySelection(catalog(channelList)).video
  return channelList.map(({ id, label, enabled, models }) => {
    const preferred = channelModels({ models }, 'video').some(model => modelKey({ id }, model) === selected)
    return { id, label, enabled, preferred, models: Object.values(models).flatMap(model => (Array.isArray(model) ? model : [model]).flatMap(item => item.model_ids || [item.model])).filter(Boolean) }
  })
}
export async function selectThirdPartyModel(kind, id, revision) {
  if (!['image', 'video'].includes(kind)) throw Object.assign(new Error('三方模型类型无效'), { status: 400 })
  const models = await thirdPartyModels()
  if (!(models?.[kind] || []).some(model => model.id === id)) throw Object.assign(new Error('三方模型未配置或已关闭'), { status: 400 })
  const selection = readSelection()
  const saved = await writeSelection({ ...selection, third_party: { ...selection.third_party, [kind]: id } }, revision)
  return { revision: saved.revision, selected: id, effect: 'new_jobs', message: '新任务的三方回退使用此模型；旧任务继续使用原模型。' }
}
