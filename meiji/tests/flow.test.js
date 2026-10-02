import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { canGenerate, gateMessage, shotsReady, hasFilm, hasStoryboard } from '../shared/gates.js'
import { clearShotDownstream, sourcePatch } from '../shared/project-rules.js'
import { setContent } from '../shared/drama-model.js'
import { stepRunLabel } from '../client/flow-view.js'
test('AI self-check alone unlocks downstream without manual approval',()=>{const p=episodeFixture();assert.equal(canGenerate(p,'shots'),true);assert.equal(shotsReady(p),true);assert.equal(p.shots.review.text,'');p.shots.check.passed=false;assert.equal(canGenerate(p,'storyboard'),false)})
test('镜头表门禁指出道具缺失或未通过，空集合通过后可继续', () => {
  const project = episodeFixture(), props = project.plot.props
  delete project.plot.props
  assert.equal(canGenerate(project, 'shots'), false)
  assert.match(gateMessage(project, 'shots'), /道具尚未提取.*剧情页提取道具/)
  project.plot.props = props
  props.check.passed = false
  assert.equal(canGenerate(project, 'shots'), false)
  assert.match(gateMessage(project, 'shots'), /道具自审未通过/)
  props.check.passed = true
  assert.equal(props.items.length, 0)
  assert.equal(canGenerate(project, 'shots'), true)
})
test('upstream changes clear only the selected shot descendants',()=>{const p=episodeFixture();const patch=clearShotDownstream(p,'seconds','S01');assert.equal(patch.shots.items[0].storyboard.content,null);assert.deepEqual(patch.shots.items[1],p.shots.items[1]);assert.deepEqual(patch.shots.items[0].seconds.content,p.shots.items[0].seconds.content)})
test('changing summary resets episode production, retaining new summary',()=>{const p=episodeFixture();const patch=sourcePatch(p,{summary:'新剧情'});assert.equal(patch.summary.content,'新剧情');assert.equal(patch.plot.outline.content,null);assert.equal(patch.shots.items.length,0)})
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
