import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../src/toonflow/server/index.js'

function responseRecorder() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status
      this.headers = headers
    },
    end(body = '') {
      this.body = String(body)
    },
  }
}

test('rejects untrusted requests before every Toonflow route', async () => {
  const routes = []
  let cleanup = () => {}
  const scope = {
    tools: { get() { return undefined } },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(callback) {
      cleanup = callback()
      return cleanup
    },
  }
  const ctx = {
    tools: scope.tools,
    inject(_services, callback) {
      callback(scope)
      return () => {}
    },
  }

  apply(ctx, {}, () => false)

  assert.deepEqual(routes.map(route => route.path), [
    '/toonflow/api',
    '/toonflow/file',
    '/toonflow/import-image',
  ])
  for (const route of routes) {
    const response = responseRecorder()
    await route.handler({ method: 'POST', url: route.path, headers: {} }, response)
    assert.equal(response.status, 403, route.path)
  }
  cleanup()
})
