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
  testTemplateReadiness,
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
    path.resolve(MODULE_DIR, '../../../templates/comfyui'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
}

function bundledTemplateIds() {
  const source = bundledTemplatesDir()
  if (!fs.existsSync(source)) return new Set()
  const ids = new Set()
  for (const name of fs.readdirSync(source).filter(file => file.endsWith('.contract.json'))) {
    try {
      const contract = JSON.parse(fs.readFileSync(path.join(source, name), 'utf8'))
      if (contract.id) ids.add(String(contract.id))
    } catch { /* invalid bundled contracts are reported by normal template loading */ }
  }
  return ids
}

function normalizeBaseUrl(value) {
  const candidate = String(value || '').trim().replace(/\/$/, '')
  let parsed
  try { parsed = new URL(candidate) } catch { /* handled below */ }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('请输入有效的 HTTP(S) ComfyUI 地址'), { code: 'BAD_BASE_URL' })
  }
  return candidate
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
      const protectedTemplates = bundledTemplateIds()
      return {
        ok: true,
        baseUrl: current.baseUrl,
        ping: status,
        templates: annotateTemplates(current.templatesDir, settings).map(item => ({ ...item, removable: !protectedTemplates.has(item.id) })),
        loras: loraCatalog(current.templatesDir, settings).map(item => ({ ...item, on_server: status.ok ? onServer.has(item.name) : null })),
        availableLoras,
      }
    },
    async saveSettings(patch = {}) {
      const current = runtime()
      const next = patch.baseUrl == null ? patch : { ...patch, baseUrl: normalizeBaseUrl(patch.baseUrl) }
      saveSettings(current.templatesDir, next)
      return this.state()
    },
    async testConnection(input = {}) {
      const candidate = normalizeBaseUrl(input.baseUrl)
      const status = await ping(candidate)
      if (!status.ok) {
        throw Object.assign(new Error(status.message || '无法连接 ComfyUI'), { code: status.code || 'UNREACHABLE' })
      }
      return { ok: true, baseUrl: candidate, ping: status }
    },
    async inspect(template, query) {
      const current = runtime()
      const result = annotateInspect(inspectTemplate(current.templatesDir, template), loadSettings(current.templatesDir))
      if (query) result.assets = await searchAssets(current.baseUrl, query)
      return { ok: true, ...result }
    },
    async testTemplate(template) {
      const current = runtime()
      if (!String(template || '').trim()) {
        throw Object.assign(new Error('请选择要测试的工作流'), { code: 'SLOT_REQUIRED' })
      }
      return testTemplateReadiness({ ...current, template: String(template) })
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
      if (bundledTemplateIds().has(String(id))) {
        throw Object.assign(new Error('内置工作流由插件维护，不能删除'), { code: 'BUNDLED_TEMPLATE' })
      }
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
