import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sessionSkills, builtinSkill, builtinSkills, stageSkillIds, validateSkills } from '../skills/load-skills.js'
import { buildTextPrompts } from '../server/prompts/text-prompts.js'
import { render } from '../server/prompts/skill-prompts.js'
const skillsDir = fileURLToPath(new URL('../skills/', import.meta.url))
test('约束只放平铺的功能正文，没有通用审核修订指导 skill', async () => {
  assert.equal(validateSkills().length, 13)
  assert.ok(builtinSkills().every(skill => skill.kind === 'stage' && skill.fixedConstraints && !skill.fields.length))
  assert.deepEqual(stageSkillIds(), ['script-revision', 'project-summary', 'episode', 'outline', 'shots', 'shot-revise', 'seconds', 'storyboard', 'video', 'image-prompt', 'character-image', 'scene-image', 'part-image'])
  const files = await readdir(join(skillsDir, 'task'), { withFileTypes: true })
  assert.deepEqual(files.filter(file => !file.name.startsWith('.')).map(file => file.name).sort(), ["generate-project-summary","revise-script","generate-episode-summary","generate-story-outline","extract-story-characters","extract-story-scenes","extract-story-props","generate-shot-table","generate-seconds-instructions","generate-text-storyboard","generate-video","generate-character-image","generate-scene-image","generate-part-image"].map(name => `${name}-skill.md`).sort())
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
  assert.ok(directories.includes('task') && directories.includes('review') && directories.includes('session'))
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
test('各文本步骤生成与修订使用生产规则、自审只使用对应审核 skill，审核使用统一 JSON 协议', () => {
  for (const stage of ['project-summary', 'script-revision', 'episode', 'outline', 'shots', 'shot-revise', 'seconds', 'image-prompt']) {
    const prompts = buildTextPrompts({ skill: stage, project: { outputLanguage: 'en' }, operation: { action: 'script-revise', requirements: '补结局' }, facts: { targets: [{ kind: 'body' }] }, instructions: 'UPSTREAM' })
    const skill = builtinSkill(stage), rules = skill.constraints
    const review = stage === 'outline' ? skill.reviewRules.outline : skill.review
    assert.ok(review.trim(), stage)
    const count = (request, text) => (request.system + request.user).split(text).length - 1
    for (const request of [prompts.generation, prompts.revision('FAILED', 'REPAIR')]) {
      if (rules) assert.equal(count(request, rules), 1, stage)
      assert.equal(count(request, review), 0, stage)
      assert.match(request.system + request.user, /输出语言：English/)
    }
    assert.equal(count(prompts.review('LATEST'), review), 1, stage)
    if (rules) assert.equal(count(prompts.review('LATEST'), rules), 0, stage)
    assert.match(prompts.review('LATEST').system + prompts.review('LATEST').user, /输出语言：English/)
    assert.match(prompts.review('LATEST').system, stage === 'outline' ? /【审核原则】/ : /【审核方式】/)
    assert.equal(prompts.review('LATEST').system.split('【本次审核协议】').length - 1, 1)
    assert.match(prompts.review('LATEST').system, /passed.*issues/s)
    assert.match(prompts.revision('FAILED', 'REPAIR').user, /FAILED/)
    assert.match(prompts.revision('FAILED', 'REPAIR').user, /REPAIR/)
  }
})

test('每个有自审的功能在 review/ 有独立审核 skill，未登记或缺失文件报错', async () => {
  const reviewed = { 'project-summary': 'review-project-summary-skill.md', 'script-revision': 'review-script-revision-skill.md', episode: 'review-episode-summary-skill.md', shots: 'review-shot-table-skill.md', 'shot-revise': 'review-shot-revision-skill.md',
    seconds: 'review-seconds-instructions-skill.md', storyboard: 'review-text-storyboard-skill.md', 'image-prompt': 'review-image-prompt-skill.md' }
  for (const [id, file] of Object.entries(reviewed)) {
    const skill = builtinSkill(id)
    assert.equal(skill.reviewFile, file)
    assert.ok(skill.review.trim(), id)
    assert.notEqual(skill.review, skill.constraints)
    assert.doesNotMatch(skill.review, /^#{1,6}\s/m)
  }
  const outline = builtinSkill('outline')
  assert.deepEqual(Object.keys(outline.reviewRules), ['outline', 'characters', 'scenes', 'props'])
  for (const [kind, text] of Object.entries(outline.reviewRules)) { assert.ok(text.trim(), kind); assert.notEqual(text, outline.rules[kind]) }
  for (const id of ['video', 'character-image', 'scene-image', 'part-image']) assert.equal(builtinSkill(id).review, '', id)
  const files = (await readdir(join(skillsDir, 'review'))).filter(name => !name.startsWith('.')).sort()
  assert.deepEqual(files, [...Object.values(reviewed), ...Object.values(outline.reviewVariants)].sort())
  const dir = await mkdtemp(join(tmpdir(), 'meiji-review-skills-'))
  try {
    await cp(skillsDir, dir, { recursive: true })
    await writeFile(join(dir, 'review/unused-skill.md'), 'x')
    assert.throws(() => validateSkills(dir), /审核 md 文件 unused-skill.md 未登记/)
    await rm(join(dir, 'review/unused-skill.md'))
    await rm(join(dir, 'review/review-shot-table-skill.md'))
    assert.throws(() => validateSkills(dir), /ENOENT/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
