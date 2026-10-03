import test from 'node:test'
import assert from 'node:assert/strict'
import { CANVAS_STAGES, canvasStageCounts, canvasStageForNode, nodesForCanvasStage } from '../../studio/stages.js'

test('canvas stage tabs keep the approved horizontal production order', () => {
  assert.deepEqual(CANVAS_STAGES.map((stage) => stage.key), [
    'overview', 'analysis', 'assets', 'scripts', 'storyboard', 'media', 'delivery',
  ])
})

test('canvas nodes are projected into stages without changing the nodes', () => {
  const nodes = [
    { id: 'brief', kind: 'text', group: '内容分析', title: '项目简报' },
    { id: 'character', kind: 'image', group: '角色设定', title: '主角定妆' },
    { id: 'script', kind: 'text', group: '分集剧本', title: '第 1 集' },
    { id: 'board', kind: 'image', group: '分镜图', title: '镜头 1 多宫格' },
    { id: 'clip', kind: 'video', group: '视频片段', title: '镜头 1' },
    { id: 'final', kind: 'video', group: '成片交付', title: '最终成片' },
    { id: 'free', kind: 'text', group: '自定义', title: '自由备注' },
  ]

  assert.equal(canvasStageForNode(nodes[0]), 'analysis')
  assert.equal(canvasStageForNode(nodes[1]), 'assets')
  assert.equal(canvasStageForNode(nodes[2]), 'scripts')
  assert.equal(canvasStageForNode(nodes[3]), 'storyboard')
  assert.equal(canvasStageForNode(nodes[4]), 'media')
  assert.equal(canvasStageForNode(nodes[5]), 'delivery')
  assert.equal(canvasStageForNode(nodes[6]), null)
  assert.deepEqual(nodesForCanvasStage(nodes, 'overview'), nodes)
  assert.deepEqual(nodesForCanvasStage(nodes, 'assets').map((node) => node.id), ['character'])
  assert.deepEqual(canvasStageCounts(nodes), {
    overview: 7,
    analysis: 1,
    assets: 1,
    scripts: 1,
    storyboard: 1,
    media: 1,
    delivery: 1,
  })
})
