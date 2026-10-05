import { promptData } from './fixtures/prompt-data.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { EpisodeSummaryModel } from '../server/prompts/models/episode-summary-model.js'
import { buildEpisodePrompts } from '../server/prompts/episode-summary-prompts.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { executionContext } from '../server/runtime/task-context.js'
import { builtinSkillSet } from '../server/data/skill-store.js'
import { builtinSkill } from '../skills/load-skills.js'
import { previewPrompts } from '../server/prompts/preview-prompts.js'
import { render } from '../server/prompts/skill-prompts.js'

const root = () => ({ title: '故事标题', summary: { content: '项目设定' }, script: '明确剧本', style: '武侠仙侠', outputLanguage: 'zh-CN', aspectRatio: '1344x768', episodes: [] })
const episode = (id, content, durationSeconds = 150) => ({ id, summary: { content }, durationSeconds })
const middle = () => ({ ...root(), episodes: [episode('next', '后集开头'), episode('target', '本集旧稿'), episode('first', '前集结尾')] })

test('summary separates identity, one-line tasks, rules, source material and language', () => {
  const set = builtinSkillSet()
  set.nodeSupplements = { target: { summary: [{ id: 'rule', content: 'SUMMARY_SUPPLEMENT' }], outline: [{ id: 'other', content: 'OUTLINE_ONLY' }] } }
  executionContext.run({ skillSet: set, skills: new Map() }, () => {
    for (const generationMode of ['regenerate', 'modify']) checkContext.run({ generationMode, review: '本次意见' }, () => {
      const prompts = buildEpisodePrompts(middle(), 'target', 38)
      for (const request of [prompts.generation, prompts.revision('本轮失败摘要', reviewFail('修复转折'))]) {
        assert.equal(request.system.split('【角色与职责】\n')[1].split('\n\n')[0], '你是一名短剧分集编剧。')
        const task = request.user.split('【本次任务】\n')[1].split('\n\n')[0]
        assert.equal(task.split('\n').length, 1)
        assert.match(task, /剧本.*第 2 集摘要.*基础规则和补充规则/)
        assert.doesNotMatch(task, /任务模式|旧摘要|历史意见|只处理|只修改|保留未涉及|500/)
        assert.match(request.system, /【基础规则】\n/)
        assert.match(request.system, /【补充规则】\nSUMMARY_SUPPLEMENT/)
        assert.doesNotMatch(request.system + request.user, /OUTLINE_ONLY|【故事资料】|标题：故事标题/)
        assert.match(request.user, /【本次要求】\n输出语言：简体中文/)
        assert.doesNotMatch(request.user, /本次生成语言|SUPPLEMENT/)
        assert.deepEqual(promptData(request.user, '【项目摘要】'), '项目设定')
        assert.deepEqual(promptData(request.user, '【剧本】'), '明确剧本')
        assert.deepEqual(promptData(request.user, '【本次要求】'), { durationSeconds: 38, style: '武侠仙侠' })
        assert.ok(request.user.indexOf('【本次要求】\n') < request.user.indexOf('【项目摘要】\n'))
      }
      const review = prompts.review('最新摘要')
      assert.equal(review.system.split('【角色与职责】\n')[1].split('\n\n')[0], '你是一名独立剧集摘要审核员。')
      assert.match(review.system, /【补充规则】\n逐条核对以下要求；只审核其是否落实/)
      assert.doesNotMatch(review.user, /遵守基础规则和补充规则|任务模式/)
    })
  })
})

test('summary supplement headings preserve source metadata and isolate episodes', () => {
  const model = new EpisodeSummaryModel({ project: root() })
  const supplement = { source: 'node', title: '【本节点补充要求】', text: '补充正文', nodeKey: 'summary', episodeId: 'target' }
  const before = structuredClone(supplement)
  const request = model.toGenerateSegments({ additions: [supplement] })
  assert.deepEqual(request.system.find(item => item?.source === 'node'), { ...before, title: '【补充规则】' })
  assert.deepEqual(supplement, before)
  const set = builtinSkillSet()
  set.nodeSupplements = { target: { summary: [{ id: 'one', content: 'TARGET_RULE' }] }, next: { summary: [{ id: 'two', content: 'NEXT_RULE' }] } }
  executionContext.run({ skillSet: set, skills: new Map() }, () => {
    const request = buildEpisodePrompts(middle(), 'next').generation
    assert.match(request.system, /NEXT_RULE/);assert.doesNotMatch(request.system, /TARGET_RULE/)
  })
  assert.doesNotMatch(model.toGenerateMessages()[0].content, /【补充规则】/)
})

