// Native Harness skill discovery after copying presets outside this repository.
import { mkdtemp, cp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const host = process.argv[2]
if (!host) throw new Error('Usage: node tests/preset-installation.mjs /path/to/installed/dsh [preset-root]')
const require = createRequire(join(host, 'package.json'))
const { FileSystemSkillProvider } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-skill-filesystem')))
const source = process.argv[3] || fileURLToPath(new URL('../../harness/.agent-presets/', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'elysium detached '))
const profiles = { 'creation-preview': 'preview', 'creation-regular': 'regular', 'creation-hd': 'high-quality' }
try {
  for (const role of ['elysium-director', 'elysium-free', 'elysium-teaching']) {
    const preset = join(root, role)
    await cp(join(source, role), preset, { recursive: true })
    const warnings = []
    const provider = new FileSystemSkillProvider({ get: () => undefined, logger: { warn: message => warnings.push(message) } },
      { signal: new AbortController().signal, invalidate() {} },
      { includeDefaultRoots: false, customSkillDirs: [join(preset, 'skills')], watch: false })
    try {
      const entries = await provider.list({ cwd: root })
      assert.ok(Array.isArray(entries))
      assert.deepEqual(entries.map(entry => entry.name).sort(), Object.keys(profiles).sort())
      for (const entry of entries) {
        const skill = await provider.get(entry, {})
        assert.match(skill.content, new RegExp(`profile="${profiles[entry.name]}"`))
        assert.match(skill.content, /workflow_resume_video/)
      }
      assert.deepEqual(warnings, [])
      const rules = await readFile(join(preset, 'rules.md'), 'utf8')
      for (const name of Object.keys(profiles)) assert.ok(rules.includes(name))
    } finally { await provider.dispose() }
  }
  console.log('PASS: native Harness discovers and loads exactly three creation skills in all copied creative presets')
} finally { await rm(root, { recursive: true, force: true }) }
