// 职责：验证项目会话绑定工作区、复用隔离会话以及生成前的项目匹配。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { clientSource } from '../scripts/loader.js'

test('project sessions are created in their workspace, reused and isolated', async () => {
  const modules = new Map(), cache = new Map(), created = [], opened = [], calls = []
  const projects = { a: { id: 'a', session_id: 'origin' }, b: { id: 'b' }, detached: { id: 'detached', chat_session_id: 'orphan' } }
  const snapshot = { current: 'origin', byId: { origin: { cwd: '/work' }, orphan: { cwd: '/work', blank: true } } }
  const spaces = [{ workspaceId: 'workspace', path: '/work', sessionIds: ['origin'] }]
  runInNewContext(clientSource(), { window: { __ModuleLoader__: { load: m => modules.set(m.id, m.factory) } } })
  cache.set('elysium/project-api', { fetchProject: async id => projects[id], fetchProjects: async () => Object.values(projects), workflowAction: async (id, action, body) => { calls.push({ id, action, body }); projects[id].chat_session_id = body.session_id } })
  cache.set('elysium/episode-workflow', {})
  const require = name => { if (name === 'react') return React; if (!cache.has(name)) cache.set(name, modules.get(name)(require)); return cache.get(name) }
  const bridge = require('elysium/project-generation')
  bridge.apply({ sessions: { refresh: async () => {}, list: { getSnapshot: () => snapshot }, create: async input => {
    created.push(input); const id = `chat-${created.length}`; snapshot.byId[id] = { cwd: '/work', blank: true }; spaces[0].sessionIds.push(id); return id
  } }, workspaces: { list: { getSnapshot: () => ({ items: spaces }) } }, uiWorkspace: { openSession: id => { snapshot.current = id; opened.push(id) } }, slots: { inject() {} }, uiConversation: { events: { register() {} } } })
  assert.equal(await bridge.selectProject('a'), 'chat-1')
  assert.equal(created[0].workspaceId, 'workspace'); assert.equal(created[0].cwd, undefined)
  await bridge.selectProject('b'); await bridge.selectProject('a')
  assert.deepEqual(opened, ['chat-1', 'chat-2', 'chat-1']); assert.equal(created.length, 2)
  assert.equal(await bridge.projectForSession('chat-2'), 'b')
  await assert.rejects(bridge.generate(projects.b, 'plot'), /关联对话/)
  assert.equal(calls.length, 2)
  assert.equal(await bridge.selectProject('detached'), 'chat-3')
  spaces.length = 0; projects.c = { id: 'c' }
  await assert.rejects(bridge.selectProject('c'), /选择工作区/)
  assert.equal(created.length, 3)
})