test('model 通过属性和技能文本生成最终消息，参数与故事资料只在 user', () => {
  const model = new EpisodeSummaryModel({ project: root(), referenceDurationSeconds: 150 })
  model.generationRules = builtinSkill('episode').constraints
  model.outputProtocol = builtinSkill('episode').protocol
  const [system, user] = model.toMessages()
  assert.equal(system.role, 'system')
  assert.equal(user.role, 'user')
  assert.match(system.content, /短剧分集编剧/)
  assert.match(system.content, /只含 summary 字段/)
  assert.match(system.content, /示例（仅示范格式）/)
  assert.match(system.content, /本集时长由用户设定/)
  assert.doesNotMatch(system.content, /故事标题|明确剧本|本集时长：150/)
  assert.match(user.content, /【本次要求】\n输出语言：简体中文/)
  assert.match(user.content, /从剧本提取参考时长能容纳的连续剧情，生成第 1 集摘要/)
  assert.deepEqual(promptData(user.content, '【项目摘要】'), '项目设定')
  assert.deepEqual(promptData(user.content, '【剧本】'), '明确剧本')
  assert.equal(promptData(user.content, '【本次要求】').durationSeconds, 150)
  assert.doesNotMatch(user.content, /本次生成语言|标题：故事标题/)
  assert.doesNotMatch(system.content + user.content, /画幅|1344x768/)
})

