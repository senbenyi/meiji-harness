// Opt-in Cordis verification driver: uses the real workflow, storage and media tools.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { STUDIO_STORAGE_ROOT } from '../../lib/storage/layout.js'

export const name = 'drama-live-verification'
export const inject = ['agents', 'agentDefaultModel', 'agentPresets', 'tools', 'workspaceRegistry', 'storage']

export function apply(ctx) {
  if (!process.env.DSH_DRAMA_FLOW_REPORT) throw new Error('DSH_DRAMA_FLOW_REPORT is required for the opt-in live verification')
  const report = { startedAt: new Date().toISOString(), status: 'running', checks: [] }
  const save = async () => {
    await mkdir(dirname(process.env.DSH_DRAMA_FLOW_REPORT), { recursive: true })
    await writeFile(process.env.DSH_DRAMA_FLOW_REPORT, JSON.stringify(report, null, 2))
  }
  const run = async () => {
    await ctx.get('loader')?.await()
    const cwd = process.cwd()
    const workspace = await ctx.workspaceRegistry.resolveByPath(cwd) || await ctx.workspaceRegistry.create(cwd, '短剧流程验收')
    const selection = ctx.agentDefaultModel.currentSelection()
    const { agent } = await ctx.agents.create({ sessionId: `drama-flow-${randomUUID()}`, meta: { cwd, agentPreset: 'standard' }, agentOptions: { provider: selection.provider, model: selection.model }, setup: (scope) => ctx.agentPresets.mount(scope, 'standard').then(() => {}) })
    report.sessionId = agent.session.id
    report.workspaceId = workspace.id
    report.provider = selection.provider
    report.model = selection.model
    report.codeHash = createHash('sha256').update(await readFile(new URL('../../lib/index.js', import.meta.url))).digest('hex')
    const exec = { agent, signal: new AbortController().signal, concludeTurn() {} }
    const call = async (name, args) => {
      const tool = ctx.tools.get(name, agent)
      assert.ok(tool, `tool unavailable: ${name}`)
      const value = await tool.execute(args, exec)
      assert.equal(value.ok, true, `${name}: ${value.error}`)
      return JSON.parse(value.json)
    }
    await save()
    console.log('[drama-live] starting real novel workflow', report.sessionId)
    const created = await call('studio_novel_create', { sourcePath: 'scripts/fixtures/drama-flow.txt', title: '流程验收：车站的信封' })
    report.projectId = created.projectId
    report.runId = created.runId
    await save()
    for (let i = 0; i < 240; i++) {
      const status = await call('studio_production_status', { projectId: created.projectId, runId: created.runId })
      report.production = status.production
      report.tasks = status.tasks.map(({ kind, status, error, outputRef }) => ({ kind, status, error, outputRef }))
      await save()
      console.log('[drama-live]', status.run.status, JSON.stringify(status.run.counts))
      if (status.run.status === 'failed') throw new Error(JSON.stringify(report.tasks.filter((task) => task.error)))
      if (status.run.status === 'completed') {
        assert.equal(status.production.status, 'completed')
        const project = await call('studio_project_get', { projectId: created.projectId })
        report.checks.push('all six production stages completed')
        report.artifacts = { sources: Object.keys(project.sourceDocuments).length, episodes: Object.values(project.episodes).filter((ep) => ep.id !== 'legacy-main').length, images: Object.values(project.assets).filter((asset) => asset.kind === 'image').length, videos: Object.values(project.assets).filter((asset) => asset.kind === 'video').length }
        for (const deliverable of Object.values(project.deliverables)) {
          const bytes = await readFile(join(STUDIO_STORAGE_ROOT, deliverable.logicalKey))
          assert.equal(createHash('sha256').update(bytes).digest('hex'), deliverable.contentHash)
          report.delivery = { path: join(STUDIO_STORAGE_ROOT, deliverable.logicalKey), bytes: bytes.length, ...deliverable.qualityReport }
        }
        report.checks.push('delivery exists and hash matches')
        const attempts = Object.keys(project.attempts).length
        const reused = await call('studio_novel_create', { sourcePath: 'scripts/fixtures/drama-flow.txt', title: '流程验收：车站的信封' })
        assert.equal(reused.runId, created.runId)
        assert.equal(Object.keys((await call('studio_project_get', { projectId: created.projectId })).attempts).length, attempts)
        report.checks.push('repeat entrypoint reuses delivery without new generation')
        report.status = 'passed'
        report.completedAt = new Date().toISOString()
        await save()
        console.log('[drama-live] PASSED', report.projectId, report.delivery.path)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
    throw new Error('live flow did not settle within 20 minutes')
  }
  void run().catch(async (error) => {
    report.status = 'failed'
    report.error = error?.stack || String(error)
    await save()
    console.error('[drama-live] FAILED', error.message)
  })
}
