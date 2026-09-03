import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cancelJob,
  fetchOfficialClasses,
  generate as runGeneration,
  getJob,
  inspectTemplate,
  listLoraFiles,
  ping,
  searchAssets,
  waitForJob,
} from './engine.js'
import { scanPath, saveTemplate, removeTemplate } from './import-template.js'
import {
  annotateInspect,
  annotateTemplates,
  loraCatalog,
  loadSettings,
  removeLora,
  saveSettings,
  upsertLora,
} from './store.js'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

function bundledTemplatesDir() {
  const candidates = [
    path.resolve(MODULE_DIR, '../templates/comfyui'),
    path.resolve(MODULE_DIR, '../../../../../templates/comfyui'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
}

function copyBundledTemplates(target) {
  fs.mkdirSync(target, { recursive: true })
  const source = bundledTemplatesDir()
  if (!fs.existsSync(source) || path.resolve(source) === path.resolve(target)) return
  const upgradedWorkflows = new Set()
  for (const name of fs.readdirSync(source).filter(file => file.endsWith('.contract.json'))) {
    const sourcePath = path.join(source, name)
    const destination = path.join(target, name)
    const bundled = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
    const installed = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination, 'utf8')) : null
    const bundledVersion = Number(bundled._bundleVersion || 0)
    const installedVersion = Number(installed?._bundleVersion || 0)
    if (!installed || bundledVersion > installedVersion) {
      fs.copyFileSync(sourcePath, destination)
      const workflow = String(bundled.workflow || '')
      if (workflow && path.basename(workflow) === workflow && fs.existsSync(path.join(source, workflow))) {
        fs.copyFileSync(path.join(source, workflow), path.join(target, workflow))
        upgradedWorkflows.add(workflow)
      }
    }
  }
  for (const name of fs.readdirSync(source)) {
    if (!name.endsWith('.json')) continue
    if (upgradedWorkflows.has(name)) continue
    const destination = path.join(target, name)
    if (!fs.existsSync(destination)) fs.copyFileSync(path.join(source, name), destination)
  }
}

export function resolveComfyUiConfig(config = {}) {
  const comfyui = config.comfyui && typeof config.comfyui === 'object' ? config.comfyui : {}
  const workspace = path.resolve(String(config.workspace || './elysium-workspace'))
  const templatesDir = path.resolve(String(comfyui.templatesDir || path.join(workspace, 'comfyui', 'templates')))
  const outputDir = path.resolve(String(comfyui.outputDir || path.join(workspace, 'comfyui', 'output')))
  copyBundledTemplates(templatesDir)
  fs.mkdirSync(outputDir, { recursive: true })
  const settings = loadSettings(templatesDir)
  return {
    baseUrl: String(settings.baseUrl || comfyui.baseUrl || 'http://127.0.0.1:8189').replace(/\/$/, ''),
    templatesDir,
    outputDir,
  }
}

export function createComfyUiService(config = {}) {
  const runtime = () => resolveComfyUiConfig(config)

  return {
    runtime,
    async generate(args = {}) {
      return runGeneration({ ...runtime(), args })
    },
    async job(args = {}) {
      const current = runtime()
      const action = String(args.action || 'status')
      if (action === 'cancel') return cancelJob(current.baseUrl)
      const id = String(args.job_id || '')
      if (!id) return { ok: false, code: 'SLOT_REQUIRED', message: 'job_id required' }
      if (action === 'wait') {
        return waitForJob({
          baseUrl: current.baseUrl,
          outputDir: current.outputDir,
          promptId: id,
          saveIds: getJob(id)?.saveIds,
          waitS: args.wait_s == null ? 120 : Number(args.wait_s),
        })
      }
      const job = getJob(id)
      return job
        ? { ok: true, job }
        : { ok: false, code: 'JOB_UNKNOWN', job_id: id, message: '任务不在当前进程中；可使用 wait 从 ComfyUI 历史恢复' }
    },
    async state() {
      const current = runtime()
      const settings = loadSettings(current.templatesDir)
      const status = await ping(current.baseUrl)
      let availableLoras = []
      if (status.ok) {
        try { availableLoras = await listLoraFiles(current.baseUrl) } catch { /* optional metadata */ }
      }
      const onServer = new Set(availableLoras)
      return {
        ok: true,
        baseUrl: current.baseUrl,
        ping: status,
        templates: annotateTemplates(current.templatesDir, settings),
        loras: loraCatalog(current.templatesDir, settings).map(item => ({ ...item, on_server: onServer.has(item.name) })),
        availableLoras,
      }
    },
    async saveSettings(patch = {}) {
      const current = runtime()
      saveSettings(current.templatesDir, patch)
      return this.state()
    },
    async inspect(template, query) {
      const current = runtime()
      const result = annotateInspect(inspectTemplate(current.templatesDir, template), loadSettings(current.templatesDir))
      if (query) result.assets = await searchAssets(current.baseUrl, query)
      return { ok: true, ...result }
    },
    async scan(input = {}) {
      const current = runtime()
      const official = await fetchOfficialClasses(current.baseUrl)
      const scanned = scanPath(input.path, { id: input.id, title: input.title, officialClasses: official })
      return { ok: true, ...scanned, draft: scanned.summary }
    },
    async importTemplate(input = {}) {
      const current = runtime()
      const official = await fetchOfficialClasses(current.baseUrl)
      const saved = saveTemplate(current.templatesDir, input.path, {
        id: input.id,
        title: input.title,
        overwrite: !!input.overwrite,
        officialClasses: official,
      })
      return { ...(await this.state()), ...saved }
    },
    async removeTemplate(id) {
      const current = runtime()
      const removed = removeTemplate(current.templatesDir, id)
      return { ...(await this.state()), ...removed }
    },
    async registerLora(input = {}) {
      const current = runtime()
      upsertLora(current.templatesDir, input.name, {
        triggerWords: input.trigger_words,
        mode: input.mode,
        note: input.note,
      })
      return this.state()
    },
    async removeLora(name) {
      const current = runtime()
      removeLora(current.templatesDir, name)
      return this.state()
    },
  }
}