test('实际生成精简重复与审核包装，同时独立审核保留完整标准', () => {
  const prompts = buildEpisodePrompts(root())
  const { system, user } = prompts.generation
  const combined = system + user
  assert.equal(combined.split('你是一名短剧分集编剧').length - 1, 1)
  assert.equal(combined.split('输出语言：').length - 1, 1)
  assert.equal(combined.split('【本次要求】').length - 1, 1)
  assert.equal(promptData(user, '【本次要求】').durationSeconds, 150)
  for (const request of [prompts.generation, prompts.revision('最新基稿', reviewFail('修复因果')), prompts.review('待审稿')]) {
    assert.doesNotMatch(request.system + request.user, /最多\s*\d+\s*字|不超过.*字|字数上限/)
  }
  assert.doesNotMatch(system, /FAIL|失败依据|outputLanguage|角色 look|指导技能只细化|durationSeconds":120/)
  assert.match(system, /保持事件因果与时间顺序/)
  assert.doesNotMatch(prompts.review('待审稿').system, /保持事件因果与时间顺序/)
  assert.match(prompts.review('待审稿').system, /【审核标准】/)
  assert.match(prompts.review('待审稿').system, /后续集没有承接前集结尾/)
  assert.match(prompts.review('待审稿').system, /passed 和 issues/)
})

test('首集和无后集明确开场与悬念方向，追加新集延续全部前集', () => {
  const first = buildEpisodePrompts(root()).generation.user
  assert.match(first, /生成第 1 集摘要/)
  assert.doesNotMatch(first, /【前集摘要】\n/)
  assert.doesNotMatch(first, /【后集摘要】\n/)
  assert.match(buildEpisodePrompts(root()).generation.system, /危机、新发现或关键抉择/)
  const project = { ...root(), episodes: [episode('b', '第二集事件'), episode('a', '第一集事件')] }
  const next = buildEpisodePrompts(project).generation.user
  assert.match(next, /从剧本提取参考时长能容纳的连续剧情，生成第 3 集摘要/)
  assert.ok(next.indexOf('第一集事件') < next.indexOf('第二集事件'))
  assert.match(buildEpisodePrompts(project).generation.system, /后续各集承接上一集结尾/)
})

test('中间集重新生成使用前后集约束，排除旧稿及历史意见', () => {
  const prompts = checkContext.run({ generationMode: 'regenerate', review: 'HISTORY_OPINION' }, () => buildEpisodePrompts(middle(), 'target', 200))
  const user = prompts.generation.user
  assert.match(user, /重新生成第 2 集摘要/)
  assert.match(user, /前集结尾/)
  assert.deepEqual(promptData(user, '【后集摘要】').episodes, [{ episodeId: 'next', episodeNumber: 3, durationSeconds: 150, summary: '后集开头' }])
  assert.match(prompts.generation.system, /不在本集提前演出/)
  assert.equal(promptData(user, '【本次要求】').durationSeconds, 200)
  assert.doesNotMatch(user, /本集旧稿|HISTORY_OPINION|【修改基稿】/)
  const preview = previewPrompts({ stage: 'episode', root: middle(), view: { episodeId: 'target' }, skillSet: builtinSkillSet() })
  const actual = buildEpisodePrompts(middle(), 'target').generation
  assert.equal(render(preview.generate.system), actual.system)
  assert.equal(render(preview.generate.user), actual.user)
})

test('人工修改带基稿和意见，自动修订只带最新失败稿并保留本次要求', () => {
  checkContext.run({ generationMode: 'modify', review: '加强最后的抉择', requirements: '只涉及本集事件' }, () => {
    const prompts = buildEpisodePrompts(middle(), 'target', 150)
    assert.match(prompts.generation.user, /【修改基稿】\n.*本集旧稿/)
    assert.match(prompts.generation.user, /【本次修改意见】\n加强最后的抉择/)
    assert.match(prompts.generation.system, /【本次修订范围】/)
    assert.match(prompts.generation.system, /保留未涉及的事件、顺序、结果与内容/)
    const revision = prompts.revision('最新失败稿正文', reviewFail('缺少因果'))
    assert.match(revision.user, /最新失败稿正文/)
    assert.match(revision.user, /缺少因果/)
    assert.match(revision.user, /加强最后的抉择/)
    assert.equal(promptData(revision.user, '【本次要求】').durationSeconds, 150)
    assert.equal(revision.user.split('只涉及本集事件').length - 1, 1)
    assert.doesNotMatch(revision.user, /本集旧稿|【修改基稿】|任务模式：重新生成/)
    assert.match(prompts.review('修改后').user, /加强最后的抉择|只涉及本集事件/)
  })
})

test('英文参数和节点补充生效，废弃的通用审核修订覆盖不再参与编排', () => {
  const set = builtinSkillSet({ additions: { episode: { common: '本剧创作补充', revise: '本剧修订补充', review: '本剧审核补充' } } })
  set.nodeSupplements = { target: { summary: [{ id: 'node', content: '本节点创作补充' }] } }
  set.skills.episode.parts.common = '基础通用覆盖'
  set.skills.episode.parts.revise = '基础修订覆盖'
  set.skills.episode.parts.review = '独立审核覆盖'
  executionContext.run({ skillSet: set, skills: new Map() }, () => {
    const prompts = buildEpisodePrompts({ ...middle(), outputLanguage: 'en' }, 'target')
    assert.match(prompts.generation.user, /输出语言：English/)
    assert.match(prompts.generation.user, /对白语言：English/)
    assert.doesNotMatch(prompts.generation.user, /本次生成语言/)
    assert.doesNotMatch(prompts.generation.system, /基础通用覆盖/)
    assert.match(prompts.generation.system, /本节点创作补充/)
    assert.doesNotMatch(prompts.generation.system, /独立审核覆盖|本剧审核补充/)
    assert.doesNotMatch(prompts.review('稿件').system, /独立审核覆盖/)
    assert.match(prompts.review('稿件').system, /本节点创作补充/)
    assert.doesNotMatch(prompts.review('稿件').system, /本剧审核补充/)
    assert.doesNotMatch(prompts.revision('稿件', 'FAIL').system, /基础修订覆盖/)
    assert.match(prompts.revision('稿件', 'FAIL').system, /本节点创作补充/)
  })
})

test('三类 model 方法使用独立职责和输出协议，修订接受结构化基稿', () => {
  const model = new EpisodeSummaryModel({ project: root(), generationRules: builtinSkill('episode').constraints,
    outputProtocol: builtinSkill('episode').protocol, reviewRules: builtinSkill('episode').parts.review,
    revisionRules: builtinSkill('episode').parts.revise })
  const generated = model.toGenerateMessages()
  const revised = model.toReviseMessages({ baseContent: { summary: '原摘要', durationSeconds: 150 }, opinion: '修复动机' })
  const reviewed = model.toReviewMessages({ content: { summary: '最新摘要', durationSeconds: 150 } })
  for (const messages of [generated, revised]) {
    assert.match(messages[0].content, /你是一名短剧分集编剧/)
    assert.match(messages[0].content, /返回一个 JSON 对象/)
    assert.doesNotMatch(messages[0].content, /独立剧集摘要审核员|首行 FAIL/)
  }
  assert.match(revised[1].content, /"summary":"原摘要"/)
  assert.match(revised[1].content, /修复动机/)
  assert.match(reviewed[0].content, /你是一名独立剧集摘要审核员/)
  assert.doesNotMatch(reviewed[0].content, /你是一名短剧分集编剧|本次输出协议/)
  assert.equal(reviewed[0].content.split('passed 和 issues').length - 1, 1)
  assert.match(reviewed[1].content, /"summary":"最新摘要"/)
  assert.throws(() => model.toReviseMessages({ opinion: '意见' }), /需要提供基稿/)
})

test('实际审核把验收规则放 system，参数不重复且不带其他阶段模板', () => {
  const audit = buildEpisodePrompts(root()).review('最新内容')
  assert.equal(audit.json, true)
  assert.match(audit.system, /独立剧集摘要审核员/)
  assert.match(audit.system, /【审核标准】/)
  assert.doesNotMatch(audit.system, /【创作约束（仅作验收依据）】/)
  assert.doesNotMatch(audit.user, /【验收标准/)
  assert.doesNotMatch(audit.system + audit.user, /独立审片师|subject_definitions|retention_analysis|outputLanguage|角色 look/)
  assert.equal((audit.system + audit.user).split('输出语言：').length - 1, 1)
  assert.equal((audit.system + audit.user).split('【本次要求】').length - 1, 1)
  assert.equal(promptData(audit.user, '【本次要求】').durationSeconds, 150)
  assert.doesNotMatch(audit.user, /【修订基稿/)
})

test('人工修订初审使用人工基稿，自动修订复审使用最新失败稿和本轮意见', async () => {
  const { generateEpisode } = await import('../server/flow/tasks/text/task-summary.js')
  const initial = JSON.stringify({ summary: '初次修改稿', durationSeconds: 150 })
  const revised = JSON.stringify({ summary: '修复后的最新稿', durationSeconds: 150 })
  const replies = [initial, reviewFail('动机不完整'), revised, reviewPass]
  const calls = []
  const result = await checkContext.run({ generationMode: 'modify', review: '加强抉择', requirements: '保留既定结尾' }, () => generateEpisode({
    project: middle(), episodeId: 'target', referenceDurationSeconds: 150,
    request: async message => { calls.push(message); return replies.shift() },
  }))
  assert.equal(result.summary, '修复后的最新稿')
  assert.equal(calls.length, 4)
  assert.match(calls[1].user, /【修订基稿.*本集旧稿/s)
  assert.match(calls[2].user, /最新失败稿.*初次修改稿/s)
  assert.doesNotMatch(calls[2].user, /本集旧稿/)
  assert.match(calls[3].user, /摘要的自动修订结果/)
  assert.match(calls[3].user, /【修订基稿.*初次修改稿/s)
  assert.match(calls[3].user, /【本轮修订意见】[\s\S]*动机不完整/)
  assert.match(calls[3].user, /【本次修改意见】\n加强抉择/)
  assert.doesNotMatch(calls[3].user, /本集旧稿/)
  for (const call of calls) assert.equal(call.user.split('保留既定结尾').length - 1, 1)
})

test('生成、人工修订、审核、自动修订预览复用独立 model 编排', () => {
  const project = middle()
  const preview = previewPrompts({ stage: 'episode', root: project, view: { episodeId: 'target' }, skillSet: builtinSkillSet() })
  const prompts = buildEpisodePrompts(project, 'target')
  const modify = checkContext.run({ generationMode: 'modify', review: '（此处为人工修改意见）' }, () => buildEpisodePrompts(project, 'target').generation)
  for (const [shown, actual] of [[preview.generate, prompts.generation], [preview.modify, modify],
    [preview.review, prompts.review('（待审内容）')], [preview.revise, prompts.revision('（自审未通过的稿件）', reviewFail('（自审不通过原因）'))]]) {
    assert.equal(render(shown.system), actual.system)
    assert.equal(render(shown.user), actual.user)
  }
})

test('通用文本入口的摘要复审保留人工意见并区分本轮修订意见', async () => {
  const { buildTextPrompts } = await import('../server/prompts/text-prompts.js')
  const prompts = buildTextPrompts({ skill: 'episode', project: root(), instructions: '本集资料', opinion: '保留原结尾' })
  const audit = prompts.review('最新稿', { baseContent: '失败稿', revisionOpinion: '修复动机', revisionReview: true })
  assert.match(audit.user, /【本轮修订意见】\n修复动机/)
  assert.match(audit.user, /【本次修改意见】\n保留原结尾/)
})
