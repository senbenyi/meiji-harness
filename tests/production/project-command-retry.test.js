import test from 'node:test'
import assert from 'node:assert/strict'
import { DomainConflictError } from '../../lib/domain/errors.js'
import { executeLatestProjectCommand } from '../../lib/production/commands.js'

test('project command retries a revision conflict with the same idempotency key', async () => {
  const revisions = [4, 5]
  const calls = []
  const projects = {
    getProject: async () => ({ revision: revisions.shift() }),
    execute: async (command) => {
      calls.push(command)
      if (calls.length === 1) throw new DomainConflictError('revision conflict', { expectedRevision: 4, actualRevision: 5 })
      return { project: { revision: 6 } }
    },
  }

  await executeLatestProjectCommand(projects, {
    projectId: 'project', commandId: 'stable-command', type: 'completeProductionTask', payload: { taskId: 'task' }, actor: 'worker',
  })

  assert.deepEqual(calls.map((call) => call.expectedRevision), [4, 5])
  assert.deepEqual(new Set(calls.map((call) => call.commandId)), new Set(['stable-command']))
})

test('project command does not retry a different conflict class', async () => {
  let calls = 0
  const projects = {
    getProject: async () => ({ revision: 4 }),
    execute: async () => {
      calls += 1
      throw new DomainConflictError('commandId reused with different payload')
    },
  }

  await assert.rejects(executeLatestProjectCommand(projects, {
    projectId: 'project', commandId: 'bad-command', type: 'completeProductionTask', payload: {}, actor: 'worker',
  }), /commandId reused/)
  assert.equal(calls, 1)
})
