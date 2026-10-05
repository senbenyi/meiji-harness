import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const harnessRoot = process.argv[2]
const { harness, declare, agentOn } = await import(pathToFileURL(resolve(harnessRoot, 'packages/preset/agent-preset-registry/tests/harness.ts')))
const { default: Skills } = await import(pathToFileURL(resolve(harnessRoot, 'packages/skill/skill/src/index.ts')))
const ctx = await harness()
try {
  await ctx.plugin(Skills)
  const ready = Promise.withResolvers()
  ctx.provide('meiji', { home: process.env.DSH_HOME, tasks: { list: () => [] }, ready: ready.promise })
  await declare(ctx, { id: 'standard', plugins: [] })
  await declare(ctx, { id: 'meiji', plugins: [{ name: new URL('../../session.js', import.meta.url).href }] })
  const standard = await agentOn(ctx, 'standard-check', 'standard'), meiji = await agentOn(ctx, 'meiji-check', 'meiji')
  const visible = ctx.tools.schemas(meiji).map(row => row.name)
  assert.equal(visible.filter(name => name.startsWith('meiji_')).length, 11)
  assert.equal(ctx.tools.schemas(standard).filter(row => row.name.startsWith('meiji_')).length, 0)
  assert.equal(ctx.tools.schemas().filter(row => row.name.startsWith('meiji_')).length, 0)
  assert.ok((await ctx.skills.list({ scope: meiji })).some(skill => skill.name === 'skill-gongyong-panel-generate'))
  assert.ok(!(await ctx.skills.list({ scope: standard })).some(skill => skill.name === 'skill-gongyong-panel-generate'))
  let settled = false
  const execution = ctx.tools.get('meiji_generate_story', meiji).execute({}, {}).finally(() => { settled = true })
  await new Promise(setImmediate); assert.equal(settled, false)
  ready.resolve(); await assert.rejects(execution, /生成模式无效/)
  console.log(JSON.stringify({ meiji: visible, standard: [], global: [], skillIsolated: true }))
} finally { await ctx.fiber.dispose() }
