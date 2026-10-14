import { readFile, copyFile, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { modelStore } from '../server/data/model-settings.js'
import { defaults } from '../models/model-config.js'

// 显式迁移已保存的模型配置；不在运行时保留旧文本路由。
export async function migrateQwenModels(home) {
  const file = join(home, 'storages', 'meiji', 'models.json')
  const target = JSON.parse(await readFile(new URL('../config/models.json', import.meta.url), 'utf8'))
  let existing
  try { existing = JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const current = existing || await defaults()
  const next = {
    ...current,
    textBaseUrl: target.textBaseUrl,
    chat: { model: target.chat.model },
    story: { model: target.story.model },
  }
  if (existing && JSON.stringify(next) === JSON.stringify(current)) return { changed: false }
  const backup = existing ? `${file}.before-qwen-${Date.now()}.bak` : null
  if (backup) await copyFile(file, backup, constants.COPYFILE_EXCL)
  await modelStore(home).write(next)
  return { changed: true, backup }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const home = process.argv[2] || process.env.DSH_HOME || join(homedir(), '.dsh')
  console.log(JSON.stringify(await migrateQwenModels(home)))
}
