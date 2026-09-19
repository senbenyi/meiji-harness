import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url).pathname, presets = `${root}harness/.dsh/.agent-presets`
const names = { 'elysium-standard': '标准模式', 'elysium-free': '极乐世界 · 自由', 'elysium-director': '极乐世界 · 导演' }
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

test('Elysium presets include persona and behavior rules', async () => {
  const contents = {}
  for (const id of ['elysium-free', 'elysium-director']) {
    const persona = await readFile(`${presets}/${id}/persona.md`, 'utf8')
    const rules = await readFile(`${presets}/${id}/rules.md`, 'utf8')
    assert.match(rules, /创作质量由系统设置统一控制/)
    assert.doesNotMatch(rules, /\/(?:预览创作|常规创作|高清创作)/)
    contents[id] = { persona, commonRules: rules.split('\n').filter(line => !line.startsWith('# 极乐世界') && !line.includes('用户项目') && !line.includes('call_tools_project_')).join('\n') }
  }
  assert.equal(contents['elysium-free'].persona, contents['elysium-director'].persona)
  assert.equal(contents['elysium-free'].commonRules, contents['elysium-director'].commonRules)
  await assert.rejects(access(`${presets}/elysium-teaching`))
})
