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
const source = process.argv[3] || fileURLToPath(new URL('../../harness/.dsh/.agent-presets/', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'elysium detached '))
const retired = ['creation-video', 'creation-preview', 'creation-regular', 'creation-hd']
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
      assert.ok(entries.every(entry => !retired.includes(entry.name)))
      assert.deepEqual(warnings, [])
      const rules = await readFile(join(preset, 'rules.md'), 'utf8')
      assert.ok(rules.includes('创作质量由系统设置统一控制'))
      for (const name of ['预览创作', '常规创作', '高清创作']) assert.ok(!rules.includes('/' + name))
    } finally { await provider.dispose() }
  }
  console.log('PASS: native Harness no longer discovers retired creation skills or creation commands')
} finally { await rm(root, { recursive: true, force: true }) }
