import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { EpisodeSummaryModel } from '../server/prompts/models/episode-summary-model.js'
import { buildEpisodePrompts } from '../server/prompts/episode-prompts.js'
import { checkContext } from '../server/data/operation-context.js'
import { executionContext } from '../server/data/task-store.js'
import { builtinSkillSet } from '../server/data/skill-store.js'
import { builtinSkill } from '../skills/load.js'
import { previewPrompts } from '../server/prompts/preview.js'
import { render } from '../server/prompts/skill-prompts.js'

const root = () => ({ title: '故事标题', summary: { content: '项目设定' }, script: '明确剧本', style: '武侠仙侠', outputLanguage: 'zh-CN', aspectRatio: '1344x768', episodes: [] })
const episode = (id, content, durationSeconds = 150) => ({ id, summary: { content }, durationSeconds })
const middle = () => ({ ...root(), episodes: [episode('next', '后集开头'), episode('target', '本集旧稿'), episode('first', '前集结尾')] })

test('model 通过属性和技能文本生成最终消息，参数与故事资料只在 user', () => {
  const model = new EpisodeSummaryModel({ project: root(), referenceDurationSeconds: 150 })
  model.generationRules = builtinSkill('episode').constraints
  model.outputProtocol = builtinSkill('episode').protocol
  const [system, user] = model.toMessages()
  assert.equal(system.role, 'system')
  assert.equal(user.role, 'user')
  assert.match(system.content, /短剧分集编剧/)
  assert.match(system.content, /durationSeconds 是本次指定范围内的整数秒/)
  assert.doesNotMatch(system.content, /故事标题|明确剧本|本次生成语言|130–170/)
  assert.match(user.content, /任务模式：首次生成/)
  assert.match(user.content, /标题：故事标题/)
  assert.match(user.content, /参考时长：150 秒/)
  assert.match(user.content, /130–170 秒（含边界）/)
  assert.doesNotMatch(system.content + user.content, /画幅|1344x768/)
})

test('实际生成精简重复与审核包装，同时独立审核保留完整标准', () => {
  const prompts = buildEpisodePrompts(root())
  const { system, user } = prompts.generation
  const combined = system + user
  assert.equal(combined.split('你是一名短剧分集编剧').length - 1, 1)
  assert.equal(combined.split('本次生成语言：').length - 1, 1)
  assert.equal(combined.split('130–170').length - 1, 1)
  assert.equal(combined.split('最多 300').length - 1, 1)
  assert.doesNotMatch(system, /FAIL|失败依据|outputLanguage|角色 look|指导技能只细化|durationSeconds":120/)
  assert.match(system, /保持事件因果与时间顺序/)
  assert.doesNotMatch(prompts.review('待审稿').system, /保持事件因果与时间顺序/)
  assert.match(prompts.review('待审稿').system, /【审核标准】/)
  assert.match(prompts.review('待审稿').system, /后续集没有承接前集结尾/)
  assert.match(prompts.review('待审稿').system, /passed 和 issues/)
})

test('首集和无后集明确开场与悬念方向，追加新集延续全部前集', () => {
  const first = buildEpisodePrompts(root()).generation.user
  assert.match(first, /无前集。本集为第 1 集/)
  assert.match(first, /未提供后集剧情/)
  assert.match(first, /危机、新发现或关键抉择/)
  const project = { ...root(), episodes: [episode('b', '第二集事件'), episode('a', '第一集事件')] }
  const next = buildEpisodePrompts(project).generation.user
  assert.match(next, /任务模式：首次生成/)
  assert.match(next, /这一集是第 3 集/)
  assert.ok(next.indexOf('第一集事件') < next.indexOf('第二集事件'))
  assert.match(next, /本集开场承接前集结尾/)
})

test('中间集重新生成使用前后集约束，排除旧稿及历史意见', () => {
  const prompts = checkContext.run({ generationMode: 'regenerate', review: 'HISTORY_OPINION' }, () => buildEpisodePrompts(middle(), 'target', 200))
  const user = prompts.generation.user
  assert.match(user, /这一集是第 2 集/)
  assert.match(user, /前集结尾/)
  assert.match(user, /第 3 集：后集开头/)
  assert.match(user, /不提前演出后集事件/)
  assert.match(user, /180–220/)
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
    assert.match(revision.user, /130–170/)
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
    assert.match(prompts.generation.user, /本次生成语言：English/)
    assert.match(prompts.generation.user, /对白语言：English/)
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
    assert.match(messages[0].content, /合法的 JSON 对象/)
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
  assert.equal((audit.system + audit.user).split('本次生成语言：').length - 1, 1)
  assert.equal((audit.system + audit.user).split('130–170').length - 1, 1)
  assert.doesNotMatch(audit.user, /【修订基稿/)
})

test('人工修订初审使用人工基稿，自动修订复审使用最新失败稿和本轮意见', async () => {
  const { generateEpisode } = await import('../server/generate/story.js')
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
  assert.match(calls[3].user, /自动修订结果验收/)
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
