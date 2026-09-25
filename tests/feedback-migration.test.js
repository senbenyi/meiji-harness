import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateFeedback } from '../server/data/feedback-migration.js'
import { normalizeProject, materialize, foldEpisode } from '../server/data/episodes.js'

const failed = text => ({ passed: false, reasons: [text] })

test('legacy workflow metadata migrates to two common fields without duplication or content changes', () => {
  const old = {
    summary: '摘要', outline: '大纲', selfCheck: failed('摘要失败'), outlineSelfCheck: failed('大纲失败'),
    storyboardSelfCheck: failed('整表失败'), assemblySelfCheck: failed('合成失败'),
    characters: { items: [{ id: 'C01', name: 'Mike', imageSelfCheck: failed('图片失败'), partSelfChecks: { props: failed('道具失败') } }] },
    shots: { items: [{ id: 'S01', duration: 15, selfCheck: failed('镜头失败'), secondsSelfCheck: failed('时间段失败'), storyboardSelfCheck: failed('分镜失败') }], check: { passed: false, failures: ['时长不足'] }, review: '不要切碎动作' },
    storyboard: [{ id: 'S01', selfCheck: failed('分镜失败') }], boards: { S01: { selfCheck: failed('铅笔失败') } }, films: { S01: { selfCheck: failed('视频失败') } },
    reviews: { outline: 'approved' }, reviewHistory: [{ action: 'shot-seconds', track: 'S01', text: '旧人工意见', createdAt: '2026-01-01' }],
  }
  const migrated = migrateFeedback(old)
  for (const key of ['summary', 'outline', 'storyboard', 'assembly', 'image:C01', 'image:C01:props', 'shots', 'shot:S01', 'seconds:S01', 'storyboard:S01', 'pencil:S01', 'film:S01']) {
    assert.deepEqual(Object.keys(migrated.feedback[key]).sort(), ['check', 'review'])
    assert.equal(migrated.feedback[key].check.passed, false)
  }
  assert.equal(migrated.feedback.shots.review.text, '不要切碎动作')
  assert.equal(migrated.feedback.outline.review.status, 'approved')
  assert.equal(migrated.feedback['seconds:S01'].review.history[0].text, '旧人工意见')
  assert.deepEqual(migrated.shots, { items: [{ id: 'S01', duration: 15 }] })
  assert.deepEqual(migrated.characters.items[0], { id: 'C01', name: 'Mike' })
  assert.equal(migrated.outline, old.outline)
  assert.equal(migrated.reviewHistory, undefined)
  assert.equal(migrated.reviews, undefined)
  assert.doesNotMatch(JSON.stringify(migrated), /SelfCheck|selfCheck|partSelfChecks/)
  assert.deepEqual(migrateFeedback(migrated), migrated)
  assert.ok(old.selfCheck)
})

test('identical shot IDs keep independent episode feedback through materialize and fold', () => {
  const project = normalizeProject({ id: 'p', episodes: [
    { id: 'e1', shots: { items: [{ id: 'S01', secondsSelfCheck: failed('第一集') }] } },
    { id: 'e2', shots: { items: [{ id: 'S01', secondsSelfCheck: failed('第二集') }] } },
  ] })
  const view = materialize(project, 'e1')
  assert.deepEqual(view.feedback['seconds:S01'].check.failures, ['第一集'])
  view.feedback['seconds:S01'].review.text = '只改第一集'
  const folded = foldEpisode(project, 'e1', view)
  assert.equal(folded.episodes[0].feedback['seconds:S01'].review.text, '只改第一集')
  assert.equal(folded.episodes[1].feedback['seconds:S01'].review.text, '')
  assert.deepEqual(folded.episodes[1].feedback['seconds:S01'].check.failures, ['第二集'])
})
