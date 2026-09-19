// 职责：锁定 Elysium 顶层职责边界，防止旧目录和分散存储入口回流。
import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'

const root = new URL('../src/', import.meta.url)
const exists = url => access(url).then(() => true, () => false)

test('source tree follows session → tools → worker flow with client, server, database and generic utils separated', async () => {
  const entries = await readdir(root, { withFileTypes: true })
  assert.deepEqual(entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort(),
    ['client', 'database', 'server', 'session', 'tools', 'utils', 'worker'])
  for (const legacy of ['business', 'comfyui', 'harness', 'http', 'prompts', 'servers']) {
    assert.equal(await exists(new URL(`${legacy}/`, root)), false, legacy)
  }
  for (const legacy of ['server/jobs', 'server/workflows', 'tools/agent', 'worker/tasks', 'worker/models/managers']) {
    assert.equal(await exists(new URL(`${legacy}/`, root)), false, legacy)
  }
  const worker = await readdir(new URL('worker/', root), { withFileTypes: true })
  assert.deepEqual(worker.filter(entry => entry.isDirectory()).map(entry => entry.name).sort(),
    ['intake', 'manager', 'models', 'results', 'routing', 'runner', 'store'])
  for (const file of ['index.js', 'config.js', 'client/api/media.js', 'client/api/projects.js', 'client/api/directors.js', 'client/api/settings.js',
    'server/http.js', 'server/routes/media.js', 'server/routes/projects.js', 'server/routes/directors.js', 'server/routes/settings.js',
    'server/directors/service.js', 'server/projects/service.js',
    'session/index.js', 'worker/runner/process.js', 'worker/intake/calls.js', 'worker/store/status.js',
    'database/index.js', 'database/json.js', 'database/paths.js', 'database/schemas/projects.js', 'tools/index.js', 'tools/card/workcard.js', 'worker/models/protocols/comfyui/client.js',
    'worker/models/index.js', 'utils/context.js', 'utils/errors.js', 'utils/validation.js']) {
    assert.equal(await exists(new URL(file, root)), true, file)
  }
  assert.equal(await exists(new URL('tools/workcard.js', root)), false, 'tools/workcard.js')
})

test('database is centralized and non-error utils stay business-free', async () => {
  const database = await import('../src/database/index.js')
  for (const name of ['readJson', 'saveJson', 'storageRoot', 'materials', 'directors', 'projects', 'registry', 'selection', 'settings']) {
    assert.ok(database[name], name)
  }
  for (const file of ['context.js', 'validation.js']) {
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

// 依赖方向：session / tools / server → worker/index.js → manager → intake | routing | store | runner | results → models（经 contract 与 ctx）。
test('dependencies flow one way from the session entry through the worker facade to the model layer', async () => {
  const sources = async directory => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory()
    ? sources(new URL(`${entry.name}/`, directory)) : /\.m?js$/.test(entry.name) ? [new URL(entry.name, directory)] : []))).flat()
  const imports = async file => [...(await readFile(file, 'utf8')).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.[^'"]+)['"]/g)].map(match => new URL(match[1], file).pathname)
  const under = (path, directory) => path.startsWith(new URL(directory, root).pathname)
  const facade = new URL('worker/index.js', root).pathname
  for (const file of await sources(root)) {
    const path = file.pathname
    const source = await readFile(file, 'utf8')
    if (under(path, 'worker/')) assert.doesNotMatch(source, /snapshotEvents|agent\??\.session/, path)
    if (/\/providers\/[^/]+\/(?:legacy|resources)\//.test(path)) continue // 运维材料不进入运行包
    for (const target of await imports(file)) {
      if (under(path, 'worker/')) assert.ok(!['session/', 'tools/', 'server/', 'client/'].some(layer => under(target, layer)), `${path} → ${target}`)
      if (['session/', 'tools/', 'server/'].some(layer => under(path, layer)) || path === new URL('index.js', root).pathname) {
        assert.ok(!under(target, 'worker/') || target === facade, `${path} must use worker/index.js, not ${target}`)
      }
      if (under(path, 'session/')) assert.ok(!under(target, 'tools/'), `${path} → ${target}`)
      if (under(path, 'worker/models/')) {
        assert.ok(!['intake/', 'manager/', 'routing/', 'store/', 'runner/', 'results/'].some(layer => under(target, `worker/${layer}`)), `${path} → ${target}`)
      }
    }
  }
})
