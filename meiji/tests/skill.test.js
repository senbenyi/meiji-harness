import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentSkills, builtinSkill, stageSkillIds, validateSkills } from '../skills/load.js'
import { buildGenerationPrompt, buildTextPrompts } from '../server/prompts/text-prompts.js'
import { runTextRequest } from '../server/generate/text-request.js'
import { imageSkillPrompt } from '../server/generate/image.js'

const skillsDir = fileURLToPath(new URL('../skills/', import.meta.url))
const textStages = ['episode', 'outline', 'shots', 'shot-revise', 'seconds', 'storyboard', 'image-prompt']
const imageStages = ['character-image', 'scene-image', 'part-image', 'pencil']

test('built-in skills load by field: 12 stages, 5 guidance skills, 6 shared modules', () => {
  const ids = validateSkills()
  assert.deepEqual(stageSkillIds(), ['episode', 'outline', 'shots', 'shot-revise', 'seconds', 'storyboard', 'video', 'image-prompt', 'character-image', 'scene-image', 'part-image', 'pencil'])
  assert.deepEqual(ids.filter(id => id.startsWith('guidance-')), ['guidance-action', 'guidance-dialogue', 'guidance-expression', 'guidance-martial', 'guidance-sound'])
  assert.equal(ids.filter(id => id.startsWith('shared-')).length, 6)
  for (const id of textStages) {
    const skill = builtinSkill(id)
    assert.ok((skill.constraints || skill.parts.generate).trim(), id)
    assert.ok(skill.protocol.trim(), `${id} protocol`)
  }
  for (const id of imageStages) assert.deepEqual(builtinSkill(id).fields, id === 'character-image' ? [] : ['generate'])
  assert.equal(builtinSkill('video').parts.generate, '')
  assert.equal(builtinSkill('guidance-martial').defaultEnabled, false)
})

test('structure errors are reported: stray files, unknown fields and missing shared modules', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'meiji-skills-'))
  try {
    await cp(skillsDir, dir, { recursive: true })
    validateSkills(dir)
    await writeFile(join(dir, 'stages/shots/extra.md'), 'x')
    assert.throws(() => validateSkills(dir), /md 文件/)
    await rm(join(dir, 'stages/shots/extra.md'))
    const meta = JSON.parse(await readFile(join(dir, 'stages/seconds/skill.json'), 'utf8'))
    await writeFile(join(dir, 'stages/seconds/skill.json'), JSON.stringify({ ...meta, unknown: 1 }))
    assert.throws(() => validateSkills(dir), /未知字段 unknown/)
    await writeFile(join(dir, 'stages/seconds/skill.json'), JSON.stringify(meta))
    await rm(join(dir, 'shared/tail-frame.md'))
    assert.throws(() => validateSkills(dir), /tail-frame/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Harness registers only the session agent skill; generation skills are read by code', () => {
  const skills = agentSkills()
  assert.deepEqual(skills.map(skill => skill.name), ['skill-gongyong-panel-generate'])
  assert.match(skills[0].content, /meiji_context_query/)
})

test('every text stage receives the configured language on each request', async () => {
  for (const skill of textStages) {
    for (const outputLanguage of ['zh-CN', 'en']) {
      let body
      const value = await runTextRequest(buildGenerationPrompt({ skill, project: { outputLanguage }, instructions: '中文输入', mode: 'text' }), {
        route: { baseUrl: 'http://model.test/v1', apiKey: 'test', model: 'test' },
        fetchImpl: async (_url, options) => {
          body = JSON.parse(options.body)
          return Response.json({ choices: [{ message: { content: 'Unmodified output' } }] })
        },
      })
      const system = body.messages.find(message => message.role === 'system').content
      assert.ok(system.startsWith(skill === 'episode' ? '【角色与职责】' : '【阶段技能·通用】'), skill)
      assert.ok(system.includes('本次生成语言：' + (outputLanguage === 'en' ? 'English' : '简体中文')))
      assert.ok(system.trimEnd().endsWith('只执行本阶段，不调用其他阶段。'), skill)
      assert.equal(body.messages.find(message => message.role === 'user').content, '【任务与上下文】\n中文输入')
      assert.equal(value, 'Unmodified output')
    }
  }
  const storyboard = buildGenerationPrompt({ skill: 'storyboard', project: {}, instructions: '', mode: 'reference' }).system
  assert.ok(storyboard.includes('文本分镜正文同样遵循本次生成语言'))
  assert.ok(!storyboard.includes('【官方参考'))
  assert.ok(!storyboard.includes('最终 H3 描述使用英文'))
})

