import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, cp, readFile, rm, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const repo = fileURLToPath(new URL('../', import.meta.url))
for (const kinds of [['tools'], ['ui'], ['tools', 'ui']]) {
  test(`detached packages: ${kinds.join(' + ')}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'elysium independent '))
    try {
      const tools = new Map(), hooks = [], settings = new Map(), modules = new Map(), slots = []
      const ctx = {
        tools: { register(tool) { assert.ok(!tools.has(tool.name)); tools.set(tool.name, tool) } },
        settings: {
          register(name, schema) { assert.ok(!settings.has(name)); settings.set(name, schema({})) },
          get: name => settings.get(name),
        },
        inject(names, callback) { assert.deepEqual(names, ['webServer']) },
        on(event, callback) { assert.equal(event, 'system-prompt/assemble'); hooks.push(callback) },
      }
      for (const kind of kinds) {
        const name = `dsh-elysium-${kind}`, source = join(repo, name), dest = join(root, name)
        await mkdir(dest)
        const scriptDir = kind === 'tools' ? 'build-scripts' : 'scripts'
        const configDir = kind === 'tools' ? '.dsh' : 'config'
        for (const path of ['src', scriptDir, configDir, 'package.json', 'cordis.patch.yml']) {
          await cp(join(source, path), join(dest, path), { recursive: true })
        }
        const pkg = JSON.parse(await readFile(join(dest, 'package.json'), 'utf8'))
        assert.ok(pkg.files.includes(configDir))
        assert.ok(pkg.files.includes('lib'))
        assert.equal(pkg.exports['./client'], './lib/client.js')
        assert.equal(pkg.dsh.client.platform, 'web')
        for (const dep of Object.keys(pkg.dependencies || {})) {
          assert.ok(!dep.startsWith('@dsh-external/'))
          // Supply only declared third-party dependencies, never the sibling plugin.
          const require = createRequire(join(source, 'package.json'))
          const path = fileURLToPath(new URL('./', pathToFileURL(require.resolve(`${dep}/package.json`))))
          await mkdir(join(dest, 'node_modules'), { recursive: true })
          await symlink(path, join(dest, 'node_modules', dep))
        }
        const plugin = await import(pathToFileURL(join(dest, 'src/index.js')))
        plugin.apply(ctx)
        const { clientSource } = await import(pathToFileURL(join(dest, scriptDir, 'client-source.mjs')))
        runInNewContext(clientSource(), { window: { __ModuleLoader__: { load(entry) {
          assert.ok(!modules.has(entry.id), entry.id); modules.set(entry.id, entry.factory)
        } } } })
      }
      const load = name => name === 'react' ? {} : modules.get(name)(load)
      for (const kind of kinds) load(`@dsh-external/dsh-elysium-${kind}`).apply({
        settingsScope: { bind: () => ({}) },
        uiConversation: { events: { register(definition) { assert.equal(definition.kind, 'elysium-media-results') } } },
        slots: { inject: (_, run) => run(), register(spec) { slots.push(spec) } },
      })
      assert.equal(new Set(slots.map(slot => `${slot.name}:${slot.key || slot.id}`)).size, slots.length)
      assert.equal(slots.filter(slot => slot.name === 'tool.call.toolview').length, kinds.includes('tools') ? 2 : 0)
      assert.equal(slots.filter(slot => slot.name === 'conversation.chat.turnTail').length, kinds.includes('tools') ? 1 : 0)
      assert.equal(slots.filter(slot => slot.name === 'settings.section').length, kinds.includes('ui') ? 1 : 0)
      if (kinds.includes('ui')) {
        settings.set('dsh-elysium-ui', { enabled: true, directors: [{ id: 'a', name: 'A', prompt: 'P' }] })
        const agent = { session: { header: { agentPreset: 'standard' }, events: [] } }
        let assembly = { sections: [], tools: [...tools.values()] }
        for (const hook of hooks) { const previous = assembly; assembly = await hook(null, { agent }, async () => previous) }
        assert.ok(assembly.tools.some(tool => tool.name === 'elysium_read_director'))
        assert.equal((await tools.get('elysium_read_director').execute({ id: 'a' }, { agent })).prompt, 'P')
      }
      assert.equal(tools.has('workflow_generate_video'), kinds.includes('tools'))
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}
