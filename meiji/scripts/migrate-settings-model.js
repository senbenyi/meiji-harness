import { readFile, copyFile, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { modelStore } from '../server/data/model-settings.js'
import { defaults, normalizeModels } from '../models/model-config.js'

export async function migrateSettingsModel(home) {
  const file = join(home, 'storages', 'meiji', 'models.json')
  let existing
  try { existing = JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const base = await defaults()
  const current = existing || base
  if (existing?.text && !existing.chat && !existing.story && (existing.output_language === 'zh-CN' || existing.output_language === 'en')) {
    normalizeModels(existing)
    return { changed: false }
  }
  const { chat, story, ...rest } = current
  const next = normalizeModels({ ...rest, textBaseUrl: current.textBaseUrl || base.textBaseUrl, text: current.text || story || chat || base.text })
  const backup = existing ? `${file}.before-settings-${Date.now()}.bak` : null
  if (backup) await copyFile(file, backup, constants.COPYFILE_EXCL)
  await modelStore(home).write(next)
  return { changed: true, backup }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const home = process.argv[2] || process.env.DSH_HOME || join(homedir(), '.dsh')
  console.log(JSON.stringify(await migrateSettingsModel(home)))
}
