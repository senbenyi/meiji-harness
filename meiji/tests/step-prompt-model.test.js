import test from 'node:test'
import assert from 'node:assert/strict'
import { ShotTableModel, ShotSecondsModel } from '../server/prompts/models/text-step-model.js'
import { TextStoryboardModel } from '../server/prompts/models/text-storyboard-model.js'
import { render } from '../server/prompts/skill-prompts.js'
import { builtinSkill } from '../skills/load-skills.js'
for (const [Model, stage] of [[ShotTableModel, 'shots'], [ShotSecondsModel, 'seconds']]) {
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
test('每秒指令使用单镜职责并保留给定上下文', () => {
  const task = { instructions: '只修改 S02，相邻 S01 与 S03 仅作衔接资料', project: {} }
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
 const { shotContext, buildTablePrompts }=await import('../server/prompts/shot-text-prompts.js')
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
 const { shotContext }=await import('../server/prompts/shot-text-prompts.js')
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
 const { buildTablePrompts, buildSecondsPrompts }=await import('../server/prompts/shot-text-prompts.js')
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
 const { shotContext }=await import('../server/prompts/shot-text-prompts.js')
 const { cardModel }=await import('../shared/drama-model.js')
 const project=episodeFixture()
 project.plot.characters.items.push(cardModel({ id: 'C09', name: '路人', type: 'role', look: '无关人物' }))
 project.plot.scenes.items.push(cardModel({ id: 'E09', name: '码头', type: 'scene', look: '无关场景' }))
 const single=JSON.stringify(shotContext(project,'S01').filter(fact=>fact.title!=='【实体引用清单】'))
 assert.match(single,/旅人/); assert.match(single,/庭院/)
 assert.doesNotMatch(single,/路人|码头|本集摘要/)
 assert.equal(shotContext(project,'S01').find(fact=>fact.title.includes('衔接段')).text.handoffs[0].shotId, 'S02'); assert.equal(shotContext(project,'S01').find(fact=>fact.title.includes('衔接段')).text.handoffs[0].position, 'start'); assert.doesNotMatch(single,/S02：事件/)
 const whole=JSON.stringify(shotContext(project))
 assert.match(whole,/路人/); assert.match(whole,/码头/)
})

test('镜头表三类编排先规划时间和同名分段，不再要求摄影条目', async () => {
 const { buildTablePrompts, buildSingleShotPrompts }=await import('../server/prompts/shot-text-prompts.js')
 const { episodeFixture }=await import('./fixtures/model.js')
 const project=episodeFixture()
 project.shots.items[0].content='标题：发现旧信1\n旅人已发现信件，尚未取出。'
 project.shots.items[1].content='标题：发现旧信2\n旅人取出信件，辨认名字。'
 const table=buildTablePrompts({project})
 for(const message of [table.generation,table.revision('失败稿','时间不足')]) {
  assert.match(message.system,/先按大纲梳理.*估计必要动作.*再分配本集预算/s)
  assert.match(message.system,/发现旧信1.*发现旧信2/s)
  assert.match(message.system,/末尾依次直接加 1、2、3/)
  assert.doesNotMatch(message.system,/- 机位与构图：|- 切镜点与理由：|每镜写明主要景别/)
 }
 const review=table.review('最新镜头表')
 assert.match(review.system,/不要求机位、景别、构图/)
 assert.match(review.system,/不能仅凭人物、(?:场景|地点)相同/)
 assert.doesNotMatch(review.system,/- 调度与机位：|- 景别：|- 切镜：/)
 const single=buildSingleShotPrompts({project,shotId:'S01',review:'只补充必要环境'})
 for(const message of [single.generation,single.revision('标题：发现旧信1\n环境描述不完整的失败稿','缺少环境'),single.review('标题：发现旧信1\n修订正文')]) {
  assert.match(message.system,/基础标题.*分段尾数/s)
  assert.match(message.user,/发现旧信1/)
 }
})

test('每秒指令三类编排携带当前关联布局并允许独立设计摄影，排除其他地点资料及图片', async () => {
 const { buildSecondsPrompts }=await import('../server/prompts/shot-text-prompts.js')
 const { episodeFixture }=await import('./fixtures/model.js')
 const { cardModel }=await import('../shared/drama-model.js')
 const project=episodeFixture()
 project.plot.scenes.items[0].landmark='北侧石拱门'
 project.plot.scenes.items[0].light='西侧月光'
 project.plot.scenes.items[0].image.content={localPath:'/private-scene-image'}
 project.plot.scenes.items.push(cardModel({id:'E09',name:'码头',type:'scene',space:'无关场景布局'}))
 project.plot.props.items.push(cardModel({id:'P01',name:'旧信',type:'prop',description:'封口完整的旧信'}))
 project.shots.items[0].content='旅人【旅人|C01】在庭院【庭院|E01】发现旧信【旧信|P01】，尚未取出。'
 project.shots.items[1].scene='码头'
 project.shots.items[1].content='只供后续镜头的剧情'
 const prompts=buildSecondsPrompts({project,shotId:'S01'})
 for(const message of [prompts.generation,prompts.review('待审内容'),prompts.revision('最新失败稿','补充发现旧信的特写')]) {
  const scene=message.user.match(/【上游事实：本镜关联场景】\n([^\n]+)/)?.[1]
  assert.ok(scene)
  assert.equal(JSON.parse(scene).scenes[0].landmark,'北侧石拱门')
  assert.equal(JSON.parse(scene).scenes[0].light,'西侧月光')
  assert.match(message.user,/封口完整的旧信/)
  assert.doesNotMatch(message.user,/无关场景布局|private-scene-image|只供后续镜头的剧情/)
  assert.doesNotMatch(message.system,/切镜发生在镜头表规定的位置|继承镜头表的景别意图|仅在上游明确剪辑时为 cut/)
 }
 assert.match(prompts.generation.system,/cut 表示本阶段有叙事依据的剪辑切镜/)
 assert.match(prompts.review('待审').system,/上游没有摄影安排不构成遗漏/)
 assert.match(prompts.review('待审').system,/同一画面或切换中超过三名重要人物/)
})

test('镜头表生成修订与审核按小剧情合并，不按动作和摄影切镜拆视频片段', async () => {
 const { buildTablePrompts,buildSingleShotPrompts }=await import('../server/prompts/shot-text-prompts.js')
 const { episodeFixture }=await import('./fixtures/model.js')
 const project=episodeFixture(),prompts=buildTablePrompts({project})
 for(const message of [prompts.generation,prompts.revision('最新失败稿','连续动作合并')]) {
  assert.match(message.system,/不按大纲条目逐条分镜/)
  assert.match(message.system,/景别变化、运镜、特写、反应或动作完成不自动成为视频片段边界/)
  assert.match(message.system,/没有必须保留的边界，就合并/)
  assert.doesNotMatch(message.system,/在动作结果、完整对白、关键反应或可连续承接的中间状态拆段/)
 }
 const review=prompts.review('标题：查阅旧信\n连续呈现查找、取出与辨认。')
 assert.match(review.system,/一个片段含多个动作或故事节拍/)
 assert.match(review.system,/不能仅因短或片段多判失败/)
 const single=buildSingleShotPrompts({project,shotId:'S01',review:'合写连续动作'}).review('单镜修订结果')
 assert.match(single.system,/不要求修改编号、时长或合并相邻片段/)
})

test('每秒三类编排允许整镜连续beat，不设篇幅和5秒节拍上限', async () => {
 const { buildSecondsPrompts }=await import('../server/prompts/shot-text-prompts.js')
 const { episodeFixture }=await import('./fixtures/model.js')
 const prompts=buildSecondsPrompts({project:episodeFixture(),shotId:'S01'})
 for(const message of [prompts.generation,prompts.revision('最新失败稿','合并连续动作'),prompts.review('单段连续动作')]) {
  assert.match(message.system,/覆盖整镜/)
  assert.doesNotMatch(message.system,/350–650|稳定.*合并为 1–5 秒|关键招式细分到亚秒/)
 }
 assert.match(prompts.generation.system,/不设置固定段数或字数配额/)
 assert.match(prompts.review('最新稿').system,/不因 beat 长于 5 秒而失败/)
})

test('镜头表补时编排允许有作用的扩充与旁白，审核不将细化误判成新增主线',async()=>{
 const { buildTablePrompts,buildSingleShotPrompts }=await import('../server/prompts/shot-text-prompts.js')
 const { episodeFixture }=await import('./fixtures/model.js')
 const project=episodeFixture(),prompts=buildTablePrompts({project})
 for(const message of [prompts.generation,prompts.revision('短稿','补足本集时间')]){
  assert.match(message.system,/基础呈现时间不足时.*必要时增加有作用的旁白/s)
  assert.match(message.system,/不能只把片段秒数写长或只报告时间不足/)
  assert.match(message.system,/不能把并行的动作和旁白时间重复相加/)
  assert.match(message.system,/明确禁止旁白或所有人声时/)
  assert.match(message.system,/仅要求无人物对白时，独立画外旁白仍可使用/)
  assert.doesNotMatch(message.system,/不能增加调查.*扩充容量|预算冲突应指出具体缺口/)
 }
 const review=prompts.review('动作与旁白补时后的完整镜头表')
 assert.match(review.system,/合理扩充.*不视为新增主线/s)
 assert.match(review.system,/不因大纲未逐字写出而失败/)
 assert.match(review.system,/新增独立支线、重大线索、人物、地点、关键道具或新危机/)
 const single=buildSingleShotPrompts({project,shotId:'S01',review:'丰富动作和旁白，补足本镜时间'})
 assert.match(single.review('单镜补时稿').system,/补时意见允许在本镜既定事件内丰富动作、反应、环境互动与旁白/)
})

test('每秒生成修订审核继承镜头表补时内容，独立旁白协议无需角色卡',async()=>{
 const { buildSecondsPrompts }=await import('../server/prompts/shot-text-prompts.js')
 const { episodeFixture }=await import('./fixtures/model.js')
 const prompts=buildSecondsPrompts({project:episodeFixture(),shotId:'S01'})
 for(const message of [prompts.generation,prompts.revision('最新失败稿','保留完整旁白')]){
  assert.match(message.system,/镜头表已确定的扩充动作、反应、环境互动与旁白属于本镜依据/)
  assert.match(message.system,/不在本步骤独立新增补时剧情或旁白/)
  assert.match(message.system,/独立画外旁白固定 NARRATOR，delivery 固定 off，无需角色卡/)
  assert.match(message.system,/本镜无对白和旁白时为空数组/)
 }
 const review=prompts.review('每秒补时稿')
 assert.match(review.system,/不因大纲未逐字写出而失败/)
 assert.match(review.system,/NARRATOR.*off/s)
 assert.doesNotMatch(review.system,/【本次输出协议】/)
})