test('requests carry only what they need: generation self-checks, review sees acceptance criteria, revision sees boundaries', () => {
  for (const skill of ['episode', 'outline', 'shots', 'seconds', 'storyboard']) {
    const prompts = buildTextPrompts({ skill, project: {}, instructions: 'CTX', mode: 'text' })
    const { generation } = prompts
    const review = prompts.review('DRAFT')
    const revision = prompts.revision('DRAFT', 'FAIL 原因')
    const modify = buildGenerationPrompt({ skill, project: {}, instructions: 'CTX', opinion: '意见', modify: true, mode: 'text' })
    const stage = builtinSkill(skill)
    assert.ok(generation.system.includes(stage.parts.generate), skill)
    assert.ok(generation.system.includes('【自检标准】') && generation.system.includes(stage.parts.review), skill)
    const boundary = /【阶段技能·修订边界】|【共享·修订边界】/
    assert.doesNotMatch(generation.system, boundary, skill)
    assert.ok(modify.system.includes('【自检标准】') && boundary.test(modify.system), skill)
    assert.ok(modify.system.includes('语言一致性优先于修订时的逐字保留'), skill)
    assert.ok(!revision.system.includes('【自检标准】') && boundary.test(revision.system), skill)
    assert.ok(!generation.system.includes('语言一致性优先于修订时的逐字保留'), skill)
    // 审核：不附生成技能；验收标准在 user，PASS/FAIL 协议在 system 结尾。
    if (stage.parts.generate) assert.ok(!review.system.includes(stage.parts.generate) && !review.user.includes(stage.parts.generate), skill)
    if (stage.fixedConstraints) assert.ok(review.system.includes(stage.constraints), skill)
    assert.ok(!(review.system + review.user).includes('【官方参考'), skill)
    assert.ok(review.user.includes('【验收标准') && review.user.includes(stage.parts.review), skill)
    assert.match(review.system, /没有问题只返回 PASS；否则首行 FAIL/)
    assert.equal(review.skill, 'review')
    assert.equal(review.stage, skill)
  }
  // 通用审核只含跨阶段协议；镜头类审核只在镜头阶段加入。
  assert.doesNotMatch(buildTextPrompts({ skill: 'episode', project: {}, instructions: '' }).review('x').system, /可见面审核|尾帧/)
  assert.match(buildTextPrompts({ skill: 'seconds', project: {}, instructions: '' }).review('x').system, /可见面审核/)
  assert.match(buildTextPrompts({ skill: 'storyboard', project: {}, instructions: '' }).review('x').system, /【共享·尾帧协议】/)
  // 流程说明不再发给模型。
  for (const skill of textStages) {
    const { generation } = buildTextPrompts({ skill, project: {}, instructions: '', mode: 'text' })
    assert.doesNotMatch(generation.system, /服务端流程层调度|最多自动修订一次|生成、审核和修订由程序分别发起请求/, skill)
  }
})

test('generation prompts do not inject official references', () => {
  for (const skill of ['shots', 'shot-revise', 'seconds', 'storyboard']) {
    for (const mode of ['', 'text', 'reference']) {
      const system = buildGenerationPrompt({ skill, project: {}, instructions: '', mode }).system
      assert.doesNotMatch(system, /【官方参考|官方规则：|STEP 5\.5|Per-Second Directives/, skill + mode)
    }
  }
  assert.doesNotMatch(imageSkillPrompt('pencil', '画面', {}), /【官方参考|官方规则：|Opt-in 路径/)
})

