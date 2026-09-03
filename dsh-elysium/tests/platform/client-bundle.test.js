import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { bulkProductionRequests } from '../../src/presentation/studio/views/Studio.js'

test('generated client bundle registers a valid DSH module', async (t) => {
  const previousWindow = globalThis.window
  const definitions = []
  globalThis.window = {
    __ModuleLoader__: {
      load(value) { definitions.push(value) },
    },
  }
  t.after(() => { globalThis.window = previousWindow })

  await import(`../../lib/client.js?test=${Date.now()}`)
  assert.deepEqual(definitions.map(item => item.id), [
    '@dsh-external/dsh-elysium',
    'dsh-better-sidebar',
  ])
  assert.equal(typeof definitions[0].factory, 'function')

  const bundle = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(bundle, /window\.(?:prompt|confirm)\s*\(/)
  assert.match(bundle, /aria-modal/)
})

test('studio project navigation supports explicit multi-project actions', async () => {
  const source = await readFile(new URL('../../src/presentation/studio/views/Studio.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /ely-project-select/)
  assert.match(source, /selectedProjectIds/)
  assert.match(source, /批量启动 \/ 继续/)
  assert.match(source, /批量暂停/)
  assert.match(source, /confirmAuthorizedContent: true/)
  assert.match(source, /ely-add-episode/)
  assert.doesNotMatch(source, /ely-new-episode/)

  const projects = [
    { projectId: 'one', episodes: [{ id: 'ready', status: 'ready' }, { id: 'running', status: 'running' }] },
    { projectId: 'two', episodes: [{ id: 'paused', status: 'paused' }, { id: 'approved', status: 'approved' }] },
  ]
  assert.deepEqual(bulkProductionRequests(projects, 'start'), [
    { route: '/production.start', body: { projectId: 'one', episodeId: 'ready', confirmAuthorizedContent: true } },
    { route: '/production.resume', body: { projectId: 'two', episodeId: 'paused' } },
  ])
  assert.deepEqual(bulkProductionRequests(projects, 'pause'), [
    { route: '/production.pause', body: { projectId: 'one', episodeId: 'running' } },
  ])
})
