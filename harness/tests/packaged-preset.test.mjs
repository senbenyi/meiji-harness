import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url).pathname, presets = `${root}harness/.dsh/.agent-presets`
const names = { 'elysium-standard': '标准模式', 'elysium-teaching': '极乐世界 · 教学', 'elysium-free': '极乐世界 · 自由', 'elysium-director': '极乐世界 · 导演' }
test('all packaged presets retain native capabilities and names', async () => {
  for (const [id, name] of Object.entries(names)) {
    const directory = `${presets}/${id}`, composition = await readFile(`${directory}/agent.cordis.yml`, 'utf8'), preset = await readFile(`${directory}/preset.yml`, 'utf8')
    for (const capability of ['persona', 'skill-filesystem', 'tool-fs', 'planning', 'delegation', 'compaction']) assert.match(composition, new RegExp(`id: ${capability}`))
    assert.match(composition, /id: command-goal\s+name: '@deepseek-ai\/dsh-command-goal'\s+disabled: true/)
    assert.doesNotMatch(composition, /^  name: (?!['"]?(?:@deepseek-ai\/|cordis:))/m)
    assert.match(composition, /id: delegation[\s\S]*?isolate:/)
    assert.match(preset, new RegExp(`name: ['"]?${name.replace('·', '·')}['"]?`))
    await assert.rejects(access(`${directory}/standard.mjs`))
  }
})

test('Elysium presets include persona and command rules', async () => {
  for (const id of ['elysium-teaching', 'elysium-free', 'elysium-director']) {
    await access(`${presets}/${id}/persona.md`); const rules = await readFile(`${presets}/${id}/rules.md`, 'utf8')
    for (const command of ['/预览创作', '/常规创作', '/高清创作']) assert.match(rules, new RegExp(command))
  }
})
