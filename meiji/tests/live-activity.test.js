// 面板「执行中」由进行中的操作推导（计划 第 17、18 节 AC-M1）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { activityOf, liveActivityMark, withLiveActivity } from '../client/live-activity.js'
import { episodeWork } from '../client/project-overview-view.js'

const project = { id: 'p', title: '测试剧', summary: { content: '' }, episodes: [{ id: 'e1', summary: { content: '' } }, { id: 'e2', summary: { content: '' } }] }

test('AC-M1 会话发起的操作排队中，面板该集即为执行中，其他剧集不受影响', () => {
  const tasks = [{ id: 't', projectId: 'p', episodeId: 'e1', action: 'outline', queued: true, initiator: 'session' }]
  const view = withLiveActivity(project, tasks)
  assert.equal(view.episodes[0].activity, 'outline')
  assert.equal(view.episodes[1].activity, null)
  assert.equal(episodeWork(view, 'e1').activity, 'outline')
  assert.equal(episodeWork(view, 'e2').activity, null)
  assert.equal(project.episodes[0].activity, undefined, '不修改传入的项目')
})

test('执行中标记与原服务端 activity 写法一致', () => {
  assert.equal(activityOf({ action: 'episode-generate' }), 'episode')
  assert.equal(activityOf({ action: 'image', itemId: 'C01' }), 'image:C01')
  assert.equal(activityOf({ action: 'film', track: 'S02' }), 'film:S02')
  assert.equal(activityOf({ action: 'seconds' }), 'seconds')
  const view = withLiveActivity(project, [{ projectId: 'p', action: 'episode-generate' }])
  assert.equal(view.activity, 'episode')
  assert.equal(episodeWork(view, 'e2').activity, 'episode')
})

test('操作结束后标记变化，面板据此重绘', () => {
  const running = liveActivityMark(project, [{ projectId: 'p', episodeId: 'e1', action: 'shots' }])
  assert.notEqual(running, liveActivityMark(project, []))
  assert.equal(withLiveActivity(project, []).episodes.every(episode => episode.activity === null), true)
})
