import test from 'node:test'
import assert from 'node:assert/strict'
import { ShotTableModel } from '../server/prompts/models/shot-table-model.js'
import { EpisodeSecondsModel } from '../server/prompts/models/episode-seconds-model.js'
import { ShotSecondsModel } from '../server/prompts/models/shot-seconds-model.js'
import { TextStoryboardModel } from '../server/prompts/models/text-storyboard-model.js'
import { render } from '../server/prompts/skill-prompts.js'
import { builtinSkill } from '../skills/load.js'
for (const [Model, stage] of [[ShotTableModel, 'shots'], [EpisodeSecondsModel, 'seconds'], [ShotSecondsModel, 'seconds'], [TextStoryboardModel, 'storyboard']]) {
  test(`${Model.name}：共用基础规则，人工修订和自动修订使用各自基稿`, () => {
    const model = new Model({ project: { outputLanguage: 'en' }, instructions: 'UPSTREAM', reviewInstructions: 'UPSTREAM', modify: true, baseContent: 'HUMAN_BASE', opinion: 'HUMAN_OPINION' })
    const creation = model.toGenerateSegments(), review = model.toReviewSegments('LATEST'), revised = model.toReviseSegments('FAILED_BASE', 'FAIL_NEW')
    for (const request of [creation, review, revised]) assert.equal((render(request.system) + render(request.user)).split(builtinSkill(stage).constraints).length - 1, 1)
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

test('给 Model 赋值基础规则后，生成审核修订读取同一属性', () => {
  const model = new ShotTableModel({ instructions: 'UPSTREAM' })
  model.generationRules = 'ASSIGNED_BASE_RULE'
  for (const request of [model.toGenerateSegments(), model.toReviewSegments('LATEST'), model.toReviseSegments('FAILED', 'OPINION')]) assert.equal((render(request.system) + render(request.user)).split('ASSIGNED_BASE_RULE').length - 1, 1)
})

test('单镜修订与整集镜头表共用生成基础，三种编排都保持单镜范围', async () => {
 const { ShotRevisionModel } = await import('../server/prompts/models/shot-revision-model.js')
 const rules = builtinSkill('shots').constraints
 const model = new ShotRevisionModel({ instructions: '仅 S02', modify: true, baseContent: '原镜头', opinion: '新意见' })
 assert.equal(model.generationRules, rules)
 for (const request of [model.toGenerateSegments(), model.toReviewSegments('待审'), model.toReviseSegments('失败稿', '审核意见')]) {
  const text = render(request.system) + render(request.user)
  assert.equal(text.split(rules).length - 1, 1)
  assert.match(text, /只处理本次指定镜头/)
  assert.match(text, /沿用已保存的编号和时长/)
 }
})

test('图片提示词改写由 Model 定义规则，不需要独立基础文件', async () => {
 const { ImagePromptModel } = await import('../server/prompts/models/image-prompt-model.js')
 assert.equal(builtinSkill('image-prompt').constraintFile, undefined)
 const model = new ImagePromptModel({ instructions: '原图描述', modify: true, baseContent: '基稿', opinion: '改为蓝色' })
 for (const request of [model.toGenerateSegments(), model.toReviewSegments('待审'), model.toReviseSegments('失败稿', '新意见')]) {
  const text = render(request.system) + render(request.user)
  assert.match(text, /只修改用户指定的外观/)
  assert.match(text, /不编造素材 ID 或文件地址/)
 }
})


test('shot context omits empty blocks and preserves landmark and light facts', async () => {
 const { shotContext, buildTablePrompts }=await import('../server/prompts/shot-prompts.js')
 const { episodeFixture }=await import('./fixtures/model.js')
 const project=episodeFixture();project.plot.scenes.items[0].landmark='固定地标';project.plot.scenes.items[0].light='东侧光源'
 const prompt=buildTablePrompts({project}).generation
 assert.match(prompt.user,/固定地标/);assert.match(prompt.user,/东侧光源/)
 assert.doesNotMatch(prompt.user,/【上下文：相邻镜头|【上下文：完整镜头表|首帧接续|多模态参考/)
 assert.ok(prompt.user.indexOf('【本次任务】')<prompt.user.indexOf('【上游事实：大纲】'))
 assert.doesNotMatch(shotContext({...project,shots:{items:[]}}),/上下文与衔接边界/)
 assert.doesNotMatch(render(new TextStoryboardModel({project}).toGenerateSegments().system),/镜头表按要求用标题/)
})


test('single target labels distinguish upstream same shot from previous and following shots',async()=>{
 const { episodeFixture }=await import('./fixtures/model.js')
 const { buildStoryboardPrompts, shotContext }=await import('../server/prompts/shot-prompts.js')
 const project=episodeFixture(),shot=project.shots.items[0]
 const context=shotContext(project,'S01')
 assert.doesNotMatch(context,/前镜已发生/);assert.match(context,/后镜尚未发生/)
 const prompts=buildStoryboardPrompts({project,shotId:'S01'},{shot,video:'text',characters:[],scenes:[],refs:'',images:[]})
 assert.match(prompts.generation.user,/仅为 S01 将已通过的每秒指令直接编排/)
 assert.match(prompts.generation.user,/本镜已通过每秒指令/)
 assert.doesNotMatch(prompts.generation.user,/后镜尚未发生|本集摘要|大纲/)
 assert.match(prompts.review('最终提示词').user,/不重新审核此前已通过/)
})
