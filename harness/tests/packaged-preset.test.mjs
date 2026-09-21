import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url).pathname, presets = `${root}harness/.dsh/.agent-presets`
const names = { 'elysium-standard': '标准模式', 'elysium-free': '极乐世界' }
test('all packaged presets retain native capabilities and names', async () => {
  for (const [id, name] of Object.entries(names)) {
    const directory = `${presets}/${id}`, composition = await readFile(`${directory}/agent.cordis.yml`, 'utf8'), preset = await readFile(`${directory}/preset.yml`, 'utf8')
    for (const capability of ['persona', 'skill-filesystem', 'tool-fs', 'planning', 'delegation', 'compaction']) assert.match(composition, new RegExp(`id: ${capability}`))
    assert.match(composition, /id: persona[\s\S]*?config:\s+prefix:/)
    assert.match(composition, /id: command-goal\s+name: '@deepseek-ai\/dsh-command-goal'\s+disabled: true/)
    assert.doesNotMatch(composition, /^  name: (?!['"]?(?:@deepseek-ai\/|cordis:))/m)
    assert.match(composition, /id: delegation[\s\S]*?isolate:/)
    assert.match(preset, new RegExp(`name: ['"]?${name.replace('·', '·')}['"]?`))
    await assert.rejects(access(`${directory}/standard.mjs`))
  }
})

test('Elysium preset delegates creation rules to Skills', async () => {
  const persona = await readFile(`${presets}/elysium-free/persona.md`, 'utf8')
  const rules = await readFile(`${presets}/elysium-free/rules.md`, 'utf8')
  assert.match(persona, /按需加载 Skill/)
  assert.match(rules, /按需加载 Skill/)
  assert.doesNotMatch(persona + rules, /call_tools_|t2va|i2va|交付规则/)
  await assert.rejects(access(`${presets}/elysium-teaching`))
})
