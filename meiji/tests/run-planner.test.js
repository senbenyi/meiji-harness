import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { planRun, invalidatedRunTargets } from '../shared/run-planner.js'
import { normalizeRunGoal } from '../shared/run-templates.js'
import { validateRun, RUN_SCHEMA } from '../shared/run-model.js'
const view = () => ({ ...episodeFixture(), episodeId: 'episode', id: 'project', library: { characters: [], scenes: [], props: [] } })
const checked = result => { validateRun({ schemaVersion: RUN_SCHEMA, id: 'run', projectId: 'project', episodeId: 'episode', events: [], steps: result.steps.map(step => ({ status: 'pending', ...step })) }); return result }

test('各业务模板形成可验证 DAG，预览确定且不修改项目', () => {
  for (const to of ['summary', 'story', 'images', 'shots', 'seconds', 'film', 'assemble', 'project-summary', 'script-revise']) {
    const project = view(), before = structuredClone(project), goal = { to, mode: 'regenerate' }
    const first = checked(planRun(project, goal))
    assert.deepEqual(planRun(project, goal), first)
    assert.deepEqual(project, before)
    assert.ok(first.steps.length)
  }
})
test('剧情人物与场景并行，剧情流程不再生成道具，文本 policy 与 review 只执行授权步骤', () => {
  const result = checked(planRun(view(), { to: 'story', mode: 'regenerate' }))
  const byKey = new Map(result.steps.map(step => [step.key, step]))
  assert.deepEqual(byKey.get('generate@characters').after, byKey.get('generate@scenes').after)
 assert.equal(byKey.has('generate@props'), false)
  assert.deepEqual(planRun(view(), { to: 'story', scope: { only: 'outline' } }, { review: false }).steps.map(step => step.kind), ['generate'])
  assert.deepEqual(planRun(view(), { to: 'story', mode: 'review', scope: { only: 'outline' } }).steps.map(step => step.kind), ['review'])
})
test('人物、场景提取通过后各自展开补图：不作为剧情末端，已就绪时跳过，只读审核不补图', () => {
  const result = checked(planRun(view(), { from: 'story', to: 'shots', mode: 'regenerate' }))
  const byKey = new Map(result.steps.map(step => [step.key, step]))
  for (const kind of ['characters', 'scenes']) {
    const expand = byKey.get(`expand@images:${kind}`)
    assert.deepEqual(expand.after, [byKey.get(`review@${kind}`).id])
    assert.deepEqual(expand.input.goal, { to: 'images', mode: 'generate', scope: { kinds: [kind] } })
    assert.deepEqual(expand.input.policy, { imageConfirm: false })
    assert.notEqual(expand.status, 'skipped')
  }
  // 镜头表只等剧情文本，不等补图。
  const imageIds = new Set(['characters', 'scenes'].map(kind => byKey.get(`expand@images:${kind}`).id))
  assert.ok(!byKey.get('generate@shots').after.some(id => imageIds.has(id)))
  // 补齐生成时剧情已通过：提取与补图都跳过，前置检查据此判定剧情就绪。
  const ready = checked(planRun(view(), { to: 'story' }))
  assert.ok(ready.steps.length && ready.steps.every(step => step.status === 'skipped'))
  assert.ok(!checked(planRun(view(), { to: 'story', mode: 'review' })).steps.some(step => step.kind === 'expand'))
})
test('补图只处理指定类别、缺图的卡，不等待确认；普通生图仍等待确认', () => {
  const project = view()
  const scenesOnly = checked(planRun(project, { to: 'images', mode: 'generate', scope: { kinds: ['scenes'] } }, { imageConfirm: false }))
  assert.deepEqual(scenesOnly.steps.map(step => [step.key, step.status || 'pending']), [['image@image:E01', 'pending']])
  project.plot.characters.items[0].image.content = { assetId: 'a', localPath: '/c.png' }
  const characters = checked(planRun(project, { to: 'images', mode: 'generate', scope: { kinds: ['characters'] } }, { imageConfirm: false }))
  assert.deepEqual(characters.steps.map(step => [step.key, step.status]), [['image@image:C01', 'skipped']])
  assert.ok(checked(planRun(view(), { to: 'images', mode: 'generate' })).steps.some(step => step.kind === 'wait_confirm'))
  // 补图不再要求剧情前置：即使剧情未通过且已授权前置，也不会展开出剧情步骤（防止补图与剧情互相展开）。
  const unready = view(); unready.plot.outline.check.passed = false
  const isolated = checked(planRun(unready, { to: 'images', mode: 'generate', scope: { kinds: ['characters'] } }, { imageConfirm: false, authorizePrereq: ['story@all'] }))
  assert.deepEqual([isolated.prereq, isolated.steps.map(step => step.key)], [[], ['image@image:C01']])
  assert.throws(() => normalizeRunGoal({ to: 'story', scope: { kinds: ['characters'] } }), /图片类别无效/)
  assert.throws(() => normalizeRunGoal({ to: 'images', scope: { kinds: ['outline'] } }), /图片类别无效/)
})
test('缺前置不暗中执行，授权后只插入明确前置，前置依赖也保持可见', () => {
  const project = view(); project.summary.check.passed = false; project.plot.outline.check.passed = false
  const preview = checked(planRun(project, { to: 'story', scope: { only: 'characters' } }))
  assert.ok(preview.prereq.some(item => item.key === 'summary@all'))
  assert.deepEqual(preview.steps.map(step => step.key), ['generate@characters', 'review@characters', 'expand@images:characters'])
  assert.ok(preview.steps[0].input.required.length)
  const authorized = checked(planRun(project, { to: 'story', scope: { only: 'characters' } }, { authorizePrereq: ['summary@all', 'story@outline'] }))
  assert.ok(authorized.steps.some(step => step.target === 'summary' && step.origin === 'prereq'))
  assert.ok(authorized.steps.some(step => step.target === 'outline' && step.origin === 'prereq'))
})
test('未知镜头和卡片使用 expand，不能把旧镜头用于重新规划后的成片', () => {
  const project = view(); project.shots.items = []
  const result = checked(planRun(project, { from: 'story', to: 'film', mode: 'regenerate' }))
  assert.ok(result.steps.some(step => step.kind === 'expand' && step.target === 'images'))
  assert.ok(result.steps.some(step => step.kind === 'expand' && step.target === 'seconds'))
  assert.ok(result.steps.some(step => step.kind === 'expand' && step.target === 'film'))
  assert.ok(!result.steps.some(step => step.target === 'film:S01'))
})
test('单镜意见保留之前各镜内容与删除边界，后续镜头仍按现有级联规则清理', () => {
  const project = view()
  const result = checked(planRun(project, { to: 'shots', scope: { tracks: ['S02'] }, feedback: '修正位置' }))
  assert.deepEqual(result.steps.map(step => [step.kind, step.target]), [['revise', 'shots:S02'], ['re_review', 'shots:S02']])
  assert.ok(!result.deletions.some(item => item.track === 'S01'))
  assert.ok(result.deletions.some(item => item.track === 'S02'))
})
test('已满足目标跳过且不删除，成片按引用图片依赖并逐镜接续前一镜尾帧，前置只挂在缺指令的那一镜', () => {
  const project = view()
  const seconds = checked(planRun(project, { to: 'seconds' }))
  assert.ok(seconds.steps.every(step => step.status === 'skipped')); assert.deepEqual(seconds.deletions, [])
  project.shots.items[0].seconds.check.passed = false
  // 没有既存尾帧引用时，后一镜也等前一镜尾帧：前镜未完成会卡住其后各镜。
  const film = checked(planRun(project, { to: 'film' }))
  const first = film.steps.find(step => step.key === 'storyboard@storyboard:S01')
  const second = film.steps.find(step => step.key === 'storyboard@storyboard:S02')
  assert.ok(first.input.required.some(item => item.key === 'seconds@S01'))
  assert.ok(!second.input.required.some(item => item.key === 'seconds@S01'))
  assert.ok(second.after.includes(film.steps.find(step => step.key === 'tail@film:S01').id))
  assert.deepEqual(first.after, [])
  // 只做单镜时没有同任务的前一镜可等。
  assert.deepEqual(checked(planRun(project, { to: 'film', scope: { tracks: ['S02'] } })).steps.find(step => step.key === 'storyboard@storyboard:S02').after, [])
})
test('图片变更只作废引用镜头及其尾帧链，不作废无关镜头', () => {
  const project = view(); project.shots.items[0].content = '旅人【旅人|C01】'; project.shots.items[0].video.content = { status: 'ready', file: 'test.mp4' }; project.shots.items[1].content = '空镜'
  project.shots.items[1].seconds.content = null; project.shots.items[1].storyboard.content = null
  const targets = invalidatedRunTargets(project, { type: 'image', itemId: 'C01' })
  assert.ok(targets.includes('film:S01')); assert.ok(!targets.includes('film:S02'))
})
test('目标拒绝任意执行字段、非法范围、空意见与反向链', () => {
  for (const goal of [{ to: 'film', actor: 'human' }, { to: 'film', scope: { tracks: ['S01', 'S01'] } }, { to: 'story', mode: 'modify', feedback: ' ' }, { from: 'film', to: 'story' }]) assert.throws(() => normalizeRunGoal(goal))
})
