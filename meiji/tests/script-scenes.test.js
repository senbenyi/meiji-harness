import test from 'node:test'
import assert from 'node:assert/strict'
import { scriptScenes, episodeScriptScene } from '../shared/script-scenes.js'
import { addEpisode } from '../shared/episode-rules.js'
import { setupModel } from './fixtures/model.js'
import { StoryOutlineModel } from '../server/models/prompts/story-model.js'
import { createRunService } from '../server/flow/runs/run-service.js'
import { useWorkspaces } from './fixtures/host.js'
import { linkStore } from '../server/data/workspace-links.js'
import { episodeDialog } from '../client/project-overview-view.js'
import { JSDOM } from './fixtures/jsdom.js'

const script = '共同设定：兄弟二人。\n第一场：回家\n预计时长：5分钟\n【00:00—01:00】\n哥哥端饼。\n第二场：出门\n预计时长：约4分钟\n【05:00—06:00】\n弟弟撑伞离开。'
test('独立分场标题确定范围，时间小节不拆集', () => {
  const scenes = scriptScenes(script)
  assert.equal(scriptScenes(script.replaceAll('\n', '\r\n')).length, 2)
  assert.deepEqual(scenes.map(s => [s.number, s.title, s.durationSeconds]), [[1, '第一场：回家', 300], [2, '第二场：出门', 240]])
  assert.doesNotMatch(scenes[0].content, /弟弟撑伞|第二场/)
  assert.equal(scenes[1].common, '共同设定：兄弟二人。')
  assert.equal(scriptScenes('武松说：第一场打完了。\n【00:00—01:00】\n继续走。').length, 0)
  assert.equal(episodeScriptScene({ mode: 'free', script }, 3), null)
  assert.equal(episodeScriptScene({ mode: 'script', script: '没有分场' }, 3), null)
  assert.throws(() => episodeScriptScene({ mode: 'script', script }, 3), /共有 2 场/)
})

test('创建下一集采用本场时长，不能超过明确分场数', async t => {
  const e = await setupModel(t)
  const root = { ...await e.store.read(e.id), mode: 'script', script, episodes: [] }
  root.episodes = addEpisode(root, { durationSeconds: 150 }).episodes
  assert.equal(root.episodes[0].durationSeconds, 300)
  root.episodes = addEpisode(root, { durationSeconds: 150 }).episodes
  assert.equal(root.episodes[0].durationSeconds, 240)
  assert.throws(() => addEpisode(root, {}), /共有 2 场/)
})

test('生成修订审核仅提供指定分场和共同设定，人工优先规则保留', () => {
  const project = { mode: 'script', script, episodeNumber: 2, durationSeconds: 240 }
  const model = new StoryOutlineModel({ project })
  for (const messages of [model.toGenerateMessages(), model.toReviseMessages({ baseContent: [{编号:1,时长秒:10,正文:'弟弟离开。'}], opinion: '保留原对白' }), model.toReviewMessages({ content: [{编号:1,时长秒:10,正文:'弟弟离开。'}] })]) {
    const text = messages.map(m => m.content).join('\n')
    assert.match(text, /本集分场边界/); assert.match(text, /弟弟撑伞/); assert.match(text, /共同设定/)
    assert.doesNotMatch(text, /哥哥端饼/)
  }
  const manual = new StoryOutlineModel({ project: { ...project, plot: { outline: { sourceMode: 'manual' } } } })
  assert.match(manual.toReviewMessages({ content: '人工改写' })[1].content, /允许覆盖原始来源/)
})

test('制作目标创建首集也采用分场时长', async t => {
  const e = await setupModel(t); useWorkspaces(t)
  await e.store.save(e.id, { mode: 'script', script, episodes: [] })
  const session = 'session-11111111-1111-4111-8111-111111111111'
  await linkStore(e.home).selectProject(session, e.id, e.store)
  const service = createRunService({ home: e.home, deps: {} }); t.after(() => service.dispose())
  const { run } = await service.plan({ projectId: e.id, goal: { to: 'story', durationSeconds: 150 } }, session)
  assert.equal(run.request.newEpisode.durationSeconds, 300)
})

test('新增弹窗显示对应分场及明确时长，超出场数不能保存', async t => {
  const dom = new JSDOM('<body><main></main></body>'), prior = { document: globalThis.document, window: globalThis.window }
  Object.assign(globalThis, { document: dom.window.document, window: dom.window })
  dom.window.HTMLDialogElement.prototype.show = function () { this.open = true }
  t.after(() => { Object.assign(globalThis, prior); dom.window.close() })
  const root = document.querySelector('main'), open = episodeDialog(root, async () => {})
  open({ mode: 'script', script, episodes: [{ id: 'first' }] })
  assert.equal(root.querySelector('[name=duration]').value, '240')
  assert.match(root.textContent, /第二场：出门/)
  open({ mode: 'script', script, episodes: [{ id: 'second' }, { id: 'first' }] })
  assert.equal(root.querySelector('[type=submit]').disabled, true)
})
