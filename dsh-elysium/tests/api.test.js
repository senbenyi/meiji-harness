import assert from 'node:assert/strict'
import test from 'node:test'
import { createApi } from '../src/elysium/client/api.js'

test('preserves API error code and status for client recovery', async () => {
  const api = createApi(async () => ({
    ok: false,
    status: 404,
    async json() {
      return { ok: false, code: 'PROJECT_NOT_FOUND', error: 'Project not found' }
    },
  }))

  await assert.rejects(
    api.fetchJson('/plan.get', { projectId: 'missing' }),
    error => error.code === 'PROJECT_NOT_FOUND' && error.status === 404,
  )
})

test('uploads an image as a binary request', async () => {
  let request
  const api = createApi(async (url, options) => {
    request = { url, options }
    return { ok: true, status: 200, async json() { return { ok: true } } }
  })
  const file = new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
  Object.defineProperty(file, 'name', { value: 'frame.png' })

  await api.uploadImage({ projectId: 'project-1', scope: 'shots', entityId: 'shot-1', file })

  assert.match(request.url, /^\/elysium\/import-image\?/)
  assert.match(request.url, /filename=frame\.png/)
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.body, file)
  assert.equal(request.options.headers['content-type'], 'image/png')
})
