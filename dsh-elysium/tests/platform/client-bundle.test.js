import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { bulkProductionRequests, episodesInCreationOrder } from '../../src/presentation/studio/views/videos/Studio.js'

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
  const source = await readFile(new URL('../../src/presentation/studio/views/videos/Studio.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /ely-project-select/)
  assert.match(source, /selectedProjectIds/)
  assert.match(source, /启动 \/ 继续 \(\$\{batchStartCount\}\)/)
  assert.match(source, /暂停 \(\$\{batchPauseCount\}\)/)
  assert.match(source, /confirmAuthorizedContent: true/)
  assert.match(source, /ely-add-episode/)
  assert.match(source, /ely-delete-project/)
  assert.match(source, /call\('\/project\.delete'/)
  assert.match(source, /项目下的全部单集与产物也会被删除，且无法恢复/)
  assert.doesNotMatch(source, /ely-new-episode/)
  assert.match(source, /'保存中…' : '保存单集'/)
  assert.match(source, /call\('\/episode\.plan'/)
  assert.doesNotMatch(source, /建立单集并自动规划|Qwen3\.8 正在规划/)

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
  assert.deepEqual(episodesInCreationOrder([
    { id: 'third', createdAt: '2026-09-03T03:00:00.000Z' },
    { id: 'first', createdAt: '2026-09-03T01:00:00.000Z' },
    { id: 'second', createdAt: '2026-09-03T02:00:00.000Z' },
  ]).map(item => item.id), ['first', 'second', 'third'])
})
