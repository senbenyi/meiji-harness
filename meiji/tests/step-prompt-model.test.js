import test from 'node:test'
import assert from 'node:assert/strict'
import { ShotTableModel } from '../server/prompts/models/text-step-model.js'
import { EpisodeSecondsModel } from '../server/prompts/models/text-step-model.js'
import { ShotSecondsModel } from '../server/prompts/models/text-step-model.js'
import { TextStoryboardModel } from '../server/prompts/models/text-storyboard-model.js'
import { render } from '../server/prompts/skill-prompts.js'
import { builtinSkill } from '../skills/load.js'
for (const [Model, stage] of [[ShotTableModel, 'shots'], [EpisodeSecondsModel, 'seconds'], [ShotSecondsModel, 'seconds']]) {
  test(`${Model.name}：生成与修订用生产规则，自审只用审核 skill，人工修订和自动修订使用各自基稿`, () => {
    const model = new Model({ project: { outputLanguage: 'en' }, instructions: 'UPSTREAM', reviewInstructions: 'UPSTREAM', modify: true, baseContent: 'HUMAN_BASE', opinion: 'HUMAN_OPINION' })
    const creation = model.toGenerateSegments(), review = model.toReviewSegments('LATEST'), revised = model.toReviseSegments('FAILED_BASE', 'FAIL_NEW')
    const count = (request, text) => (render(request.system) + render(request.user)).split(text).length - 1
    for (const request of [creation, revised]) { assert.equal(count(request, builtinSkill(stage).constraints), 1); assert.equal(count(request, builtinSkill(stage).review), 0) }
    assert.equal(count(review, builtinSkill(stage).review), 1)
    assert.equal(count(review, builtinSkill(stage).constraints), 0)
    assert.match(render(creation.user), /HUMAN_BASE/)
    assert.match(render(review.user), /HUMAN_BASE.*HUMAN_OPINION/s)
    assert.match(render(review.user), /LATEST/)
    assert.match(render(revised.user), /FAILED_BASE.*FAIL_NEW.*HUMAN_OPINION/s)
    assert.doesNotMatch(render(revised.user), /HUMAN_BASE/)
  })
}
test('整集与单镜每秒指令使用独立职责，单镜正文仍保留给定上下文', () => {
  const task = { instructions: '只修改 S02，相邻 S01 与 S03 仅作衔接资料', project: {} }
  assert.match(render(new EpisodeSecondsModel(task).toGenerateSegments().system), /整集每秒指令编剧/)
  const single = new ShotSecondsModel(task).toGenerateSegments()
  assert.match(render(single.system), /单镜每秒指令编剧/)
  assert.match(render(single.user), /只修改 S02/)
})

test('给 Model 赋值基础规则后，生成与修订读取该属性，自审不读取', () => {
  const model = new ShotTableModel({ instructions: 'UPSTREAM' })
  model.generationRules = 'ASSIGNED_BASE_RULE'
  for (const request of [model.toGenerateSegments(), model.toReviseSegments('FAILED', 'OPINION')]) assert.equal((render(request.system) + render(request.user)).split('ASSIGNED_BASE_RULE').length - 1, 1)
  assert.doesNotMatch(render(model.toReviewSegments('LATEST').system) + render(model.toReviewSegments('LATEST').user), /ASSIGNED_BASE_RULE/)
})

test('单镜修订与整集镜头表共用生成基础、自审用单镜修订审核 skill，三种编排都保持单镜范围', async () => {
 const { ShotRevisionModel } = await import('../server/prompts/models/text-step-model.js')
 const rules = builtinSkill('shots').constraints, review = builtinSkill('shot-revise').review
 const model = new ShotRevisionModel({ instructions: '仅 S02', modify: true, baseContent: '原镜头', opinion: '新意见' })
 assert.equal(model.generationRules, rules)
 assert.match(review, /修改意见中的具体要求没有落实/)
 for (const [request, kind] of [[model.toGenerateSegments(), 'generate'], [model.toReviewSegments('待审'), 'review'], [model.toReviseSegments('失败稿', '审核意见'), 'revise']]) {
  const text = render(request.system) + render(request.user)
  assert.equal(text.split(rules).length - 1, kind === 'review' ? 0 : 1)
  assert.equal(text.split(review).length - 1, kind === 'review' ? 1 : 0)
  assert.match(text, /只处理本次指定镜头/)
  assert.match(text, /沿用已保存的编号和时长/)
 }
})

