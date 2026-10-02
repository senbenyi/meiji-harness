import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConcatGraph } from '../../lib/concat.js'

test('buildConcatGraph rejects fewer than two clips', () => {
  for (const bad of [[], ['a.mp4'], null]) {
    assert.throws(() => buildConcatGraph(bad, 'p'))
  }
})

test('buildConcatGraph builds the two-clip topology', () => {
  const graph = buildConcatGraph(['a.mp4', 'b.mp4'], 'out/x')

  assert.equal(Object.keys(graph).length, 8)
  assert.equal(graph.load0.inputs.file, 'a.mp4')
  assert.deepEqual(graph.comp1.inputs.video, ['load1', 0])
  assert.deepEqual(graph.batch1.inputs.image1, ['comp0', 0])
  assert.deepEqual(graph.batch1.inputs.image2, ['comp1', 0])
  assert.deepEqual(graph.acat1.inputs.audio1, ['comp0', 1])
  assert.deepEqual(graph.acat1.inputs.audio2, ['comp1', 1])
  assert.equal(graph.acat1.inputs.direction, 'after')
  assert.deepEqual(graph.create.inputs.fps, ['comp0', 2])
  assert.deepEqual(graph.create.inputs.images, ['batch1', 0])
  assert.deepEqual(graph.create.inputs.audio, ['acat1', 0])
  assert.equal(graph.save.inputs.format, 'mp4')
  assert.equal(graph.save.inputs.codec, 'h264')
  assert.equal(graph.save.inputs.filename_prefix, 'out/x')
})

test('buildConcatGraph left-folds multiple clips without dangling references', () => {
  const count = 5
  const graph = buildConcatGraph(Array.from({ length: count }, (_, index) => `c${index}.mp4`), 'p')

  assert.equal(Object.keys(graph).length, 2 * count + 2 * (count - 1) + 2)
  assert.deepEqual(graph[`batch${count - 1}`].inputs.image1, [`batch${count - 2}`, 0])
  assert.deepEqual(graph.create.inputs.images, [`batch${count - 1}`, 0])
  for (const node of Object.values(graph)) {
    for (const value of Object.values(node.inputs)) {
      if (Array.isArray(value) && typeof value[0] === 'string') assert.ok(graph[value[0]], value[0])
    }
  }
})
