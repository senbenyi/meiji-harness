// 停止 Harness 后清空项目与生成文件；素材库、模型配置及 Harness 会话保留。
import { mkdir, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function resetRuntimeData(home) {
  if (!home || resolve(home) === '/') throw new Error('必须指定 DSH_HOME')
  const root = join(resolve(home), 'storages', 'meiji')
  const files = await readdir(join(root, 'projects')).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const projects = files.filter(name => /^[0-9a-f-]{36}\.json$/i.test(name)).length
  for (const name of ['projects', 'image-drafts', 'incoming', 'session-projects']) await rm(join(root, name), { recursive: true, force: true })
  const links = join(root, 'workspace-links.json')
  try {
    const data = JSON.parse(await readFile(links, 'utf8'))
    await writeFile(links + '.tmp', JSON.stringify({ ...data, workspaces: {} }, null, 2) + '\n', { mode: 0o600 })
    await rename(links + '.tmp', links)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(join(root, 'projects'), { recursive: true })
  return { projects, cleared: ['projects', 'image-drafts', 'incoming', 'session-projects'], preserved: ['assets', 'models.json', 'Harness 配置与会话'] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[3] !== '--execute') throw new Error('用法（先停止 Harness）：node meiji/scripts/reset-runtime-data.js <DSH_HOME> --execute')
  console.log(JSON.stringify(await resetRuntimeData(process.argv[2]), null, 2))
}
