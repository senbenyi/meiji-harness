import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { useWorkspaces } from './fixtures/host.js'
import { reviewPass } from './fixtures/review-result.js'
import { createRunService } from '../server/flow/runs/run-service.js'
import { linkStore } from '../server/data/workspace-links.js'
import { scriptStore, readScriptProposalArtifact } from '../server/data/script-store.js'
const sessionId = 'session-11111111-1111-4111-8111-111111111111'
async function setup(t, request) {
  const e = await setupModel(t); useWorkspaces(t); await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const runs = createRunService({ home: e.home, deps: { request: message => request(message, e) } })
  t.after(() => runs.dispose()); return { ...e, runs }
}
test('下一集预览不写项目，确认后直接生成大纲并提取展示摘要，不自动回写剧本', async t => {
 const e=await setup(t,async message=>message.skill==='review'?reviewPass:message.skill==='episode'?'{"summary":"展示摘要"}':JSON.stringify({故事小段:'1. 旅人回到庭院，找到山脚地图。'}))
 await e.store.save(e.id,root=>({...root,episodes:[],scriptPendingDeletes:[]}))
 await e.store.save(e.id,{scriptPendingDeletes:[]})
 const preview=await e.runs.plan({projectId:e.id,episodeNumber:1,goal:{to:'story',durationSeconds:10}},sessionId)
 assert.equal((await e.store.read(e.id)).episodes.length,0)
 assert.deepEqual(preview.run.steps.map(step=>[step.kind,step.target]),[['generate','outline'],['review','outline'],['generate','summary']])
 await e.runs.confirm(e.id,preview.run.id,sessionId,{confirmDelete:true});await e.runs.drain()
 const saved=await e.runs.get(e.id,preview.run.id,sessionId),root=await e.store.read(e.id)
 assert.equal(saved.status,'completed');assert.equal(root.episodes[0].id,preview.run.episodeId);assert.equal(root.episodes[0].durationSeconds,10)
 assert.equal(root.script,'');assert.equal(root.episodes[0].summary.content,'展示摘要')
})

test('剧本修改的生成与审核分开，方案归属 Run，人工放弃后自动继续', async t => {
  const e = await setup(t, async message => message.skill === 'review' ? reviewPass : JSON.stringify({ needsChange: true, note: '修改结尾', changes: [{ target: { kind: 'body' }, before: '旧结尾', after: '新结尾' }] }))
  await scriptStore(e.home, e.store).commit(e.id, { script: '旧结尾', scriptKind: 'imported' })
  const preview = await e.runs.plan({ projectId: e.id, goal: { to: 'script-revise', feedback: '改结尾' } }, sessionId)
  await e.runs.confirm(e.id, preview.run.id, sessionId, { confirmDelete: true }); await e.runs.drain()
  const waiting = await e.runs.get(e.id, preview.run.id, sessionId)
  assert.equal(waiting.status, 'paused'); assert.equal(waiting.pause.reasons[0].code, 'wait_script_confirm')
  const root = await e.store.read(e.id), proposal = root.scriptProposals.find(item => item.runId === waiting.id)
  assert.ok(proposal)
  const artifact = await readScriptProposalArtifact(e.home, e.id, proposal.id)
  assert.equal(artifact.runId, waiting.id); assert.ok(!Object.hasOwn(artifact, 'taskId'))
  assert.equal(root.script, '旧结尾')
  await scriptStore(e.home, e.store).resolve(e.id, proposal.id, []); await e.runs.drain()
  assert.equal((await e.runs.get(e.id, waiting.id, sessionId)).status, 'completed')
  assert.equal((await e.store.read(e.id)).script, '旧结尾')
})
