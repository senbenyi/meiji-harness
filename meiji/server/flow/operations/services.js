// 操作共用的存储与模型服务。
import { normalizeModels } from '../../../models/model-config.js'
import { assetStore } from '../../data/library.js'
import { modelStore } from '../../data/model-settings.js'
import { projectStore } from '../../data/projects.js'

export async function loadModels(models) {
  return normalizeModels(await models.read())
}

export function services(home) {
  return { projects: projectStore(home), models: modelStore(home), library: assetStore(home) }
}
