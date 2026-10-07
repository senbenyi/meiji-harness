import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { targetBusy, withRunActivity } from '../client/run-activity.js'
import { runTabProgress } from '../client/flow-view.js'
test('仅禁用正在执行对象，暂停分支与其他镜头可编辑；项目锁仍保护跨集写入', () => {
  const episode = episodeFixture(), root = { id: 'project', episodes: [episode] }, run = { id: 'run', episodeId: episode.id, status: 'paused', activeSteps: [{ id: 'step', target: 'film:S01', scope: 'episode' }] }
  const view = withRunActivity(root, [run]), work = { ...view.episodes[0], episodeId: episode.id }
  assert.equal(targetBusy(work, 'film:S01'), true)
  assert.equal(targetBusy(work, 'film:S02'), false)
  assert.equal(targetBusy(work, 'characters'), false)
  assert.equal(targetBusy({ ...work, episodeId: 'other' }, 'film:S01'), false)
  assert.equal(targetBusy(work, 'project'), true)
  const projectLocked = withRunActivity(root, [{ ...run, activeSteps: [{ target: 'script', scope: 'project' }] }])
  assert.equal(targetBusy({ ...projectLocked.episodes[0], episodeId: 'other' }, 'film:S02'), true)
})
test('流程标签只计算当前有效对象进度和暂停点', () => {
  const project = { activeRuns: [{ progress: [{ target: 'seconds:S01', total: 2, done: 2, paused: false }, { target: 'seconds:S02', total: 4, done: 3, paused: true }, { target: 'film:S01', total: 2, done: 0, paused: false }] }] }
  assert.deepEqual(runTabProgress(project, 'seconds'), { done: 5, total: 6, paused: true })
  assert.equal(runTabProgress(project, 'summary'), null)
})
test('剧情和资产进度不再计入场景道具提取', () => {
  const project = { activeRuns: [{ progress: [{ target: 'outline', total: 2, done: 2 }, { target: 'characters', total: 2, done: 1 }, { target: 'scenes', total: 2, done: 0, paused: true }, { target: 'props', total: 2, done: 0 }] }] }
  assert.deepEqual(runTabProgress(project, 'script'), { done: 2, total: 2, paused: false })
  assert.deepEqual(runTabProgress(project, 'assets'), { done: 1, total: 2, paused: false })
})


test('既有失败任务只补充当前人物正文版本的原因，成功/新版本/其他集不沿用', () => {
 const episode = episodeFixture(), characters = episode.plot.characters
 characters.check.passed = null; characters.source = { runId: 'failed-run' }
 const root = { id: 'project', episodes: [episode] }
 const history = [{ id: 'failed-run', status: 'failed', episodeId: episode.id, failure: { target: 'characters', message: '人物不支持多造型' } }]
 assert.equal(withRunActivity(root, [], history).episodes[0].charactersFailure, '人物不支持多造型')
 characters.check.passed = true
 assert.equal(withRunActivity(root, [], history).episodes[0].charactersFailure, '')
 characters.check.passed = null; characters.source.runId = 'new-run'
 assert.equal(withRunActivity(root, [], history).episodes[0].charactersFailure, '')
 characters.source.runId = 'failed-run'; history[0].episodeId = 'other'
 assert.equal(withRunActivity(root, [], history).episodes[0].charactersFailure, '')
 history[0].episodeId = episode.id; characters.operation = { id: 'new-step' }
 assert.equal(withRunActivity(root, [], history).episodes[0].charactersFailure, '')
})