test('图片提示词改写由 Model 定义生成规则，自审使用独立审核 skill', async () => {
 const { ImagePromptModel } = await import('../server/prompts/models/text-step-model.js')
 assert.equal(builtinSkill('image-prompt').constraintFile, undefined)
 assert.equal(builtinSkill('image-prompt').reviewFile, 'review-image-prompt-skill.md')
 const model = new ImagePromptModel({ instructions: '原图描述', modify: true, baseContent: '基稿', opinion: '改为蓝色' })
 for (const request of [model.toGenerateSegments(), model.toReviseSegments('失败稿', '新意见')]) {
  const text = render(request.system) + render(request.user)
  assert.match(text, /只修改用户指定的外观/)
  assert.match(text, /不编造素材 ID 或文件地址/)
 }
 const review = render(model.toReviewSegments('待审').system) + render(model.toReviewSegments('待审').user)
 assert.match(review, /【审核标准】/)
 assert.match(review, /用户指定的外观修改没有写入/)
 assert.doesNotMatch(review, /只修改用户指定的外观；其他身份/)
})


test('shot context omits empty blocks and preserves landmark and light facts', async () => {
 const { shotContext, buildTablePrompts }=await import('../server/prompts/shot-prompts.js')
 const { episodeFixture }=await import('./fixtures/model.js')
 const project=episodeFixture();project.plot.scenes.items[0].landmark='固定地标';project.plot.scenes.items[0].light='东侧光源'
 const prompt=buildTablePrompts({project}).generation
 assert.match(prompt.user,/固定地标/);assert.match(prompt.user,/东侧光源/)
 assert.doesNotMatch(prompt.user,/【上下文：相邻镜头|【上下文：完整镜头表|首帧接续|多模态参考/)
 assert.ok(prompt.user.indexOf('【本次任务】')<prompt.user.indexOf('【核心输入：大纲】'))
 assert.doesNotMatch(JSON.stringify(shotContext({...project,shots:{items:[]}})),/上下文与衔接边界/)
 assert.ok(shotContext(project).every(fact => fact.title && fact.text))
 assert.doesNotMatch(render(new TextStoryboardModel({project}).toReviewSegments('正文').system),/镜头表按要求用标题/)
})


test('single target labels distinguish upstream same shot from previous and following shots',async()=>{
 const { episodeFixture }=await import('./fixtures/model.js')
 const { shotContext }=await import('../server/prompts/shot-prompts.js')
 const { buildEditedContentReview }=await import('../server/prompts/text-prompts.js')
 const project=episodeFixture()
 const context=shotContext(project,'S01').map(fact=>fact.title).join('\n')
 assert.doesNotMatch(context,/前镜已发生/);assert.match(context,/后镜尚未发生/)
 const review=buildEditedContentReview({project,stage:'storyboard',shotId:'S01'},'最终提示词')
 assert.match(review.user,/只审核 S01 已编辑的最终提示词/)
 assert.match(review.user,/本镜已通过每秒指令/)
 assert.doesNotMatch(review.user,/后镜尚未发生|本集摘要|大纲/)
 assert.match(review.system,/不重新审核此前已通过/)
})

test('审核请求不带生成指令，审核标准与规则在 system、任务与资料在 user', async () => {
 const { episodeFixture }=await import('./fixtures/model.js')
 const { buildTablePrompts, buildSecondsPrompts }=await import('../server/prompts/shot-prompts.js')
 const project=episodeFixture()
 for (const prompts of [buildTablePrompts({project}), buildSecondsPrompts({project,shotId:'S01'})]) {
  const review=prompts.review('待审')
  assert.match(review.system,/【审核标准】/); assert.doesNotMatch(review.user,/【审核标准】|【基础规则】|【基础生产规则】/)
  assert.match(review.user,/【审核目标】/); assert.doesNotMatch(review.user,/【本次任务】/)
  assert.doesNotMatch(review.user,/一次返回完整镜头表|返回shots JSON数组/)
  assert.match(prompts.generation.system,/【基础规则】/); assert.match(prompts.generation.user,/^【本次任务】/)
 }
})

test('单镜上下文只带本镜及前后镜关联卡片与衔接段，大纲存在时不重复摘要', async () => {
 const { episodeFixture }=await import('./fixtures/model.js')
 const { shotContext }=await import('../server/prompts/shot-prompts.js')
 const { cardModel }=await import('../shared/drama-model.js')
 const project=episodeFixture()
 project.plot.characters.items.push(cardModel({ id: 'C09', name: '路人', type: 'role', look: '无关人物' }))
 project.plot.scenes.items.push(cardModel({ id: 'E09', name: '码头', type: 'scene', look: '无关场景' }))
 const single=JSON.stringify(shotContext(project,'S01').filter(fact=>fact.title!=='【实体引用清单】'))
 assert.match(single,/旅人/); assert.match(single,/庭院/)
 assert.doesNotMatch(single,/路人|码头|本集摘要/)
 assert.match(single,/S02 开场/); assert.doesNotMatch(single,/S02：事件/)
 const whole=JSON.stringify(shotContext(project))
 assert.match(whole,/路人/); assert.match(whole,/码头/)
})
