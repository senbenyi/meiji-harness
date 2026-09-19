// 职责：验证制作上下文实际加载规则，以及发布后的资源独立性与缺失处理。
import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createProductionWorkflow } from '../src/server/projects/production.js'
import { loadProductionInstructions } from '../src/server/projects/production-rules.js'

test('production context selects only the current stage rules and injects the latest duration', async () => {
  const p = { revision: 1, target_seconds: 30, segments: [], assets: [], story: { text: '书店重逢', scenes: [] } }
  const flow = createProductionWorkflow({ read: async () => ({ id: 'project', production: p }) })
  const stages = { story: ['剧情写作', '场景划分'], segments: ['视频片段与衔接'], shots: ['分镜与运镜'], inputs: ['H3 提示词编写'] }
  for (const [stage, headings] of Object.entries(stages)) {
    p.request = { id: 'request', stage, session_id: 'session', revision: 1, segment_ids: [] }
    const context = await flow.context('project', 'request', 'session')
    const actual = [...context.instructions.matchAll(/^# (.+)$/gm)].map(match => match[1])
    assert.deepEqual(actual, headings)
    assert.doesNotMatch(context.instructions, /\{\{target_seconds\}\}/)
    if (['story', 'segments'].includes(stage)) {
      assert.match(context.instructions, /target_seconds=30/)
      assert.match(context.instructions, /上下 30 秒/)
    }
  }
  p.target_seconds = 45
  p.request.stage = 'story'
  const updated = await flow.context('project', 'request', 'session')
  assert.match(updated.instructions, /target_seconds=45/)
  assert.doesNotMatch(updated.instructions, /target_seconds=30/)
  await assert.rejects(flow.context('project', 'old-request', 'session'), /AI 请求已过期/)
})

test('unknown production rule stages fail instead of returning empty instructions', async () => {
  await assert.rejects(loadProductionInstructions('unknown', 30), /未知制作规则阶段/)
})

test('Registry ships standalone rules, reloads edits and reports missing stage resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'production-rules-package-'))
  try {
    for (const file of ['package.json', 'README.md', 'config', 'resources/production-rules']) {
      await cp(new URL(`../${file}`, import.meta.url), join(root, file), { recursive: true })
    }
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    assert.ok(pkg.files.includes('resources/production-rules'))
    await mkdir(join(root, 'lib/server/projects'), { recursive: true })
    await cp(new URL('../src/server/projects/production-rules.js', import.meta.url), join(root, 'lib/server/projects/production-rules.js'))
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/registry.mjs', import.meta.url))], { cwd: root })
    const deployed = join(root, 'registry')
    await rm(join(root, 'resources'), { recursive: true })
    const { loadProductionInstructions: load } = await import(pathToFileURL(join(deployed, 'lib/server/projects/production-rules.js')).href)
    for (const stage of ['story', 'story-segments', 'segments', 'shots', 'inputs']) {
      assert.equal(await load(stage, 30), await loadProductionInstructions(stage, 30))
    }
    await writeFile(join(deployed, 'resources/production-rules/story.md'), '# 已更新剧情规则\ntarget_seconds={{target_seconds}}')
    assert.match(await load('story', 42), /已更新剧情规则\ntarget_seconds=42/)
    await rm(join(deployed, 'resources/production-rules/h3-prompt.md'))
    assert.match(await load('story', 42), /场景划分/)
    await assert.rejects(load('inputs', 42), error => error.code === 'ENOENT' && error.path.endsWith('h3-prompt.md'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
