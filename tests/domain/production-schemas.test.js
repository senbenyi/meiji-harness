import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NOVEL_SCHEMAS, NOVEL_SCHEMA_PARTS, productionOutputSchema } from '../../lib/script/production-schemas.js'
import { ASSET_EXTRACTION_SCHEMA } from '../../lib/script/asset-production.js'
import { generationSchema } from '../../lib/prompts/specification.js'

test('production output schemas load from the authoritative schema document without refs', () => {
  assert.deepEqual(Object.keys(NOVEL_SCHEMAS), ['summary', 'analysis', 'assets', 'plan', 'script', 'storyboard'])
  assert.equal(NOVEL_SCHEMAS.storyboard.properties.shots.items.properties.referenceBindings.items.properties.kind.enum.includes('variant'), true)
  assert.equal(NOVEL_SCHEMA_PARTS.citation.required.includes('sourceId'), true)

  const visit = (schema) => {
    assert.equal('$ref' in schema, false)
    for (const child of Object.values(schema.properties || {})) visit(child)
    if (schema.items) visit(schema.items)
    for (const child of schema.oneOf || []) visit(child)
  }
  for (const schema of Object.values(NOVEL_SCHEMAS)) visit(schema)
  assert.deepEqual(ASSET_EXTRACTION_SCHEMA, productionOutputSchema('asset-extraction'))
  assert.deepEqual(generationSchema('image'), productionOutputSchema('image-generation'))
  assert.deepEqual(generationSchema('video'), productionOutputSchema('video-generation'))
})

test('production pipeline meta-schema defines the hard orchestration contract', () => {
  const path = new URL('../../schemas/production-pipeline.schema.json', import.meta.url)
  const schema = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepEqual(schema.required, ['id', 'version', 'title', 'phases', 'nodes'])
  assert.deepEqual(schema.definitions.node.required, ['id', 'kind', 'phase', 'dependsOn', 'commit'])
  assert.deepEqual(schema.definitions.node.allOf[0].then.required, ['role', 'inputs', 'outputSchema', 'validators', 'retry', 'prompt'])
  assert.equal(schema.definitions.node.properties.dependsOn.type, 'array')
  assert.equal(schema.definitions.node.properties.retry.properties.maxAttempts.minimum, 1)
  assert.equal(schema.definitions.node.properties.prompt.additionalProperties, false)
})