test('image prompts keep only picture requirements, the configured language and the requested picture', () => {
  for (const name of imageStages) {
    const english = imageSkillPrompt(name, '沙漠里的石洞', { outputLanguage: 'en' })
    assert.ok(name === 'scene-image' ? english.includes(builtinSkill(name).parts.generate.trim()) : english.startsWith(name === 'character-image' ? builtinSkill(name).constraints : builtinSkill(name).parts.generate))
    if (['character-image', 'scene-image'].includes(name)) assert.doesNotMatch(english, /本次生成语言/)
    else assert.ok(english.includes('本次生成语言：English'))
    assert.ok(name === 'scene-image' ? english.includes('画面：沙漠里的石洞') : english.endsWith('沙漠里的石洞'))
    assert.doesNotMatch(english, /身份与职责|只输出本技能要求的产物|意见修订边界|重新生成”和“修改/)
    const defaultLanguage = imageSkillPrompt(name, '画面', {})
    if (['character-image', 'scene-image'].includes(name)) assert.doesNotMatch(defaultLanguage, /本次生成语言/)
    else assert.ok(defaultLanguage.includes('本次生成语言：简体中文'))
    const styled = imageSkillPrompt(name, '画面', { style: '写实电影，国风水墨' })
    if (['character-image', 'scene-image'].includes(name)) assert.doesNotMatch(styled, /项目视觉风格|写实电影|国风水墨/)
    else assert.ok(styled.includes('项目视觉风格：写实电影，国风水墨'))
    const supplemented = imageSkillPrompt(name, '画面', { skills: { additions: { [name]: { generate: '本剧统一暖色' } } } })
    if (name === 'character-image') assert.doesNotMatch(supplemented, /本剧统一暖色/)
    else assert.match(supplemented, name === 'scene-image' ? /【本剧补充】\n本剧统一暖色/ : /本剧补充要求：\n本剧统一暖色/)
  }
  assert.match(imageSkillPrompt('pencil', '画面', {}), /黑白铅笔线稿/)
})

test('guidance skills join the stages that enable them and stay out of summary and image requests', () => {
  const martial = { skills: { guidance: { enabled: ['action', 'martial'] } } }
  const seconds = buildTextPrompts({ skill: 'seconds', project: martial, instructions: '' })
  assert.match(seconds.generation.system, /【武术指导】[\s\S]*本阶段落点（招式、节奏、受力与位置时间线）/)
  assert.match(seconds.generation.system, /【自检·武术指导】/)
  assert.match(seconds.review('x').user, /【验收·武术指导】/)
  assert.doesNotMatch(seconds.generation.system, /【台词指导】/)
  const defaults = buildTextPrompts({ skill: 'storyboard', project: {}, instructions: '' }).generation.system
  for (const label of ['动作指导', '台词指导', '表情指导', '声音指导']) assert.ok(defaults.includes(`【${label}】`), label)
  assert.ok(!defaults.includes('【武术指导】'))
  assert.doesNotMatch(buildGenerationPrompt({ skill: 'episode', project: martial, instructions: '' }).system, /指导】/)
  assert.doesNotMatch(imageSkillPrompt('character-image', '画面', martial), /指导/)
  const order = seconds.generation.system
  assert.ok(order.indexOf('【阶段技能·生成】') < order.indexOf('【武术指导】') && order.indexOf('【武术指导】') < order.indexOf('【自检标准】'))
  assert.ok(order.indexOf('【优先级】') < order.indexOf('【本次输出协议】'))
})


test('固定约束文件允许为空，缺失仍报错，人物图不再有 generate.md', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'meiji-fixed-skills-'))
  try {
    await cp(skillsDir, dir, { recursive: true })
    assert.equal(builtinSkill('character-image').fixedConstraints, true)
    assert.match(builtinSkill('character-image').constraints, /正面全身照/)
    await assert.rejects(readFile(join(dir, 'stages/character-image/generate.md')), { code: 'ENOENT' })
    await writeFile(join(dir, 'constraints/character/generate-character-image.md'), '')
    assert.ok(validateSkills(dir).includes('character-image'))
    await writeFile(join(dir, 'constraints/character/generate-character-image.md'), '   \n')
    assert.ok(validateSkills(dir).includes('character-image'))
    await rm(join(dir, 'constraints/character/generate-character-image.md'))
    assert.throws(() => validateSkills(dir), /ENOENT/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
