import test from 'node:test'
import assert from 'node:assert/strict'
import { assertStoryboard, episodeStoryboardSchema, groundedStoryboardFallback } from '../../lib/script/novel-production.js'

const episode = { id: 'ep:01', beatIds: ['beat:01'] }

test('storyboard schema uses a direct binding schema when only one asset kind exists', () => {
  const schema = episodeStoryboardSchema({ characters: [], locations: [{ id: 'loc:room' }], props: [], assetVariants: [] }, episode)
  const binding = schema.properties.shots.items.properties.referenceBindings.items

  assert.equal(binding.type, 'object')
  assert.equal(binding.properties.kind.const, 'location')
  assert.deepEqual(binding.properties.entityId.enum, ['loc:room'])
  assert.equal(Object.hasOwn(binding, 'oneOf'), false)
})

test('storyboard schema uses oneOf only when at least two asset kinds exist', () => {
  const schema = episodeStoryboardSchema({ characters: [{ id: 'char:hero' }], locations: [{ id: 'loc:room' }], props: [], assetVariants: [] }, episode)
  const binding = schema.properties.shots.items.properties.referenceBindings.items

  assert.equal(binding.oneOf.length, 2)
})

test('storyboard schema rejects a project with no bindable assets before workflow start', () => {
  assert.throws(() => episodeStoryboardSchema({ characters: [], locations: [], props: [], assetVariants: [] }, episode), /缺少可绑定的正式资产/)
})

test('grounded storyboard fallback passes the same domain gate', () => {
  const assets = { characters: [], locations: [{ id: 'loc:room', name: '房间' }], props: [], assetVariants: [] }
  const fullEpisode = { ...episode, title: '生日夜', outline: '生日夜冲突' }
  const draft = { episodeId: episode.id, script: '龙哥进入房间。\n桌上放着晚餐。', beatIds: episode.beatIds, sourceSpans: [{ sourceId: 'source', start: 0, end: 20 }] }
  const board = groundedStoryboardFallback(assets, fullEpisode, draft, 2)

  assert.doesNotThrow(() => assertStoryboard(assets, fullEpisode, draft, board, { minShots: 2, maxShots: 2 }))
  assert.equal(board.shots.length, 2)
  assert.ok(board.shots.every((shot) => shot.referenceBindings[0].entityId === 'loc:room'))
})
