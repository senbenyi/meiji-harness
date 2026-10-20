import { readFile, copyFile, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { modelStore } from '../server/data/model-settings.js'
import { defaults, normalizeModels } from '../models/model-config.js'
import { languageOptions, modelOptions } from '../shared/models/settings_model.js'

// 选择不在固定选项内时回落到默认配置的同类选择。
const valid = (purpose, value) => modelOptions[purpose].some(option => option.value === value?.model)

export async function migrateSettingsModel(home) {
  const file = join(home, 'storages', 'meiji', 'models.json')
  let existing
  try { existing = JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const base = await defaults()
  const current = existing || base
  const languageOk = languageOptions.some(option => option.value === existing?.output_language)
  if (existing?.text && !existing.chat && !existing.story && languageOk && Object.keys(modelOptions).every(purpose => valid(purpose, existing[purpose]))) {
    normalizeModels(existing)
    return { changed: false }
  }
  const { chat, story, ...rest } = current
  const text = [current.text, story, chat].find(value => valid('text', value)) || base.text
  const pick = purpose => valid(purpose, current[purpose]) ? current[purpose] : base[purpose]
  const next = normalizeModels({ ...rest, output_language: languageOk ? current.output_language : (base.output_language || 'zh-CN'), textBaseUrl: current.textBaseUrl || base.textBaseUrl, text, image: pick('image'), video: pick('video') })
  const backup = existing ? `${file}.before-settings-${Date.now()}.bak` : null
  if (backup) await copyFile(file, backup, constants.COPYFILE_EXCL)
  await modelStore(home).write(next)
  return { changed: true, backup }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const home = process.argv[2] || process.env.DSH_HOME || join(homedir(), '.dsh')
  console.log(JSON.stringify(await migrateSettingsModel(home)))
}
