import test from 'node:test'
import assert from 'node:assert/strict'
import { generateEpisode } from '../server/flow/tasks/text/task-summary.js'
import { episodeFixture } from './fixtures/model.js'
import { outlineFixture } from './fixtures/story-package.js'

test('AI 从故事小段提取展示摘要，只调用一次且不修改时长或原故事', async () => {
 const project = episodeFixture(); project.plot.outline.content = outlineFixture('完整原话与动作 DETAIL_SOURCE')
 const before = structuredClone(project), calls = [], saved = []
 const draft = await generateEpisode({ project, request: async message => { calls.push(message); return '{"summary":"简洁展示摘要","durationSeconds":999}' }, persist: value => saved.push(value) })
 assert.equal(calls.length,1); assert.match(calls[0].user,/DETAIL_SOURCE/)
 assert.equal(draft.summary,'简洁展示摘要'); assert.equal(draft.durationSeconds,project.durationSeconds)
 assert.equal(saved.length,1); assert.deepEqual(project,before)
})
for (const response of ['{"summary":""}', '{"summary":null}', 'invalid']) test(`无效摘要响应不保存：${response}`, async () => {
 let saves=0
 await assert.rejects(generateEpisode({ project:episodeFixture(), request:async()=>response,persist:()=>saves++ }))
 assert.equal(saves,0)
})
test('提取失败不改变原大纲或已生成成片', async () => {
 const project=episodeFixture(),before=structuredClone(project)
 await assert.rejects(generateEpisode({project,request:async()=>{throw new Error('网络故障')}}),/网络故障/)
 assert.deepEqual(project,before)
})
