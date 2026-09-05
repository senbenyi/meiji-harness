import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultAssets, defaultPlan } from '../../src/domain/episode.js'
import {
  MANIFEST_SCHEMA_VERSION, manifestFromEpisode, storyHashOf, validateManifest,
} from '../../src/domain/production-manifest.js'

function episodeFixture(overrides = {}) {
  return {
    id: 'episode-01',
    sourceText: '角色在雨夜重逢，完成选择并走向新的生活。',
    targetDurationSec: 40,
    aspectRatio: '9:16',
    stylePrompt: '写实电影光线，竖屏构图',
    castPrompt: '同一位成年角色，黑色短发和蓝色外套',
    ...overrides,
  }
}

function build(overrides = {}, extra = {}) {
  const episode = episodeFixture(overrides)
  const plan = defaultPlan(episode, episode.id, episode.targetDurationSec)
  return manifestFromEpisode({ projectId: 'project-01', episode, plan, assets: defaultAssets(episode), ...extra })
}

test('manifest 覆盖章节与锚点，每章恰好六个镜头', () => {
  const manifest = build()
  assert.equal(manifest.schemaVersion, MANIFEST_SCHEMA_VERSION)
  assert.equal(manifest.scenes.length, 2)
  assert.equal(manifest.shots.length, 12)
  assert.equal(manifest.shots.filter(shot => shot.role === 'start').length, 2)
  for (const scene of manifest.scenes) {
    assert.equal(manifest.shots.filter(shot => shot.sceneId === scene.id).length, 6)
  }
})

test('故事未变时 manifestId 与版本保持不变——重复确认必须幂等', () => {
  const first = build()
  const second = build({}, { previous: first })
  assert.equal(second.storyHash, first.storyHash)
  assert.equal(second.manifestId, first.manifestId)
  assert.equal(second.manifestVersion, first.manifestVersion)
  assert.equal(second.createdAt, first.createdAt)
})

test('故事变了才递增版本并换 manifestId', () => {
  const first = build()
  const changed = build({ stylePrompt: '冷色调霓虹，竖屏构图' }, { previous: first })
  assert.notEqual(changed.storyHash, first.storyHash)
  assert.notEqual(changed.manifestId, first.manifestId)
  assert.equal(changed.manifestVersion, first.manifestVersion + 1)
})

test('storyHash 只覆盖语义内容，任务状态变化不换版本', () => {
  const withoutTasks = build()
  const withTasks = build({}, {
    tasks: [{ id: 'asset:cast-main', type: 'asset', entityId: 'cast-main', dependencies: [], inputHash: 'h1', maxAttempts: 3 }],
    previous: withoutTasks,
  })
  assert.equal(withTasks.storyHash, withoutTasks.storyHash)
  assert.equal(withTasks.manifestVersion, withoutTasks.manifestVersion)
  assert.equal(withTasks.capabilityPlan.length, 1)
  assert.deepEqual(withTasks.capabilityPlan[0], {
    taskId: 'asset:cast-main', type: 'asset', entityId: 'cast-main', dependsOn: [], inputHash: 'h1',
  })
})

test('授权状态进入 consent 而不进 storyHash', () => {
  const authorizedAt = '2026-09-05T00:00:00.000Z'
  const manifest = build({}, { state: { authorizedAt } })
  assert.equal(manifest.consent.authorizedAt, authorizedAt)
  assert.equal(manifest.storyHash, build().storyHash)
})

test('校验拒绝被部分更新的 manifest', () => {
  const manifest = build()
  validateManifest(manifest)
  assert.throws(() => validateManifest({ ...manifest, shots: manifest.shots.slice(1) }), /storyHash 与内容不一致/)
  assert.throws(() => validateManifest({ ...manifest, schemaVersion: 'elysium-manifest-0' }), /不支持的 manifest 版本/)
  assert.throws(() => validateManifest({ ...manifest, manifestVersion: 0 }), /manifestVersion 必须是正整数/)
})

test('校验拒绝指向不存在场景的镜头', () => {
  const manifest = build()
  const broken = { ...manifest, shots: manifest.shots.map((shot, index) => index === 0 ? { ...shot, sceneId: 'chapter-99' } : shot) }
  broken.storyHash = storyHashOf(broken)
  assert.throws(() => validateManifest(broken), /指向不存在的场景/)
})

test('缺少必要输入直接拒绝', () => {
  const episode = episodeFixture()
  assert.throws(() => manifestFromEpisode({ episode, plan: defaultPlan(episode, episode.id, 40) }), /projectId 必填/)
  assert.throws(() => manifestFromEpisode({ projectId: 'p', episode, plan: { chapters: [] } }), /至少需要一章/)
})
