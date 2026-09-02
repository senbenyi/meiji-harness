import assert from 'node:assert/strict'
import test from 'node:test'
import { createApi } from '../src/client/api.js'

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
