// Run with the installed Harness package directory. No build, install or live-profile writes.
import { mkdtemp, cp, mkdir, rm, readFile, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const host = process.argv[2]
if (!host) throw new Error('Usage: node tests/preset-installation.mjs /path/to/installed/dsh')
const require = createRequire(join(host, 'package.json'))
const yaml = require('js-yaml')
const { discoverPresets } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-agent-presets')))
const { interpolate } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')))
const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ __jsExpr: value }) })])
const source = fileURLToPath(new URL('../', import.meta.url))
const root = await realpath(await mkdtemp(join(tmpdir(), 'elysium detached ')))
try {
  const pkg = join(root, 'installed package'), profile = join(root, 'profile')
  await mkdir(pkg); await mkdir(join(profile, 'node_modules/@dsh-external'), { recursive: true })
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  assert.ok(manifest.files.includes('presets'))
  for (const file of ['package.json', 'cordis.patch.yml', 'presets']) await cp(join(source, file), join(pkg, file), { recursive: true })
  await symlink(pkg, join(profile, 'node_modules/@dsh-external/dsh-elysium-tools'))
  const patch = yaml.load(await readFile(join(pkg, 'cordis.patch.yml'), 'utf8'), { schema })
  const config = interpolate({ baseUrl: pathToFileURL(join(profile, 'cordis.yml')).href }, patch.find(row => row.id === 'agent-presets').config)
  assert.equal(config.roots[0].path, join(pkg, 'presets'))
  const presets = await discoverPresets(config.roots, pathToFileURL(join(host, 'lib/bin.js')).href)
  assert.equal(presets[0].trust, 'system');
  assert.equal(presets.length, 1); assert.equal(presets[0].id, 'elysium'); assert.equal(presets[0].broken, undefined)
  const composition = yaml.load(await readFile(presets[0].path, 'utf8'), { schema })
  const ctx = { baseUrl: pathToFileURL(join(pkg, 'presets/elysium/')).href }
  const standardPath = join(host, 'node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml')
  const standardText = await readFile(standardPath, 'utf8')
  const standard = yaml.load(standardText, { schema })
  const adapter = await import(pathToFileURL(join(pkg, 'presets/elysium/standard.mjs')))
  const { Group } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')))
  let rows
  await adapter.apply({
    fiber: { entry: { parent: { tree: { import: name => import(pathToFileURL(require.resolve(name))) } } } },
    agentPresets: { readComposition: async id => { assert.equal(id, 'standard'); return standardText } },
    loader: { builtins: { group: Group } },
    plugin: (plugin, config) => { assert.equal(plugin, Group); rows = config; return { await: async () => {} } },
  }, interpolate(ctx, composition[0].config))
  for (const row of standard) {
    if (!['persona', 'skill-filesystem'].includes(row.id)) assert.deepEqual(rows.find(item => item.id === row.id), row)
  }
  assert.equal(await readFile(standardPath, 'utf8'), standardText)
  await assert.rejects(adapter.apply({
    fiber: { entry: { parent: { tree: { import: name => import(pathToFileURL(require.resolve(name))) } } } },
    agentPresets: { readComposition: async () => '[]' },
  }, interpolate(ctx, composition[0].config)), /patch failed/)
  const persona = interpolate(ctx, rows.find(row => row.id === 'persona').config)
  const skills = interpolate(ctx, rows.find(row => row.id === 'skill-filesystem').config)
  assert.match(persona.text, /极乐世界/); assert.match(persona.text, /workflow_generate_video/)
  for (const name of ['creation-video', 'creation-drama']) assert.match(await readFile(join(skills.customSkillDirs[0], name, 'SKILL.md'), 'utf8'), /name:/)
  for (const id of ['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-jobs', 'tool-goal', 'planning', 'delegation', 'tool-todo', 'compaction', 'tool-skill', 'tool-ask-user', 'tool-web']) assert.ok(rows.some(row => row.id === id), id)
  // Exercise the actual Loader/Group lifecycle; leaf tools are probes (no shell/network/model calls).
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')))
  const { Loader, EntryTree } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')))
  const runtime = new Context()
  runtime.baseUrl = ctx.baseUrl
  const loader = runtime.plugin(Loader, { baseUrl: ctx.baseUrl })
  await loader.await()
  runtime.loader.builtins.group = Group
  runtime.reflect.provide('agentPresets', { readComposition: async () => standardText })
  const active = new Map()
  class TestTree extends EntryTree {
    write() {} // Same read-only persistence policy as Harness PresetTree.
    import(name) {
      if (name === './standard.mjs') return adapter
      if (name === 'cordis:group') return Group
      if (name.startsWith('@deepseek-ai/dsh-')) return {
        apply(ctx, config) {
          const id = ctx.fiber.entry.options.id
          active.set(id, config)
          ctx.effect(() => () => { active.delete(id) })
        },
      }
      return import(pathToFileURL(require.resolve(name)))
    }
  }
  const tree = new TestTree(runtime)
  try {
    await tree.root.update(composition)
    assert.match(active.get('persona').text, /极乐世界/)
    assert.deepEqual(active.get('skill-filesystem').customSkillDirs, [join(pkg, 'presets/elysium/skills/')])
    assert.ok(active.has(process.platform === 'win32' ? 'tool-pwsh' : 'tool-bash'))
    assert.ok(!active.has(process.platform === 'win32' ? 'tool-bash' : 'tool-pwsh'))
    assert.ok(active.has('tool-subagent')); assert.ok(active.has('plan-mode'))
    assert.ok(tree.store.delegation.subgroup)
  } finally {
    await tree.root.stop()
    await loader.dispose()
  }
  assert.equal(active.size, 0)
  assert.equal(await readFile(standardPath, 'utf8'), standardText)
  assert.deepEqual(yaml.load(await readFile(presets[0].path, 'utf8'), { schema }), composition)
  console.log('PASS: relocated package discovered by native Harness; persona, instructions and skills resolve without app/config or repository .dsh')
} finally { await rm(root, { recursive: true, force: true }) }
