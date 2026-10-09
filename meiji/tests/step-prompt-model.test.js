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
    if (stage === 'shots') { assert.doesNotMatch(render(review.user), /HUMAN_BASE/); assert.match(render(review.user), /HUMAN_OPINION/) }
    else assert.match(render(review.user), /HUMAN_BASE.*HUMAN_OPINION/s)
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
 assert.ok(prompt.user.indexOf('【本次任务】')<prompt.user.indexOf('【剧情大纲】'))
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
 assert.doesNotMatch(whole,/路人|人物资料|关联人物|人物称谓规则/); assert.match(whole,/码头/)
})

test('镜头表三类编排先规划时间和同名分段，不再要求摄影条目', async () => {
 const { buildTablePrompts, buildSingleShotPrompts }=await import('../server/prompts/shot-text-prompts.js')
 const { episodeFixture }=await import('./fixtures/model.js')
 const project=episodeFixture()
 project.shots.items[0].content='标题：发现旧信1\n旅人已发现信件，尚未取出。'
 project.shots.items[1].content='标题：发现旧信2\n旅人取出信件，辨认名字。'
 const table=buildTablePrompts({project})
 for(const message of [table.generation,table.revision('失败稿','时间不足')]) {
  assert.match(message.system,/逐个小段拆分/)
  assert.match(message.system,/使用相同基础标题/)
  assert.match(message.system,/加1、2、3/)
  assert.doesNotMatch(message.system,/- 机位与构图：|- 切镜点与理由：|每镜写明主要景别/)
 }
 const review=table.review('最新镜头表')
 assert.match(review.system,/不要求固定栏目、分段理由、机位、景别/)
 assert.match(review.system,/不能凭个人节奏偏好判失败/)
 assert.doesNotMatch(review.system,/- 调度与机位：|- 景别：|- 切镜：/)
 const single=buildSingleShotPrompts({project,shotId:'S01',review:'只补充必要环境'})
 for(const message of [single.generation,single.revision('标题：发现旧信1\n环境描述不完整的失败稿','缺少环境'),single.review('标题：发现旧信1\n修订正文')]) {
  assert.match(message.system,/基础标题.*分段尾数/s)
  assert.match(message.user,/发现旧信1/)
 }
})

test('镜头表与单镜修订三类请求采用直接叙事，审核兼容旧栏目且只验必要事实', async () => {
 const { buildTablePrompts, buildSingleShotPrompts, buildSecondsPrompts } = await import('../server/prompts/shot-text-prompts.js')
 const { episodeFixture } = await import('./fixtures/model.js')
 const { readShotSections } = await import('../server/flow/steps/step-generate-shot-table.js')
 const { protocols } = await import('../skills/output-protocols.js')
 const project = episodeFixture()
 const narrative = '旅人【旅人|C01】在庭院【庭院|E01】门边取出旧信，说：“这是他的字。”片段结束时信仍未拆封。'
 project.shots.items[0].content = narrative
 for (const prompts of [buildTablePrompts({ project }), buildSingleShotPrompts({ project, shotId: 'S01', review: '保留未拆封状态' })]) {
  for (const message of [prompts.generation, prompts.revision(narrative, '保留原台词')]) {
   assert.match(message.system, /一段或少量自然段(?:直接叙事|的完整叙事)/)
   assert.match(message.system, /不列固定栏目、不解释分段理由|不写固定栏目、拆分理由/)
   assert.doesNotMatch(message.system, /content 内依次写以下条目|每段重复同一结构|- 叙事任务与事件过程：/)
  }
  const review = prompts.review(narrative)
  assert.match(review.system, /直接叙事与已保存的旧栏目正文都可验收/)
  assert.match(review.system, /不.*固定栏目.*分段理由/)
 }
 for (const stage of ['shots', 'shot-revise']) {
  const rows = stage === 'shots'
   ? [{ shotId: 'S01', durationSeconds: 15, title: '取信1', content: narrative }, { shotId: 'S02', durationSeconds: 5, title: '取信2', content: '旅人看着尚未拆封的旧信。' }]
   : JSON.parse(protocols[stage].split(/示例[^\n]*：\n/)[1]).shots
  const parsed = readShotSections(JSON.stringify({ shots: rows }), stage === 'shot-revise' ? 1 : 0)
  assert.equal(parsed.length, rows.length)
  assert.equal(parsed.at(-1).content, `标题：${rows.at(-1).title}\n${rows.at(-1).content}`)
  assert.doesNotMatch(rows.map(r => r.content).join(''), /叙事任务与事件过程：|分段依据：/)
 }
 const prompts = buildSecondsPrompts({ project, shotId: 'S02' })
 assert.match(prompts.generation.system, /不重演其过程或复制摄影安排/)
 assert.match(prompts.review('待审').system, /允许上游有依据的转场、时间省略与机位变化/)
 assert.doesNotMatch(prompts.review('待审').system, /以上一镜已通过指令核对承接/)
 for (const content of [narrative, '- 叙事任务与事件过程：取出旧信。\n- 结束状态与下镜边界：尚未拆封。']) {
  const [parsed] = readShotSections(JSON.stringify({ shots: [{ shotId: 'S01', durationSeconds: 5, title: '取信', content }] }))
  assert.equal(parsed.content, `标题：取信\n${content}`)
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

test('镜头表按小段固定预算拆分，不跨段合镜或增加事件', async () => {
 const { buildTablePrompts }=await import('../server/prompts/shot-text-prompts.js')
 const { episodeFixture }=await import('./fixtures/model.js')
 const prompts=buildTablePrompts({project:episodeFixture()})
 for(const message of [prompts.generation,prompts.revision('最新失败稿','修正拆分')]) {
  assert.match(message.system,/镜头不能跨小段/)
  assert.match(message.system,/每镜不超过15秒，允许15秒/)
  assert.match(message.system,/不复制剧情、追加内容或删减事实凑时长/)
 }
 assert.match(prompts.review('待审正文').system,/不跨段合镜、借秒或重排事件/)
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
