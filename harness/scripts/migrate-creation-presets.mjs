// 职责：备份并定向更新创作预设与界面入口，保留历史会话的预设标识。
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export async function migrateCreationPresets(target = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '../.dsh')
  const backup = join(target, 'storages/elysium/runtime/migrations', `project-creation-${Date.now()}`)
  await mkdir(backup, { recursive: true })
  for (const relative of ['.agent-presets', 'settings.yaml', 'profiles/web/cordis.patch.yml']) {
    await cp(join(target, relative), join(backup, relative), { recursive: true, verbatimSymlinks: true }).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
  for (const id of ['_base', 'elysium-creation', 'elysium-director', 'elysium-free', 'elysium-teaching']) await cp(join(source, '.agent-presets', id), join(target, '.agent-presets', id), { recursive: true, verbatimSymlinks: true })
  for (const relative of ['settings.yaml', 'profiles/web/cordis.patch.yml']) {
    const path = join(target, relative)
    let text = await readFile(path, 'utf8')
    text = text.replace(/default: elysium-(?:teaching|free|director)\b/g, 'default: elysium-creation')
    if (relative.endsWith('cordis.patch.yml') && !text.includes('- id: ui-agent-preset')) text += '\n- id: ui-agent-preset\n  disabled: true\n'
    await writeFile(path, text)
  }
  return backup
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await migrateCreationPresets())
