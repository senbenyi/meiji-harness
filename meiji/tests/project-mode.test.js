import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './fixtures/model.js'
import { runOperation } from './fixtures/operation.js'
import { projectStore, validateProject } from '../server/data/project-store.js'
import { scriptStore } from '../server/data/script-store.js'

test('自由模式方向必填且持久化原文；两种模式拒绝混合资料', async t => {
  const home = await tempHome(t), projects = projectStore(home)
  const project = await projects.create({ title: '自由创作', mode: 'free', premise: '  主角寻找姐姐，揭开旧案。  ' })
  const saved = await projectStore(home).read(project.id)
  assert.equal(saved.mode, 'free'); assert.equal(saved.premise, '主角寻找姐姐，揭开旧案。')
  assert.equal(saved.scriptKind, 'assembled'); assert.equal(saved.script, '')
  for (const fields of [{}, { premise: ' \n ' }, { premise: '字'.repeat(1001) }, { mode: 'other', premise: '方向' }, { mode: 'script' }, { mode: 'script', script: ' ' }, { premise: '方向', script: '正文' }, { mode: 'script', script: '正文', premise: '方向' }]) {
    assert.throws(() => validateProject({ title: '测试', ...fields }), { status: 400 })
  }
  await assert.rejects(runOperation({ action: 'premise-edit', projectId: project.id, text: ' \n ' }, { home }), /必填/)
  assert.equal((await projects.read(project.id)).premise, saved.premise)
})

test('剧本模式保存模式和初始版本，直接编辑与确认方案不能清空剧本', async t => {
  const home = await tempHome(t), projects = projectStore(home)
  const project = await projects.create({ title: '剧本创作', mode: 'script', script: '最初剧本' })
  const scripts = scriptStore(home, projects)
  assert.equal((await projectStore(home).read(project.id)).mode, 'script')
  assert.equal(project.scriptKind, 'imported'); assert.equal(project.scriptRevision, 1)
  await assert.rejects(runOperation({ action: 'script-edit', projectId: project.id, text: ' ', note: '清空正文' }, { home }), /必须提供剧本/)
  const proposalId = await scripts.propose(project.id, { source: 'edit', baseRevision: 1, note: '删除全部', changes: [{ target: { kind: 'body' }, before: '最初剧本', after: '' }] })
  await assert.rejects(scripts.resolve(project.id, proposalId, [0]), /必须提供剧本/)
  assert.equal((await projects.read(project.id)).script, '最初剧本')
  assert.equal((await scripts.versions(project.id)).length, 1)
})
