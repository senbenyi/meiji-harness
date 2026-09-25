import test from 'node:test'
import assert from 'node:assert/strict'
import { allSkills, loadSkill, registeredSkillFiles, skillFilesOnDisk } from '../skills/load.js'
import { askSkill } from '../server/generate/chat.js'

const generationSkills = ['meiji-episode', 'meiji-outline', 'meiji-characters', 'meiji-scenes', 'meiji-shots', 'meiji-revise-shot', 'meiji-shot-seconds', 'meiji-storyboard', 'meiji-revise-image']
const checkedSkills = ['meiji-episode', 'meiji-outline', 'meiji-characters', 'meiji-scenes', 'meiji-shots', 'meiji-revise-shot', 'meiji-shot-seconds', 'meiji-storyboard', 'meiji-film']

test('every generation skill is registered and receives configured language on each request', async () => {
  const registered = allSkills()
  assert.equal(new Set(registered.map(skill => skill.name)).size, registered.length)
  for (const skillName of generationSkills) {
    const skill = loadSkill(skillName)
    for (const outputLanguage of ['zh-CN', 'en']) {
      let body
      const value = await askSkill(skillName, '中文输入', {
        project: { outputLanguage }, route: { baseUrl: 'http://model.test/v1', apiKey: 'test', model: 'test' },
        fetchImpl: async (_url, options) => {
          body = JSON.parse(options.body)
          return Response.json({ choices: [{ message: { content: 'Unmodified output' } }] })
        },
      })
      const system = body.messages.find(message => message.role === 'system').content
      assert.ok(system.startsWith(skill.content))
      assert.ok(system.includes('本次生成语言：' + (outputLanguage === 'en' ? 'English' : '简体中文')))
      assert.equal(body.messages.find(message => message.role === 'user').content, '中文输入')
      assert.equal(value, 'Unmodified output')
    }
  }
})

test('checked skills separate generation rules from self-check rules', () => {
  for (const skillName of checkedSkills) {
    const content = loadSkill(skillName).content
    const generation = /^## (?:生成|2\. 返回形式)$/m.exec(content)
    const check = /^## (?:自检|6\. 返回前核对)$/m.exec(content)
    assert.ok(generation, `${skillName} missing generation rules`)
    assert.ok(check, `${skillName} missing self-check rules`)
    assert.ok(generation.index < check.index, `${skillName} self-check should follow generation`)
  }
})

test('image skills compose configured language and preserve the requested picture', async () => {
  const { imageSkillPrompt } = await import('../server/generate/image.js')
  for (const name of ['meiji-character-image', 'meiji-scene-image', 'meiji-part-image', 'meiji-pencil-image']) {
    const english = imageSkillPrompt(name, '沙漠里的石洞', { outputLanguage: 'en' })
    assert.ok(english.startsWith(loadSkill(name).content))
    assert.ok(english.includes('本次生成语言：English'))
    assert.ok(english.endsWith('沙漠里的石洞'))
    assert.ok(imageSkillPrompt(name, '画面', {}).includes('本次生成语言：简体中文'))
    const styled = imageSkillPrompt(name, '画面', { style: '写实电影，国风水墨' })
    assert.ok(styled.includes('项目视觉风格：写实电影，国风水墨'))
  }
})

test('every skill file is registered exactly once under a panel category', () => {
  assert.deepEqual(registeredSkillFiles(), skillFilesOnDisk())
  for (const skill of allSkills()) {
    assert.ok(['gailan', 'juqing', 'juese', 'jingtou', 'chengpian', 'gongyong'].includes(skill.category), skill.name)
    assert.ok(['generate', 'review'].includes(skill.mode), skill.name)
    const mid = skill.pane ? `${skill.category}-${skill.pane}-${skill.feature}` : `${skill.category}-${skill.feature}`
    assert.match(skill.path, new RegExp(`/skill-${mid}-${skill.mode}\\.md$`))
    assert.equal(skill.path.startsWith('/'), true, skill.name)
  }
})

test('panel skill paths are absolute and openable', async () => {
  const { access } = await import('node:fs/promises')
  const { skillFilePath, knownSkillNames } = await import('../skills/load.js')
  for (const name of knownSkillNames()) {
    const path = skillFilePath(name)
    assert.equal(path.startsWith('/'), true, name)
    await access(path)
  }
})

test('official references are injected into model skills and prompt language is explicit', () => {
  assert.match(loadSkill('meiji-shots').content, /STEP 5.5/)
  assert.match(loadSkill('meiji-shot-seconds').content, /Per-Second Directives/)
  const storyboard = loadSkill('meiji-storyboard').content
  for (const section of ['subject_definitions', 'retention_analysis', 'integrated_multimodal_description', 'detailed_description']) assert.ok(storyboard.includes(section))
  assert.match(storyboard, /Write all six rewrite sections in English/)
  assert.match(loadSkill('meiji-language').content, /例外：H3/)
})
