import { operationRequest } from '../client/operation-request.js'
// 面板「执行中」由进行中的操作推导（计划 第 17、18 节 AC-M1）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { activityOf, liveActivityMark, withLiveActivity } from '../client/live-activity.js'
import { episodeWork } from '../client/project-overview-view.js'

const project = { id: 'p', title: '测试剧', summary: { content: '' }, episodes: [{ id: 'e1', summary: { content: '' } }, { id: 'e2', summary: { content: '' } }] }

test('AC-M1 会话发起的操作排队中，面板该集即为执行中，其他剧集不受影响', () => {
  const tasks = [operationRequest('outline', { id: 't', projectId: 'p', episodeId: 'e1', queued: true, initiator: 'session' })]
  const view = withLiveActivity(project, tasks)
  assert.equal(view.episodes[0].operationActivity, 'outline')
  assert.equal(view.episodes[1].operationActivity, null)
  assert.equal(episodeWork(view, 'e1').operationActivity, 'outline')
  assert.equal(episodeWork(view, 'e2').operationActivity, null)
  assert.equal(project.episodes[0].operationActivity, undefined, '不修改传入的项目')
})

test('执行中标记与原服务端 operationActivity 写法一致', () => {
  assert.equal(activityOf(operationRequest('episode-generate', {  })), 'episode')
  assert.equal(activityOf(operationRequest('image', { itemId: 'C01' })), 'image:C01')
  assert.equal(activityOf({ action: 'film', track: 'S02' }), 'film:S02')
  assert.equal(activityOf({ action: 'seconds' }), 'seconds')
  const view = withLiveActivity(project, [operationRequest('episode-generate', { projectId: 'p' })])
  assert.equal(view.operationActivity, 'episode')
  assert.equal(episodeWork(view, 'e2').operationActivity, 'episode')
})

test('操作结束后标记变化，面板据此重绘', () => {
  const running = liveActivityMark(project, [operationRequest('shots', { projectId: 'p', episodeId: 'e1' })])
  assert.notEqual(running, liveActivityMark(project, []))
  assert.equal(withLiveActivity(project, []).episodes.every(episode => episode.operationActivity === null), true)
})
