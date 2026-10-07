import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryProjectRepository, ProjectService } from '../../lib/domain/service.js'
import { DurableDagExecutor } from '../../lib/production/dag-executor.js'

async function fixture() {
  const projects = await new ProjectService(new MemoryProjectRepository()).open()
  const { project } = await projects.createProject({ payload: { title: 'Durable DAG' } })
  const created = await projects.execute({
    projectId: project.id, expectedRevision: project.revision, commandId: 'create-run', type: 'createProductionRun',
    payload: { runId: 'run', tasks: [{ id: 'node', kind: 'author', input: { commit: { type: 'saveDraft' } } }] },
  })
  return { projects, projectId: project.id, task: created.project.productionTasks.node }
}

test('executes generate, validate, durable checkpoints, materialize and complete in order', async () => {
  const f = await fixture()
  const calls = []
  const executor = new DurableDagExecutor({
    projectService: f.projects, owner: 'worker',
    generate: async ({ task }) => { calls.push('generate'); return { draft: task.id } },
    validate: async (candidate) => { calls.push('validate'); return { ...candidate, valid: true } },
    materialize: async (candidate, context) => {
      calls.push(['materialize', candidate, context.commit, context.commandId])
      return { materializationRef: 'proposal:1' }
    },
  })

  const result = await executor.runTask(f.projectId, f.task.id)
  const task = (await f.projects.getProject(f.projectId)).productionTasks.node
  assert.equal(result.status, 'completed')
  assert.deepEqual(calls.slice(0, 2), ['generate', 'validate'])
  assert.deepEqual(calls[2].slice(0, 3), ['materialize', { draft: 'node', valid: true }, { type: 'saveDraft' }])
  assert.equal(calls[2][3], 'production:run:node:materialize')
  assert.deepEqual(task.checkpoint, {
    stage: 'materialized', candidate: { draft: 'node', valid: true }, materializationRef: 'proposal:1',
    materializeCommandId: 'production:run:node:materialize',
  })
  assert.equal(task.status, 'completed')
  assert.equal(task.outputRef, 'proposal:1')
})

test('resumes a validated candidate without generating it again', async () => {
  const f = await fixture()
  let generated = 0
  const first = new DurableDagExecutor({
    projectService: f.projects, owner: 'worker-1', generate: async () => { generated += 1; return { draft: 1 } },
    validate: async (value) => value,
    materialize: async () => { const error = new Error('database unavailable'); error.retryable = true; throw error },
  })
  assert.equal((await first.runTask(f.projectId, f.task.id)).retryable, true)
  let task = (await f.projects.getProject(f.projectId)).productionTasks.node
  assert.equal(task.status, 'failed')
  assert.equal(task.checkpoint.stage, 'validated')
  await f.projects.execute({ projectId: f.projectId, expectedRevision: (await f.projects.getProject(f.projectId)).revision, commandId: 'resume', type: 'resumeProductionRun', payload: { runId: 'run' } })

  const commandIds = []
  const second = new DurableDagExecutor({
    projectService: f.projects, owner: 'worker-2', generate: async () => { generated += 1 }, validate: async () => {},
    materialize: async (_candidate, context) => { commandIds.push(context.commandId); return { materializationRef: 'proposal:1' } },
  })
  await second.runTask(f.projectId, f.task.id)
  task = (await f.projects.getProject(f.projectId)).productionTasks.node
  assert.equal(generated, 1)
  assert.deepEqual(commandIds, ['production:run:node:materialize'])
  assert.equal(task.status, 'completed')
})

test('resumes a materialized reference by completing without generate or materialize', async () => {
  const f = await fixture()
  await f.projects.execute({ projectId: f.projectId, expectedRevision: (await f.projects.getProject(f.projectId)).revision, commandId: 'lease-old', type: 'leaseProductionTask', payload: { taskId: 'node', owner: 'old' } })
  await f.projects.execute({ projectId: f.projectId, expectedRevision: (await f.projects.getProject(f.projectId)).revision, commandId: 'start-old', type: 'startProductionTask', payload: { taskId: 'node', owner: 'old' } })
  await f.projects.execute({ projectId: f.projectId, expectedRevision: (await f.projects.getProject(f.projectId)).revision, commandId: 'checkpoint-old', type: 'checkpointProductionTask', payload: { taskId: 'node', owner: 'old', checkpoint: { stage: 'materialized', candidate: { draft: 1 }, materializationRef: 'proposal:1', materializeCommandId: 'production:run:node:materialize' } } })
  await f.projects.execute({ projectId: f.projectId, expectedRevision: (await f.projects.getProject(f.projectId)).revision, commandId: 'fail-old', type: 'failProductionTask', payload: { taskId: 'node', owner: 'old', error: 'crashed before complete' } })
  await f.projects.execute({ projectId: f.projectId, expectedRevision: (await f.projects.getProject(f.projectId)).revision, commandId: 'resume', type: 'resumeProductionRun', payload: { runId: 'run' } })

  const executor = new DurableDagExecutor({
    projectService: f.projects, owner: 'new',
    generate: async () => assert.fail('generate must not run'), validate: async () => assert.fail('validate must not run'),
    materialize: async () => assert.fail('materialize must not run'),
  })
  const result = await executor.runTask(f.projectId, f.task.id)
  assert.equal(result.materializationRef, 'proposal:1')
  assert.equal((await f.projects.getProject(f.projectId)).productionTasks.node.status, 'completed')
})

test('validation failures are classified as retryable invalid output', async () => {
  const f = await fixture()
  const executor = new DurableDagExecutor({
    projectService: f.projects, owner: 'worker', generate: async () => ({ draft: 1 }),
    validate: async () => { throw new Error('missing required episode') },
    materialize: async () => assert.fail('materialize must not run'),
  })
  const result = await executor.runTask(f.projectId, f.task.id)
  assert.deepEqual(result, {
    status: 'failed', taskId: 'node', error: 'missing required episode',
    failureClass: 'invalid-output', retryable: true,
  })
  assert.equal((await f.projects.getProject(f.projectId)).productionTasks.node.status, 'failed')
})

test('materialize failures are persisted and never complete the task', async () => {
  const f = await fixture()
  const executor = new DurableDagExecutor({
    projectService: f.projects, owner: 'worker', generate: async () => ({ draft: 1 }), validate: async () => {},
    materialize: async () => { throw new Error('proposal rejected') },
  })
  const result = await executor.runTask(f.projectId, f.task.id)
  const task = (await f.projects.getProject(f.projectId)).productionTasks.node
  assert.deepEqual(result, { status: 'failed', taskId: 'node', error: 'proposal rejected', failureClass: 'domain-commit', retryable: false })
  assert.equal(task.status, 'failed')
  assert.notEqual(task.status, 'completed')
  assert.equal(task.outputRef, null)
})
