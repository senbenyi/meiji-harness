import test from 'node:test'
import assert from 'node:assert/strict'
import { makeProjectTools } from '../../lib/domain/tools.js'

test('Studio tool renderers return DSH content block arrays', () => {
  const tools = makeProjectTools({})

  for (const tool of tools) {
    const content = tool.output.render({}, { ok: true, json: '{}', error: '' })
    assert.ok(Array.isArray(content), `${tool.name} renderer must return an array`)
    assert.deepEqual(content, [{ type: 'text', text: '{}' }])
  }
})
