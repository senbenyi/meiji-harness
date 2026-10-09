import { runStore, runRecordStore } from '../../server/data/run-store.js'
import { executionContext } from '../../server/runtime/task-context.js'
import { RUN_SCHEMA } from '../../server/models/tasks/run-model.js'
import { tempHome } from './model.js'
export async function runContext(t, { home, projectId = 'project', kind = 'generate', target = null, episodeId = null } = {}) {
  home ||= await tempHome(t)
  const runId = crypto.randomUUID(), stepId = crypto.randomUUID(), records = runStore(home, projectId)
  const step = { id: stepId, key: `${kind}@${target}`, target, kind, scope: 'project', queue: 'text', actor: 'model', after: [], status: 'running', attempts: [], inputs: [], outputs: [], prompts: [], responses: [], artifacts: [], startedAt: new Date().toISOString() }
  await records.create({ schemaVersion: RUN_SCHEMA, id: runId, projectId, episodeId, sessionId: null, goal: {}, policy: { maxRevisions: 2 }, createdAt: new Date().toISOString(), steps: [step], events: [{ type: 'confirmed' }] })
  const context = { store: runRecordStore(home, projectId, runId, stepId), home, projectId, runId, stepId, nodes: [{ ...step, scope: 'root' }], nodeId: stepId, scope: 'root', operation: { episodeId }, outputs: [], baselines: new Map(), skills: new Map() }
  return { context, store: records, home, projectId, runId, stepId, step, run: fn => executionContext.run(context, fn), read: kind => records.records(runId, stepId, kind) }
}
