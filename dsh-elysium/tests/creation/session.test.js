import test from 'node:test'
import assert from 'node:assert/strict'
import { openCreationSession } from '../../src/presentation/studio/creation-session.js'

function fixture(t, status = 'director_selected') {
  const stored = new Map()
  const previousWindow = globalThis.window
  globalThis.window = { sessionStorage: {
    getItem: key => stored.get(key) || null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: key => stored.delete(key),
  } }
  t.after(() => { globalThis.window = previousWindow })

  const calls = []
  const face = {
    async rename(title) { calls.push(['rename', title]); return { ok: true, value: undefined } },
    async command(line) { calls.push(['command', line]); return { ok: true, value: undefined } },
    async prompt(content, mode, signal, requestId) { calls.push(['prompt', content, mode, signal, requestId]); return { ok: true, value: undefined } },
  }
  const sessions = {
    list: { getSnapshot: () => ({ current: 'main', byId: { main: { cwd: '/workspace' } } }) },
    async create(options) { calls.push(['create', options]); return { ok: true, value: options.sessionId } },
    binding: id => ({ sessionId: id, session: face }),
    open(id) { calls.push(['open', id]) },
  }
  const sidebar = { openTab(seed, scope) { calls.push(['openTab', seed, scope]) } }
  const binds = []
  return {
    calls, binds, ctx: { sessions }, sidebar,
    input: {
      project: { id: 'project-1', title: '雾港来信' },
      creation: { status, conversationId: status === 'director_selected' ? null : 'session-existing' },
      director: { schoolName: '真实交流派', skill: 'elysium-story' },
      openingPrompt: '导演开场', skill: 'elysium-story',
      bindSession: async body => { binds.push(body) },
    },
  }
}

test('创新项目创建稳定会话并依次加载 Skill、注入提示词和打开项目面板', async (t) => {
  const value = fixture(t)
  const sessionId = await openCreationSession({ ...value.input, ctx: value.ctx, sidebar: value.sidebar })

  assert.ok(sessionId)
  assert.equal(value.calls[0][0], 'create')
  assert.equal(value.calls[0][1].cwd, '/workspace')
  assert.deepEqual(value.calls.find(call => call[0] === 'command'), ['command', '/skill elysium-story'])
  const prompt = value.calls.find(call => call[0] === 'prompt')
  assert.equal(prompt[1][0].text, '导演开场')
  assert.equal(prompt[2], 'queue')
  assert.equal(prompt[4], 'elysium-opening:project-1')
  assert.equal(value.binds.length, 2)
  assert.equal(value.binds[1].skillLoaded, true)
  assert.deepEqual(value.calls.at(-1), ['open', sessionId])
  assert.equal(value.calls.find(call => call[0] === 'openTab')[1].meta.projectId, 'project-1')
})

test('已加载 Skill 的会话只领回并打开，不重复注入', async (t) => {
  const value = fixture(t, 'story_developing')
  await openCreationSession({ ...value.input, ctx: value.ctx, sidebar: value.sidebar })
  assert.equal(value.calls.some(call => call[0] === 'command'), false)
  assert.equal(value.calls.some(call => call[0] === 'prompt'), false)
  assert.equal(value.binds.length, 0)
})

test('远程错误分支不会被误当成 Skill 加载成功', async (t) => {
  const value = fixture(t)
  const failure = Object.assign(new Error('Skill 不存在'), { code: 'REMOTE_ERROR' })
  value.ctx.sessions.binding = id => ({ sessionId: id, session: {
    async rename() { return { ok: true, value: undefined } },
    async command() { return { ok: false, error: failure } },
    async prompt() { throw new Error('不应执行') },
  } })
  await assert.rejects(openCreationSession({ ...value.input, ctx: value.ctx, sidebar: value.sidebar }), /Skill 不存在/)
  assert.equal(value.binds.length, 1)
  assert.equal(value.binds[0].skillLoaded, undefined)
})
