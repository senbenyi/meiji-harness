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

test('Studio tools expose batch shot upsert as one domain command', async () => {
  let request
  const tools = makeProjectTools({
    async execute(value) {
      request = value
      return { project: { revision: 3 }, output: { ids: ['shot-1', 'shot-2'] } }
    },
  })
  const tool = tools.find((item) => item.name === 'studio_shot_batch_upsert')
  const result = await tool.execute({
    projectId: 'project-1', revision: 2, commandId: 'command-1',
    shots: JSON.stringify([{ id: 'shot-1' }, { id: 'shot-2' }]),
  })

  assert.equal(request.type, 'batchUpsertShots')
  assert.deepEqual(request.payload.shots, [{ id: 'shot-1' }, { id: 'shot-2' }])
  assert.deepEqual(JSON.parse(result.json), { revision: 3, ids: ['shot-1', 'shot-2'] })
})
