import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sessionSkills, builtinSkill, builtinSkills, stageSkillIds, validateSkills } from '../skills/load.js'
import { buildTextPrompts } from '../server/prompts/text-prompts.js'
import { render } from '../server/prompts/skill-prompts.js'
const skillsDir = fileURLToPath(new URL('../skills/', import.meta.url))
test('约束只放平铺的功能正文，没有独立通用审核修订指导 skill', async () => {
  assert.equal(validateSkills().length, 13)
  assert.ok(builtinSkills().every(skill => skill.kind === 'stage' && skill.fixedConstraints && !skill.fields.length))
  assert.deepEqual(stageSkillIds(), ['episode', 'outline', 'shots', 'shot-revise', 'seconds', 'text-shot', 'storyboard', 'video', 'image-prompt', 'character-image', 'scene-image', 'part-image', 'pencil'])
  const files = await readdir(join(skillsDir, 'task'), { withFileTypes: true })
  assert.deepEqual(files.filter(file => !file.name.startsWith('.')).map(file => file.name).sort(), ["generate-episode-summary","generate-story-outline","extract-story-characters","extract-story-scenes","generate-shot-table","generate-seconds-instructions","generate-text-shot","generate-text-storyboard","generate-video","generate-character-image","generate-scene-image","generate-part-image","generate-pencil-storyboard"].map(name => `${name}-skill.md`).sort())
  assert.ok(files.filter(file => !file.name.startsWith('.')).every(file => file.isFile() && file.name.endsWith('-skill.md')))
  for (const skill of builtinSkills()) {
    assert.doesNotMatch(skill.constraints, /^#{1,6}\s/m)
    for (const rule of Object.values(skill.rules || {})) assert.doesNotMatch(rule, /^#{1,6}\s/m)
  }
  assert.equal(builtinSkill('shot-revise').constraintFile, builtinSkill('shots').constraintFile)
  assert.equal(builtinSkill('shot-revise').constraints, builtinSkill('shots').constraints)
  assert.equal(sessionSkills().length, 1)
  assert.ok(sessionSkills()[0].path.endsWith('/skills/session/panel.md'))
  const directories = (await readdir(skillsDir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
  assert.ok(directories.includes('task') && directories.includes('session'))
  assert.ok(!directories.includes('constraints') && !directories.includes('agent'))
})
test('基础规则空正文有效，缺失与未登记文件报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'meiji-skills-'))
  try {
    await cp(skillsDir, dir, { recursive: true })
    await writeFile(join(dir, 'task/unused.md'), 'x')
    assert.throws(() => validateSkills(dir), /未登记/)
    await rm(join(dir, 'task/unused.md'))
    await writeFile(join(dir, 'task/generate-character-image-skill.md'), '')
    assert.equal(validateSkills(dir).length, 13)
    await rm(join(dir, 'task/generate-character-image-skill.md'))
    assert.throws(() => validateSkills(dir), /ENOENT/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('各文本步骤三类请求共用生产规则且只出现一次，审核保留 PASS/FAIL 边界', () => {
  for (const stage of ['episode', 'outline', 'shots', 'shot-revise', 'seconds', 'text-shot', 'storyboard', 'image-prompt']) {
    const prompts = buildTextPrompts({ skill: stage, project: { outputLanguage: 'en' }, instructions: 'UPSTREAM' })
    const rules = builtinSkill(stage).constraints
    for (const request of [prompts.generation, prompts.review('LATEST'), prompts.revision('FAILED', 'REPAIR')]) {
      if (rules) assert.equal((request.system + request.user).split(rules).length - 1, 1, stage)
      assert.match(request.system + request.user, /本次生成语言：English/)
    }
    assert.match(prompts.review('LATEST').system, /只审核|只验收/)
    assert.match(prompts.review('LATEST').system, /PASS.*FAIL/s)
    assert.match(prompts.revision('FAILED', 'REPAIR').user, /FAILED/)
    assert.match(prompts.revision('FAILED', 'REPAIR').user, /REPAIR/)
  }
})
