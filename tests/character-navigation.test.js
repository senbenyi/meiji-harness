import test from 'node:test'
import assert from 'node:assert/strict'
import { collectCharacters, episodeWork } from '../client/overview.js'

test('overview character links retain the selected portrait episode and original data', () => {
  const first = { id: 'C01', name: '麦克', type: 'role' }
  const second = { id: 'C02', name: '麦克', type: 'role', localPath: '/portrait.png' }
  const project = { id: 'project', episodes: [
    { id: 'episode-a', characters: { items: [first] } },
    { id: 'episode-b', characters: { items: [second] } },
  ] }
  const people = collectCharacters(project)
  assert.equal(people.length, 1)
  assert.equal(people[0].episodeId, 'episode-b')
  assert.equal(people[0].id, 'C02')
  const work = episodeWork(project, people[0].episodeId)
  assert.equal(work.id, 'project')
  assert.equal(work.characters.items.find(item => item.id === people[0].id), second)
  assert.equal(second.episodeId, undefined)
  assert.equal(first.episodeId, undefined)
})
