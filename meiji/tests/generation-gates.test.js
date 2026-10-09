import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { canGenerate, gateMessage, gateOf, shotsReady, hasFilm, hasStoryboard } from '../shared/generation-gates.js'
import { clearShotDownstream, sourcePatch } from '../shared/project-rules.js'
import { setContent } from '../server/models/data/drama-model.js'
import { stepRunLabel } from '../client/flow-view.js'
test('AI self-check alone unlocks downstream without manual approval',()=>{const p=episodeFixture();assert.equal(canGenerate(p,'shots'),true);assert.equal(shotsReady(p),true);assert.equal(p.shots.review.text,'');p.shots.check.passed=false;assert.equal(canGenerate(p,'storyboard'),false)})
test('镜头表门禁不再要求道具，缺失或未通过也可继续', () => {
  const project = episodeFixture(), props = project.plot.props
  delete project.plot.props
  assert.equal(canGenerate(project, 'shots'), true)
  assert.doesNotMatch(gateMessage(project, 'shots'), /道具尚未提取/)
  project.plot.props = props
  props.check.passed = false
  assert.equal(canGenerate(project, 'shots'), true)
  assert.doesNotMatch(gateMessage(project, 'shots'), /道具自审未通过/)
  props.check.passed = true
  assert.equal(props.items.length, 0)
  assert.equal(canGenerate(project, 'shots'), true)
})
test('seconds changes clear later continuity descendants',()=>{const p=episodeFixture();const patch=clearShotDownstream(p,'seconds','S01');assert.equal(patch.shots.items[0].storyboard.content,null);assert.equal(patch.shots.items[1].seconds.content,null);assert.equal(patch.shots.items[1].storyboard.content,null);assert.deepEqual(patch.shots.items[0].seconds.content,p.shots.items[0].seconds.content)})
test('场景缺失或审核失败不阻断镜头，当前流程跳过场景关卡', () => {
  const project = episodeFixture()
  project.shots.items = []
  project.plot.scenes.items = []; project.plot.scenes.check.passed = false
  assert.equal(canGenerate(project, 'shots'), true)
  assert.equal(gateOf(project), 'shots')
  assert.doesNotMatch(gateMessage(project, 'shots'), /场景卡尚未|场景卡自审未通过/)
  delete project.plot.scenes
  assert.equal(canGenerate(project, 'shots'), true)
  project.plot.characters.check.passed = false
  assert.equal(canGenerate(project, 'shots'), true)
  assert.doesNotMatch(gateMessage(project, 'shots'), /人物角色自审未通过/)
})
test('展示摘要不能通过原始资料编辑覆盖，摘要输入不改变剧情',()=>{const p=episodeFixture();const patch=sourcePatch(p,{summary:'新剧情'});assert.deepEqual(patch.summary,p.summary);assert.equal(patch.plot,undefined);assert.equal(patch.shots,undefined)})
test('episode completion requires every shot exactly once, not only existing storyboards', () => {
  const p = episodeFixture()
  const story = p.shots.items[1].storyboard.content
  p.shots.items[1].storyboard.content = null
  assert.equal(hasStoryboard(p), false)
  p.shots.items[1].storyboard.content = story
  assert.equal(hasStoryboard(p), true)
  assert.equal(hasFilm(p), false)
  for (const shot of p.shots.items) setContent(shot.video, { status: 'ready', url: '/video' }, { passed: true, failures: [] })
  assert.equal(hasFilm(p), true)
  p.shots.items[1].video.status = 'failed'
  assert.equal(hasFilm(p), false)
  p.shots.status = 'failed'
  assert.equal(stepRunLabel(p, 'shots'), '未通过')
})


test('人物生成独立以通过的大纲为前置', () => {
 const p = episodeFixture()
 assert.equal(canGenerate(p, 'characters'), true)
 p.plot.outline.check.passed = false
 assert.equal(canGenerate(p, 'characters'), false)
 assert.equal(gateOf(p), 'outline')
 p.plot.outline.check.passed = true
 p.plot.characters.check.passed = false
 assert.equal(gateOf(p), 'film')
 p.plot.outline.content = null
 assert.equal(canGenerate(p, 'characters'), false)
})
