import assert from 'node:assert/strict'
import test from 'node:test'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

test('panel conversion loads exports with no newline, LF, CRLF and trailing whitespace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-client-source-'))
  try {
    await cp(new URL('../scripts', import.meta.url), join(root, 'scripts'), { recursive: true })
    await cp(new URL('../src/client', import.meta.url), join(root, 'src/client'), { recursive: true })
    const { clientSource } = await import(pathToFileURL(join(root, 'scripts/client-source.mjs')))
    for (const ending of ['', '\n', '\r\n', '\n\n \t\r\n']) {
      for (const name of await readdir(join(root, 'src/client/panel'))) {
        const path = join(root, 'src/client/panel', name)
        await writeFile(path, (await readFile(path, 'utf8')).trimEnd() + ending)
      }
      const modules = new Map(), cache = new Map()
      runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: item => modules.set(item.id, item.factory) } } })
      const require = name => { if (name === 'react') return {}; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
      assert.equal(typeof require('elysium-tools/asset-panel').apply, 'function')
      assert.equal(typeof require('elysium-tools/asset-list').AssetList, 'function')
      assert.equal(typeof require('elysium-tools/storyboard').StoryboardList, 'function')
      assert.equal(typeof require('elysium-tools/panel-styles').apply, 'function')
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
