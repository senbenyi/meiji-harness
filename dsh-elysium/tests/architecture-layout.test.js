// 职责：锁定 Elysium 顶层职责边界，防止旧目录和分散存储入口回流。
import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'

const root = new URL('../src/', import.meta.url)
const exists = url => access(url).then(() => true, () => false)

test('source tree keeps client, server, database, tools, models and generic utils separated', async () => {
  const entries = await readdir(root, { withFileTypes: true })
  assert.deepEqual(entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort(),
    ['client', 'database', 'models', 'server', 'tools', 'utils'])
  for (const legacy of ['business', 'comfyui', 'harness', 'http', 'prompts', 'servers']) {
    assert.equal(await exists(new URL(`${legacy}/`, root)), false, legacy)
  }
  for (const file of ['index.js', 'config.js', 'client/api/media.js', 'client/api/projects.js', 'client/api/directors.js', 'client/api/settings.js',
    'server/http.js', 'server/routes/media.js', 'server/routes/projects.js', 'server/routes/directors.js', 'server/routes/settings.js',
    'server/directors/service.js', 'server/projects/service.js',
    'server/workflows/images/service.js', 'server/workflows/videos/service.js',
    'database/index.js', 'database/json.js', 'database/paths.js', 'database/schemas/projects.js', 'tools/index.js', 'models/protocols/comfyui/client.js',
    'models/managers/runtime/index.js', 'utils/context.js', 'utils/errors.js', 'utils/validation.js']) {
    assert.equal(await exists(new URL(file, root)), true, file)
  }
})

test('database is the centralized persistence module and utils stay business-free', async () => {
  const database = await import('../src/database/index.js')
  for (const name of ['readJson', 'saveJson', 'storageRoot', 'materials', 'directors', 'projects', 'registry', 'selection', 'settings']) {
    assert.ok(database[name], name)
  }
  for (const file of ['context.js', 'errors.js', 'validation.js']) {
    const source = await readFile(new URL(`utils/${file}`, root), 'utf8')
    assert.doesNotMatch(source, /(?:project|director|material|job|workflow|provider|model)/i, file)
  }
  for (const directory of ['managers', 'schemas']) {
    for (const entry of await readdir(new URL(`database/${directory}/`, root))) {
      const source = await readFile(new URL(`database/${directory}/${entry}`, root), 'utf8')
      assert.doesNotMatch(source, /from ['"]\.\.\/\.\.\/server\//, `database/${directory}/${entry}`)
    }
  }
})
