/**
 * dsh-short-video-studio — host half.
 *
 * MiniMax-Design 风格的短剧/动画画布工作室：
 *  - ComfyUI 生成引擎（图片 FLUX / 视频 MiniMax H3，默认 http://localhost:8188）
 *  - Project Domain 持久化业务状态；旧画布经兼容命令适配
 *  - /dsh-short-video-studio 路由（画布 API + 媒体伺服 + studio 静态站）
 *  - Agent 工具：comfy_generate_image / comfy_generate_video / canvas_*
 *  - systemPrompt 段：流水线 + 工具契约 + 选项卡门控
 *  - pre-ask 自动送达：tools/pre-execute 钩子在 ask_user_question 前把画布
 *    未送达产物经 send_file 发到飞书（文本节点自动导出 .pdf）
 *
 * 本文件刻意零 @deepseek-ai/* 运行时 import：工具用原生 ToolDefinition
 * 注册（parameters 直接写 JSON Schema），服务全部走注入的 ctx
 * （webServer/tools/systemPrompt/workspaceRegistry），从而 link:/file: 安装
 * 都不受 peer 解析路径影响。
 */

import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  realpath,
  stat,
  unlink,
} from 'node:fs/promises'
import { resolve, basename, dirname, join, relative, sep, extname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { loadBuiltinManifests, buildGraphFromManifest, validateManifest, resolveAssets, CAPABILITIES, TIERS } from './manifest.js'
import { convertComfyExport, isRawComfyExport, isLegacyWorkflowFormat } from './convert.js'
import {
  loadLibrary, normalizeAssetId, isAssetRef, canonicalAssetId, assetFilename,
  resolveAssetImagePath, resolveAssetPath, registerAsset, removeAsset, slugifyName,
  ASSET_TYPES, TYPE_KINDS, NODE_KINDS, assetKind, assetTypesForKind,
} from './assets.js'
import { buildConcatGraph, detectFfmpeg, ffmpegConcat } from './concat.js'
import {
  probeMp4, snapToAlign, planUpscale, planUpscaleChunks, chunkRanges, sliceUpscaleGraph,
  PIXEL_FRAME_WARN,
} from './upscale.js'
import { detectPdfTool } from './pdf.js'
import { markdownToHtml } from '../studio/markdown.js'
import { createHarnessProjectService, MemoryProjectRepository, ProjectService } from './domain/service.js'
import { LegacyCanvasCommandAdapter } from './compat/legacy-canvas-adapter.js'
import { makeProjectTools } from './domain/tools.js'
import { canvasReadModel, diagnosticsReadModel, projectSummary, reviewQueue } from './domain/read-models.js'
import { compilePromptSnapshot } from './prompts/compiler.js'
import { assertDeliverableReady, assertProductionStages, isStandaloneShot, preparationSignature } from './domain/policies.js'
import { dramaProductionTasks } from './production/drama.js'
import { NOVEL_SCHEMAS, novelTextProduction, assertNovelCoverage } from './script/novel-production.js'
import { inspectWorkflow } from './capabilities/workflow-inspector.js'
import { validateWorkflowBindings, deriveWorkflowCapabilities } from './capabilities/workflow-bindings.js'
import { buildWorkflowRequest, workflowHash } from './comfy/request-builder.js'
import { classifyGenerationFailure } from './media/failures.js'
import { DeliveryService } from './delivery/export.js'
import { ProductionWorker } from './production/worker.js'
import { FileService } from './storage/files.js'
import { PROJECT_STEPS, STUDIO_STORAGE_ROOT, formatProjectId, projectDirectory, safeName } from './storage/layout.js'
import { SourceTextService, normalizeSourceText } from './script/source-service.js'
import { makeScriptDevelopmentTools } from './script/tools.js'
import { installNovelChildPolicy } from './script/child-policy.js'
import { GUIDANCE } from './guidance.js'
import {
  hashSkillDir,
  installBundledSkills as installBundledSkillCopies,
  readPluginVersion as readBundledPluginVersion,
  readSkillStamp,
  STUDIO_SKILL_MARK,
  syncBundledSkills,
} from './skills/sync.js'
import {
  POLL_INTERVAL_MS,
  GENERATION_TIMEOUT_MS,
  FLUX_CLIP_TYPE,
  H3_CLIP_TYPE,
  H3_FPS,
  CONFIG_PATH,
  featureEnabled,
  loadConfigFile,
  getCfg,
  DEFAULT_TIER,
  DEFAULT_PREFERRED,
  GUIDANCE_ORDER,
} from './config.js'
import {
  createH3PromptGate,
  h3HasSection,
  H3_PROMPT_GATE,
  H3_GATE_MAX_DENIES,
} from './hooks/h3-prompt-gate.js'
import {
  createPreAskDelivery,
  AUTO_DELIVER_BEFORE_ASK,
  TEXT_NODE_EXPORT_PDF,
} from './hooks/pre-ask-delivery.js'

export const name = 'short-video-studio'

/** 宿主服务依赖（fiber 等待这些服务先就绪）。 */
export const inject = ['webServer', 'tools', 'systemPrompt', 'workspaceRegistry', 'storage']

const ROUTE_ROOT = '/dsh-short-video-studio'
const CANVAS_DIR = 'canvas'

// 未指定分组时的中性兜底名。分组词汇由 skill 自由定义，执行层不认识任何片型名词；
// 展示顺序由画布 settings.groupOrder（skill 通过 canvas_set_state 声明）决定，未声明的按首次出现排。
const DEFAULT_GROUP = 'ungrouped'

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const text = (value) => [{ type: 'text', text: String(value) }]

function HttpError(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

function errorCode(error) {
  if (!error || typeof error !== 'object') return ''
  const code = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : ''
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** 校验 workspace 内相对路径，防路径逃逸（借鉴 idesign / dsh-ssh）。 */
function safeRelative(value, prefix = '') {
  const normalized = String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (!normalized || isAbsolute(normalized) || normalized.includes('\0')) {
    throw HttpError(400, 'invalid canvas path')
  }
  if (normalized.split('/').some((p) => !p || p === '.' || p === '..')) {
    throw HttpError(400, 'invalid canvas path')
  }
  if (prefix) {
    const root = prefix.replace(/\/+$/, '')
    if (normalized !== root && !normalized.startsWith(root + '/')) {
      throw HttpError(403, 'path escapes canvas folder')
    }
  }
  return normalized
}

function inside(root, target) {
  const r = relative(root, target)
  return r === '' || (!r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r))
}

async function requestJson(req, maxBytes = 8 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > maxBytes) throw HttpError(413, 'request too large')
    chunks.push(buf)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object')
    return value
  } catch {
    throw HttpError(400, 'invalid JSON body')
  }
}

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
}

const contentType = (p) => CONTENT_TYPES[extname(p).toLowerCase()] || 'application/octet-stream'

/** 计算一个媒体相对路径的交付信息：绝对路径 / 媒体类型 / 字节数（供 TUI/飞书渠道送达）。 */
function resolveStoredPath(root, logicalPath) {
  const value = String(logicalPath || '')
  const base = value.startsWith('artifacts/') && ctx ? STUDIO_STORAGE_ROOT : root
  return join(base, ...value.split('/'))
}

let lastArtifactTimestamp = 0
function nextArtifactStamp() {
  lastArtifactTimestamp = Math.max(Date.now(), lastArtifactTimestamp + 1)
  return formatProjectId(lastArtifactTimestamp)
}

function mediaDelivery(root, media) {
  if (!media) return { absPath: '', mediaType: '', bytes: 0 }
  const absPath = resolveStoredPath(root, media)
  let bytes = 0
  try { bytes = statSync(absPath).size } catch { /* 文件缺失时保持 0 */ }
  return { absPath, mediaType: contentType(absPath), bytes }
}

/** 字节数 → 人类可读（交付时对照 send_file 的单文件上限）。 */
function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return (i === 0 ? String(Math.round(value)) : value.toFixed(1)) + ' ' + units[i]
}

/** 生成类工具结果的统一交付信息文本：相对路径供 send_file，绝对路径供终端打开。 */
function mediaResultDetail(value) {
  const lines = [`相对路径(send_file 交付): ${value.media}`]
  if (value.absPath) lines.push(`绝对路径(终端打开): ${value.absPath}`)
  if (value.mediaType || value.bytes) lines.push(`媒体: ${value.mediaType || 'unknown'} · ${humanSize(value.bytes)}`)
  return lines.join('\n')
}

/**
 * 渲染结果的档位透明度说明：档位 → 实现 → 解析来源（+ 警告）。
 * 产品层必须能一眼看出"这次实际用了哪个实现"，否则又回到"显示 fast 实际跑 20 步"的失真。
 */
function renderResolutionNote(value) {
  if (!value || !value.ok) return ''
  const bits = []
  if (value.tier) bits.push(`档位 ${value.tier}`)
  if (value.implementation) bits.push(`实现 ${value.implementation}`)
  if (value.resolution) bits.push(`解析 ${value.resolution}`)
  const warn = Array.isArray(value.warnings) && value.warnings.length ? `\n注意：${value.warnings.join('；')}` : ''
  return (bits.length ? `\n${bits.join(' · ')}` : '') + warn
}

// ---------------------------------------------------------------------------
// ComfyUI 客户端
// ---------------------------------------------------------------------------

async function comfyFetch(path, init) {
  const cfg = getCfg()
  const headers = { ...(init?.headers || {}) }
  if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey
  let res
  try {
    res = await fetch(cfg.baseUrl + path, { ...init, headers })
  } catch (error) {
    throw new Error('comfy-unreachable: ComfyUI 不可达（' + cfg.baseUrl + '）：' + (error?.message || String(error)))
  }
  return res
}

/** 提交工作流，返回 prompt_id。 */
async function comfySubmit(graph) {
  const res = await comfyFetch('/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'dsh-short-video-studio-' + randomUUID() }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body?.prompt_id) {
    let detail = ''
    if (body?.node_errors && Object.keys(body.node_errors).length) detail = JSON.stringify(body.node_errors)
    else if (body?.error) detail = typeof body.error === 'string' ? body.error : JSON.stringify(body.error)
    else if (body?.message) detail = body.message
    else detail = res.status + (typeof res.statusText === 'string' ? ' ' + res.statusText : '')
    throw new Error('workflow-validation: ComfyUI 拒绝工作流：' + (detail || res.status))
  }
  return body.prompt_id
}

/** 轮询 /history/{id} 直到 completed/error，带超时与 signal。 */
async function comfyWait(promptId, signal) {
  const deadline = Date.now() + GENERATION_TIMEOUT_MS
  for (;;) {
    if (signal?.aborted) throw new Error('generation cancelled')
    if (Date.now() > deadline) throw new Error('timeout: ComfyUI 生成超时（>' + GENERATION_TIMEOUT_MS + 'ms）')
    const res = await comfyFetch('/history/' + encodeURIComponent(promptId))
    const body = await res.json().catch(() => ({}))
    const entry = body?.[promptId]
    if (entry) {
      const status = entry.status
      if (status?.completed) return entry
      if (status?.status_str === 'error') {
        const errs = []
        for (const out of Object.values(entry.outputs || {})) {
          for (const e of out?.node_errors || []) errs.push(e?.message || JSON.stringify(e))
        }
        throw new Error('generation-error: ' + (errs.join('; ') || 'ComfyUI 节点报错'))
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

/** 从 history 抽取输出文件。 */
function comfyOutputs(entry) {
  const files = []
  const seen = new Set()
  for (const out of Object.values(entry?.outputs || {})) {
    for (const kind of ['images', 'videos', 'gifs', 'audio']) {
      for (const item of out?.[kind] || []) {
        // LoadVideo/LoadImage 等**加载类节点**会把输入文件回显成 images/videos 条目（type=input）。
        // 那不是产物：误收会把「上一镜」当成这一镜的结果存进画布（链式续接里尤其致命）。
        if (item.type === 'input') continue
        const key = (item.type || 'output') + '/' + (item.subfolder || '') + '/' + item.filename
        if (seen.has(key)) continue
        seen.add(key)
        files.push({ filename: item.filename, subfolder: item.subfolder || '', type: item.type || 'output' })
      }
    }
  }
  return files
}

/** 下载产物为 Buffer。 */
async function comfyDownload(file) {
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder,
    type: file.type || 'output',
  })
  const res = await comfyFetch('/view?' + params.toString())
  if (!res.ok) throw new Error('comfy-download-failed: ' + res.status + ' ' + file.filename)
  return Buffer.from(await res.arrayBuffer())
}

/** 上传一张图片到 ComfyUI input 目录，返回 {name, subfolder, type}。 */
async function comfyUploadImage(buffer, filename) {
  const form = new FormData()
  form.append('image', new Blob([buffer]), filename)
  form.append('overwrite', 'true')
  const res = await comfyFetch('/upload/image', { method: 'POST', body: form })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body?.name) {
    throw new Error('comfy-upload-failed: ' + (body?.error || body?.message || res.status))
  }
  return body
}

// ---------------------------------------------------------------------------
// 工作流模板（ComfyUI API 格式）
// ---------------------------------------------------------------------------

/**
 * FLUX 2 文生图工作流。
 * UNETLoader → ModelSamplingFlux → CLIPLoader → VAELoader →
 * CLIPTextEncode(通用，mistral flux2 CLIP) → FluxGuidance →
 * EmptyFlux2LatentImage → Flux2Scheduler →
 * RandomNoise + BasicGuider + KSamplerSelect → SamplerCustomAdvanced → VAEDecode → SaveImage
 */
function buildFluxImageWorkflow({ prompt, width, height, seed, steps, guidance, filenamePrefix }) {
  const models = getCfg().models
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: models.fluxUnet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: models.fluxClip, type: FLUX_CLIP_TYPE } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: models.fluxVae } },
    '4': { class_type: 'ModelSamplingFlux', inputs: { model: ['1', 0], max_shift: 1.15, base_shift: 0.5, width, height } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    '5b': { class_type: 'FluxGuidance', inputs: { conditioning: ['5', 0], guidance } },
    '6': { class_type: 'EmptyFlux2LatentImage', inputs: { width, height, batch_size: 1 } },
    '7': { class_type: 'Flux2Scheduler', inputs: { steps, width, height } },
    '8': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '9': { class_type: 'BasicGuider', inputs: { model: ['4', 0], conditioning: ['5b', 0] } },
    '10': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '11': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['8', 0], guider: ['9', 0], sampler: ['10', 0], sigmas: ['7', 0], latent_image: ['6', 0] } },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    '13': { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: filenamePrefix } },
  }
}

// ---------------------------------------------------------------------------
// 分辨率计算：fast/quality 均按「每档固定长边 + 画布 aspectRatio」推导宽高，
// 因此 fast 也支持 9:16 / 1:1 等任意比例（不再写死 832×480）。
// ---------------------------------------------------------------------------
const VIDEO_MODE_LONG = { fast: 832, quality: 1344 }
const VIDEO_MODE_DEFAULT = { fast: { w: 832, h: 480 }, quality: { w: 1344, h: 768 } }
/** 起链序号：会话级单调递增；起点随机（latent 槽位跨会话共享，随机起点避免两会话互踩）。 */
function allocateChainIndex(project) {
  if (!project.settings || typeof project.settings !== 'object') project.settings = {}
  const s = project.settings
  if (!Number.isInteger(s.chainNext) || s.chainNext < 1) s.chainNext = 1 + Math.floor(Math.random() * 9000)
  return s.chainNext
}

/** 采样帧数取整到模型合法网格（清单声明 [步长, 偏移]，如 17k+5）：**向上**取整，不缩短交付。 */
function snapLengthToGrid(len, grid) {
  const n = Math.max(1, Math.round(Number(len) || 1))
  if (!Array.isArray(grid) || grid.length !== 2) return n
  const step = Math.max(1, Math.round(Number(grid[0]) || 1))
  const offset = Math.max(1, Math.round(Number(grid[1]) || 1))
  if (n <= offset) return offset
  return offset + Math.ceil((n - offset) / step) * step
}

function snap32(n) { return Math.max(32, Math.round(n / 32) * 32) }
/**
 * 计算单镜头视频实际宽高。
 * - 显式传入 width/height：直接采用（snap 到 32 倍数）；
 * - 否则按 aspectRatio（如 '16:9'/'9:16'/'1:1'）以「每档长边」推导；
 * - 都没给：回退每档默认（fast 832×480 / quality 1344×768）。
 */
function computeVideoSize({ mode, width, height, aspectRatio }) {
  const hasW = Number.isFinite(width) && width > 0
  const hasH = Number.isFinite(height) && height > 0
  if (hasW && hasH) return { w: snap32(width), h: snap32(height) }
  const m = /^\s*(\d+)\s*[:/x]\s*(\d+)\s*$/.exec(String(aspectRatio || '').trim())
  if (m) {
    const rw = Number(m[1])
    const rh = Number(m[2])
    const long = VIDEO_MODE_LONG[mode] || VIDEO_MODE_LONG.quality
    if (rw >= rh) return { w: long, h: snap32(long * rh / rw) }
    return { w: snap32(long * rw / rh), h: long }
  }
  return VIDEO_MODE_DEFAULT[mode] || VIDEO_MODE_DEFAULT.quality
}

/**
 * MiniMax H3 音视频 + 参考绑定工作流（静音→有声，去参考→参考绑定）。
 * - 模式 quality：1344×768 / 20 步 / 无 LoRA；fast：4 步 / Lightning LoRA（调试）。
 * - 分辨率由调用方按画布 aspectRatio 传入 width/height（fast/quality 均支持任意比例）。
 * - refComfyNames 为已上传到 ComfyUI 的参考图文件名（角色/场景卡），经
 *   MiniMaxH3ReferenceToVideo 的 ref_images.ref_image_N（dotted）绑定身份/环境。
 * - 音频经 VAEDecodeAudio(audio_vae) → CreateVideo(audio) 合成，不再静音。
 */
function buildH3VideoWorkflow({ prompt, width, height, length, seed, steps, filenamePrefix, mode = 'quality', refComfyNames = [] }) {
  const fast = mode === 'fast'
  const w = width
  const h = height
  const st = fast ? 4 : steps
  const sampler = 'res_multistep'
  const scheduler = 'simple'
  const models = getCfg().models

  const graph = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: models.h3RefUnet, weight_dtype: 'default' } },
    '3': { class_type: 'CLIPLoader', inputs: { clip_name: models.h3Clip, type: H3_CLIP_TYPE } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: models.h3VideoVae } },
    '4a': { class_type: 'VAELoader', inputs: { vae_name: models.h3AudioVae } },
  }

  // 模型链路：fast 档插入 Lightning LoRA（4 步 turbo）
  let modelRef = ['1', 0]
  if (fast) {
    graph['1a'] = { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: models.h3FastLora, strength_model: 1.0, model: ['1', 0] } }
    modelRef = ['1a', 0]
  }
  graph['2'] = { class_type: 'MiniMaxH3SigmaShift', inputs: { model: modelRef, shift_video: 12.0, shift_audio: 3.0 } }

  const n5 = { clip: ['3', 0], vae: ['4', 0], audio_vae: ['4a', 0], prompt, width: w, height: h, length, ref_image_size: 'match' }
  if (Array.isArray(refComfyNames) && refComfyNames.length) {
    for (let i = 0; i < refComfyNames.length; i++) {
      const nodeKey = String(200 + i)
      graph[nodeKey] = { class_type: 'LoadImage', inputs: { image: refComfyNames[i] } }
      n5['ref_images.ref_image_' + i] = [nodeKey, 0]
    }
  }
  graph['5'] = { class_type: 'MiniMaxH3ReferenceToVideo', inputs: n5 }
  graph['6'] = { class_type: 'RandomNoise', inputs: { noise_seed: seed } }
  graph['7'] = { class_type: 'BasicGuider', inputs: { model: ['2', 0], conditioning: ['5', 0] } }
  graph['8'] = { class_type: 'KSamplerSelect', inputs: { sampler_name: sampler } }
  graph['9'] = { class_type: 'BasicScheduler', inputs: { model: ['2', 0], scheduler, steps: st, denoise: 1.0 } }
  graph['10'] = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['6', 0], guider: ['7', 0], sampler: ['8', 0], sigmas: ['9', 0], latent_image: ['5', 1] } }
  graph['11'] = { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['4', 0] } }
  graph['11a'] = { class_type: 'VAEDecodeAudio', inputs: { samples: ['10', 0], vae: ['4a', 0] } }
  graph['12'] = { class_type: 'CreateVideo', inputs: { images: ['11', 0], audio: ['11a', 0], fps: H3_FPS } }
  graph['13'] = { class_type: 'SaveVideo', inputs: { video: ['12', 0], filename_prefix: filenamePrefix, format: 'mp4', codec: 'h264' } }
  return graph
}

/**
 * MiniMax H3 首/末帧串联 + 音频工作流（用于同场景续接镜，改善 Q5 过渡）。
 * - first_frame_node/last_frame_node：把上一镜末帧 / 本镜末帧作为首帧/末帧，实现连续性。
 * - 与 buildH3VideoWorkflow 不同，它用 MiniMaxH3ImageToVideo（无 ref_images，但 latent 仍可
 *   VAEDecodeAudio 取音频），身份/环境由首帧（真实帧）继承。
 */
function buildH3ImageToVideoWorkflow({ prompt, width, height, length, seed, steps, filenamePrefix, mode = 'quality', firstFrameComfyName = null, lastFrameComfyName = null }) {
  const fast = mode === 'fast'
  const w = width
  const h = height
  const st = fast ? 4 : steps
  const sampler = 'res_multistep'
  const scheduler = 'simple'
  const models = getCfg().models

  const graph = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: models.h3FlUnet, weight_dtype: 'default' } },
    '3': { class_type: 'CLIPLoader', inputs: { clip_name: models.h3Clip, type: H3_CLIP_TYPE } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: models.h3VideoVae } },
    '4a': { class_type: 'VAELoader', inputs: { vae_name: models.h3AudioVae } },
  }
  let modelRef = ['1', 0]
  if (fast) {
    graph['1a'] = { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: models.h3FlFastLora, strength_model: 1.0, model: ['1', 0] } }
    modelRef = ['1a', 0]
  }
  graph['2'] = { class_type: 'MiniMaxH3SigmaShift', inputs: { model: modelRef, shift_video: 12.0, shift_audio: 3.0 } }

  const n5 = { clip: ['3', 0], vae: ['4', 0], prompt, width: w, height: h, length }
  let nid = 200
  if (firstFrameComfyName) {
    graph[String(nid)] = { class_type: 'LoadImage', inputs: { image: firstFrameComfyName } }
    graph[String(nid + 1)] = { class_type: 'ImageScale', inputs: { image: [String(nid), 0], upscale_method: 'lanczos', width: w, height: h, crop: 'disabled' } }
    n5.first_frame = [String(nid + 1), 0]
    nid += 2
  }
  if (lastFrameComfyName) {
    graph[String(nid)] = { class_type: 'LoadImage', inputs: { image: lastFrameComfyName } }
    graph[String(nid + 1)] = { class_type: 'ImageScale', inputs: { image: [String(nid), 0], upscale_method: 'lanczos', width: w, height: h, crop: 'disabled' } }
    n5.last_frame = [String(nid + 1), 0]
  }
  graph['5'] = { class_type: 'MiniMaxH3ImageToVideo', inputs: n5 }

  graph['6'] = { class_type: 'RandomNoise', inputs: { noise_seed: seed } }
  graph['7'] = { class_type: 'BasicGuider', inputs: { model: ['2', 0], conditioning: ['5', 0] } }
  graph['8'] = { class_type: 'KSamplerSelect', inputs: { sampler_name: sampler } }
  graph['9'] = { class_type: 'BasicScheduler', inputs: { model: ['2', 0], scheduler, steps: st, denoise: 1.0 } }
  graph['10'] = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['6', 0], guider: ['7', 0], sampler: ['8', 0], sigmas: ['9', 0], latent_image: ['5', 1] } }
  graph['11'] = { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['4', 0] } }
  graph['11a'] = { class_type: 'VAEDecodeAudio', inputs: { samples: ['10', 0], vae: ['4a', 0] } }
  graph['12'] = { class_type: 'CreateVideo', inputs: { images: ['11', 0], audio: ['11a', 0], fps: H3_FPS } }
  graph['13'] = { class_type: 'SaveVideo', inputs: { video: ['12', 0], filename_prefix: filenamePrefix, format: 'mp4', codec: 'h264' } }

  return graph
}

// ---------------------------------------------------------------------------
// 画布兼容投影（权威状态在 Harness Domain Storage）
// ---------------------------------------------------------------------------

let legacyCanvasAdapter = null
let activeProjectService = null

async function initializeTestProjectDomain() {
  const projectService = new ProjectService(new MemoryProjectRepository())
  const adapter = new LegacyCanvasCommandAdapter(projectService)
  await projectService.open()
  legacyCanvasAdapter = adapter
  activeProjectService = projectService
  return async () => {
    if (legacyCanvasAdapter === adapter) legacyCanvasAdapter = null
    if (activeProjectService === projectService) activeProjectService = null
    await projectService.close()
  }
}

function projectDir(_root, projectId, step = PROJECT_STEPS.generation) {
  return join(projectDirectory(ctx ? STUDIO_STORAGE_ROOT : _root, projectId), step)
}
function emptyProject(sessionId) {
  return {
    schemaVersion: 1,
    sessionId,
    settings: { aspectRatio: '16:9', duration: '', audioMode: 'native' },
    nodes: [],
  }
}

async function loadProject(root, sessionId) {
  if (!legacyCanvasAdapter) throw new Error('Project Domain is not initialized')
  return legacyCanvasAdapter.load(root, sessionId)
}

async function saveProject(root, sessionId, project) {
  if (!legacyCanvasAdapter) throw new Error('Project Domain is not initialized')
  return legacyCanvasAdapter.save(root, sessionId, project)
}

async function submitProjectCommand(projectId, type, payload, actor = 'legacy-render') {
  if (!activeProjectService) throw new Error('Project Domain is not initialized')
  const project = await activeProjectService.getProject(projectId)
  return activeProjectService.execute({
    projectId,
    commandId: randomUUID(),
    expectedRevision: project.revision,
    type,
    payload,
    actor,
  })
}

async function ensureLegacyShot(projectId, nodeId, title) {
  let project = await activeProjectService.getProject(projectId)
  const episodeId = 'legacy-main'
  if (!project.episodes[episodeId]) {
    await submitProjectCommand(projectId, 'upsertEpisode', { id: episodeId, title: '兼容画布', status: 'rendering' })
    project = await activeProjectService.getProject(projectId)
  }
  if (!project.shots[nodeId]) {
    await submitProjectCommand(projectId, 'upsertShot', { id: nodeId, episodeId, title, status: 'ready' })
  }
  return nodeId
}

function nextOrder(nodes) {
  return nodes.reduce((m, n) => Math.max(m, Number(n.order) || 0), -1) + 1
}

// ---------------------------------------------------------------------------
// workspace / session 解析
// ---------------------------------------------------------------------------

/**
 * 解析会话工作区根目录。
 * 优先级：显式 workspaceId → agent 会话 cwd → workspaceRegistry 会话成员扫描。
 */
function resolveSessionRoot(ctx, sessionId, workspaceId, exec) {
  const sid = sessionId || exec?.agent?.id
  if (!sid) throw HttpError(400, 'sessionId required')

  if (workspaceId) {
    const w = ctx.workspaceRegistry.get(workspaceId)
    if (w) return { sessionId: sid, root: w.path, workspaceId: String(w.id) }
  }

  const cwd = exec?.agent?.session?.meta?.cwd
  if (cwd) return { sessionId: sid, root: cwd, workspaceId: '' }

  for (const w of ctx.workspaceRegistry.list()) {
    if (w.sessionIds.includes(sid)) return { sessionId: sid, root: w.path, workspaceId: String(w.id) }
  }

  throw HttpError(404, 'workspace not found for session ' + sid)
}

// ---------------------------------------------------------------------------
// 生成执行（图片 / 视频），写回画布
// ---------------------------------------------------------------------------

/**
 * 读图片的**真实像素尺寸**（PNG / JPEG / WebP）。读不出返回 null（不猜）。
 *
 * 为什么需要它：交付尺寸必须**如实记账**——i2i 的尺寸跟随参考图、放大类实现的交付 = 首遍 ×倍率，
 * 都与「图内推导出来的尺寸」不同。旧行为是拿推导值写进画布节点（i2i 会记 1344×768 而产物是 1056×1056），
 * 拼接/续接的一致性判断读这个字段就会错。
 */
function probeImageSize(absPath) {
  let buf
  try { buf = readFileSync(absPath) } catch { return null }
  if (buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG') {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const fmt = buf.toString('latin1', 12, 16)
    try {
      if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
      if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
      if (fmt === 'VP8L') {
        const b = buf.readUInt32LE(21)
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }
      }
    } catch { return null }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue }
      const marker = buf[off + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) }
      }
      off += 2 + buf.readUInt16BE(off + 2)
    }
  }
  return null
}

async function persistMedia(root, sessionId, buffer, filename, title = 'generated-media', step = PROJECT_STEPS.generation) {
  const project = await loadProject(root, sessionId)
  const projectId = project.projectId
  const dir = projectDir(root, projectId, step)
  await mkdir(dir, { recursive: true })
  const ext = extname(filename) || '.bin'
  const semanticName = `${step.slice(0, 7)}-${safeName(title, 'generated-media')}-${nextArtifactStamp()}` + ext
  const target = join(dir, semanticName)
  await writeFile(target, buffer)
  return `artifacts/${projectId}/${step}/${semanticName}`
}

// ---------------------------------------------------------------------------
// 手动资产导入（画布「自己添加角色卡/场景卡」）
//   importManualImage    — 上传的本地图片 → 画布 image 节点
//   copyAssetToCanvas    — 资产库中的资产 → 画布 image 节点（工具/路由共用）
// 入库仍是用户可选的独立动作（画布卡片「入库」按钮），与「入库由用户人工完成」
// 的契约一致：此处只落画布卡，不写资产库。
// ---------------------------------------------------------------------------

const UPLOAD_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}
const UPLOAD_MAX_FILE = 24 * 1024 * 1024
const UPLOAD_MAX_FILES = 12

/** data:image/...;base64 → { buffer, ext }；非法输入抛错。 */
function parseDataUrlImage(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim())
  if (!m) throw new Error('仅支持 png / jpg / webp / gif 图片的 dataURL')
  const buffer = Buffer.from(m[2], 'base64')
  if (!buffer.length) throw new Error('图片内容为空')
  if (buffer.length > UPLOAD_MAX_FILE) throw new Error('图片超过 24MB 上限')
  return { buffer, ext: UPLOAD_MIME[m[1]] }
}

/** 把一张上传的本地图片存成画布 image 节点（kind=image，params.source='manual-upload'）。 */
async function importManualImage(root, sessionId, item, group) {
  const { buffer, ext } = parseDataUrlImage(item && item.dataUrl)
  const nodeId = randomUUID()
  const rawName = String((item && item.filename) || '').replace(/\\/g, '/').split('/').pop() || '图片'
  const baseName = rawName.replace(/\.[^.]+$/, '').trim().slice(0, 60) || '图片'
  const rel = await persistMedia(root, sessionId, buffer, 'upload' + ext, baseName)
  const project = await loadProject(root, sessionId)
  const node = {
    id: nodeId,
    kind: 'image',
    title: (item && typeof item.title === 'string' && item.title.trim()) ? item.title.trim().slice(0, 60) : baseName,
    media: rel,
    group: group || DEFAULT_GROUP,
    params: { source: 'manual-upload', originalName: rawName },
    status: 'ready',
    createdAt: Date.now(),
    order: nextOrder(project.nodes),
  }
  project.nodes.push(node)
  await saveProject(root, sessionId, project)
  return node
}

/**
 * 把资产库（.dsh-assets/library.json）中的资产物化为当前画布节点，按 kind 决定产物：
 *   - image / video：库文件拷贝到 canvas/<sessionId>/，建同 kind 的媒体节点（params.assetId 绑定资产 id）
 *   - text：不落文件，直接建 text/table 节点，正文取资产记录的 text
 * 三种情况都写 params.assetId，方便「已入库」态与后续追溯。
 */
async function copyAssetToCanvas(root, sessionId, ref, opts = {}) {
  const lib = loadLibrary(root)
  const id = canonicalAssetId(ref)
  const a = lib.assets[id]
  if (!a) throw new Error('资产不存在: ' + ref)
  const kind = assetKind(a)

  const nodeId = opts.nodeId || randomUUID()
  const project = await loadProject(root, sessionId)
  const prev = project.nodes.find((n) => n.id === nodeId)

  let node
  if (kind === 'text') {
    node = {
      id: nodeId,
      kind: a.nodeKind === 'table' ? 'table' : 'text',
      title: opts.title || a.title || a.name || id,
      content: String(a.text == null ? '' : a.text),
      group: opts.group || DEFAULT_GROUP,
      params: { assetId: id, model: 'asset:' + id, capability: opts.capability || null },
      status: 'ready',
      createdAt: Date.now(),
      order: nextOrder(project.nodes),
    }
  } else {
    const abs = resolveAssetPath(root, lib, id)
    if (!abs) throw new Error('资产文件缺失: ' + (a.file || a.image || id))
    const buf = await readFile(abs)
    const rel = await persistMedia(root, sessionId, buf, 'asset' + (extname(abs) || '.png'), opts.title || a.name || id)
    node = {
      id: nodeId,
      kind: kind === 'video' ? 'video' : 'image',
      title: opts.title || a.name || id,
      media: rel,
      group: opts.group || DEFAULT_GROUP,
      params: { assetId: id, model: 'asset:' + id, speaksOnScreen: a.speaksOnScreen },
      status: 'ready',
      createdAt: Date.now(),
      order: nextOrder(project.nodes),
    }
  }

  if (prev) { node.order = prev.order; node.createdAt = prev.createdAt }
  if (prev) project.nodes[project.nodes.findIndex((n) => n.id === nodeId)] = node
  else project.nodes.push(node)
  await saveProject(root, sessionId, project)
  return node
}

/**
 * 替换画布某 image 节点的图片（画布卡「编辑 → 本地上传替换」）。
 * - 新图落盘为 upload-<uuid><ext>，节点 media 指向新文件（原文件保留在磁盘）。
 * - 该节点此前若已绑定资产库（params.assetId，来自入库或 asset_to_canvas），
 *   替换后**解除绑定**（库中旧图不被被动更新），返回 prevAssetId 供提示用户按需重新「入库」。
 * - 生成类元数据（model/prompt/seed/steps/width/height 等）一并清掉，避免误导
 *   「这张图是按旧参数生成」；capability/状态类 params 保留。
 * - 清除 deliveredAt/deliveryError：替换后的新图会在下次 ask 前重新自动送达（飞书）。
 */
async function replaceNodeImage(root, sessionId, nodeId, item) {
  const { buffer, ext } = parseDataUrlImage(item && item.dataUrl)
  const project = await loadProject(root, sessionId)
  const idx = project.nodes.findIndex((n) => n.id === nodeId)
  if (idx < 0) throw new Error('节点不存在: ' + nodeId)
  const n = project.nodes[idx]
  if (n.kind !== 'image') throw new Error('仅 image 节点可替换图片（当前 ' + (n.kind || '?') + '）')

  const rel = await persistMedia(root, sessionId, buffer, 'upload' + ext, n.title || 'replacement-image')
  const params = { ...(n.params || {}) }
  const prevAssetId = params.assetId
  delete params.assetId
  for (const k of ['model', 'prompt', 'seed', 'steps', 'guidance', 'width', 'height', 'length', 'count']) delete params[k]
  const rawName = String((item && item.filename) || '').replace(/\\/g, '/').split('/').pop() || ''
  params.source = 'manual-upload'
  params.replacedAt = Date.now()
  if (rawName) params.originalName = rawName
  delete params.deliveredAt
  delete params.deliveryError

  n.media = rel
  n.params = params
  project.nodes[idx] = n
  await saveProject(root, sessionId, project)
  return { node: n, prevAssetId, assetIdCleared: Boolean(prevAssetId) }
}

async function runImageGeneration(ctx, opts) {
  const { workspaceId, exec } = opts
  const { root, sessionId } = resolveSessionRoot(ctx, opts.sessionId, workspaceId, exec)
  const width = intArg(opts, 'width', 1344)
  const height = intArg(opts, 'height', 768)
  const seed = intArg(opts, 'seed', Math.floor(Math.random() * 2 ** 31))
  const steps = intArg(opts, 'steps', 20)
  const guidance = floatArg(opts, 'guidance', 3.5)
  const count = Math.min(Math.max(intArg(opts, 'count', 1), 1), 4)
  const nodeId = opts.nodeId || randomUUID()

  const files = []
  for (let i = 0; i < count; i++) {
    const prefix = CANVAS_DIR + '/' + sessionId + '/' + nodeId
    const graph = buildFluxImageWorkflow({ prompt: opts.prompt, width, height, seed: seed + i, steps, guidance, filenamePrefix: prefix })
    const promptId = await comfySubmit(graph)
    const entry = await comfyWait(promptId, opts.signal)
    const outputs = comfyOutputs(entry)
    if (outputs.length === 0) throw new Error('generation-error: ComfyUI 无输出')
    for (const f of outputs) {
      const buf = await comfyDownload(f)
      files.push(await persistMedia(root, sessionId, buf, f.filename, opts.title || 'generated-image'))
    }
  }

  const project = await loadProject(root, sessionId)
  const node = {
    id: nodeId,
    kind: 'image',
    title: opts.title || 'FLUX 图片',
    media: files[0] || '',
    group: opts.group || DEFAULT_GROUP,
    params: { model: 'flux', seed, width, height, steps, guidance, prompt: opts.prompt },
    status: 'ready',
    createdAt: Date.now(),
    order: nextOrder(project.nodes),
  }
  const existing = project.nodes.findIndex((n) => n.id === nodeId)
  if (existing >= 0) { node.order = project.nodes[existing].order; node.createdAt = project.nodes[existing].createdAt; project.nodes[existing] = node }
  else project.nodes.push(node)
  await saveProject(root, sessionId, project)

  return { ok: true, node, files }
}

async function runVideoGeneration(ctx, opts) {
  const { workspaceId, exec } = opts
  const { root, sessionId } = resolveSessionRoot(ctx, opts.sessionId, workspaceId, exec)
  const explicitW = opts.width !== undefined && opts.width !== null && opts.width !== ''
  const explicitH = opts.height !== undefined && opts.height !== null && opts.height !== ''
  const width = intArg(opts, 'width', 1344)
  const height = intArg(opts, 'height', 768)
  const length = intArg(opts, 'length', 124)
  const seed = intArg(opts, 'seed', Math.floor(Math.random() * 2 ** 31))
  const steps = intArg(opts, 'steps', 20)
  const mode = opts.mode === 'fast' ? 'fast' : 'quality'
  const nodeId = opts.nodeId || randomUUID()

  const project = await loadProject(root, sessionId)
  // 实际生效分辨率：显式 width/height 优先，否则按画布 aspectRatio 推导（fast/quality 均支持任意比例）
  const { w: effW, h: effH } = computeVideoSize({
    mode,
    width: explicitW ? width : undefined,
    height: explicitH ? height : undefined,
    aspectRatio: project.settings?.aspectRatio,
  })
  // 上传画布图片节点 → ComfyUI 文件名（参考图 / 首末帧）
  const uploadNode = async (nid) => {
    const n = project.nodes.find((x) => x.id === nid)
    if (n?.media) {
      const absPath = resolveStoredPath(root, n.media)
      if (existsSync(absPath)) {
        const buf = await readFile(absPath)
        const up = await comfyUploadImage(buf, basename(n.media))
        return up.name
      }
    }
    return null
  }

  // 参考绑定（角色卡/场景卡）→ ReferenceToVideo 路径
  const refNodeIds = Array.isArray(opts.ref_nodes) ? opts.ref_nodes : []
  const refComfyNames = []
  for (const rid of refNodeIds) {
    const name = await uploadNode(rid)
    if (name) refComfyNames.push(name)
  }

  // 首/末帧串联（同场景续接）→ ImageToVideo 路径
  const firstFrameComfyName = opts.first_frame_node ? await uploadNode(opts.first_frame_node) : null
  const lastFrameComfyName = opts.last_frame_node ? await uploadNode(opts.last_frame_node) : null
  const useChaining = Boolean(firstFrameComfyName || lastFrameComfyName)

  const prefix = CANVAS_DIR + '/' + sessionId + '/' + nodeId
  const graph = useChaining
    ? buildH3ImageToVideoWorkflow({ prompt: opts.prompt, width: effW, height: effH, length, seed, steps, filenamePrefix: prefix, mode, firstFrameComfyName, lastFrameComfyName })
    : buildH3VideoWorkflow({ prompt: opts.prompt, width: effW, height: effH, length, seed, steps, filenamePrefix: prefix, mode, refComfyNames })
  const promptId = await comfySubmit(graph)
  const entry = await comfyWait(promptId, opts.signal)
  const outputs = comfyOutputs(entry)
  if (outputs.length === 0) throw new Error('generation-error: ComfyUI 无输出')

  const files = []
  for (const f of outputs) {
    const buf = await comfyDownload(f)
    files.push(await persistMedia(root, sessionId, buf, f.filename, opts.title || 'generated-video'))
  }

  // 记录实际生效分辨率（fast/quality 均按画布比例或传入宽高计算）
  const node = {
    id: nodeId,
    kind: 'video',
    title: opts.title || 'MiniMax H3 视频',
    media: files[0] || '',
    group: opts.group || DEFAULT_GROUP,
    params: { model: 'minimax-h3' + (mode === 'fast' ? '-fast' : ''), seed, width: effW, height: effH, length, fps: H3_FPS, steps: mode === 'fast' ? 4 : steps, mode, ref_nodes: refNodeIds, first_frame_node: opts.first_frame_node || null, last_frame_node: opts.last_frame_node || null, prompt: opts.prompt },
    status: 'ready',
    createdAt: Date.now(),
    order: nextOrder(project.nodes),
  }
  const existing = project.nodes.findIndex((n) => n.id === nodeId)
  if (existing >= 0) { node.order = project.nodes[existing].order; node.createdAt = project.nodes[existing].createdAt; project.nodes[existing] = node }
  else project.nodes.push(node)
  await saveProject(root, sessionId, project)

  return { ok: true, node, files }
}

function intArg(obj, key, dflt) {
  const v = obj?.[key]
  if (v === undefined || v === null || v === '') return dflt
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : dflt
}
function floatArg(obj, key, dflt) {
  const v = obj?.[key]
  if (v === undefined || v === null || v === '') return dflt
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

// ---------------------------------------------------------------------------
// 通用渲染（M2）：capability → manifest → 编译图 → ComfyUI → 写画布
// ---------------------------------------------------------------------------

let _registry = null
let _registrySig = null
// 用户清单目录。`DSH_SVS_USER_WORKFLOWS` 是**测试接缝**：e2e 脚本指到临时目录，
// 就不必往用户真实配置目录里塞夹具（也能保证跑完不留垃圾）。缺省仍是标准位置。
const USER_WORKFLOWS_DIR = process.env.DSH_SVS_USER_WORKFLOWS || join(homedir(), '.dsh', 'dsh-short-video-studio', 'workflows')

/**
 * 清单目录指纹：文件名 + mtime + size。任一清单被生成器重写、新增或删除都会变。
 * 两处目录都很小（内置 ~31 个 json），readdir + stat 约 0.1ms，够便宜到每次 getRegistry 都查。
 */
function manifestSignature() {
  return [resolve(packageRoot, 'workflows'), USER_WORKFLOWS_DIR].map((dir) => {
    try {
      return readdirSync(dir)
        .filter((n) => n.endsWith('.json'))
        .sort()
        .map((n) => {
          try { const s = statSync(join(dir, n)); return `${n}:${s.mtimeMs}:${s.size}` } catch { return `${n}:?` }
        })
        .join(',')
    } catch { return '(absent)' }
  }).join('|')
}

/** 重新加载内置 + 用户清单（用户同名遮蔽内置）。 */
function reloadRegistry() {
  // 先取指纹再读文件：若读取途中恰好有人改清单，指纹会偏旧 → 下次调用再重载一次（多一次无害）
  const sig = manifestSignature()
  const builtin = loadBuiltinManifests(resolve(packageRoot, 'workflows'))
  const user = loadBuiltinManifests(USER_WORKFLOWS_DIR)
  for (const m of builtin.manifests) m._source = 'builtin'
  for (const m of user.manifests) m._source = 'user'
  const byId = { ...builtin.byId, ...user.byId }
  const byCapability = {}
  for (const m of Object.values(byId)) (byCapability[m.capability] ||= []).push(m)
  // 同能力候选**确定性排序**：priority 降序（缺省 0），再按 id 升序。
  // 该顺序决定 `preferred` 为空时的隐式默认档（resolveManifest 取 candidates[0]），
  // 所以不能依赖文件系统枚举顺序（曾导致"新增一份清单就悄悄改掉默认档"）。
  // 约定：想永不被选为隐式默认的清单写负数 priority（如实验/依赖自定义节点的加速变体）。
  for (const list of Object.values(byCapability)) {
    list.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0) || String(a.id).localeCompare(String(b.id)))
  }
  _registry = {
    manifests: Object.values(byId),
    byId,
    byCapability,
    errors: [...builtin.errors, ...user.errors],
  }
  // 清单变动 → 节点可用性预检缓存作废（用户可能刚装了 Sol 之类的第三方节点）
  _nodeProbe.clear()
  _registrySig = sig
  return _registry
}

function getRegistry() {
  if (!_registry) return reloadRegistry()
  // 清单目录变了（生成器重跑 / 用户新增）→ 自动重载。否则新清单要重启 dsh 才可见，
  // 表现为「脚本刚生成的工作流在 comfy_list_workflows 里查不到、workflow= 也解析不到」。
  if (_registrySig !== manifestSignature()) return reloadRegistry()
  return _registry
}

/** 读取某 capability 的有序 preferred 工作流 id 列表（**家族序**：家族 = group，或清单自身 id）。 */
function getPreferred(capability, cfg = null) {
  const c = cfg || loadConfigFile()
  const configured = c.preferred?.[capability]
  const values = Array.isArray(configured) ? configured : (DEFAULT_PREFERRED[capability] || [])
  return values.filter((id) => typeof id === 'string')
}

/**
 * 配置面「钉实现」：`cfg.pins[capability]` 可以是**实现 id**（如 `qwen-image-21-t2i-quality`）
 * 或**家族名**（如 `qwen-image-21-t2i`，= 清单的 group）。
 *
 * 存在意义：工具面不再接受 `workflow=`（实现选择归配置面），但排障与基准脚本仍需要一个
 * 「临时钉死某实现」的通道。钉死**不等于**允许跨档：钉的是 fast 档却请求 quality ⇒ 报错。
 *
 * @returns 命中的清单；未配置返回 null；配置非法/冲突抛错（不静默忽略）。
 */
function resolvePinnedImplementation(capability, tier, cfg, registry) {
  const raw = cfg?.pins?.[capability]
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') throw new Error(`配置 pins["${capability}"] 必须是字符串（实现 id 或家族名）`)
  const key = raw.trim()
  const direct = registry.byId[key]
  if (direct) {
    if (direct.capability !== capability) {
      throw new Error(`配置 pins["${capability}"] = "${key}" 的能力是 ${direct.capability}，与该能力不匹配：请在设置页修正`)
    }
    if (direct.tier && tier && direct.tier !== tier) {
      throw new Error(`配置 pins["${capability}"] 钉的是 ${direct.tier} 档实现 "${key}"，与请求的 ${tier} 档冲突（钉实现不跨档）：请改档位或改 pin`)
    }
    return direct
  }
  const pool = tierImplementations(capability, tier, registry)
  const hit = pool.find((m) => groupNameOf(m) === key)
  if (!hit) {
    const fams = [...new Set(tierImplementations(capability, tier, registry).map(groupNameOf))]
    throw new Error(
      `配置 pins["${capability}"] = "${key}" 既不是实现 id，也不是该能力 ${tier} 档的家族名` +
      `（该档可用家族：${fams.join(' / ') || '无'}）：请在设置页修正`)
  }
  return hit
}

// Elysium 使用独立模型键，避免旧作者配置覆盖已按本机 GPU 调整的清单资产。
const H3_ELYSIUM_REF2V_IDS = ['elysium-minimax-h3-ref2v-fast', 'elysium-minimax-h3-ref2v-balanced', 'elysium-minimax-h3-ref2v-quality']
const H3_ELYSIUM_I2V_IDS = ['elysium-minimax-h3-i2v-fast', 'elysium-minimax-h3-i2v-balanced', 'elysium-minimax-h3-i2v-quality']
const QWEN_ELYSIUM_T2I_IDS = ['elysium-qwen-image-21-t2i-fast', 'elysium-qwen-image-21-t2i-balanced', 'elysium-qwen-image-21-t2i-quality']
const QWEN_ELYSIUM_I2I_IDS = ['elysium-qwen-image-21-i2i-fast', 'elysium-qwen-image-21-i2i-balanced', 'elysium-qwen-image-21-i2i-quality']
const H3_ELYSIUM_ASSETS = { unet: 'elysiumH3Unet', clip: 'elysiumH3Clip', vae: 'elysiumH3VideoVae', audio_vae: 'elysiumH3AudioVae' }
const QWEN_ELYSIUM_ASSETS = { unet: 'elysiumQwenUnet', clip: 'elysiumQwenClip', vae: 'elysiumQwenVae' }

const LEGACY_MODEL_ASSET_MAP = {
  ...Object.fromEntries(H3_ELYSIUM_REF2V_IDS.map((id) => [id, H3_ELYSIUM_ASSETS])),
  ...Object.fromEntries(H3_ELYSIUM_I2V_IDS.map((id) => [id, H3_ELYSIUM_ASSETS])),
  ...Object.fromEntries(QWEN_ELYSIUM_T2I_IDS.map((id) => [id, QWEN_ELYSIUM_ASSETS])),
  ...Object.fromEntries(QWEN_ELYSIUM_I2I_IDS.map((id) => [id, QWEN_ELYSIUM_ASSETS])),
}

/**
 * 旧清单 id 的 assetOverrides 继承：拆分后新 id 会同时读旧 id 的覆盖，
 * 使用户既有的 assetOverrides（如 int8 VAE 选择）不因拆分而失效。
 */
const ASSET_OVERRIDE_ALIASES = Object.fromEntries([
  ...H3_ELYSIUM_REF2V_IDS.map((id) => [id, ['elysium-minimax-h3-ref2v']]),
  ...H3_ELYSIUM_I2V_IDS.map((id) => [id, ['elysium-minimax-h3-i2v']]),
  ...QWEN_ELYSIUM_T2I_IDS.map((id) => [id, ['elysium-qwen-image-21-t2i']]),
  ...QWEN_ELYSIUM_I2I_IDS.map((id) => [id, ['elysium-qwen-image-21-i2i']]),
])

/** 某工作流的资产覆盖：显式 assetOverrides[id] > 旧 id 覆盖 > 旧 models.* 兜底。 */
function getAssetOverrides(workflowId) {
  const c = loadConfigFile()
  const explicit = (c.assetOverrides && c.assetOverrides[workflowId]) || {}
  const alias = {}
  for (const oldId of ASSET_OVERRIDE_ALIASES[workflowId] || []) {
    Object.assign(alias, (c.assetOverrides && c.assetOverrides[oldId]) || {})
  }
  const legacy = {}
  const map = LEGACY_MODEL_ASSET_MAP[workflowId] || {}
  const models = c.models || {}
  for (const [assetKey, modelKey] of Object.entries(map)) {
    if (models[modelKey] !== undefined && models[modelKey] !== '') legacy[assetKey] = models[modelKey]
  }
  return { ...legacy, ...alias, ...explicit }
}

/**
 * 视频「形状」真值表：工具面对调用者显式声明走哪条条件路径（= capability），
 * 与「续接」正交——形状决定条件节点与必须/禁止的绑定参数，continuity_from 决定是否继承上一镜。
 *
 * 为什么要有这张表：形状此前是被**副作用**推断的（传了 first_frame 就当 i2v），
 * 于是"两个都传"会把参数静默丢掉（i2v 清单没有 refs 槽位 → 上传了但不接线）。
 * 现在：形状必须显式传，冲突直接报错并给出修法。
 * **跨形状续接是允许的**（上一镜 r2v → 本镜 i2v + continuity_from），所以这里不校验上一镜的形状。
 */
const VIDEO_SHAPES = {
  r2v: {
    capability: 'video.reference2video',
    label: '参考绑定',
    expect: ['ref_nodes'],
    forbid: ['first_frame_node', 'last_frame_node'],
    forbidHint: 'r2v 没有首帧/末帧槽位（以前会被静默忽略）。同场景续接请用 continuity_from=上一镜节点 id；要首帧锚定请改 type=i2v',
  },
  i2v: {
    capability: 'video.image2video',
    label: '首帧/末帧串联',
    require: ['first_frame_node'],
    forbid: ['ref_nodes'],
    forbidHint: 'i2v 不接受 ref_nodes：身份与环境由首帧继承。请删掉 ref_nodes，或改 type=r2v（参考绑定）',
    // 链式续接已支持：i2v 版 ctx 模板（scripts/make-h3-ctx-templates.mjs 派生 → minimax-h3-i2v-ctx-*）
    // 把 Motion Context 挂在 MiniMaxH3ImageToVideo 之后 ⇒ 首帧锚定与"继承上一镜尾部"可同时用。
    // 注意 i2v 的**普通实现不声明 chain**（无 clipIndex）：要用续接必须选到链式实现，否则报「上一镜没有链式序号」。
    chain: true,
  },
}
const SHAPE_OF_CAPABILITY = Object.fromEntries(Object.entries(VIDEO_SHAPES).map(([k, v]) => [v.capability, k]))

/**
 * 校验 shape × 参数。errors 抛错（带修法），warnings 随结果返回。
 * 只对视频能力生效；image.* / audio.* / image.from_video 直接放行。
 */
function validateVideoArgs(capability, args = {}) {
  const shapeId = SHAPE_OF_CAPABILITY[capability]
  const warnings = []
  if (!shapeId) return { shape: null, warnings }
  const shape = VIDEO_SHAPES[shapeId]
  if (args.type !== undefined && args.type !== null && args.type !== '' && args.type !== shapeId) {
    throw new Error(`参数冲突：type=${args.type} 与 capability=${capability} 不一致（type=${args.type} 对应 ${VIDEO_SHAPES[args.type] ? VIDEO_SHAPES[args.type].capability : '未知'}）`)
  }
  const given = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '')
  for (const k of shape.forbid || []) {
    if (given(args[k])) throw new Error(`type=${shapeId}（${shape.label}）不接受 ${k}。${shape.forbidHint}`)
  }
  for (const k of shape.require || []) {
    if (!given(args[k])) throw new Error(`type=${shapeId}（${shape.label}）必须传 ${k}：首帧决定身份与构图（末帧 last_frame_node 可选）`)
  }
  if (shapeId === 'r2v' && !given(args.ref_nodes)) {
    warnings.push('r2v 未传 ref_nodes：本次按「只有文本提示词」生成，角色/场景一致性无从保证（要绑定身份请传角色卡/场景卡）')
  }
  if (given(args.continuity_from) && shape.chain === false) {
    throw new Error(`type=${shapeId} 的形状不支持链式续接（continuity_from）。请改用支持续接的形状，或不传 continuity_from`)
  }
  return { shape: shapeId, warnings }
}

/** 显式 workflow > preferred 顺序 > 该 capability 任意清单（internal 诊断清单不参与隐式选中）。 */
function resolveManifest(registry, capability, workflowId) {
  const candidates = (registry.byCapability[capability] || []).filter((m) => !m.internal)
  if (workflowId) {
    const m = registry.byId[workflowId]
    if (!m) throw new Error(`workflow "${workflowId}" 不存在`)
    if (m.capability !== capability) throw new Error(`workflow "${workflowId}" 能力是 ${m.capability}，非 ${capability}`)
    return m
  }
  if (!candidates.length) throw new Error(`no workflow for capability ${capability}`)
  for (const id of getPreferred(capability)) {
    const m = registry.byId[id]
    if (m && m.capability === capability && !m.internal) return m
  }
  return candidates[0]
}

/**
 * 解析 mode：显式合法 mode > 单档清单的唯一 mode > 清单首个 mode。
 * strict=true 时，显式请求的 mode 不存在于清单 → **报错**（禁止静默跨档替换）。
 * 例外：已声明 tier 且只有一个 mode 的清单（P2 之后的分档实现），其唯一 mode 就是该档的参数组，
 * 名称不同也照用——这不算跨档替换。
 */
function resolveMode(manifest, mode, { strict = false } = {}) {
  const names = Object.keys(manifest.modes || {})
  if (!names.length) return null
  if (mode && manifest.modes[mode]) return mode
  if (mode && strict) {
    if (manifest.tier && names.length === 1) return names[0]
    throw new Error(
      `工作流 "${manifest.id}" 不提供 "${mode}" 档（可用：${names.join(' / ')}）：` +
      '本插件不会静默跨档替换，请改档位或改用提供该档的实现')
  }
  return names[0]
}

/** 首遍尺寸：图锁定 > 显式宽高 > aspect-ratio 推导（按 mode.longSide）> resolution.default。 */
function computeManifestSize(manifest, mode, explicitW, explicitH, aspectRatio) {
  // 只有**图锁定**形态（resolutionLock.graph）优先于一切：首遍尺寸是图结构的一部分
  // （放大倍率写在图内节点上），显式 width/height 与画布比例都不得覆盖它，否则「放大」会从错的
  // 底片开始。**只锁倍率**形态（只有 scale）不锁首遍，照常往下走。
  // 无论哪种形态，交付尺寸都用 manifestDeliverySize() 推。
  const lock = manifest.resolutionLock
  if (lock && Array.isArray(lock.graph) && lock.graph.length >= 2) {
    return { w: snap32(lock.graph[0]), h: snap32(lock.graph[1]) }
  }
  const hasW = Number.isFinite(explicitW) && explicitW > 0
  const hasH = Number.isFinite(explicitH) && explicitH > 0
  if (hasW && hasH) return { w: snap32(explicitW), h: snap32(explicitH) }
  const res = manifest.resolution || {}
  const ratioOf = (s) => {
    const m = /^\s*(\d+)\s*[:/x]\s*(\d+)\s*$/.exec(String(s || '').trim())
    if (!m) return null
    const rw = Number(m[1]); const rh = Number(m[2])
    return rw > 0 && rh > 0 ? rw / rh : null
  }
  const defaultPair = Array.isArray(res.default)
    ? res.default
    : (res.default && typeof res.default === 'object' && Array.isArray(res.default[mode]) ? res.default[mode] : null)
  // 只给一边：另一边按「画布比例 → 本档 default 比例 → 16:9」推导。
  // 旧行为是**静默忽略**（只有 hasW && hasH 才生效），调用方以为生效了——这里改成推导。
  if (hasW || hasH) {
    const ratio = ratioOf(aspectRatio) || (defaultPair ? defaultPair[0] / defaultPair[1] : 16 / 9)
    if (hasW) return { w: snap32(explicitW), h: snap32(explicitW / ratio) }
    return { w: snap32(explicitH * ratio), h: snap32(explicitH) }
  }
  if (res.policy === 'aspect-ratio') {
    const long = (mode && manifest.modes?.[mode]?.longSide) || res.longSide || 1344
    const ratio = ratioOf(aspectRatio)
    if (ratio) {
      return ratio >= 1 ? { w: long, h: snap32(long / ratio) } : { w: snap32(long * ratio), h: long }
    }
  }
  const d = res.default
  if (Array.isArray(d) && d.length >= 2) return { w: snap32(d[0]), h: snap32(d[1]) }
  if (d && typeof d === 'object' && Array.isArray(d[mode]) && d[mode].length >= 2) return { w: snap32(d[mode][0]), h: snap32(d[mode][1]) }
  return { w: 1344, h: 768 }
}

/** 交付分辨率 = 图分辨率 × resolutionLock.scale（缺省 1）。无锁时等于图分辨率。 */
function manifestDeliverySize(manifest, graphSize) {
  const scale = Number(manifest?.resolutionLock?.scale)
  if (!Number.isFinite(scale) || scale <= 0 || scale === 1) return { w: graphSize.w, h: graphSize.h }
  return { w: snap32(graphSize.w * scale), h: snap32(graphSize.h * scale) }
}

/**
 * 分辨率解析警告：让调用方知道「请求的尺寸」与「实际交付」的关系（不静默）。
 * 两种形态要分开措辞——被改写的东西不同：
 *   ① 图锁定   ：首遍尺寸被实现改写（显式宽高/画布比例都不生效）。
 *   ② 只锁倍率 ：首遍尺寸**照请求生效**，只是交付 = 首遍 × scale（二阶段，不是改写）。
 */
function resolutionLockWarning(manifest, graphSize) {
  const lock = manifest?.resolutionLock
  if (!lock) return null
  const del = manifestDeliverySize(manifest, graphSize)
  const why = lock.note ? `（${lock.note}）` : ''
  const scaleNote = Number(lock.scale) > 1 ? `（×${lock.scale} 潜空间放大）` : ''
  if (Array.isArray(lock.graph)) {
    return `实现 ${manifest.id} 锁定图分辨率 ${graphSize.w}x${graphSize.h}${why}：` +
      `显式 width/height 与画布比例均不生效，实际交付 ${del.w}x${del.h}` + scaleNote
  }
  if (!(Number(lock.scale) > 1)) return null
  return `实现 ${manifest.id} 为两阶段放大${why}：首遍 ${graphSize.w}x${graphSize.h}（按请求尺寸生效）` +
    ` → 实际交付 ${del.w}x${del.h}` + scaleNote
}

/**
 * 链式续接的兼容性判据 = **首遍尺寸一致**（不是交付尺寸一致）。
 *
 * 为什么：链上流动的是**首遍 latent**——ctx 图的 `MiniMaxH3MotionContextSaveLatent`（node 22）
 * 存的是 node 10（采样器输出），而两阶段/学习式放大发生在它**之后**。
 * 所以带 resolutionLock 的实现（hires / 学习式 2K 族）同样可以续接，
 * 只要能保证「一条链内首遍尺寸一致」；交付尺寸可以不同。
 *
 * 节点上记的两个尺寸：`width/height` = 交付尺寸，`graphWidth/graphHeight` = 首遍尺寸
 * （后者只有两阶段实现才记；普通实现两者相同）。
 *
 * @returns 不兼容时返回可直接抛出的错误信息；兼容返回 null。
 */
export function chainGraphMismatch(prevParams, graphSize) {
  const w = Number(prevParams?.graphWidth ?? prevParams?.width)
  const h = Number(prevParams?.graphHeight ?? prevParams?.height)
  if (!w || !h) return null                    // 旧节点没记尺寸：不判死，交给后续步骤
  if (w === graphSize.w && h === graphSize.h) return null
  return `链式续接要求**首遍尺寸**一致：上一镜首遍 ${w}×${h}，本镜 ${graphSize.w}×${graphSize.h}。` +
    '链上传递的是首遍 latent（放大发生在其之后），latent 无法缩放——' +
    '请让两镜用首遍尺寸相同的实现（交付尺寸可以不同），或从这里另起一链（不传 continuity_from）'
}

// ---------------------------------------------------------------------------
// 档位解析层（契约见 docs/tier-strategy-design.md）
//   产品层：capability + tier(fast|balanced|quality) → 一个实现清单
//   注册层：同 group 聚合、无加速/有加速策略投影、可用性预检
//   铁律：不静默跨档替换；选定的实现不可用就显式报错（可由用户改选，不自动换）
// ---------------------------------------------------------------------------

/** 同档候选排序：priority 降序 → 无加速优先 → id 升序（确定性；内置默认＝无加速）。 */
function sortTierCandidates(list) {
  return list.slice().sort((a, b) =>
    (Number(b.priority) || 0) - (Number(a.priority) || 0)
    || (a.accel ? 1 : 0) - (b.accel ? 1 : 0)
    || String(a.id).localeCompare(String(b.id)))
}

/** 组名：显式 group 优先，缺省以自身 id 成组（不从文件名猜）。 */
const groupNameOf = (m) => (typeof m.group === 'string' && m.group ? m.group : m.id)

/** 某能力某档的实现（排除 internal 诊断清单），已按确定性顺序排好。 */
function tierImplementations(capability, tier, registry = getRegistry()) {
  return sortTierCandidates((registry.byCapability[capability] || []).filter((m) => m.tier === tier && !m.internal))
}

/** 该能力是否已分档（至少有一档实现）。未分档 → 走旧清单兼容路径。 */
function isTieredCapability(capability, registry = getRegistry()) {
  return TIERS.some((t) => tierImplementations(capability, t, registry).length > 0)
}

/** 配置里的档位选择：capability → tier → 实现 id。 */
function getTierSelection(capability, cfg = null) {
  const c = cfg || loadConfigFile()
  const t = c.tiers && c.tiers[capability]
  return t && typeof t === 'object' && !Array.isArray(t) ? t : {}
}

/** 未分档能力的旧清单候选顺序：preferred 命中者优先，其余按注册表顺序。 */
function orderLegacyCandidates(registry, capability) {
  const list = (registry.byCapability[capability] || []).filter((m) => !m.internal)
  const pref = getPreferred(capability)
  const rank = (m) => { const i = pref.indexOf(m.id); return i < 0 ? pref.length + 1 : i }
  return list.slice().sort((a, b) => rank(a) - rank(b))
}

// --- 可用性预检（读 ComfyUI /object_info，带 TTL 缓存；离线＝未知，不判死）---------

const NODE_PROBE_TTL_MS = 5 * 60 * 1000
const _nodeProbe = new Map() // class_type → { ok: true|false|null, at }

/**
 * 探测 ComfyUI 是否注册某节点类。
 * true=已注册 / false=未注册 / null=未知（ComfyUI 不可达或探测失败）。
 * 离线时不判死：否则一断网整个设置页会被判为不可用。
 */
async function probeNodeClass(classType, { ttlMs = NODE_PROBE_TTL_MS, force = false } = {}) {
  const hit = _nodeProbe.get(classType)
  const now = Date.now()
  if (!force && hit && now - hit.at < ttlMs) return hit.ok
  let ok = null
  try {
    const res = await comfyFetch('/object_info/' + encodeURIComponent(classType))
    if (res.ok) {
      const json = await res.json()
      // ComfyUI 对未知节点返回 {}（空对象），已注册则返回该类名的条目
      ok = Boolean(json && typeof json === 'object' && Object.keys(json).length > 0)
    }
  } catch { ok = null }
  _nodeProbe.set(classType, { ok, at: now })
  return ok
}

/** 该实现的可用性：{ ok, unknown, missing }；无 requiresNodes 视为可用（不探测）。 */
async function checkAvailability(m, opts = {}) {
  const req = Array.isArray(m.requiresNodes) ? m.requiresNodes : []
  if (!req.length) return { ok: true, unknown: false, missing: [] }
  const probe = typeof opts.probe === 'function' ? opts.probe : probeNodeClass
  const missing = []
  let unknown = false
  for (const cls of req) {
    const r = await probe(cls, opts)
    if (r === false) missing.push(cls)
    else if (r === null) unknown = true
  }
  return { ok: missing.length === 0, unknown, missing }
}

/** 不可用 → 显式报错（含补救指引；**绝不静默替换**用户选定的实现）。 */
async function assertImplementationUsable(m, tier, opts = {}) {
  const a = await checkAvailability(m, opts)
  if (a.ok) return a
  const registry = opts.registry || getRegistry()
  const std = sortTierCandidates(tierImplementations(m.capability, m.tier || tier, registry).filter((x) => !x.accel && x.id !== m.id))
  throw new Error(
    `档位 ${m.tier || tier} 的实现 "${m.id}" 不可用：ComfyUI 未注册节点 ${a.missing.join('、')}。` +
    (std.length ? `可在设置页改选标准实现「${std[0].id}」，或安装对应节点后重试。` : '请安装对应节点后重试。') +
    '（本插件不会静默替换你选定的实现）')
}

// --- 解析 -------------------------------------------------------------------

/** 从调用参数取档位：显式 tier，或 mode 恰为档位名（mode 是档位的兼容别名）。 */
function tierFromArgs(opts) {
  const t = typeof opts.tier === 'string' ? opts.tier.trim() : ''
  if (TIERS.includes(t)) return t
  // 弃用别名：mode 曾是「图片 mode 轴 / 视频 mode」的入参，现在等同于 tier（兼容一版后删除）
  const m = typeof opts.mode === 'string' ? opts.mode.trim() : ''
  return TIERS.includes(m) ? m : null
}

/**
 * **内部通道**的「显式实现」：只有脚本 / 内部调用能传（`_internals.runRender(..., implementation: 'id')`）。
 *
 * 工具面**已删除** `workflow=`（实现由配置决定：设置页档位选择 / `cfg.preferred` / `cfg.pins`）。
 * 这里刻意：
 *   - 显式拒绝 `workflow=`——旧调用点必须报错，而不是静默生效（否则「实现由配置决定」立刻破功）；
 *   - 用新名字 `implementation`，与旧参数区分开。
 */
function explicitImplementationOf(opts) {
  if (opts.workflow !== undefined && opts.workflow !== null && opts.workflow !== '') {
    throw new Error(
      '不再接受 workflow=（实现由配置决定：设置页的档位选择 / cfg.preferred 家族 / cfg.pins 钉实现）。' +
      '调用方请只表达能力 + tier；脚本要钉实现请走 _internals 的 implementation= 通道')
  }
  const v = opts.implementation
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** 非档位含义的 mode 名（旧清单自定义档，如 high/low），仅旧路径使用。 */
function legacyModeFromArgs(opts) {
  const m = typeof opts.mode === 'string' ? opts.mode.trim() : ''
  return m && !TIERS.includes(m) ? m : null
}

/**
 * capability + tier → 清单。
 * 返回 { manifest, tier, resolution, warnings }，resolution ∈ explicit | tier-config | tier-default | legacy-mode | legacy。
 * 规则（docs/tier-strategy-design.md §5）：
 *   1. 显式 workflow 优先；其 tier 与请求档位不符 → 报错（不静默）
 *   2. 配置 tiers[capability][tier] 选定的实现
 *   3. 否则该档候选首个
 *   4. 该档无实现 → 报错并列出可用档位
 *   5. 该能力完全未分档（旧清单）→ 用旧清单的 mode 名匹配请求档位；匹配不到 → 报错（不猜）
 */
async function resolveTieredManifest(capability, tier, explicitWorkflow, opts = {}) {
  const registry = opts.registry || getRegistry()
  const warnings = []

  if (explicitWorkflow) {
    const m = registry.byId[explicitWorkflow]
    if (!m) throw new Error(`workflow "${explicitWorkflow}" 不存在`)
    if (m.capability !== capability) throw new Error(`workflow "${explicitWorkflow}" 能力是 ${m.capability}，非 ${capability}`)
    if (tier && m.tier && m.tier !== tier) {
      throw new Error(
        `workflow "${m.id}" 是 ${m.tier} 档，与请求的 ${tier} 档不匹配（不静默跨档替换）：` +
        `请改请求档位，或改用提供 ${tier} 档的实现`)
    }
    if (opts.chainOnly && !m.chain) {
      const sizeHint = m.resolutionLock
        ? (Array.isArray(m.resolutionLock.graph)
          ? `。该实现锁定了图分辨率（${m.resolutionLock.graph.join('×')}）`
          : `。该实现是两阶段放大（交付 = 首遍 ×${m.resolutionLock.scale}）`)
        : ''
      throw new Error(
        `workflow "${m.id}" 不是链式续接实现：continuity_from 需要声明了 chain 的实现` +
        `（契约见 docs/shot-chain-continuity.md）` +
        sizeHint +
        (sizeHint ? `：要与它续接，上一镜必须也是**首遍尺寸相同**的实现（放大在链式存档之后，交付尺寸不参与续接）` : ''))
    }
    await assertImplementationUsable(m, tier, { ...opts, registry })
    return { manifest: m, tier: m.tier || tier || null, resolution: 'explicit', warnings }
  }

  // 未分档能力：只可能是**尚未迁移的旧清单**（如 image.from_video，或用户自建、还没声明 tier 的清单）。
  // 【重构：删除】旧的「按 mode 名匹配请求档位」路径——`mode=quality` 会凭名字隐式挑一个实现，
  // 正是「同一请求被悄悄换实现」的根源（实测踩过：漏传 workflow 时落到了别的模型）。
  // 现在只按 preferred / 候选序取一个，并**明确告知未分档、忽略请求档位**。
  if (!isTieredCapability(capability, registry)) {
    const pick = resolveManifest(registry, capability, null)
    if (tier) {
      warnings.push(
        `能力 ${capability} 尚未分档（清单 "${pick.id}" 未声明 tier）：按该实现执行，**忽略请求的 ${tier} 档**。` +
        '要让该能力支持档位，请给它提供带 tier 声明的档位清单（见 docs/unified-tier-tool-design.md）')
    }
    if (pick.modes && Object.keys(pick.modes).length) {
      warnings.push(`清单 "${pick.id}" 仍声明已废弃的 modes 字段（${Object.keys(pick.modes).join(' / ')}）：请迁移为「一档一清单 + tier 声明」`)
    }
    return { manifest: pick, tier: null, resolution: 'legacy', warnings }
  }

  let want = tier || DEFAULT_TIER
  if (!tier) warnings.push(`未指定档位，按默认 ${DEFAULT_TIER} 档解析`)

  const cfgForStrategy = opts.cfg || loadConfigFile()

  // ① 配置面**钉实现**（cfg.pins[capability]）：钉死了就不再走策略/档位默认/家族序，
  //    但**档位冲突仍然报错**（钉的是 fast 档却请求 quality ⇒ 不静默换档）。
  //    这是「去掉工具面 workflow= 之后」留给排障与基准脚本的通道（设置页可写）。
  const pinned = resolvePinnedImplementation(capability, want, cfgForStrategy, registry)
  if (pinned) {
    warnings.push(`能力 ${capability} 被配置 pin 到 "${pinned.id}"（家族 ${groupNameOf(pinned)}）：跳过档位默认与家族序`)
    await assertImplementationUsable(pinned, want, { ...opts, registry })
    return { manifest: pinned, tier: want, resolution: 'pin', warnings }
  }

  // 选中了用户自建策略时：该策略**没有**的档位就是"不存在"，显式报错而不是回退到别的实现。
  // （逐档手写快照不受此限：手写条目本身就是显式选择，照常生效。）
  const selMap = (opts.selection !== undefined ? (opts.selection || {}) : getTierSelection(capability, cfgForStrategy)) || {}
  const strat = opts.strategy !== undefined ? opts.strategy : selectedUserStrategyOf(cfgForStrategy, capability)
  // 未指定档位也严格解析为 fast；策略没有 fast 时显式报错，不能偷偷换到别的档。
  if (strat && !strat.tiers[want] && !selMap[want]) {
    const mine = Object.keys(strat.tiers)
    throw new Error(
      `当前策略「${strat.label}」只提供 ${mine.join(' / ') || '（无档位）'} 档，没有 ${want} 档（策略定义了它提供哪些档位，不是回退到默认实现）：` +
      `请改请求档位（${mine.join(' / ')}），或在设置页把该策略加上 ${want} 档 / 改选内置默认策略 / 单档显式指定 workflow=`)
  }

  // 配置选定（opts.selection 可注入：让测试/预览不依赖本机配置里已保存的选择）
  const selected = selMap[want]
  if (selected) {
    const m = registry.byId[selected]
    if (!m) throw new Error(`档位 ${want} 选定的实现 "${selected}" 不存在（可能已被删除）：请在设置页重选`)
    if (m.capability !== capability) throw new Error(`档位 ${want} 选定的实现 "${selected}" 能力是 ${m.capability}，非 ${capability}：请在设置页重选`)
    if (m.internal) throw new Error(`档位 ${want} 选定的实现 "${selected}" 是内部诊断清单，不能作为档位实现：请在设置页重选`)
    if (m.tier && m.tier !== want) throw new Error(`档位 ${want} 选定的实现 "${selected}" 实际是 ${m.tier} 档：请在设置页修正`)
    if (opts.chainOnly && !m.chain) {
      throw new Error(
        `档位 ${want} 配置选定的实现 "${selected}" 不是链式续接实现：续接镜请显式指定 workflow=` +
        `（该档声明了 chain 的实现），或在设置页把该档改成链式实现`)
    }
    await assertImplementationUsable(m, want, { ...opts, registry })
    return { manifest: m, tier: want, resolution: 'tier-config', warnings }
  }

  // ④ 配置 preferred[capability] = **家族优先序**（家族 = group，或清单自身 id）：
  //    取第一个在「请求档位」上**有实现**的家族。图片能力从「未分档 + mode 轴」迁移到
  //    「一档一清单」后，用户原先写的 preferred: ["qwen-image-21-t2i"] **无需改动**即继续生效
  //    （三份档位清单的 group 都是 qwen-image-21-t2i）。
  const prefFamilies = getPreferred(capability, cfgForStrategy)
  if (prefFamilies.length) {
    const poolAll = tierImplementations(capability, want, registry)
    const pool = opts.chainOnly ? poolAll.filter((m) => m.chain) : poolAll
    for (const fam of prefFamilies) {
      const hit = pool.find((m) => groupNameOf(m) === fam || m.id === fam)
      if (!hit) continue
      await assertImplementationUsable(hit, want, { ...opts, registry })
      return { manifest: hit, tier: want, resolution: 'preferred-family', warnings }
    }
  }

  // ⑤ 该档候选首个。chainOnly（请求了上一镜续接）时只在**声明了 chain 的实现**里挑：
  // 不能悄悄退回普通实现——那会静默丢掉连续性，是把「续接」做成了「另起一镜」。
  const candsAll = tierImplementations(capability, want, registry)
  const cands = opts.chainOnly ? candsAll.filter((m) => m.chain) : candsAll
  if (!cands.length) {
    if (opts.chainOnly && candsAll.length) {
      throw new Error(
        `能力 ${capability} 的 ${want} 档没有链式续接实现（该档现有实现均未声明 chain）：` +
        `请改档位、安装链式续接实现，或改用它档的链式实现（显式 workflow=）`)
    }
    const avail = TIERS.filter((t) => tierImplementations(capability, t, registry).length)
    throw new Error(
      `能力 ${capability} 没有 ${want} 档实现（可用档位：${avail.join(' / ') || '无'}）：` +
      '请改档位，或上传/声明该档实现')
  }
  const pick = cands[0]
  await assertImplementationUsable(pick, want, { ...opts, registry })
  return { manifest: pick, tier: want, resolution: 'tier-default', warnings }
}

// --- 策略投影与矩阵（配置页 / UI / 技能读同一份数据） ------------------------

const DEFAULT_STRATEGY_ID = '__default'

/**
 * 每能力的策略清单（配置页单选列表的唯一数据源）：
 *  ① 一条**内置默认**：跟随注册表首选（各档的非加速首选实现），label = 该能力主家族名；
 *  ② 用户自建策略：用户在配置页用现有 workflow 逐档组合、**自己命名**（见 cfg.strategies）。
 *
 * 为什么不再按组投影出「（无加速）/（有加速）」：workflow 是原材料，**策略该由用户命名与组合**
 * （Sol / PDD 只是可选清单，不应自动变成"官方策略"）。注册表只把"默认"这一条说清楚。
 */
function projectCapabilityStrategies(registry, capability, cfg = {}, effective = null) {
  // 内置默认策略的**快照与标题都取「实际生效」**（effective 由 effectiveTiersOf 算出，含 preferred 家族序 / pins）：
  // 否则会出现「标题写 FLUX 2 文生图、实际跑 qwen-image-21-t2i」这种自相矛盾的显示。
  const tiers = {}
  for (const tier of TIERS) {
    const list = tierImplementations(capability, tier, registry)
    if (!list.length) continue
    const eff = effective && effective[tier] ? list.find((m) => m.id === effective[tier]) : null
    const pick = eff || list.find((m) => !m.accel) || list[0]
    if (pick?.id) tiers[tier] = pick.id
  }
  if (!Object.keys(tiers).length) return []
  const effFamily = (() => {
    const firstTier = TIERS.find((t) => tiers[t])
    const m = firstTier ? registry.byId[tiers[firstTier]] : null
    return m ? familyDisplayName(registry, m.capability, groupNameOf(m)) : null
  })()
  const label = effFamily || groupDisplayNameOf(registry, capability) || capability
  const sel = currentTierSelection(cfg, capability)
  // "选中态"按**实际生效**口径判定：显式选择优先，未显式选择的档位取内置默认（= effective）。
  const effOf = (tier) => sel[tier] || tiers[tier] || null
  const matches = (s) =>
    Object.keys(s.tiers || {}).length > 0 &&
    Object.entries(s.tiers).every(([t, id]) => effOf(t) === id) &&
    Object.entries(sel).every(([t, id]) => !s.tiers[t] || s.tiers[t] === id)
  const builtin = { id: DEFAULT_STRATEGY_ID, label, tiers, builtin: true, available: true, selected: matches({ tiers }) }
  const user = userStrategiesOf(cfg, capability).map((s) => ({ ...s, available: userStrategyAvailable(registry, capability, s), selected: matches(s) }))
  const all = [builtin, ...user]
  // 消歧：若某条用户策略的组合**恰好等于默认**，按匹配规则会两条同时点亮（UI 上出现两个选中单选）。
  // 此时以用户实际点过的 strategyOf 为准，只点亮那一条；没记过就仍按匹配规则。
  const picked = (cfg.strategyOf || {})[capability]
  if (picked && all.some((s) => s.id === picked)) {
    for (const s of all) s.selected = s.id === picked
  } else if (all.filter((s) => s.selected).length > 1) {
    for (const s of all) s.selected = s.builtin
  }
  return all
}

/** 该能力的主家族名（第一个有档位的实现所属组的显示名）；用于内置默认策略的显示名。 */
/** 某**家族**（group）的展示名（去掉档位括号后缀）；找不到就退回家族 id。 */
function familyDisplayName(registry, capability, family) {
  const ms = (registry.byCapability || {})[capability] || []
  const m = ms.find((x) => groupNameOf(x) === family && !x.internal)
  if (!m) return family
  return String(m.displayName || family).replace(/（[^）]*）\s*$/, '').trim() || family
}

function groupDisplayNameOf(registry, capability) {
  const ms = (registry.byCapability || {})[capability] || []
  const first = ms.find((m) => m.tier && !m.internal)
  return first ? (first.displayName || groupNameOf(first)) : ''
}

/**
 * 用户策略的规范形：`{ id, name, tiers:{tier→实现id} }`。
 * 只保留合法选择（未知 id / 跨能力跨档 id 一律丢弃），避免配置里留下死引用。
 */
function userStrategiesOf(cfg, capability) {
  const raw = ((cfg.strategies || {})[capability]) || []
  if (!Array.isArray(raw)) return []
  const out = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue
    const name = typeof s.name === 'string' ? s.name.trim().slice(0, 40) : ''
    if (!name) continue
    const tiers = {}
    for (const [tier, id] of Object.entries(s.tiers || {})) if (typeof id === 'string' && id) tiers[tier] = id
    out.push({ id: typeof s.id === 'string' && s.id ? s.id : 'strategy-' + (out.length + 1), label: name, tiers, builtin: false })
  }
  return out.slice(0, 24)
}

/**
 * 当前选中的**用户自建策略**（没有则 null）。
 * 用途：策略定义"它提供哪些档位"——不在其中的档位对该策略而言**就不存在**（不是回退到默认）。
 */
function selectedUserStrategyOf(cfg, capability) {
  const id = (cfg.strategyOf || {})[capability]
  if (!id || id === DEFAULT_STRATEGY_ID) return null
  return userStrategiesOf(cfg, capability).find((s) => s.id === id) || null
}

/** 该能力当前生效的档位选择（配置快照；未出现的档位 = 跟随注册表首选）。 */
function currentTierSelection(cfg, capability) {
  const t = ((cfg.tiers || {})[capability]) || {}
  return typeof t === 'object' && t ? t : {}
}

/**
 * 每档**实际生效**的实现 id（与 runner 同一套顺序：pins → cfg.tiers/策略快照 → preferred 家族序 → 候选首个）。
 *
 * 为什么必须在后端算这一份：preferred 现在是**家族序**，UI 若只按「selection || 注册表首个」显示，
 * 就会把「配置指向 qwen 家族」显示成 flux —— 设置页会对用户撒谎（内置默认的标题、档位摘要、
 * 以及「编辑档位」表单的预填都会错）。唯一口径 = 这个函数。
 */
function effectiveTiersOf(cap, cfg, registry) {
  const eff = {}
  const sel = getTierSelection(cap, cfg)
  const pin = typeof cfg?.pins?.[cap] === 'string' ? cfg.pins[cap].trim() : ''
  const pref = getPreferred(cap, cfg)
  for (const tier of TIERS) {
    const cands = tierImplementations(cap, tier, registry)
    if (!cands.length) continue
    if (pin) {
      const hit = cands.find((m) => m.id === pin) || cands.find((m) => groupNameOf(m) === pin)
      if (hit) { eff[tier] = hit.id; continue }
    }
    const chosen = sel[tier] ? cands.find((m) => m.id === sel[tier]) : null
    if (chosen) { eff[tier] = chosen.id; continue }
    let famHit = null
    for (const fam of pref) {
      const h = cands.find((m) => groupNameOf(m) === fam || m.id === fam)
      if (h) { famHit = h; break }
    }
    eff[tier] = (famHit || cands[0]).id
  }
  return eff
}

/** 用户策略里选中的实现是否都可用（任一不可用 → 该策略如实置灰）。 */
function userStrategyAvailable(registry, capability, strategy) {
  for (const [tier, id] of Object.entries(strategy.tiers || {})) {
    const list = tierImplementations(capability, tier, registry)
    const hit = list.find((m) => m.id === id)
    if (!hit) return false
    if (hit.available === false) return false
  }
  return true
}

/**
 * 档位 × 实现 × 可用性矩阵（UI 与技能的唯一数据源）。
 * opts.probe=false 时不做节点预检（可用性返回 null=未知）。
 */
async function describeTierMatrix(registry = getRegistry(), opts = {}) {
  const probe = opts.probe !== false
  // 配置来源可注入（测试与工具都读同一份口径）；默认读真实配置文件。
  const cfg = opts.cfg || loadConfigFile()
  const out = {}
  for (const [cap, ms] of Object.entries(registry.byCapability)) {
    const classified = ms.filter((m) => m.tier && !m.internal)
    const unclassified = ms.filter((m) => !m.tier && !m.internal)
    if (!classified.length && !unclassified.length) continue
    const groups = {}
    for (const m of classified) (groups[groupNameOf(m)] ||= { id: groupNameOf(m), displayName: m.displayName || groupNameOf(m), tiers: {} })
    for (const m of classified) (groups[groupNameOf(m)].tiers[m.tier] ||= []).push(m)
    const desc = async (m) => {
      const a = probe ? await checkAvailability(m, opts) : { ok: null, unknown: true, missing: [] }
      return {
        id: m.id,
        displayName: m.displayName || m.id,
        tier: m.tier,
        group: groupNameOf(m),
        accel: m.accel || '',
        available: a.ok,
        missingNodes: a.missing,
        requiresNodes: m.requiresNodes || [],
        estSeconds: Number.isFinite(m.estSeconds) ? m.estSeconds : null,
        note: m.note || '',
        source: m._source || 'builtin',
        modes: Object.keys(m.modes || {}),
        // 该档的生效参数（UI 显示尺寸/步数与后端同源，不硬编码）
        longSide: (m.modes && m.modes[m.tier] && m.modes[m.tier].longSide) || null,
        steps: (m.modes && m.modes[m.tier] && m.modes[m.tier].steps) || null,
      }
    }
    const groupList = []
    for (const g of Object.values(groups)) {
      const tiers = {}
      for (const [tier, list] of Object.entries(g.tiers)) {
        tiers[tier] = await Promise.all(sortTierCandidates(list).map(desc))
      }
      const built = { id: g.id, displayName: g.displayName, tiers }
      groupList.push(built)
    }
    out[cap] = {
      capability: cap,
      tiered: classified.length > 0,
      tiers: TIERS.filter((t) => classified.some((m) => m.tier === t)),
      groups: groupList,
      // 策略：一条内置默认 + 用户自建（命名）策略。组只负责"清单怎么分组显示"，不再自动生成策略。
      strategies: projectCapabilityStrategies(registry, cap, cfg, effectiveTiersOf(cap, cfg, registry)),
      // 当前选中策略实际提供的档位：工具条/UI 据此收敛（策略没这个档位＝不提供，而不是回退）
      availableTiers: (() => {
        const st = selectedUserStrategyOf(cfg, cap)
        return st ? TIERS.filter((t) => st.tiers[t]) : null
      })(),
      selection: getTierSelection(cap, cfg),
      // **实际生效**的实现（与 runner 同一套顺序：pins → cfg.tiers/策略快照 → preferred 家族序 → 候选首个）。
      // 为什么必须在后端算：preferred 现在是**家族序**，UI 若只按「selection || 注册表首个」显示，
      // 就会把「配置指向 qwen 家族」显示成 flux——设置页会对用户撒谎（且内置默认的编辑表单预填也会错）。
      effective: effectiveTiersOf(cap, cfg, registry),
      unclassified: unclassified.map((m) => {
        const firstMode = Object.values(m.modes || {})[0] || {}
        // 未分档清单的分辨率声明原样透出（mode.longSide / resolution.longSide / resolution.default），
        // UI 不再硬编码 1344 之类的尺寸
        const longSide = firstMode.longSide || (m.resolution && m.resolution.longSide) || null
        const def = (m.resolution && m.resolution.default) || null
        return {
          id: m.id, displayName: m.displayName || m.id, modes: Object.keys(m.modes || {}), source: m._source || 'builtin',
          longSide,
          resolution: { policy: (m.resolution && m.resolution.policy) || null, longSide, default: def },
        }
      }),
    }
  }
  return out
}

/** /api/workflows 的响应体（设置页与工具条的唯一数据源；抽成函数便于测试与复用）。 */
async function describeWorkflowsApi(registry = getRegistry(), opts = {}) {
  const matrix = await describeTierMatrix(registry, opts)
  const capabilities = Object.entries(registry.byCapability).map(([cap, ms]) => ({
    capability: cap,
    preferred: getPreferred(cap),
    tiered: Boolean((matrix[cap] || {}).tiered),
    tiers: (matrix[cap] || {}).tiers || [],
    effective: (matrix[cap] || {}).effective || {},
    selection: (matrix[cap] || {}).selection || {},
    groups: (matrix[cap] || {}).groups || [],
    // 策略：一条内置默认 + 用户自建（配置页单选列表的数据源）
    strategies: (matrix[cap] || {}).strategies || [],
    // null/undefined = 未选用户策略（档位＝各实现并集）；数组 = 当前策略只提供这些档位
    availableTiers: (matrix[cap] || {}).availableTiers || null,
    unclassified: (matrix[cap] || {}).unclassified || [],
    workflows: ms.map((m) => ({
      id: m.id,
      displayName: m.displayName || m.id,
      modes: Object.keys(m.modes || {}),
      tier: m.tier || '',
      group: groupNameOf(m),
      accel: m.accel || '',
      internal: Boolean(m.internal),
      requiresNodes: m.requiresNodes || [],
      estSeconds: Number.isFinite(m.estSeconds) ? m.estSeconds : null,
      note: m.note || '',
      output: m.output || {},
      constraints: m.constraints || {},
      assets: m.assets || {},
      // 实际生效的资产值（清单默认 ← 旧配置 models.* 映射 ← 旧 id 覆盖继承 ← 显式覆盖），
      // 供设置页显示：避免"界面显示 fp16、实际跑 int8"这类失真。
      effectiveAssets: effectiveAssetsOf(m),
      source: m._source || 'builtin',
    })),
  }))
  return { ok: true, capabilities, tiers: TIERS, errors: registry.errors }
}

/** 某清单的资产键 → 实际生效值（覆盖 > 别名/旧配置 > 清单默认）。 */
function effectiveAssetsOf(m) {
  const ov = getAssetOverrides(m.id)
  const out = {}
  for (const [k, a] of Object.entries(m.assets || {})) {
    out[k] = (ov && ov[k] !== undefined) ? ov[k] : ((a && a.default) || '')
  }
  return out
}

/** 纯逻辑：manifest + opts + aspectRatio → { mode, job, graph }（opts.refs/first_frame/last_frame 为已上传 comfy 文件名）。 */
function buildRenderGraph(manifest, opts, aspectRatio) {
  const mode = resolveMode(manifest, opts.mode)
  const explicitW = opts.width !== undefined && opts.width !== null && opts.width !== '' ? intArg(opts, 'width', 1344) : undefined
  const explicitH = opts.height !== undefined && opts.height !== null && opts.height !== '' ? intArg(opts, 'height', 768) : undefined
  const { w, h } = computeManifestSize(manifest, mode, explicitW, explicitH, aspectRatio)
  const length = intArg(opts, 'length', 124)
  const seed = intArg(opts, 'seed', Math.floor(Math.random() * 2 ** 31))
  const modeCfg = mode && manifest.modes ? (manifest.modes[mode] || {}) : {}
  const steps = opts.steps !== undefined && opts.steps !== null && opts.steps !== ''
    ? intArg(opts, 'steps', 20)
    : (modeCfg.steps ?? 20)
  const guidance = floatArg(opts, 'guidance', 3.5)
  const fps = (manifest.params?.fps?.default) || 24
  const job = {
    prompt: opts.prompt,
    width: w,
    height: h,
    length,
    seed,
    steps,
    guidance,
    fps,
    mode,
    prefix: opts.prefix || '',
    assetOverrides: getAssetOverrides(manifest.id),
  }
  if (opts.refs !== undefined) job.refs = opts.refs
  if (opts.first_frame !== undefined && opts.first_frame !== null) job.first_frame = opts.first_frame
  if (opts.last_frame !== undefined && opts.last_frame !== null) job.last_frame = opts.last_frame
  // 自动注入 manifest params 中 opts 提供的其余字段（source_video / frame_index / 未来新 param），
  // 避免新 param 漏注入（曾致 extract-frame 的 LoadVideo.file 为 null → ComfyUI 校验失败）。
  for (const pname of Object.keys(manifest.params || {})) {
    if (opts[pname] !== undefined && opts[pname] !== null && job[pname] === undefined) job[pname] = opts[pname]
  }
  const graph = buildGraphFromManifest(manifest, job)
  return { mode, job, graph }
}

/** 把画布图片节点上传到 ComfyUI，返回文件名（不存在返回 null）。 */
async function uploadCanvasNodeImage(root, project, nid) {
  const n = project.nodes.find((x) => x.id === nid)
  if (!n?.media) return null
  const absPath = resolveStoredPath(root, n.media)
  if (!existsSync(absPath)) return null
  const buf = await readFile(absPath)
  const up = await comfyUploadImage(buf, basename(n.media))
  return up.name
}

/** 解析参考图 → ComfyUI 文件名：资产 id（character:/scene:/style:）或画布节点 id 均可。 */
async function resolveRefImage(root, project, lib, ref) {
  if (!ref) return null
  if (isAssetRef(ref)) {
    const abs = resolveAssetImagePath(root, lib, ref)
    if (!abs) return null
    const buf = await readFile(abs)
    const up = await comfyUploadImage(buf, basename(abs))
    return up.name
  }
  return uploadCanvasNodeImage(root, project, ref)
}

/** 画布 video 节点 → 上传到 ComfyUI input（LoadVideo 只认 input 目录）→ 返回文件名。 */
async function resolveSourceVideo(root, project, ref) {
  const n = project.nodes.find((x) => x.id === ref)
  if (!n) throw new Error('extract-invalid: 画布无此节点 ' + ref)
  if (n.kind !== 'video') throw new Error(`extract-invalid: 节点 ${ref} 不是视频节点（kind=${n.kind}）`)
  if (!n.media) throw new Error('extract-invalid: 节点无媒体文件 ' + ref)
  const abs = resolveStoredPath(root, n.media)
  if (!existsSync(abs)) throw new Error('extract-invalid: 媒体文件不存在 ' + n.media)
  const up = await comfyUploadImage(await readFile(abs), basename(abs))
  return up.subfolder ? up.subfolder + '/' + up.name : up.name
}

/** 通用渲染：capability → manifest → 编译图 → ComfyUI → 下载 → 写画布节点。 */
async function runRender(ctx, opts) {
  const { workspaceId, exec } = opts
  const { root, sessionId } = resolveSessionRoot(ctx, opts.sessionId, workspaceId, exec)
  const project = await loadProject(root, sessionId)
  const projectId = project.projectId
  const aspectRatio = project.settings?.aspectRatio

  if (opts.projectId && opts.projectId !== projectId) throw new Error('generation project binding changed; refusing to render into another project')
  if (String(opts.capability).startsWith('video.')) {
    const domain = await activeProjectService.getProject(projectId)
    // An unrecorded manual shot is standalone only in an empty source-free project.
    if (Object.keys(domain.sourceDocuments).length || (opts.nodeId && domain.shots[opts.nodeId]?.episodeId !== 'legacy-main')) {
      assertProductionStages(domain, opts.nodeId)
      const shot = domain.shots[opts.nodeId]
      for (const assetId of [shot.storyboardAssetId, ...shot.referenceBindings.map((binding) => binding.assetId)].filter(Boolean)) {
        if (!existsSync(resolveStoredPath(root, domain.assets[assetId].logicalKey))) throw new Error(`production stages blocked: preparation file missing: ${assetId}`)
      }
    }
  }

  const registry = getRegistry()
  // 档位解析：capability + tier → 实现清单（不静默跨档替换；不可用显式报错）
  const wantTier = tierFromArgs(opts)
  const legacyMode = legacyModeFromArgs(opts)
  const wantContinuity = typeof opts.continuity_from === 'string' && opts.continuity_from.trim() !== ''
  const resolved = await resolveTieredManifest(opts.capability, wantTier, explicitImplementationOf(opts), { registry, chainOnly: wantContinuity })
  const manifest = resolved.manifest
  // 形状 × 参数校验：尽早做，所有入口（工具面 / HTTP 路由 / 脚本）受同一张真值表约束；
  // 放在上传之前，非法请求不产生任何副作用（不上传参考图、不建节点）。
  const shapeCheck = validateVideoArgs(manifest.capability, { ...opts, capability: manifest.capability })
  if (shapeCheck.warnings.length) resolved.warnings = [...(resolved.warnings || []), ...shapeCheck.warnings]
  // 参数支持面检查：调用方传了、但所选实现**没有注入点**的参数 → 明确告警（禁止静默丢弃）。
  // 典型：给 Qwen 清单传 guidance（cfg 固定 1）、给 i2i 传 width/height（尺寸跟随参考图）。
  for (const k of ['width', 'height', 'length', 'steps', 'seed', 'guidance']) {
    const v = opts[k]
    if (v === undefined || v === null || v === '') continue
    if (manifest.params && manifest.params[k] !== undefined) continue
    resolved.warnings = [...(resolved.warnings || []), `参数 ${k} 未生效：实现 ${manifest.id} 没有它的注入点（该参数由实现自身固定或由输入决定）`]
  }
  const mode = resolveMode(manifest, legacyMode || resolved.tier || (typeof opts.mode === 'string' ? opts.mode : null), {
    strict: Boolean(legacyMode || wantTier || resolved.tier),
  })
  const nodeId = opts.nodeId || randomUUID()
  const effSize = computeManifestSize(manifest, mode,
    opts.width !== undefined && opts.width !== null && opts.width !== '' ? intArg(opts, 'width', 1344) : undefined,
    opts.height !== undefined && opts.height !== null && opts.height !== '' ? intArg(opts, 'height', 768) : undefined,
    aspectRatio)
  // effSize 是**图分辨率**（注入到图里的 width/height）。带 resolutionLock 的实现（两阶段潜空间放大）
  // 在二遍把 latent 放大 scale 倍，所以**实际交付**尺寸是 manifestDeliverySize()——画布节点要记交付尺寸，
  // 否则「同分辨率才能拼接」的判断会拿底片尺寸去比成片。
  const lockSize = manifestDeliverySize(manifest, effSize)
  const lockWarn = resolutionLockWarning(manifest, effSize)
  if (lockWarn) resolved.warnings = [...(resolved.warnings || []), lockWarn]
  const modeCfg = mode && manifest.modes ? (manifest.modes[mode] || {}) : {}
  const steps = opts.steps !== undefined && opts.steps !== null && opts.steps !== ''
    ? intArg(opts, 'steps', 20)
    : (modeCfg.steps ?? 20)
  const guidance = floatArg(opts, 'guidance', 3.5)

  // 上传参考图/首末帧（资产 id 或画布节点 id → ComfyUI 文件名）
  const lib = loadLibrary(root)
  const refs = []
  if (Array.isArray(opts.ref_nodes)) {
    for (const rid of opts.ref_nodes) {
      const name = await resolveRefImage(root, project, lib, rid)
      if (name) refs.push(name)
    }
  }
  const firstFrame = opts.first_frame_node ? await resolveRefImage(root, project, lib, opts.first_frame_node) : undefined
  const lastFrame = opts.last_frame_node ? await resolveRefImage(root, project, lib, opts.last_frame_node) : undefined
  const sourceVideo = opts.video_node ? await resolveSourceVideo(root, project, opts.video_node) : undefined

  // 链式续接（manifest.chain）。协议由清单声明，runner 只管两件事：
  //   ① 序号：上一镜的链序号从**画布上一镜节点**取（params.clipIndex），本镜 Load=它、Save=它+1；
  //      不传 continuity_from = **起链**（Load 0：没有上文，上下文节点原样放行、不裁帧）。
  //   ② 长度：请求的是「交付帧数」，续接要多采 sampleExtra 帧做继承再裁掉，并按模型合法长度网格向上取整。
  // 序号在 ComfyUI 输出目录里是跨会话共享的文件槽位，所以起链起点按会话随机取、会话内单调递增。
  const chain = manifest.chain || null
  const fps = Number(manifest.params?.fps?.default) || 24
  const wantLength = opts.durationSeconds ? Math.ceil(Number(opts.durationSeconds) * fps) : intArg(opts, 'length', 124)
  const lengthGrid = chain?.lengthGrid || manifest.lengthGrid || null
  let sampledLength = wantLength
  let deliveredLength = wantLength
  let chainLoadIdx = null
  let chainSaveIdx = null
  if (!chain && lengthGrid) {
    // 非链式：模型自己也会按网格取整，这里先取整并如实记账（否则 length 与产物差最多一个步长）
    sampledLength = snapLengthToGrid(wantLength, lengthGrid)
    deliveredLength = sampledLength
  }
  if (chain) {
    const grid = chain.lengthGrid
    if (wantContinuity) {
      const fromId = String(opts.continuity_from).trim()
      const prev = project.nodes.find((n) => n.id === fromId)
      if (!prev) throw new Error(`continuity_from 指向的画布节点不存在: ${fromId}`)
      if (prev.kind !== 'video') throw new Error(`continuity_from 必须是画布视频节点（当前是 ${prev.kind}）：${fromId}`)
      const prevIdx = Number(prev.params?.clipIndex)
      if (!Number.isInteger(prevIdx) || prevIdx < 1) {
        throw new Error(
          `上一镜没有链式序号（params.clipIndex）：它必须也是链式实现渲染的。` +
          `上一镜「${prev.title || fromId}」用的是 ${prev.params?.workflow || '未知'}——` +
          '同场景第一镜请直接用链式实现渲染（不传 continuity_from 就是起链），后续镜再传它的节点 id')
      }
      // 续接的一致性判据是**首遍尺寸**，不是交付尺寸（判据本身是纯函数，见 chainGraphMismatch）：
      // 链上流动的是首遍 latent（ctx 图的 node 22 存 node 10），放大发生在它之后
      // ⇒ 学习式/两阶段放大的实现同样可以续接，只要两镜的首遍尺寸一致。
      const mismatch = chainGraphMismatch(prev.params, effSize)
      if (mismatch) throw new Error(mismatch)
      chainLoadIdx = prevIdx
      chainSaveIdx = prevIdx + 1
      sampledLength = snapLengthToGrid(wantLength + chain.sampleExtra, grid)
      // 网格向上取整会让**交付**略长于请求（146 → 采样 158 → 交付 136）：以实际交付为准记录，
      // 否则下游按 length 排时长/拼接会跟成片差出去。
      deliveredLength = Math.max(1, sampledLength - chain.sampleExtra)
    } else {
      chainLoadIdx = 0                       // 起链：没有上文
      chainSaveIdx = allocateChainIndex(project)
      sampledLength = snapLengthToGrid(wantLength, grid)
      deliveredLength = sampledLength        // 起链没有继承帧要裁，采样即交付
    }
    project.settings.chainNext = Math.max(Number(project.settings.chainNext) || 1, chainSaveIdx + 1)
  }

  const prefix = CANVAS_DIR + '/' + sessionId + '/' + nodeId
  const isImage = manifest.output?.mediaType === 'image'
  const count = isImage ? Math.min(Math.max(intArg(opts, 'count', 1), 1), 4) : 1
  const baseSeed = intArg(opts, 'seed', Math.floor(Math.random() * 2 ** 31))

  const files = []
  const shotId = await ensureLegacyShot(projectId, nodeId, opts.title || manifest.displayName || '生成镜头')
  const manifestFingerprint = workflowHash(manifest)
  for (let i = 0; i < count; i++) {
    // 视频工作流必须经过正式 Prompt 编译器；该契约不受可选快照功能开关影响。
    const inputSnapshot = (manifest.capability.startsWith('video.') || featureEnabled('promptSnapshots')) ? compilePromptSnapshot({
      project: await activeProjectService.getProject(projectId), shotId, capability: manifest.capability,
      tier: resolved.tier || 'default', workflowFingerprint: manifestFingerprint, prompt: opts.prompt,
      negativePrompt: opts.negativePrompt || opts.negative_prompt || opts.avoid || '',
      parameters: {
        width: effSize.w, height: effSize.h, seed: baseSeed + i, steps, guidance,
        ...(manifest.capability.startsWith('video.') ? { frames: sampledLength } : {}),
        ...(Array.isArray(opts.ref_nodes) ? { referenceIds: opts.ref_nodes.map(String) } : {}),
      },
    }) : null
    const { graph } = buildRenderGraph(manifest, {
      ...opts,
      ...(inputSnapshot ? { prompt: inputSnapshot.prompt } : {}),
      ...(inputSnapshot?.negativePrompt ? { avoid: inputSnapshot.negativePrompt } : {}),
      seed: baseSeed + i,
      prefix,
      refs,
      first_frame: firstFrame,
      last_frame: lastFrame,
      source_video: sourceVideo,
      width: effSize.w,
      height: effSize.h,
      ...(manifest.capability.startsWith('video.') ? { length: sampledLength } : {}),
      ...(chain ? { context_clip_index: chainLoadIdx, save_clip_index: chainSaveIdx } : {}),
    }, aspectRatio)
    let attemptId = opts.resumeAttemptId || null
    if (attemptId) {
      const previous = (await activeProjectService.getProject(projectId)).attempts[attemptId]
      if (!previous || previous.shotId !== shotId) throw new Error('generation recovery attempt does not belong to this shot')
      if (previous.status === 'submission_unknown') throw new Error('generation recovery requires confirmation of the previous submission; refusing duplicate submission')
      if (previous.status === 'failed' && previous.failureClass === 'download_failure' && previous.promptId) {
        await submitProjectCommand(projectId, 'recoverGenerationAttempt', { attemptId, decision: 'resume' })
      } else if (['failed', 'cancelled'].includes(previous.status)) attemptId = null
      if (previous.status === 'completed') {
        const current = await activeProjectService.getProject(projectId)
        const asset = current.assets[previous.outputAssetIds?.[0]]
        if (!asset?.logicalKey || !existsSync(resolveStoredPath(root, asset.logicalKey))) throw new Error('completed generation output is missing; restore the recorded file before recovery')
        files.push(asset.logicalKey)
        continue
      }
    }
    if (!attemptId) {
      const createdAttempt = await submitProjectCommand(projectId, 'createGenerationAttempt', {
        shotId,
        capability: manifest.capability,
        workflowId: manifest.id,
        requestHash: createHash('sha256').update(JSON.stringify(graph)).digest('hex'),
        ...(inputSnapshot ? { inputSnapshot } : {}),
      })
      attemptId = createdAttempt.output.attemptId
      await opts.onCheckpoint?.('attempt', { attemptId })
    }
    let attempt = (await activeProjectService.getProject(projectId)).attempts[attemptId]
    if (!attempt) throw new Error(`generation recovery attempt not found: ${attemptId}`)
    let promptId = attempt.promptId
    if (!promptId) {
      try {
        promptId = await comfySubmit(graph)
      } catch (error) {
        const failure = classifyGenerationFailure(error, { stage: 'submit' })
        if (failure.submissionUncertain) await submitProjectCommand(projectId, 'markAttemptSubmitted', { attemptId, submissionUnknown: true })
        else await submitProjectCommand(projectId, 'failGenerationAttempt', { attemptId, error: failure.message, failureClass: failure.failureClass, retryable: failure.retryable, failureStage: 'submit' })
        throw error
      }
      await submitProjectCommand(projectId, 'markAttemptSubmitted', { attemptId, promptId })
      await opts.onCheckpoint?.('prompt', { attemptId, promptId })
      attempt = (await activeProjectService.getProject(projectId)).attempts[attemptId]
    }
    try {
      if (attempt.status === 'queued') await submitProjectCommand(projectId, 'advanceGenerationAttempt', { attemptId, status: 'running' })
      const entry = await comfyWait(promptId, opts.signal)
      const outputs = comfyOutputs(entry)
      if (!outputs.length) throw new Error('generation-error: ComfyUI 无输出')
      attempt = (await activeProjectService.getProject(projectId)).attempts[attemptId]
      if (attempt.status === 'running') await submitProjectCommand(projectId, 'advanceGenerationAttempt', { attemptId, status: 'downloading' })
      let first = true
      for (const f of outputs) {
        const buf = await comfyDownload(f)
        const media = await persistMedia(root, sessionId, buf, f.filename, opts.title || manifest.displayName || 'generated-media', opts.preparationKind === 'storyboard' ? PROJECT_STEPS.storyboards : opts.preparationKind ? PROJECT_STEPS.assets : PROJECT_STEPS.generation)
        if (manifest.output?.mediaType === 'image') {
          if (!probeImageSize(resolveStoredPath(root, media))) throw new Error('generation-validation-failed: image cannot be decoded')
        } else if (manifest.output?.mediaType === 'video') {
          const probe = probeMp4(resolveStoredPath(root, media))
          if (!(probe.w > 0 && probe.h > 0 && probe.frames > 0 && probe.duration > 0)) throw new Error('generation-validation-failed: video cannot be decoded')
          if (opts.durationSeconds && Math.abs(probe.duration - Number(opts.durationSeconds)) > 1) throw new Error('generation-validation-failed: video duration does not match the shot')
        }
        files.push(media)
        if (first && attempt.status !== 'completed') {
          await submitProjectCommand(projectId, 'completeGenerationAttempt', {
            attemptId, assetId: `${attemptId}-output-0`,
            kind: manifest.output?.mediaType || 'video',
            logicalKey: media,
            contentHash: createHash('sha256').update(buf).digest('hex'),
            bytes: buf.length,
            media: { filename: f.filename, type: f.type || 'output', subfolder: f.subfolder || '' },
            sourceIds: opts.preparationKind ? [opts.entityId] : undefined,
            provenance: { provider: 'comfyui', promptId, workflowId: manifest.id, ...(opts.preparationKind ? { preparationKind: opts.preparationKind, preparationSignature: opts.preparationSignature, title: opts.title } : {}) },
          })
          first = false
        }
      }
    } catch (error) {
      const current = await activeProjectService.getProject(projectId)
      if (!['completed', 'failed', 'cancelled'].includes(current.attempts[attemptId]?.status)) {
        const failureStage = current.attempts[attemptId]?.status === 'downloading' ? 'download' : 'run'
        const failure = classifyGenerationFailure(error, { stage: failureStage })
        await submitProjectCommand(projectId, 'failGenerationAttempt', { attemptId, error: failure.message, failureClass: failure.failureClass, retryable: failure.retryable, failureStage })
      }
      throw error
    }
  }

  const mediaType = manifest.output?.mediaType || (manifest.capability.startsWith('video') ? 'video' : 'image')
  // 交付尺寸如实记账：图片产物落盘后读真实像素（视频沿用 probeMp4 的记录口径）
  let deliverySize = lockSize
  let mediaProbe = null
  if (mediaType === 'image' && files[0]) {
    const actual = probeImageSize(resolveStoredPath(root, files[0]))
    if (actual) {
      if (actual.w !== lockSize.w || actual.h !== lockSize.h) {
        resolved.warnings = [...(resolved.warnings || []), `交付尺寸以产物为准：${actual.w}×${actual.h}（推导/图内尺寸 ${effSize.w}×${effSize.h}）`]
      }
      deliverySize = actual
    }
  } else if (mediaType === 'video' && files[0]) {
    mediaProbe = probeMp4(resolveStoredPath(root, files[0]))
    if (!(mediaProbe.w > 0) || !(mediaProbe.h > 0) || !(mediaProbe.frames > 0) || !(mediaProbe.duration > 0)) {
      throw new Error('generation-validation-failed: 视频产物缺少可解码尺寸、帧数或时长')
    }
    deliverySize = { w: mediaProbe.w, h: mediaProbe.h }
  }
  const node = {
    id: nodeId,
    kind: mediaType,
    title: opts.title || manifest.displayName || (mediaType === 'video' ? '视频' : '图片'),
    media: files[0] || '',
    group: opts.group || DEFAULT_GROUP,
    params: {
      workflow: manifest.id,
      capability: manifest.capability,
      // 形状（r2v / i2v）记在节点上：画布据此辨识「转场镜 / 锚点式重渲」这类 i2v 镜，
      // 也便于节点自检（`params.type` 与 `params.first_frame_node` 互相印证）
      ...(shapeCheck.shape ? { type: shapeCheck.shape } : {}),
      model: manifest.id,
      mode,
      tier: resolved.tier,
      accel: manifest.accel || '',
      resolution: resolved.resolution,
      seed: baseSeed,
      // 画布上记**交付**分辨率（成片尺寸），不是图内首遍尺寸——拼接/续接的一致性判断都读这里。
      // 图片以**产物真实像素**为准（probeImageSize）；读不出才退回推导值。
      width: deliverySize.w,
      height: deliverySize.h,
      // 与图内首遍/推导尺寸不同时，把底片尺寸也记下来（i2i 跟随参考图、两阶段放大都属此类）
      ...(deliverySize.w !== effSize.w || deliverySize.h !== effSize.h
        ? { graphWidth: effSize.w, graphHeight: effSize.h, ...(Number(manifest.resolutionLock?.scale) > 1 ? { upscaleScale: Number(manifest.resolutionLock.scale) } : {}) }
        : {}),
      ...(resolved.warnings && resolved.warnings.length ? { warnings: resolved.warnings } : {}),
      length: deliveredLength,
      ...(chain ? {
        requestedLength: wantLength,
        sampledLength,
        clipIndex: chainSaveIdx,
        contextClipIndex: chainLoadIdx,
        continuityFrom: wantContinuity ? String(opts.continuity_from).trim() : null,
        chain: { source: chain.source, sampleExtra: chain.sampleExtra },
      } : {}),
      steps,
      guidance,
      fps: (manifest.params?.fps?.default) || 24,
      ...(mediaProbe ? {
        actualDuration: mediaProbe.duration,
        actualFrames: mediaProbe.frames,
        hasAudio: mediaProbe.hasAudio,
      } : {}),
      ref_nodes: Array.isArray(opts.ref_nodes) ? opts.ref_nodes : [],
      first_frame_node: opts.first_frame_node || null,
      last_frame_node: opts.last_frame_node || null,
      prompt: opts.prompt,
      assets: resolveAssets(manifest, getAssetOverrides(manifest.id)),
    },
    status: 'ready',
    createdAt: Date.now(),
    order: nextOrder(project.nodes),
  }
  const existing = project.nodes.findIndex((n) => n.id === nodeId)
  if (existing >= 0) { node.order = project.nodes[existing].order; node.createdAt = project.nodes[existing].createdAt; project.nodes[existing] = node }
  else project.nodes.push(node)
  await saveProject(root, sessionId, project)

  return { ok: true, node, files, tier: resolved.tier, implementation: manifest.id, resolution: resolved.resolution, warnings: resolved.warnings, ...mediaDelivery(root, node.media) }
}

/**
 * 按顺序拼接画布上的多个视频节点，产物写回画布。
 * 后端：本机有 ffmpeg 走 ffmpeg（stream copy），否则退化到 ComfyUI 纯节点链路。
 */
async function runConcat(ctx, opts) {
  const { root, sessionId } = resolveSessionRoot(ctx, opts.sessionId, opts.workspaceId, opts.exec)
  const project = await loadProject(root, sessionId)

  const ids = Array.isArray(opts.nodes) ? opts.nodes : []
  if (ids.length < 2) throw new Error('concat-invalid: nodes 至少要 2 个视频节点 id')

  // 解析素材：必须是画布上已就绪的 video 节点，且媒体文件存在
  const sources = []
  for (const id of ids) {
    const n = project.nodes.find((x) => x.id === id)
    if (!n) throw new Error('concat-invalid: 画布无此节点 ' + id)
    if (n.kind !== 'video') throw new Error(`concat-invalid: 节点 ${id} 不是视频节点（kind=${n.kind}）`)
    if (!n.media) throw new Error('concat-invalid: 节点无媒体文件 ' + id)
    const abs = resolveStoredPath(root, n.media)
    if (!existsSync(abs)) throw new Error('concat-invalid: 媒体文件不存在 ' + n.media)
    sources.push({ id, abs })
  }

  const nodeId = opts.nodeId || randomUUID()
  let media
  let backend
  let reencoded = false
  let retimed = false

  if (await detectFfmpeg()) {
    backend = 'ffmpeg'
    const dir = projectDir(root, project.projectId, PROJECT_STEPS.assembly)
    await mkdir(dir, { recursive: true })
    // 复用 nodeId 时也写新文件：节点保存失败不会让旧节点悄悄读到已替换的新字节。
    const outName = `step-08-${safeName(opts.title || 'assembled-video')}-${nextArtifactStamp()}.mp4`
    const r = await ffmpegConcat(sources.map((s) => s.abs), join(dir, outName), {
      targetDuration: Number(opts.targetDuration || 0),
      strategy: opts.strategy || (Number(opts.targetDuration) > 0 ? 'strict' : 'preserve'),
    })
    reencoded = r.reencoded
    retimed = r.retimed
    media = `artifacts/${project.projectId}/${PROJECT_STEPS.assembly}/${outName}`
  } else {
    if (Number(opts.targetDuration) > 0 || (opts.strategy && opts.strategy !== 'preserve')) {
      throw new Error('concat-target-duration-requires-ffmpeg: ComfyUI 退化后端只支持 preserve')
    }
    backend = 'comfyui'
    // ComfyUI 的 LoadVideo 只认 input 目录，先把每段上传（/upload/image 同时接受 mp4）
    const names = []
    for (const s of sources) {
      const uploaded = await comfyUploadImage(await readFile(s.abs), basename(s.abs))
      names.push(uploaded.subfolder ? uploaded.subfolder + '/' + uploaded.name : uploaded.name)
    }
    const graph = buildConcatGraph(names, CANVAS_DIR + '/' + sessionId + '/' + nodeId)
    const promptId = await comfySubmit(graph)
    const entry = await comfyWait(promptId, opts.signal)
    const outputs = comfyOutputs(entry)
    if (!outputs.length) throw new Error('generation-error: ComfyUI 拼接无输出')
    media = await persistMedia(root, sessionId, await comfyDownload(outputs[0]), outputs[0].filename, opts.title || 'assembled-video')
  }

  const outputProbe = probeMp4(resolveStoredPath(root, media))
  if (!(outputProbe.w > 0) || !(outputProbe.h > 0) || !(outputProbe.frames > 0) || !(outputProbe.duration > 0)) {
    throw new Error('concat-validation-failed: 输出缺少可解码视频流、尺寸、帧数或时长')
  }
  const targetDuration = Number(opts.targetDuration || 0)
  if (targetDuration > 0 && Math.abs(outputProbe.duration - targetDuration) > 0.15) {
    throw new Error(`concat-duration-mismatch: 目标 ${targetDuration}s，实际 ${outputProbe.duration.toFixed(3)}s`)
  }
  const node = {
    id: nodeId,
    kind: 'video',
    title: opts.title || '拼接成片',
    media,
    group: opts.group || DEFAULT_GROUP,
    params: {
      backend,
      reencoded,
      retimed,
      strategy: opts.strategy || (targetDuration > 0 ? 'strict' : 'preserve'),
      targetDuration: targetDuration || null,
      actualDuration: outputProbe.duration,
      actualFrames: outputProbe.frames,
      width: outputProbe.w,
      height: outputProbe.h,
      hasAudio: outputProbe.hasAudio,
      sources: sources.map((s) => s.id),
    },
    status: 'ready',
    createdAt: Date.now(),
    order: nextOrder(project.nodes),
  }
  const existing = project.nodes.findIndex((n) => n.id === nodeId)
  if (existing >= 0) { node.order = project.nodes[existing].order; node.createdAt = project.nodes[existing].createdAt; project.nodes[existing] = node }
  else project.nodes.push(node)
  await saveProject(root, sessionId, project)

  return { ok: true, node, backend, ...mediaDelivery(root, media) }
}

// ---------------------------------------------------------------------------
// 视频超分（U3）：工具层的确定性后处理，走注册表（capability=video.upscale）
// ---------------------------------------------------------------------------
/**
 * 把画布上的一个视频节点放大，产物写回画布。
 *
 * 与 runRender 的分工：这里没有提示词、没有采样器、不推导分辨率——尺寸来自**源视频本身**
 * （清单声明尺寸来源：`upscale.sizing='factor'` 交付 = 源 × 倍率；`='short-side'` 交付由实现的
 * 目标短边推导），所以不经过 buildRenderGraph 的尺寸策略。
 *
 * 长片：`upscale.chunking`（缺省 caller）说清显存归谁管。逐帧独立 ⇒ 可按「像素-帧预算」自动分块
 * （ImageFromBatch 切帧 + TrimAudioDuration 切音轨），再把各块拼回一条（ComfyUI 纯节点链路；
 * 本机无 ffmpeg 时这是唯一后端）。声明 `internal` 的实现（自带跨帧时间先验，如 SeedVR2）
 * **不自动分块**——切开会打断它自己的时间窗。
 */
async function runUpscale(ctx, opts) {
  const { root, sessionId } = resolveSessionRoot(ctx, opts.sessionId, opts.workspaceId, opts.exec)
  const project = await loadProject(root, sessionId)

  const srcId = String(opts.video_node || '').trim()
  if (!srcId) throw new Error('upscale-invalid: 必须给 video_node（画布上的视频节点 id）')
  const srcNode = project.nodes.find((n) => n.id === srcId)
  if (!srcNode) throw new Error('upscale-invalid: 画布无此节点 ' + srcId)
  if (srcNode.kind !== 'video') throw new Error(`upscale-invalid: 节点 ${srcId} 不是视频节点（kind=${srcNode.kind}）`)
  if (!srcNode.media) throw new Error('upscale-invalid: 节点无媒体文件 ' + srcId)
  const abs = resolveStoredPath(root, srcNode.media)
  if (!existsSync(abs)) throw new Error('upscale-invalid: 媒体文件不存在 ' + srcNode.media)

  // 档位：写错了必须报错。**不许静默退化成 quality** —— 曾因此把一次「非法档位」的校验用例
  // 变成了一次真的 5376×3072 渲染（多花 ~300s GPU、还悄悄多出一个画布节点）。
  const rawTier = (typeof opts.tier === 'string' && opts.tier.trim()) ||
    (typeof opts.mode === 'string' && opts.mode.trim()) || ''
  if (rawTier && !TIERS.includes(rawTier)) {
    throw new Error(`upscale-invalid: tier "${rawTier}" 不在档位词汇表（${TIERS.join('|')}）`)
  }
  const tier = rawTier || 'quality'
  const { manifest } = await resolveTieredManifest('video.upscale', tier, explicitImplementationOf(opts), { registry: getRegistry() })
  const u = manifest.upscale
  if (!u) throw new Error(`upscale-invalid: 实现 ${manifest.id} 没有声明尺寸来源（upscale.factor / upscale.shortSide）`)

  // 源尺寸：优先画布 params（生成时就记下了），缺失回退到容器解析（手传/拼接的节点没有 params）
  const probe = probeMp4(abs)
  const srcW = Number(srcNode.params?.width) || probe.w
  const srcH = Number(srcNode.params?.height) || probe.h
  if (!(srcW > 0) || !(srcH > 0)) throw new Error('upscale-invalid: 读不出源视频尺寸（' + srcNode.media + '）')
  const frames = Number(srcNode.params?.length) || probe.frames || 0
  const fps = Number(srcNode.params?.fps) || 24
  const plan = planUpscale({
    srcW,
    srcH,
    sizing: u.sizing || 'factor',
    factor: u.factor,
    shortSide: u.shortSide,
    maxEdge: u.maxEdge || 0,
    align: u.align || 32,
    targetWidth: intArg(opts, 'target_width', 0),
  })
  const warnings = []
  if (plan.warning) warnings.push(plan.warning)
  if (!probe.hasAudio && !(Number(srcNode.params?.length) > 0)) warnings.push('源片没有音轨（或读不出）——产物也将无音轨')

  // 显存安全阀：像素-帧总量（帧数 × 交付宽 × 交付高）。实测 248 帧 × 5376×3072 = 4.09e9 通过；
  // 超过告警线就分块，每块压到预算内（代价线性，分块几乎不额外花时间）。
  // **但这条预算只对「逐帧独立」的实现成立**（chunking='caller'）：自带跨帧时间先验的实现
  // 声明 chunking='internal'，显存由它自己管（batch / tiling / offload），外层切开会出接缝。
  const chunking = u.chunking || 'caller'
  const chunkPlan = planUpscaleChunks({
    frames,
    deliveryW: plan.delivery.w,
    deliveryH: plan.delivery.h,
    chunking,
    explicitChunkFrames: intArg(opts, 'chunk_frames', 0),
  })
  warnings.push(...chunkPlan.warnings)
  const chunks = chunkRanges(frames, chunkPlan.frameLimit)
  if (chunks.length > 1) {
    // 文案必须说清**为什么**分块：说是"超过安全线"但其实没超，就是在误导排障
    const amount = `${frames} 帧 × 交付 ${plan.delivery.w}×${plan.delivery.h} = ${(chunkPlan.pixelFrames / 1e9).toFixed(2)}e9 像素-帧`
    warnings.push(chunkPlan.reason === 'manual'
      ? `按调用方指定分 ${chunks.length} 块（${chunkPlan.frameLimit} 帧/块）；${amount}（安全线 ${(PIXEL_FRAME_WARN / 1e9).toFixed(1)}e9）`
      : `${amount}，超过安全线 ${(PIXEL_FRAME_WARN / 1e9).toFixed(1)}e9 ⇒ 自动分 ${chunks.length} 块逐段超分再拼回`)
  }

  const nodeId = opts.nodeId || randomUUID()
  const uploaded = await comfyUploadImage(await readFile(abs), basename(abs))
  const srcName = uploaded.subfolder ? uploaded.subfolder + '/' + uploaded.name : uploaded.name
  const assetOverrides = getAssetOverrides(manifest.id)

  const outFiles = []
  for (const [i, c] of chunks.entries()) {
    const prefix = CANVAS_DIR + '/' + sessionId + '/' + nodeId + (chunks.length > 1 ? '-c' + String(i).padStart(3, '0') : '')
    const base = buildGraphFromManifest(manifest, {
      mode: null,
      assetOverrides,
      source_video: srcName,
      out_width: plan.delivery.w,
      out_height: plan.delivery.h,
      // 只有 sizing='short-side' 的实现会声明这个参数（校验器强制）——把**已对齐的**短边回注给模型，
      // 让 target_width 变成「按目标渲染」而不是「先渲染再降采样」。
      out_short_side: plan.shortSide,
      prefix,
    })
    const graph = sliceUpscaleGraph(base, { start: c.start, frames: c.frames, fps, sourceNode: '2' })
    const promptId = await comfySubmit(graph)
    const entry = await comfyWait(promptId, opts.signal)
    const outs = comfyOutputs(entry)
    if (!outs.length) throw new Error('upscale-error: ComfyUI 无输出' + (chunks.length > 1 ? `（第 ${i + 1}/${chunks.length} 块）` : ''))
    outFiles.push(outs[0])
  }

  let media
  let backend = 'comfyui-pixel'
  if (outFiles.length === 1) {
    media = await persistMedia(root, sessionId, await comfyDownload(outFiles[0]), outFiles[0].filename, opts.title || 'upscaled-video')
  } else {
    // 分块拼接：把各块**下载再上传**（concat 图吃 input 目录里的文件名）。
    // 不用 ffmpeg：本机多半没有，而这条链路已在 concat 工具里验证过。
    backend = 'comfyui-pixel+concat'
    const names = []
    for (let i = 0; i < outFiles.length; i++) {
      const chunkAbs = await tmpChunkPath(root, sessionId, nodeId, i)
      await writeFile(chunkAbs, await comfyDownload(outFiles[i]))
      const up = await comfyUploadImage(await readFile(chunkAbs), basename(chunkAbs))
      names.push(up.subfolder ? up.subfolder + '/' + up.name : up.name)
    }
    const graph = buildConcatGraph(names, CANVAS_DIR + '/' + sessionId + '/' + nodeId)
    const promptId = await comfySubmit(graph)
    const entry = await comfyWait(promptId, opts.signal)
    const outs = comfyOutputs(entry)
    if (!outs.length) throw new Error('upscale-error: 分块拼接无输出')
    media = await persistMedia(root, sessionId, await comfyDownload(outs[0]), outs[0].filename, opts.title || 'upscaled-video')
    for (const nm of names) { /* 临时块文件留在 input 目录由 ComfyUI 管理，不额外清理 */ void nm }
  }

  // 标题里的尺寸口径要跟**尺寸来源**一致：倍率形态写 ×N，短边形态写短边（编个倍率出来会与交付不符）
  const sizeLabel = plan.sizing === 'short-side' ? `短边 ${plan.shortSide}` : `×${u.factor}`
  const node = {
    id: nodeId,
    kind: 'video',
    title: opts.title || `${srcNode.title || '片段'} · 超分 ${sizeLabel}`,
    media,
    group: opts.group || DEFAULT_GROUP,
    params: {
      workflow: manifest.id,
      capability: 'video.upscale',
      model: manifest.id,
      tier,
      // 交付尺寸与帧数照常记（画布靠这两个字段判断拼接/续接一致性）
      width: plan.delivery.w,
      height: plan.delivery.h,
      length: frames,
      fps,
      // 超分特有的溯源
      upscaleFrom: srcId,
      upscaleFromMedia: srcNode.media,
      sourceWidth: srcW,
      sourceHeight: srcH,
      sizing: plan.sizing,
      // 倍率只在 factor 形态下成立；short-side 形态如实记 null（不编一个数出来）
      factor: plan.factor,
      shortSide: plan.shortSide,
      naturalWidth: plan.natural.w,
      naturalHeight: plan.natural.h,
      targetWidth: intArg(opts, 'target_width', 0) || null,
      chunks: chunks.length,
      assets: resolveAssets(manifest, assetOverrides),
    },
    status: 'ready',
    createdAt: Date.now(),
    order: nextOrder(project.nodes),
  }
  const existing = project.nodes.findIndex((n) => n.id === nodeId)
  if (existing >= 0) { node.order = project.nodes[existing].order; node.createdAt = project.nodes[existing].createdAt; project.nodes[existing] = node }
  else project.nodes.push(node)
  await saveProject(root, sessionId, project)

  return { ok: true, node, backend, plan, chunks: chunks.length, warnings, ...mediaDelivery(root, media) }
}

/** 分块临时文件的落点（与画布同目录，便于排障；ComfyUI 只认 input 目录的副本）。 */
async function tmpChunkPath(root, sessionId, nodeId, i) {
  const project = await loadProject(root, sessionId)
  const dir = projectDir(root, project.projectId, PROJECT_STEPS.generation)
  await mkdir(dir, { recursive: true })
  return join(dir, `step-07-upscale-chunk-${String(i + 1).padStart(3, '0')}-${nextArtifactStamp()}.mp4`)
}

const {
  collectUndelivered,
  deliverPending,
  makePreAskDeliverListener,
  exportTextNode,
  deliveryFilename,
  renderNodeHtml,
} = createPreAskDelivery({
  loadProject,
  projectDir,
  resolveStoredPath,
  resolveSessionRoot,
  saveProject,
})

const { makeH3PromptGateListener } = createH3PromptGate({
  videoShapes: VIDEO_SHAPES,
  getRegistry,
  resolveManifest,
})

// ---------------------------------------------------------------------------
// Agent 工具（原生 ToolDefinition，parameters 用 JSON Schema）
// ---------------------------------------------------------------------------

function makeTools() {
  const imageTool = {
    name: 'comfy_generate_image',
    description:
      '生成图片（默认档 quality）。**模型/实现由配置决定**（设置页的档位选择 / cfg.preferred），调用方只表达能力（文生图）与档位。产物写入会话画布并返回节点 id 与媒体相对路径（在「画布」tab 可见）。用于角色卡、场景卡、铅笔分镜等图片资产。触发词：生成图片/角色卡/场景卡/分镜图。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片提示词（含风格、角色/场景描述、负向约束）。' },
        tier: { type: 'string', enum: TIERS, description: '档位（见 comfy_list_workflows；缺省 fast，balanced / quality 需显式指定）。抽卡迭代建议用 fast/balanced，定稿用 quality。' },
        width: { type: 'integer', description: '宽（可选；缺省按画布 aspectRatio × 档位长边推导）。' },
        height: { type: 'integer', description: '高（可选；只传一边时另一边按画布比例推导）。' },
        seed: { type: 'integer', description: '随机种子（可选，缺省随机）。' },
        steps: { type: 'integer', description: '采样步数（缺省取该档声明的步数）。' },
        guidance: { type: 'number', description: '引导强度（仅对声明了 guidance 注入点的实现生效，如 FLUX；Qwen 走 cfg=1 官方路径，传了会收到 warning）。' },
        count: { type: 'integer', description: '生成张数（1–4，默认 1）。' },
        title: { type: 'string', description: '画布节点标题，如「主角卡」。' },
        group: { type: 'string', description: '画布分组（自由字符串，由流程 skill 定义；缺省 ungrouped）。' },
        nodeId: { type: 'string', description: '复用节点 id（更新而非新增）。' },
        sessionId: { type: 'string', description: '会话 id（缺省取当前 agent 会话）。' },
        workspaceId: { type: 'string', description: '工作区 id（缺省自动解析）。' },
      },
      required: ['prompt'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, nodeId: { type: 'string' }, media: { type: 'string' }, absPath: { type: 'string' }, mediaType: { type: 'string' }, bytes: { type: 'number' }, error: { type: 'string' } } },
      render: (_args, value) => text(value.ok
        ? `已生成图片节点 ${value.nodeId}\n${mediaResultDetail(value)}`
        : `生成失败: ${value.error}`),
    },
    async execute(args, exec) {
      try {
        const r = await runRender(ctx, { ...args, capability: 'image.text2image', exec })
        return { ok: true, nodeId: r.node.id, media: r.node.media, absPath: r.absPath, mediaType: r.mediaType, bytes: r.bytes, error: '' }
      } catch (error) {
        return { ok: false, nodeId: '', media: '', absPath: '', mediaType: '', bytes: 0, error: error?.message || String(error) }
      }
    },
  }

  const videoTool = {
    name: 'comfy_generate_video',
    description:
      '用 ComfyUI 的 MiniMax H3 音视频模型生成单镜头视频（带声音）。两种路径：传 first_frame_node/last_frame_node（画布图片节点）→ 用 ImageToVideo 做首/末帧串联（同场景续接，身份/环境由首帧继承，改善过渡）；不传 → 用 ReferenceToVideo 并支持 ref_nodes（角色/场景卡）作参考绑定。**档位用 tier**（fast 调试 / balanced 日常 / quality 成片），由注册表解析到具体实现——不会静默跨档替换，所选实现不可用会显式报错。产物写入画布并返回节点 id + 媒体相对路径。用于单镜头视频。触发词：生成视频/单镜头/片段。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频提示词（含每秒动作、镜头运动、说话人绑定等）。' },
        type: { type: 'string', enum: Object.keys(VIDEO_SHAPES), description: '**必填**：单镜头视频的形状（条件路径）。r2v=参考绑定（传 ref_nodes=角色卡/场景卡；不许传 first/last_frame）；i2v=首末帧串联（传 first_frame_node，可选 last_frame_node；不许传 ref_nodes）。形状与"续接"正交：同场景续接 = type=r2v + continuity_from。' },
        tier: { type: 'string', enum: TIERS, description: '档位：一个能力支持哪些档、每档意味着什么（分辨率/步数/加速件/耗时）由注册表决定，**以 comfy_list_workflows 为准**，不要预设。缺省 fast；balanced / quality 需显式指定。具体实现由配置决定，调用方不指定工作流。' },
        ref_nodes: { type: 'array', items: { type: 'string' }, description: '参考图：画布图片节点 id 或资产 id（character:luna / scene:bridge，跨会话复用）。绑定身份/环境（一致性）。与 first/last_frame 二选一。' },
        first_frame_node: { type: 'string', description: '首帧：画布图片节点 id 或资产 id（末帧串联：传上一镜末帧来接续）。' },
        last_frame_node: { type: 'string', description: '末帧：画布图片节点 id 或资产 id（供下一镜首帧串联）。' },
        continuity_from: { type: 'string', description: '同场景续接（链式续接）：传**上一镜的画布视频节点 id**。选中的实现会消费上一镜的服务端 latent，逐帧钉住它的结尾、音频从接缝继续（画质无损、不需上传）。传了它=只要支持续接的实现（没有则显式报错，不会悄悄退回普通生成）；首次续接的那一镜本身也必须由支持续接的实现渲染。跨场景/首镜不要传。用 comfy_list_workflows 可查当前哪些实现支持续接。' },
        width: { type: 'integer', description: '宽，显式传入则优先采用（snap 到 32 倍数）；缺省按画布 aspectRatio 推导，默认 1344。fast/quality 均支持任意比例。**例外**：若该档解析到的实现锁定了自己的原生分辨率（放大类实现），本参数不生效，交付尺寸由该实现决定，返回里会带 warnings 说明。' },
        height: { type: 'integer', description: '高，显式传入则优先采用（snap 到 32 倍数）；缺省按画布 aspectRatio 推导，默认 768。fast/quality 均支持任意比例。**例外**：若该档解析到的实现锁定了自己的原生分辨率（放大类实现），本参数不生效，交付尺寸由该实现决定，返回里会带 warnings 说明。' },
        length: { type: 'integer', description: '帧数（24fps；124≈5s，步进 17）。默认 124。' },
        seed: { type: 'integer', description: '随机种子（可选）。' },
        steps: { type: 'integer', description: '采样步数，默认 20（fast 档强制 4）。' },
        title: { type: 'string', description: '画布节点标题，如「S01 片段」。' },
        group: { type: 'string', description: '画布分组（自由字符串，由流程 skill 定义；缺省 ungrouped）。' },
        nodeId: { type: 'string', description: '复用节点 id。' },
        sessionId: { type: 'string', description: '会话 id（缺省取当前 agent 会话）。' },
        workspaceId: { type: 'string', description: '工作区 id（缺省自动解析）。' },
      },
      required: ['prompt', 'type'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, nodeId: { type: 'string' }, media: { type: 'string' }, absPath: { type: 'string' }, mediaType: { type: 'string' }, bytes: { type: 'number' }, tier: { type: 'string' }, implementation: { type: 'string' }, resolution: { type: 'string' }, warnings: { type: 'array', items: { type: 'string' } }, error: { type: 'string' } } },
      render: (_args, value) => text(value.ok
        ? `已生成视频节点 ${value.nodeId}${renderResolutionNote(value)}\n${mediaResultDetail(value)}`
        : `生成失败: ${value.error}`),
    },
    async execute(args, exec) {
      try {
        // 形状**必须显式声明**（type=r2v|i2v）：不再按"传没传 first_frame"猜能力，
        // 否则两个都传时会把参数静默丢掉（i2v 清单没有参考图槽位）。
        const capability = args.type ? VIDEO_SHAPES[args.type]?.capability : null
        if (!capability) {
          return { ok: false, nodeId: '', media: '', absPath: '', mediaType: '', bytes: 0, tier: '', implementation: '', resolution: '', warnings: [], error: `缺少或非法的 type：${args.type === undefined ? '必须显式声明' : String(args.type)}。type=r2v（参考绑定：ref_nodes=角色卡/场景卡）或 type=i2v（首帧/末帧串联：first_frame_node，可选 last_frame_node）。同场景续接用 type=r2v + continuity_from=上一镜节点 id。` }
        }
        const r = await runRender(ctx, { ...args, capability, exec })
        return { ok: true, nodeId: r.node.id, media: r.node.media, absPath: r.absPath, mediaType: r.mediaType, bytes: r.bytes, tier: r.tier || '', implementation: r.implementation || '', resolution: r.resolution || '', warnings: r.warnings || [], error: '' }
      } catch (error) {
        return { ok: false, nodeId: '', media: '', absPath: '', mediaType: '', bytes: 0, tier: '', implementation: '', resolution: '', warnings: [], error: error?.message || String(error) }
      }
    },
  }

  const listNodesTool = {
    name: 'canvas_list_nodes',
    description: '列出会话画布的所有节点（含分组、状态、媒体相对路径）。',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话 id。' },
        workspaceId: { type: 'string', description: '工作区 id。' },
      },
      required: [],
    },
    output: {
      schema: { type: 'object', properties: { nodes: { type: 'array', items: { type: 'object' } } } },
      render: (_args, value) => text((value.nodes || []).map((n) => `${n.kind}\t${n.group}\t${n.id}\t${n.title}\t${n.status}`).join('\n') || '(空画布)'),
    },
    async execute(args, exec) {
      const sid = args.sessionId || exec?.agent?.id
      const { root } = resolveSessionRoot(ctx, sid, args.workspaceId, exec)
      const project = await loadProject(root, sid)
      return { nodes: project.nodes }
    },
  }

  const writeNodeTool = {
    name: 'canvas_write_node',
    description: '在会话画布写入/更新文本或表格节点（项目简报、故事大纲、七列镜头表、文本分镜等）。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: '节点类型：text / table。' },
        title: { type: 'string', description: '节点标题。' },
        content: { type: 'string', description: '文本/markdown 内容。' },
        group: { type: 'string', description: '分组。' },
        nodeId: { type: 'string', description: '复用节点 id（更新而非新增）。' },
        sessionId: { type: 'string', description: '会话 id。' },
        workspaceId: { type: 'string', description: '工作区 id。' },
      },
      required: ['kind', 'title', 'content'],
    },
    output: {
      schema: { type: 'object', properties: { nodeId: { type: 'string' }, error: { type: 'string' } } },
      render: (_args, value) => text(value.error ? '写入失败: ' + value.error : '已写入画布节点 ' + value.nodeId),
    },
    async execute(args, exec) {
      try {
        const sid = args.sessionId || exec?.agent?.id
        const { root } = resolveSessionRoot(ctx, sid, args.workspaceId, exec)
        const project = await loadProject(root, sid)
        const nodeId = args.nodeId || randomUUID()
        const node = {
          id: nodeId,
          kind: args.kind === 'table' ? 'table' : 'text',
          title: args.title,
          content: args.content,
          group: args.group || DEFAULT_GROUP,
          status: 'ready',
          createdAt: Date.now(),
          order: nextOrder(project.nodes),
        }
        // 文本/表格节点导出交付文件：PDF 优先（puppeteer/Chrome），无工具兜底 .html
        // （随 pre-ask 钩子送达飞书；失败不阻塞画布写入）
        if (TEXT_NODE_EXPORT_PDF) {
          try {
            const pdfTool = await detectPdfTool()
            const out = await exportTextNode(root, sid, nodeId, args.title, node.kind, node.group || DEFAULT_GROUP, args.content, pdfTool)
            node.file = out.rel
          } catch (error) {
            console.warn('[dsh-short-video-studio] text node export failed:', error?.message || String(error))
          }
        }
        const existing = project.nodes.findIndex((n) => n.id === nodeId)
        if (existing >= 0) { node.order = project.nodes[existing].order; node.createdAt = project.nodes[existing].createdAt; project.nodes[existing] = node }
        else project.nodes.push(node)
        await saveProject(root, sid, project)
        return { nodeId, error: '' }
      } catch (error) {
        return { nodeId: '', error: error?.message || String(error) }
      }
    },
  }

  const getNodeTool = {
    name: 'canvas_get_node',
    description: '读取会话画布单个节点。',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 id。' },
        sessionId: { type: 'string', description: '会话 id。' },
        workspaceId: { type: 'string', description: '工作区 id。' },
      },
      required: ['nodeId'],
    },
    output: {
      schema: { type: 'object', properties: { node: { type: 'object' } } },
      render: (_args, value) => text(value.node ? `${value.node.kind}\t${value.node.id}\t${value.node.title}\n${value.node.content || value.node.media || ''}` : '(未找到)'),
    },
    async execute(args, exec) {
      const sid = args.sessionId || exec?.agent?.id
      const { root } = resolveSessionRoot(ctx, sid, args.workspaceId, exec)
      const project = await loadProject(root, sid)
      const node = project.nodes.find((n) => n.id === args.nodeId) || {}
      return { node }
    },
  }

  const groupTool = {
    name: 'canvas_group_nodes',
    description: '把画布多个节点归到同一分组。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' }, description: '节点 id 列表。' },
        group: { type: 'string', description: '目标分组。' },
        sessionId: { type: 'string', description: '会话 id。' },
        workspaceId: { type: 'string', description: '工作区 id。' },
      },
      required: ['nodeIds', 'group'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, error: { type: 'string' } } },
      render: (_args, value) => text(value.ok ? '已分组' : '分组失败: ' + value.error),
    },
    async execute(args, exec) {
      try {
        const sid = args.sessionId || exec?.agent?.id
        const { root } = resolveSessionRoot(ctx, sid, args.workspaceId, exec)
        const project = await loadProject(root, sid)
        for (const n of project.nodes) if ((args.nodeIds || []).includes(n.id)) n.group = args.group
        await saveProject(root, sid, project)
        return { ok: true, error: '' }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    },
  }

  const reorderTool = {
    name: 'canvas_reorder',
    description: '按给定节点 id 顺序重排画布（未列出的节点按原顺序排到末尾）。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' }, description: '新顺序节点 id 列表。' },
        sessionId: { type: 'string', description: '会话 id。' },
        workspaceId: { type: 'string', description: '工作区 id。' },
      },
      required: ['nodeIds'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, error: { type: 'string' } } },
      render: (_args, value) => text(value.ok ? '已重排' : '重排失败: ' + value.error),
    },
    async execute(args, exec) {
      try {
        const sid = args.sessionId || exec?.agent?.id
        const { root } = resolveSessionRoot(ctx, sid, args.workspaceId, exec)
        const project = await loadProject(root, sid)
        const ids = args.nodeIds || []
        const byId = new Map(project.nodes.map((n) => [n.id, n]))
        const ordered = []
        for (const id of ids) { const n = byId.get(id); if (n) { ordered.push(n); byId.delete(id) } }
        for (const n of project.nodes) if (byId.has(n.id)) ordered.push(n)
        ordered.forEach((n, i) => { n.order = i })
        project.nodes = ordered
        await saveProject(root, sid, project)
        return { ok: true, error: '' }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    },
  }

  const stateTool = {
    name: 'canvas_get_state',
    description: '读取会话画布的项目设置（画幅/时长/音频模式/生成模式/分组展示顺序）。',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话 id。' },
        workspaceId: { type: 'string', description: '工作区 id。' },
      },
      required: [],
    },
    output: {
      schema: { type: 'object', properties: { settings: { type: 'object' } } },
      render: (_args, value) => text(JSON.stringify(value.settings || {})),
    },
    async execute(args, exec) {
      const sid = args.sessionId || exec?.agent?.id
      const { root } = resolveSessionRoot(ctx, sid, args.workspaceId, exec)
      const project = await loadProject(root, sid)
      return { settings: project.settings || {} }
    },
  }

  const setStateTool = {
    name: 'canvas_set_state',
    description: '写入会话画布的项目设置（画幅/时长/音频模式/生成模式/分组展示顺序）。用于持久化流程 skill 的开场选择。',
    parameters: {
      type: 'object',
      properties: {
        aspectRatio: { type: 'string', description: '画面比例，如 16:9 / 9:16 / 1:1。' },
        duration: { type: 'string', description: '总时长，如 30 秒。' },
        audioMode: { type: 'string', enum: ['native', 'silent', 'dialogue-led', 'narration-led'], description: '视频原生音频模式，默认 native；对白和声音要求写入分镜，由视频模型同时生成。' },
        mode: { type: 'string', enum: TIERS, description: '生成档位（画布项目设置）：项目默认档位；工具条与技能按此默认值预选。各档语义见 comfy_list_workflows（不要预设档位含义）。' },
        groupOrder: {
          type: 'array',
          items: { type: 'string' },
          description: '画布分组的展示顺序（分组名由流程 skill 自由定义）。画布按此顺序渲染分组；未列出的分组排在其后、按首次出现顺序。流程 skill 应在开场一次性声明。',
        },
        sessionId: { type: 'string', description: '会话 id。' },
        workspaceId: { type: 'string', description: '工作区 id。' },
      },
      required: [],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, error: { type: 'string' } } },
      render: (_args, value) => text(value.ok ? '已保存画布设置' : '保存失败: ' + value.error),
    },
    async execute(args, exec) {
      try {
        const sid = args.sessionId || exec?.agent?.id
        const { root } = resolveSessionRoot(ctx, sid, args.workspaceId, exec)
        const project = await loadProject(root, sid)
        project.settings = {
          ...project.settings,
          aspectRatio: args.aspectRatio ?? project.settings.aspectRatio,
          duration: args.duration ?? project.settings.duration,
          audioMode: args.audioMode ?? project.settings.audioMode,
          mode: args.mode ?? project.settings.mode,
          groupOrder: Array.isArray(args.groupOrder)
            ? args.groupOrder.filter((g) => typeof g === 'string' && g.trim()).map((g) => g.trim())
            : project.settings.groupOrder,
        }
        await saveProject(root, sid, project)
        return { ok: true, error: '' }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    },
  }

  const renderTool = {
    name: 'comfy_render',
    description:
      '通用渲染入口（模型/实现无关）：按 capability + tier 调用注册表解析出的实现。**实现由配置决定**（设置页/配置文件的 preferred、tiers、pins），调用方只表达能力与档位——不接受 workflow。产物写入画布。触发词：生成/渲染。',
    parameters: {
      type: 'object',
      properties: {
        capability: { type: 'string', enum: CAPABILITIES, description: '能力（见 comfy_list_workflows）。' },
        type: { type: 'string', enum: Object.keys(VIDEO_SHAPES), description: '视频形状别名（可选）：r2v=视频参考绑定、i2v=视频首末帧串联；传了就必须与 capability 一致。不传则按 capability 推导形状做参数校验（例如 capability=video.reference2video 时不许传 first/last_frame）。' },
        tier: { type: 'string', enum: TIERS, description: '档位（见 comfy_list_workflows；缺省 fast，balanced / quality 需显式指定）。实现由配置按档位解析，调用方不指定具体工作流。' },
        prompt: { type: 'string', description: '提示词。' },
        width: { type: 'integer', description: '宽（可选，缺省按能力/画布推导）。' },
        height: { type: 'integer', description: '高（可选，缺省按能力/画布推导）。' },
        length: { type: 'integer', description: '帧数（视频，默认 124）。' },
        seed: { type: 'integer', description: '随机种子（可选）。' },
        steps: { type: 'integer', description: '采样步数（缺省取 mode 声明的 steps）。' },
        guidance: { type: 'number', description: '引导强度。' },
        count: { type: 'integer', description: '图片张数（1–4，默认 1）。' },
        ref_nodes: { type: 'array', items: { type: 'string' }, description: '参考图：画布图片节点 id 或资产 id（character:luna / scene:bridge）。' },
        first_frame_node: { type: 'string', description: '首帧（画布图片节点 id 或资产 id）。' },
        last_frame_node: { type: 'string', description: '末帧（画布图片节点 id 或资产 id）。' },
        continuity_from: { type: 'string', description: '同场景续接（链式续接）：传**上一镜的画布视频节点 id**。选中的实现会消费上一镜的服务端 latent，逐帧钉住它的结尾、音频从接缝继续（画质无损、不需上传）。传了它=只要支持续接的实现（没有则显式报错，不会悄悄退回普通生成）；首次续接的那一镜本身也必须由支持续接的实现渲染。跨场景/首镜不要传。用 comfy_list_workflows 可查当前哪些实现支持续接。' },
        title: { type: 'string', description: '画布节点标题。' },
        group: { type: 'string', description: '画布分组。' },
        nodeId: { type: 'string', description: '复用节点 id。' },
        sessionId: { type: 'string', description: '会话 id。' },
        workspaceId: { type: 'string', description: '工作区 id。' },
      },
      required: ['capability', 'prompt'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, nodeId: { type: 'string' }, media: { type: 'string' }, absPath: { type: 'string' }, mediaType: { type: 'string' }, bytes: { type: 'number' }, tier: { type: 'string' }, implementation: { type: 'string' }, resolution: { type: 'string' }, warnings: { type: 'array', items: { type: 'string' } }, error: { type: 'string' } } },
      render: (_args, value) => text(value.ok
        ? `已渲染节点 ${value.nodeId}${renderResolutionNote(value)}\n${mediaResultDetail(value)}`
        : `渲染失败: ${value.error}`),
    },
    async execute(args, exec) {
      try {
        const r = await runRender(ctx, { ...args, exec })
        return { ok: true, nodeId: r.node.id, media: r.node.media, absPath: r.absPath, mediaType: r.mediaType, bytes: r.bytes, tier: r.tier || '', implementation: r.implementation || '', resolution: r.resolution || '', warnings: r.warnings || [], error: '' }
      } catch (error) {
        return { ok: false, nodeId: '', media: '', absPath: '', mediaType: '', bytes: 0, tier: '', implementation: '', resolution: '', warnings: [], error: error?.message || String(error) }
      }
    },
  }

  const concatTool = {
    name: 'video_concat',
    description:
      '按给定顺序拼接画布视频并在验收后原子写回画布。可用 targetDuration + strategy=retime 同步调整视频 PTS 与音频 tempo；strategy=strict 会在实际时长不符时失败。触发词：拼接/合成全片/连成一条。',
    parameters: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: { type: 'string' },
          description: '要拼接的画布视频节点 id，按成片顺序排列（至少 2 个）。',
        },
        title: { type: 'string', description: '画布节点标题，如「拼接成片」。' },
        group: { type: 'string', description: '画布分组（自由字符串，由流程 skill 定义；缺省 ungrouped）。' },
        nodeId: { type: 'string', description: '复用节点 id。' },
        targetDuration: { type: 'number', exclusiveMinimum: 0, description: '目标成片时长（秒）。传入后默认 strict；需要同步重定时时显式传 strategy=retime。' },
        strategy: { type: 'string', enum: ['preserve', 'strict', 'retime'], description: '时长策略：preserve 保持实际时长；strict 不匹配即失败；retime 同步调整视频和音频。' },
        sessionId: { type: 'string', description: '会话 id（缺省取当前 agent 会话）。' },
        workspaceId: { type: 'string', description: '工作区 id（缺省自动解析）。' },
      },
      required: ['nodes'],
    },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, nodeId: { type: 'string' }, media: { type: 'string' }, absPath: { type: 'string' }, mediaType: { type: 'string' }, bytes: { type: 'number' }, backend: { type: 'string' }, probe: { type: 'object' }, error: { type: 'string' } },
      },
      render: (_args, value) => text(value.ok
        ? `已拼接节点 ${value.nodeId}（后端 ${value.backend}）\n${mediaResultDetail(value)}`
        : `拼接失败: ${value.error}`),
    },
    async execute(args, exec) {
      try {
        const r = await runConcat(ctx, { ...args, exec })
        return { ok: true, nodeId: r.node.id, media: r.node.media, absPath: r.absPath, mediaType: r.mediaType, bytes: r.bytes, backend: r.backend, probe: r.node.params, error: '' }
      } catch (error) {
        return { ok: false, nodeId: '', media: '', absPath: '', mediaType: '', bytes: 0, backend: '', probe: {}, error: error?.message || String(error) }
      }
    },
  }

  const extractFrameTool = {
    name: 'extract_frame',
    description:
      '从画布上的视频节点抽取一帧存为画布图片节点（默认末帧）。用途：① 同场景续接镜——抽上一镜末帧作 comfy_generate_video 的 first_frame_node；② 跨场景转场镜——抽前一镜末帧 + 后一镜首帧，作首末帧生成一个真实的过渡镜头。触发词：抽帧/取末帧/取首帧。',
    parameters: {
      type: 'object',
      properties: {
        video_node: { type: 'string', description: '来源视频节点的画布 id。' },
        frame_index: {
          type: 'integer',
          description: '帧序号。负数从末尾数：-1 = 末帧（默认），0 = 首帧。',
        },
        title: { type: 'string', description: '画布节点标题，如「S03 末帧」。' },
        group: { type: 'string', description: '画布分组（自由字符串，由流程 skill 定义；缺省 ungrouped）。' },
        nodeId: { type: 'string', description: '复用节点 id。' },
        sessionId: { type: 'string', description: '会话 id（缺省取当前 agent 会话）。' },
        workspaceId: { type: 'string', description: '工作区 id（缺省自动解析）。' },
      },
      required: ['video_node'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, nodeId: { type: 'string' }, media: { type: 'string' }, absPath: { type: 'string' }, mediaType: { type: 'string' }, bytes: { type: 'number' }, error: { type: 'string' } } },
      render: (_args, value) => text(value.ok ? `已抽帧节点 ${value.nodeId}\n${mediaResultDetail(value)}` : `抽帧失败: ${value.error}`),
    },
    async execute(args, exec) {
      try {
        const r = await runRender(ctx, {
          ...args,
          capability: 'image.from_video',
          frame_index: args.frame_index === undefined ? -1 : args.frame_index,
          exec,
        })
        return { ok: true, nodeId: r.node.id, media: r.node.media, absPath: r.absPath, mediaType: r.mediaType, bytes: r.bytes, error: '' }
      } catch (error) {
        return { ok: false, nodeId: '', media: '', absPath: '', mediaType: '', bytes: 0, error: error?.message || String(error) }
      }
    },
  }

  const upscaleTool = {
    name: 'video_upscale',
    description:
      '视频超分/恢复（U3）：把画布上一个**已生成的视频节点**放大并写回画布（音轨原样带回——音频从不经过模型）。' +
      '与生成工具同构：tier 走注册表解析，workflow 可显式指定实现，模型走资产槽可替换。' +
      '交付尺寸由实现的**尺寸来源**决定：倍率形态（像素空间 CNN，交付 = 源 × 倍率）或短边形态' +
      '（扩散/恢复类模型，交付由实现的目标短边推导）。target_width 两种形态都可用——' +
      '前者是事后收敛（超出倍率能力只是插值，会告警），后者**回注给模型按目标渲染**；都按 32 对齐。' +
      '长片只在实现声明可被外层切块（chunking=caller，逐帧独立）时按像素-帧预算自动分块再拼回；' +
      '自带跨帧时间先验的实现由它自己管显存（batch / tiling），外层不切。' +
      '推荐**对单个分镜放大**（成片先拼后放会让失败代价与显存峰值都放大到全片）。触发词：超分/放大/提分辨率/2K/4K。',
    parameters: {
      type: 'object',
      properties: {
        video_node: { type: 'string', description: '要放大的画布视频节点 id（源片）。' },
        tier: { type: 'string', enum: TIERS, description: '档位（缺省 fast，balanced / quality 需显式指定）。**实现由配置决定**（如 x2 / x4 是两个并列实现，用设置页或 cfg.pins 选），调用方不指定工作流。' },
        target_width: { type: 'integer', description: '目标交付宽度（可选；按 32 对齐，高度按原比例同步）。倍率形态=事后收敛到该宽度（超过实现的倍率能力时只是插值，会告警）；短边形态=反解短边回注实现，让它按目标渲染。不传=用实现自己的尺寸。' },
        chunk_frames: { type: 'integer', description: '每块帧数（可选；缺省按像素-帧预算自动决定，只有超预算的长片才会分块）。实现声明 upscale.chunking="internal"（自带跨帧时间先验）时不会自动分块，显式传它会出警告。' },
        title: { type: 'string', description: '画布节点标题。' },
        group: { type: 'string', description: '画布分组。' },
        nodeId: { type: 'string', description: '复用节点 id（更新而非新增）。' },
        sessionId: { type: 'string', description: '会话 id（缺省取当前 agent 会话）。' },
        workspaceId: { type: 'string', description: '工作区 id（缺省自动解析）。' },
      },
      required: ['video_node'],
    },
    // 宿主 tools.register 强制要求 output { schema, render }：缺了会在注册时抛
    // TypeError，整条 apply 随之失败（工具与路由一起没了）。schema 只允许
    // type/oneOf/properties/required/additionalProperties/items/enum/const 子集，
    // 且 type 不能写成数组 ⇒ plan 的"空"用 {} 而不是 null。
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          nodeId: { type: 'string' },
          media: { type: 'string' },
          absPath: { type: 'string' },
          mediaType: { type: 'string' },
          bytes: { type: 'number' },
          backend: { type: 'string' },
          chunks: { type: 'integer' },
          plan: {
            type: 'object',
            properties: {
              natural: { type: 'object' },
              delivery: { type: 'object' },
              // sizing='short-side' 时 factor 为 null（倍率是推导的），输出侧省略该键（见 execute）
              factor: { type: 'number' },
              shortSide: { type: 'integer' },
              maxEdge: { type: 'integer' },
              sizing: { type: 'string' },
              align: { type: 'integer' },
              warning: { type: 'string' },
            },
          },
          warnings: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(value.ok
        ? `已超分 ${value.nodeId} → ${value.media}` +
          (value.plan && value.plan.delivery ? `（交付 ${value.plan.delivery.w}×${value.plan.delivery.h}）` : '') +
          (value.chunks > 1 ? ` · 分 ${value.chunks} 块` : '') +
          (value.warnings && value.warnings.length ? `\n⚠ ${value.warnings.join('\n⚠ ')}` : '')
        : `超分失败: ${value.error}`),
    },
    async execute(args, exec) {
      try {
        const r = await runUpscale(ctx, { ...args, exec })
        // output schema 里 factor 是 number、shortSide 是 integer，而两个形态各自会把**不属于自己的**
        // 那个键置为 null（短边形态无倍率、倍率形态无短边——都不编数）。宿主 schema 子集不支持
        // type 数组 / null 联合 ⇒ 输出侧统一**省略** null 键，改由 sizing 表明是哪种形态。
        const plan = {}
        for (const [k, v] of Object.entries(r.plan || {})) if (v !== null) plan[k] = v
        return {
          ok: true, nodeId: r.node.id, media: r.node.media, absPath: r.absPath, mediaType: r.mediaType,
          bytes: r.bytes, backend: r.backend, chunks: r.chunks, plan, warnings: r.warnings || [], error: '',
        }
      } catch (error) {
        return {
          ok: false, nodeId: '', media: '', absPath: '', mediaType: '', bytes: 0,
          backend: '', chunks: 0, plan: {}, warnings: [], error: error?.message || String(error),
        }
      }
    },
  }

  const listWorkflowsTool = {
    name: 'comfy_list_workflows',
    description: '列出可用的生成能力与**档位**（含可用性、交付尺寸、实测耗时）。**实现由配置决定**，调用方只按「能力 + 档位」请求，不需要（也不应该）知道具体工作流 id。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: {
      schema: { type: 'object', properties: { endpoint: { type: 'string' }, capabilities: { type: 'array', items: { type: 'object' } }, diagnostics: { type: 'string' } } },
      render: (_args, value) => {
        const main = (value.capabilities || []).map((c) => {
          if (!c.tiered) {
            return `${c.capability}（未分档：只有唯一实现，忽略档位请求）`
          }
          const lines = [`${c.capability}\t档位=${(c.tiers || []).join(' / ')}`]
          for (const t of c.tierInfo || []) {
            const av = t.ok ? '✓可用' : `✗不可用${t.missing && t.missing.length ? `(缺节点 ${t.missing.join(',')})` : ''}`
            const size = t.longSide ? `长边 ${t.longSide}` : (t.referencePixels ? `参考图预算 ${t.referencePixels}px` : '跟随输入')
            lines.push(`  [${t.tier}] ${av} · ${size}${t.estSeconds ? ` · 约 ${t.estSeconds}s` : ''}${t.count > 1 ? ` · ${t.count} 个并列实现` : ''}`)
          }
          return lines.join('\n')
        }).join('\n') || '(无工作流)'
        const diag = value.diagnostics ? `\n\n诊断（排障用，技能/流程不必引用）：\n${value.diagnostics}` : ''
        return text(`ComfyUI endpoint=${value.endpoint || '(unknown)'}\n${main}${diag}`)
      },
    },
    async execute() {
      const registry = getRegistry()
      const matrix = await describeTierMatrix(registry)
      const capabilities = Object.entries(registry.byCapability).map(([cap, ms]) => {
        const preferred = getPreferred(cap)
        const m = matrix[cap] || {}
        return {
          capability: cap,
          default: preferred[0] || (ms[0] && ms[0].id) || '',
          tiered: Boolean(m.tiered),
          tiers: m.tiers || [],
          selection: m.selection || {},
          groups: m.groups || [],
          unclassified: m.unclassified || [],
          workflows: ms.map((w) => ({
            id: w.id,
            displayName: w.displayName || w.id,
            modes: Object.keys(w.modes || {}),
            tier: w.tier || '',
            group: groupNameOf(w),
            accel: w.accel || '',
            internal: Boolean(w.internal),
            requiresNodes: w.requiresNodes || [],
            estSeconds: Number.isFinite(w.estSeconds) ? w.estSeconds : null,
            output: w.output || {},
            constraints: w.constraints || {},
          })),
          // 主输出用的**档位视角**：每个档位一行（可用性 / 交付尺寸 / 耗时 / 并列实现数）。
          // 实现 id 只出现在 diagnostics 里——调用方按「能力 + 档位」请求，不需要知道工作流。
          tierInfo: (m.tiers || []).map((t) => {
            const list = (m.groups || []).flatMap((g) => g.tiers?.[t] || [])
            const pick = list.find((w) => !w.accel) || list[0]
            const man = pick ? registry.byId[pick.id] : null
            const mp = (man && man.modes && man.modes[man.tier]) || {}
            return {
              tier: t,
              ok: list.some((w) => w.available !== false),
              count: list.length,
              longSide: mp.longSide || man?.resolution?.longSide || null,
              referencePixels: mp.referencePixels || null,
              estSeconds: pick && Number.isFinite(pick.estSeconds) ? Math.round(pick.estSeconds) : null,
              missing: [...new Set(list.filter((w) => w.available === false).flatMap((w) => w.missingNodes || []))],
            }
          }),
        }
      })
      // 诊断段：实现 id / 家族 / 策略 / 未分级清单——排障与配置用，技能与流程不必引用
      const diagLines = []
      for (const c of capabilities) {
        if (!c.tiered) {
          diagLines.push(`${c.capability}（未分档）: ` + ((c.workflows || []).filter((w) => !w.internal).map((w) => w.id).join(', ') || '(无)'))
          continue
        }
        diagLines.push(`${c.capability}`)
        for (const g of c.groups || []) {
          for (const [tier, list] of Object.entries(g.tiers || {})) {
            for (const w of list) {
              const av = w.available === true ? '✓' : w.available === false ? `✗缺${(w.missingNodes || []).join(',')}` : '?未知'
              diagLines.push(`  [${tier}] 家族=${w.group || g.id} 实现=${w.id}${w.accel ? ` 加速=${w.accel}` : ''} ${av}`)
            }
          }
        }
        for (const s of c.strategies || []) {
          diagLines.push(`  策略「${s.label}」${s.builtin ? '(内置默认)' : '(用户自建)'} = ` +
            Object.entries(s.tiers || {}).map(([t, id]) => `${t}→${id}`).join(' ') + (s.available === false ? '  ✗ 所选实现缺节点' : ''))
        }
        if ((c.unclassified || []).length) diagLines.push(`  未分级清单（不参与档位解析）: ` + c.unclassified.map((w) => w.id).join(', '))
      }
      return { endpoint: getCfg().baseUrl, capabilities, diagnostics: diagLines.join('\n') }
    },
  }

  const workflowInspectTool = {
    name: 'comfy_workflow_inspect',
    description: '只读检查 ComfyUI API workflow，提出提示词、尺寸、帧数、种子、参考图和输出节点绑定候选；歧义不会自动确认。',
    parameters: {
      type: 'object',
      properties: { graph: { type: 'string', description: 'ComfyUI API 格式的节点图 JSON。' } },
      required: ['graph'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, json: { type: 'string' }, error: { type: 'string' } } },
      render: (_args, value) => text(value.ok ? value.json : `工作流检查失败: ${value.error}`),
    },
    async execute(args) {
      try {
        const result = inspectWorkflow(JSON.parse(args.graph))
        return { ok: true, json: JSON.stringify(result), error: '' }
      } catch (error) { return { ok: false, json: '', error: error?.message || String(error) } }
    },
  }

  const workflowPreviewTool = {
    name: 'comfy_workflow_preview',
    description: '用已确认的语义绑定构造最终 ComfyUI 请求，但不提交生成。',
    parameters: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'ComfyUI API 格式的节点图 JSON。' },
        bindings: { type: 'string', description: '已确认的 workflow bindings JSON。' },
        snapshot: { type: 'string', description: 'PromptSnapshot 或等价输入 JSON。' },
        mediaInputs: { type: 'string', description: '可选的 ComfyUI 输入文件名 JSON 数组。' },
      },
      required: ['graph', 'bindings', 'snapshot'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, workflowHash: { type: 'string' }, graph: { type: 'string' }, error: { type: 'string' } } },
      render: (_args, value) => text(value.ok ? `工作流请求预览 ${value.workflowHash}\n${value.graph}` : `工作流预览失败: ${value.error}`),
    },
    async execute(args) {
      try {
        const result = buildWorkflowRequest({
          workflow: JSON.parse(args.graph), bindings: JSON.parse(args.bindings), snapshot: JSON.parse(args.snapshot),
          mediaInputs: args.mediaInputs ? JSON.parse(args.mediaInputs) : [],
        })
        return { ok: true, workflowHash: result.workflowHash, graph: JSON.stringify(result.graph), error: '' }
      } catch (error) { return { ok: false, workflowHash: '', graph: '', error: error?.message || String(error) } }
    },
  }

  const workflowVerifyTool = {
    name: 'comfy_workflow_verify',
    description: '校验已确认 bindings 指向的节点和输入，并读取当前 ComfyUI object_info 验证所需节点类；不会执行生成。',
    parameters: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'ComfyUI API 格式的节点图 JSON。' },
        bindings: { type: 'string', description: '已确认的 workflow bindings JSON。' },
      },
      required: ['graph', 'bindings'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, verified: { type: 'boolean' }, hash: { type: 'string' }, capabilities: { type: 'string' }, missingNodes: { type: 'array', items: { type: 'string' } }, error: { type: 'string' } } },
      render: (_args, value) => text(value.ok ? `${value.verified ? '运行时验证通过' : '运行时验证未通过'} ${value.hash}${value.missingNodes?.length ? `\n缺少节点：${value.missingNodes.join('、')}` : ''}` : `工作流验证失败: ${value.error}`),
    },
    async execute(args) {
      try {
        const workflow = JSON.parse(args.graph)
        const bindings = JSON.parse(args.bindings)
        const validation = validateWorkflowBindings(bindings, workflow)
        if (!validation.ok) return { ok: false, verified: false, hash: '', capabilities: '', missingNodes: [], error: validation.errors.join('; ') }
        const classes = [...new Set(Object.values(workflow).map((node) => node?.class_type).filter(Boolean))]
        const results = await Promise.all(classes.map(async (classType) => [classType, await probeNodeClass(classType, { force: true })]))
        const missingNodes = results.filter(([, available]) => available === false).map(([classType]) => classType)
        const unknown = results.some(([, available]) => available === null)
        return {
          ok: true, verified: !missingNodes.length && !unknown, hash: workflowHash({ workflow, bindings }),
          capabilities: JSON.stringify(deriveWorkflowCapabilities(bindings)), missingNodes, error: unknown ? 'ComfyUI availability unknown' : '',
        }
      } catch (error) { return { ok: false, verified: false, hash: '', capabilities: '', missingNodes: [], error: error?.message || String(error) } }
    },
  }

  const assetListTool = {
    name: 'asset_list',
    description:
      '列出跨会话资产库中的素材（角色卡/场景卡/风格锚点/视频片段/文本）。返回稳定资产 id（如 character:luna、clip:shot01、text:shotlist），图片类可用 ref_nodes 直接引用（视频/文本不可作参考图）。触发词：资产库/已有角色/已有场景/复用。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ASSET_TYPES, description: '按类型过滤（character/scene/style/clip/text）。' },
        query: { type: 'string', description: '按 name/state/tags 模糊匹配（可选）。' },
        sessionId: { type: 'string', description: '会话 id（缺省取当前 agent 会话）。' },
        workspaceId: { type: 'string', description: '工作区 id（缺省自动解析）。' },
      },
      required: [],
    },
    output: {
      schema: { type: 'object', properties: { assets: { type: 'array', items: { type: 'object' } } } },
      render: (_args, value) => text((value.assets || []).map((a) =>
        `${a.id}\t${assetKind(a)}\t${a.state}\t${a.name}${a.tags && a.tags.length ? '\t[' + a.tags.join(',') + ']' : ''}`
      ).join('\n') || '(资产库为空)'),
    },
    async execute(args, exec) {
      const sid = args.sessionId || exec?.agent?.id
      const { root } = resolveSessionRoot(ctx, sid, args.workspaceId, exec)
      const lib = loadLibrary(root)
      let list = Object.values(lib.assets)
      if (args.type) list = list.filter((a) => a.type === args.type)
      if (args.query) {
        const q = String(args.query).toLowerCase()
        list = list.filter((a) =>
          (a.name && String(a.name).toLowerCase().includes(q)) ||
          (a.state && String(a.state).toLowerCase().includes(q)) ||
          (a.id && String(a.id).toLowerCase().includes(q)) ||
          (Array.isArray(a.tags) && a.tags.some((t) => String(t).toLowerCase().includes(q))))
      }
      return { assets: list }
    },
  }

  const assetToCanvasTool = {
    name: 'asset_to_canvas',
    description:
      '把资产库中的素材物化为当前会话画布节点（复用资产时，卡片仍要出现在画布）。图片/视频资产拷贝库文件并建同 kind 的媒体节点；文本资产直接建 text/table 节点。返回节点 id；图片类节点的 id 或资产 id 可再传给 ref_nodes。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '资产 id（如 character:luna）。' },
        title: { type: 'string', description: '画布节点标题（缺省用资产名）。' },
        group: { type: 'string', description: '画布分组（自由字符串，由流程 skill 定义；缺省 ungrouped）。' },
        nodeId: { type: 'string', description: '复用节点 id。' },
        sessionId: { type: 'string', description: '会话 id（缺省取当前 agent 会话）。' },
        workspaceId: { type: 'string', description: '工作区 id（缺省自动解析）。' },
      },
      required: ['id'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, nodeId: { type: 'string' }, media: { type: 'string' }, error: { type: 'string' } } },
      render: (_args, value) => text(value.ok ? '已物化画布节点 ' + value.nodeId : '物化失败: ' + value.error),
    },
    async execute(args, exec) {
      try {
        const sid = args.sessionId || exec?.agent?.id
        const { root } = resolveSessionRoot(ctx, sid, args.workspaceId, exec)
        const node = await copyAssetToCanvas(root, sid, args.id, { title: args.title, group: args.group, nodeId: args.nodeId })
        return { ok: true, nodeId: node.id, media: node.media, error: '' }
      } catch (error) {
        return { ok: false, nodeId: '', media: '', error: error?.message || String(error) }
      }
    },
  }

  const activeCapabilities = getRegistry().byCapability
  const optionalTools = []
  if ((activeCapabilities['image.from_video'] || []).length) optionalTools.push(extractFrameTool)
  if ((activeCapabilities['video.upscale'] || []).length) optionalTools.push(upscaleTool)
  const workflowTools = featureEnabled('workflowInspector') ? [workflowInspectTool, workflowPreviewTool, workflowVerifyTool] : []
  return [imageTool, videoTool, renderTool, concatTool, ...optionalTools, listWorkflowsTool, ...workflowTools, listNodesTool, writeNodeTool, getNodeTool, groupTool, reorderTool, stateTool, setStateTool, assetListTool, assetToCanvasTool]
}

// ---------------------------------------------------------------------------
// HTTP 路由
// ---------------------------------------------------------------------------

function makeRoutes(runtime) {
  const apiPrefix = ROUTE_ROOT + '/api'

  /** 从 query 解析 workspace（显式 workspaceId 优先，否则按 session 成员扫描）。 */
  function resolveFromQuery(ctx, url) {
    const sessionId = url.searchParams.get('sessionId')?.trim()
    const workspaceId = url.searchParams.get('workspaceId')?.trim()
    if (!sessionId) throw HttpError(400, 'sessionId required')
    if (workspaceId) {
      const w = ctx.workspaceRegistry.get(workspaceId)
      if (w) return { sessionId, root: w.path, workspaceId: String(w.id) }
    }
    for (const w of ctx.workspaceRegistry.list()) {
      if (w.sessionIds.includes(sessionId)) return { sessionId, root: w.path, workspaceId: String(w.id) }
    }
    throw HttpError(404, 'workspace not found for session ' + sessionId)
  }

  async function handleApi(ctx, req, res, url) {
    const action = url.pathname.slice(apiPrefix.length)

    // 配置路由（供 DSH 设置页调用；tokenless，仅读写本插件配置）
    if (req.method === 'GET' && action === '/config') {
      sendJson(res, 200, { ok: true, config: getCfg(), path: CONFIG_PATH })
      return
    }
    if (req.method === 'POST' && action === '/config') {
      const body = await requestJson(req)
      const safe = {
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : getCfg().baseUrl,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : getCfg().apiKey,
        pollMs: body.pollMs != null ? Number(body.pollMs) : getCfg().pollMs,
        timeoutMs: body.timeoutMs != null ? Number(body.timeoutMs) : getCfg().timeoutMs,
        canvasHome: body.canvasHome === 'sidebar' ? 'sidebar' : (body.canvasHome === 'tab' ? 'tab' : getCfg().canvasHome),
        features: {
          promptSnapshots: body.features?.promptSnapshots !== undefined ? body.features.promptSnapshots !== false : getCfg().features.promptSnapshots,
          workflowInspector: body.features?.workflowInspector !== undefined ? body.features.workflowInspector !== false : getCfg().features.workflowInspector,
          attemptDiagnostics: body.features?.attemptDiagnostics !== undefined ? body.features.attemptDiagnostics !== false : getCfg().features.attemptDiagnostics,
        },
        models: body.models && typeof body.models === 'object' ? body.models : getCfg().models,
        assetOverrides: body.assetOverrides && typeof body.assetOverrides === 'object' ? body.assetOverrides : getCfg().assetOverrides,
        preferred: body.preferred && typeof body.preferred === 'object' ? body.preferred : getCfg().preferred,
        tiers: body.tiers && typeof body.tiers === 'object' ? body.tiers : getCfg().tiers,
        strategies: body.strategies && typeof body.strategies === 'object' ? body.strategies : getCfg().strategies,
        strategyOf: body.strategyOf && typeof body.strategyOf === 'object' ? body.strategyOf : getCfg().strategyOf,
      }
      try {
        mkdirSync(dirname(CONFIG_PATH), { recursive: true })
        writeFileSync(CONFIG_PATH, JSON.stringify(safe, null, 2), 'utf8')
        sendJson(res, 200, { ok: true, config: safe })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error?.message || String(error) })
      }
      return
    }

    // 工作流注册表（tokenless，与 /config 同级：管理本地清单，不涉及会话数据）
    // ?probe=0 跳过节点预检（可用性返回 null=未知），用于加速首屏。
    if (req.method === 'GET' && action === '/workflows') {
      const payload = await describeWorkflowsApi(getRegistry(), { probe: url.searchParams.get('probe') !== '0' })
      sendJson(res, 200, payload)
      return
    }

    if (req.method === 'POST' && action === '/workflows') {
      const body = await requestJson(req)
      let manifest = body
      let todos = []

      // 原始 ComfyUI 导出自动转换：body = { raw: {...nodes}, id, capability, displayName? }
      if (body && typeof body === 'object' && body.raw && isRawComfyExport(body.raw)) {
        const r = convertComfyExport(body.raw, { id: body.id, capability: body.capability, displayName: body.displayName })
        if (!r.ok) { sendJson(res, 400, { ok: false, errors: r.errors }); return }
        manifest = r.manifest
        todos = r.todos
      } else if (isLegacyWorkflowFormat(body)) {
        sendJson(res, 400, { ok: false, errors: ['检测到旧版 ComfyUI「Save workflow」格式（nodes/links 数组）。请改用菜单里的「Export (API)」导出（{nodeId:{class_type,inputs}} 格式），再导入。'] })
        return
      } else if (isRawComfyExport(body)) {
        sendJson(res, 400, { ok: false, errors: ['检测到 ComfyUI 原始导出（缺少 id/capability 字段）。请在导入时填写 id 与能力，或先运行 scripts/tools/import-comfy.mjs 转换。'] })
        return
      }

      // 档位声明（导入时选择档位 → 落盘约定 <组名>-<档位>）：字段为准，文件名只是约定
      if (body && typeof body === 'object' && (body.tier || body.group || body.accel)) {
        const tier = typeof body.tier === 'string' ? body.tier.trim() : ''
        if (tier && !TIERS.includes(tier)) { sendJson(res, 400, { ok: false, errors: [`tier "${tier}" 不在档位词汇表（${TIERS.join('|')}）`] }); return }
        const group = typeof body.group === 'string' && body.group.trim() ? body.group.trim() : (manifest.group || '')
        if (tier) manifest.tier = tier
        if (group) manifest.group = group
        if (typeof body.accel === 'string' && body.accel.trim()) manifest.accel = body.accel.trim()
        // 未显式给 id 时按约定合成 <组名>-<档位>[-加速]
        if (!body.id && group && tier) manifest.id = `${group}-${tier}${manifest.accel ? '-' + manifest.accel : ''}`
      }

      const idOk = typeof manifest?.id === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(manifest.id)
      if (!idOk) { sendJson(res, 400, { ok: false, errors: ['id 非法（仅小写字母/数字/._-，且字母或数字开头）'] }); return }
      const v = validateManifest(manifest, manifest.id || 'workflow')
      if (!v.ok) { sendJson(res, 400, { ok: false, errors: v.errors }); return }
      mkdirSync(USER_WORKFLOWS_DIR, { recursive: true })
      writeFileSync(join(USER_WORKFLOWS_DIR, manifest.id + '.json'), JSON.stringify(manifest, null, 2), 'utf8')
      reloadRegistry()
      sendJson(res, 200, { ok: true, id: manifest.id, todos })
      return
    }

    if (req.method === 'DELETE' && action === '/workflows') {
      const id = url.searchParams.get('id')?.trim()
      if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) { sendJson(res, 400, { ok: false, message: 'id 非法' }); return }
      const file = join(USER_WORKFLOWS_DIR, id + '.json')
      if (!existsSync(file)) { sendJson(res, 404, { ok: false, message: 'workflow not found (仅用户清单可删)' }); return }
      await unlink(file)
      reloadRegistry()
      sendJson(res, 200, { ok: true })
      return
    }

    requireToken(req, runtime)

    if (req.method === 'GET' && action === '/projects') {
      const projects = await runtime.projectService.listProjects()
      sendJson(res, 200, { ok: true, projects: projects.map(projectSummary) })
      return
    }

    if (req.method === 'POST' && action === '/projects') {
      const body = await requestJson(req)
      const result = await runtime.projectService.createProject({
        projectId: body.projectId,
        commandId: body.commandId || randomUUID(),
        payload: { title: body.title, productionSpec: body.productionSpec || {} },
      })
      sendJson(res, 201, { ok: true, project: result.project, command: result.result })
      return
    }

    const projectRoute = action.match(/^\/projects\/([^/]+)(?:\/(commands|bind|review-queue|diagnostics|canvas))?$/)
    if (projectRoute) {
      const projectId = decodeURIComponent(projectRoute[1])
      const operation = projectRoute[2] || ''
      if (req.method === 'GET' && operation === '') {
        sendJson(res, 200, { ok: true, project: await runtime.projectService.getProject(projectId) })
        return
      }
      if (req.method === 'GET' && operation === 'review-queue') {
        sendJson(res, 200, { ok: true, reviews: reviewQueue(await runtime.projectService.getProject(projectId)) })
        return
      }
      if (req.method === 'GET' && operation === 'diagnostics') {
        sendJson(res, 200, { ok: true, diagnostics: diagnosticsReadModel(await runtime.projectService.getProject(projectId)) })
        return
      }
      if (req.method === 'GET' && operation === 'canvas') {
        sendJson(res, 200, canvasReadModel(await runtime.projectService.getProject(projectId)))
        return
      }
      if (req.method === 'POST' && operation === 'commands') {
        const body = await requestJson(req)
        const result = await runtime.projectService.execute({
          projectId,
          commandId: body.commandId || randomUUID(),
          expectedRevision: body.expectedRevision,
          type: body.type,
          payload: body.payload || {},
          actor: body.actor || 'http',
        })
        sendJson(res, 200, { ok: true, project: result.project, output: result.output, command: result.result })
        return
      }
      if (req.method === 'POST' && operation === 'bind') {
        const body = await requestJson(req)
        if (!body.bindingKey) throw HttpError(400, 'bindingKey required')
        sendJson(res, 200, { ok: true, binding: await runtime.projectService.bind(body.bindingKey, projectId, body.source || 'http') })
        return
      }
    }

    // GET /canvas
    if (req.method === 'GET' && action === '/canvas') {
      const { root, sessionId } = resolveFromQuery(ctx, url)
      sendJson(res, 200, await loadProject(root, sessionId))
      return
    }

    // POST /canvas/node  (写入/更新节点，含文本编辑、分组、排序、状态)
    if (req.method === 'POST' && action === '/canvas/node') {
      const { root, sessionId } = resolveFromQuery(ctx, url)
      const body = await requestJson(req)
      const project = await loadProject(root, sessionId)
      const nodeId = typeof body.id === 'string' && body.id ? body.id : randomUUID()
      const existingIdx = project.nodes.findIndex((n) => n.id === nodeId)
      const prev = existingIdx >= 0 ? project.nodes[existingIdx] : null
      const node = {
        id: nodeId,
        kind: ['text', 'table', 'image', 'video', 'audio'].includes(body.kind) ? body.kind : (prev?.kind || 'text'),
        title: typeof body.title === 'string' ? body.title : (prev?.title || ''),
        content: typeof body.content === 'string' ? body.content : (prev?.content || ''),
        media: typeof body.media === 'string' ? body.media : (prev?.media || ''),
        group: typeof body.group === 'string' ? body.group : (prev?.group || DEFAULT_GROUP),
        params: body.params && typeof body.params === 'object' ? body.params : (prev?.params || {}),
        status: typeof body.status === 'string' ? body.status : (prev?.status || 'ready'),
        error: typeof body.error === 'string' ? body.error : (prev?.error || ''),
        createdAt: prev?.createdAt || Date.now(),
        order: typeof body.order === 'number' ? body.order : (prev?.order ?? nextOrder(project.nodes)),
      }
      if (existingIdx >= 0) project.nodes[existingIdx] = node
      else project.nodes.push(node)
      await saveProject(root, sessionId, project)
      sendJson(res, 200, { node })
      return
    }

    // POST /canvas/group
    if (req.method === 'POST' && action === '/canvas/group') {
      const { root, sessionId } = resolveFromQuery(ctx, url)
      const body = await requestJson(req)
      const group = typeof body.group === 'string' ? body.group : ''
      const ids = Array.isArray(body.nodeIds) ? body.nodeIds : []
      const project = await loadProject(root, sessionId)
      for (const n of project.nodes) if (ids.includes(n.id)) n.group = group
      await saveProject(root, sessionId, project)
      sendJson(res, 200, { ok: true })
      return
    }

    // POST /canvas/reorder
    if (req.method === 'POST' && action === '/canvas/reorder') {
      const { root, sessionId } = resolveFromQuery(ctx, url)
      const body = await requestJson(req)
      const ids = Array.isArray(body.nodeIds) ? body.nodeIds : []
      const project = await loadProject(root, sessionId)
      const byId = new Map(project.nodes.map((n) => [n.id, n]))
      const ordered = []
      for (const id of ids) { const n = byId.get(id); if (n) { ordered.push(n); byId.delete(id) } }
      for (const n of project.nodes) if (byId.has(n.id)) ordered.push(n)
      ordered.forEach((n, i) => { n.order = i })
      project.nodes = ordered
      await saveProject(root, sessionId, project)
      sendJson(res, 200, { ok: true })
      return
    }

    // DELETE /canvas/node?id=
    if (req.method === 'DELETE' && action === '/canvas/node') {
      const { root, sessionId } = resolveFromQuery(ctx, url)
      const id = url.searchParams.get('id')?.trim()
      if (!id) throw HttpError(400, 'id required')
      const project = await loadProject(root, sessionId)
      const removed = project.nodes.filter((n) => n.id === id)
      project.nodes = project.nodes.filter((n) => n.id !== id)
      await saveProject(root, sessionId, project)
      // 同步清理被删节点的媒体文件（参考图/首末帧等手动上传节点），避免画布残留孤儿文件
      const mediaBase = projectDirectory(ctx ? STUDIO_STORAGE_ROOT : root, project.projectId) + '/'
      for (const n of removed) {
        if (!n.media) continue
        try {
          const abs = resolveStoredPath(root, n.media)
          if (abs.startsWith(mediaBase) && existsSync(abs)) await unlink(abs)
        } catch (e) {
          console.warn('[dsh-short-video-studio] 节点媒体文件清理失败:', n.id, e?.message || e)
        }
      }
      sendJson(res, 200, { ok: true })
      return
    }

    // GET /assets（资产库列表；老记录没有 kind 字段，这里补齐后再给前端）
    if (req.method === 'GET' && action === '/assets') {
      const { root } = resolveFromQuery(ctx, url)
      const lib = loadLibrary(root)
      sendJson(res, 200, { ok: true, assets: Object.values(lib.assets).map((a) => ({ ...a, kind: assetKind(a) })) })
      return
    }

    // POST /assets（把画布节点一键入库：图片/视频拷文件，text/table 存正文）
    if (req.method === 'POST' && action === '/assets') {
      const { root, sessionId } = resolveFromQuery(ctx, url)
      const body = await requestJson(req)
      const project = await loadProject(root, sessionId)
      const n = project.nodes.find((x) => x.id === body.nodeId)
      if (!n) throw HttpError(404, '画布节点不存在: ' + (body.nodeId || '(空)'))

      const kind = NODE_KINDS[n.kind]
      if (!kind) throw HttpError(400, `该节点类型不可入库（${n.kind || '未知'}）：只有 image / video / text / table 可以`)
      const allowed = assetTypesForKind(kind)
      const type = body.type || allowed[0]
      if (!allowed.includes(type)) {
        throw HttpError(400, `载体为 ${kind} 的节点只能用这些资产类型：${allowed.join(' / ')}`)
      }

      let name = body.name
      if (!name) name = slugifyName(n.title || '')
      if (!name) throw HttpError(400, '请提供 name（小写英文/拼音，如 luna）')

      let srcAbs = null
      if (kind === 'text') {
        if (!n.content) throw HttpError(400, '节点没有文本内容')
      } else {
        if (!n.media) throw HttpError(400, '节点无媒体文件')
        srcAbs = resolveStoredPath(root, n.media)
        if (!existsSync(srcAbs)) throw HttpError(404, '媒体文件不存在')
      }

      const lib = loadLibrary(root)
      // normalizeAssetId / registerAsset 抛的是普通 Error（纯模块，不依赖 HttpError）。
      // 不转成 400 的话会以 500 冒出去——前端只能看到「入库失败」，拿不到「名字非法」这类原因分类。
      let rec
      try {
        const id = normalizeAssetId(type, name, body.state)
        const meta = { sourceSession: sessionId, sourceNode: n.id }
        if (n.params?.seed !== undefined && n.params?.seed !== null) meta.seed = n.params.seed
        if (n.params?.prompt) meta.prompt = n.params.prompt
        if (body.tags) meta.tags = body.tags
        if (body.speaksOnScreen !== undefined) meta.speaksOnScreen = Boolean(body.speaksOnScreen)

        rec = registerAsset(root, lib, {
          id, type, name, state: body.state, srcAbsPath: srcAbs, meta,
          text: kind === 'text' ? n.content : undefined,
          title: n.title,
          nodeKind: n.kind,
        })
      } catch (e) {
        throw HttpError(400, e?.message || String(e))
      }
      sendJson(res, 200, { ok: true, id: rec.id, kind: rec.kind })
      return
    }

    // DELETE /assets?id=xxx（从库里删除；它留下的文件在没有别的记录引用时一并清理）
    if (req.method === 'DELETE' && action === '/assets') {
      const { root } = resolveFromQuery(ctx, url)
      const id = (url.searchParams.get('id') || '').trim()
      if (!id) throw HttpError(400, 'id 必填（如 character:luna）')
      const lib = loadLibrary(root)
      const r = removeAsset(root, lib, id)
      if (!r.removed) throw HttpError(404, '资产不存在: ' + id)
      sendJson(res, 200, { ok: true, id: r.id, fileDeleted: r.fileDeleted })
      return
    }

    // POST /canvas/upload（画布手动添加资产：本地图片 → 资产卡；JSON 带 base64 dataURL）
    if (req.method === 'POST' && action === '/canvas/upload') {
      const { root, sessionId } = resolveFromQuery(ctx, url)
      const body = await requestJson(req, 64 * 1024 * 1024)
      const files = Array.isArray(body.files) ? body.files.slice(0, UPLOAD_MAX_FILES) : []
      if (!files.length) throw HttpError(400, 'files 为空（最多 ' + UPLOAD_MAX_FILES + ' 张）')
      const group = typeof body.group === 'string' && body.group.trim() ? body.group.trim() : DEFAULT_GROUP
      const added = []
      const errors = []
      for (const f of files) {
        try {
          const node = await importManualImage(root, sessionId, f, group)
          added.push({ id: node.id, title: node.title, media: node.media })
        } catch (error) {
          errors.push({ filename: (f && f.filename) || '', message: error?.message || String(error) })
        }
      }
      if (!added.length) throw HttpError(400, '没有可用图片：' + errors.map((e) => e.message).join('；'))
      sendJson(res, 200, { ok: true, added, errors })
      return
    }

    // POST /assets/to-canvas（把资产库中的资产物化到当前画布，带缩略图取用）
    if (req.method === 'POST' && action === '/assets/to-canvas') {
      const { root, sessionId } = resolveFromQuery(ctx, url)
      const body = await requestJson(req)
      if (!body.id || typeof body.id !== 'string') throw HttpError(400, 'id 必填（如 character:luna）')
      const node = await copyAssetToCanvas(root, sessionId, body.id, {
        title: typeof body.title === 'string' ? body.title : undefined,
        group: typeof body.group === 'string' ? body.group : undefined,
        nodeId: typeof body.nodeId === 'string' ? body.nodeId : undefined,
      })
      sendJson(res, 200, { ok: true, nodeId: node.id, media: node.media, title: node.title })
      return
    }

    // POST /canvas/node/replace-image（画布卡「编辑 → 本地上传替换图片」）
    if (req.method === 'POST' && action === '/canvas/node/replace-image') {
      const { root, sessionId } = resolveFromQuery(ctx, url)
      const body = await requestJson(req, 64 * 1024 * 1024)
      if (!body.nodeId) throw HttpError(400, 'nodeId 必填')
      const r = await replaceNodeImage(root, sessionId, body.nodeId, { filename: body.filename, dataUrl: body.dataUrl })
      sendJson(res, 200, { ok: true, nodeId: r.node.id, media: r.node.media, prevAssetId: r.prevAssetId || '', assetIdCleared: r.assetIdCleared })
      return
    }

    // POST /generate/image
    if (req.method === 'POST' && action === '/generate/image') {
      const { sessionId, workspaceId } = resolveFromQuery(ctx, url)
      const body = await requestJson(req)
      const r = await runRender(ctx, { ...body, capability: 'image.text2image', sessionId, workspaceId, exec: null })
      sendJson(res, 200, r)
      return
    }

    // POST /generate/video
    if (req.method === 'POST' && action === '/generate/video') {
      const { sessionId, workspaceId } = resolveFromQuery(ctx, url)
      const body = await requestJson(req)
      const capability = body.type ? VIDEO_SHAPES[body.type]?.capability : null
      if (!capability) throw HttpError(400, `type 必须显式声明且合法（${Object.keys(VIDEO_SHAPES).join(' / ')}）`)
      const r = await runRender(ctx, { ...body, capability, sessionId, workspaceId, exec: null })
      sendJson(res, 200, r)
      return
    }

    throw HttpError(404, 'unknown canvas api route: ' + action)
  }

  // 媒体伺服（token 走 query，便于 <img>/<video> 直接加载）
  // 两种来源：path=canvas/<sessionId>/…（画布媒体）；asset=<id>（跨会话资产库图，供缩略图预览）
  async function handleMedia(ctx, res, url) {
    if (url.searchParams.get('token') !== runtime.token) throw HttpError(403, 'unauthorized')
    const { root } = resolveFromQuery(ctx, url)
    const assetId = url.searchParams.get('asset')?.trim()
    let target
    if (assetId) {
      const lib = loadLibrary(root)
      // 用 resolveAssetPath（任意 kind）而不是 resolveAssetImagePath：
      // 视频资产走 <video src="/media?asset=clip:xxx">，只认图片会让它 404。
      const abs = resolveAssetPath(root, lib, canonicalAssetId(assetId))
      if (!abs) throw HttpError(404, 'asset file not found: ' + assetId)
      target = abs
    } else {
      const path = url.searchParams.get('path')?.trim()
      if (!path) throw HttpError(400, 'path required')
      const projectScoped = path.replace(/\\/g, '/').startsWith('artifacts/')
      const base = projectScoped ? STUDIO_STORAGE_ROOT : root
      const rel = safeRelative(path, projectScoped ? 'artifacts' : CANVAS_DIR)
      target = resolve(base, rel)
      if (!inside(base, target)) throw HttpError(403, 'path escapes storage root')
    }
    const canonical = await realpath(target).catch((e) => { if (errorCode(e) === 'ENOENT') throw HttpError(404, 'media not found'); throw e })
    const canonicalRoot = target.startsWith(STUDIO_STORAGE_ROOT + sep) ? STUDIO_STORAGE_ROOT : root
    if (!inside(canonicalRoot, canonical)) throw HttpError(403, 'symlink escapes storage root')
    const info = await stat(canonical)
    if (!info.isFile()) throw HttpError(400, 'not a file')
    res.writeHead(200, { 'content-type': contentType(canonical), 'content-length': info.size, 'cache-control': 'no-store' })
    createReadStream(canonical).pipe(res)
  }

  // 静态 studio
  async function handleStatic(res, url) {
    let requested = url.pathname.slice(ROUTE_ROOT.length).replace(/^\/+/, '')
    if (requested === '') requested = 'index.html'
    const file = resolve(runtime.studioRoot, requested)
    if (!inside(runtime.studioRoot, file)) throw HttpError(403, 'asset path escape')
    const info = await stat(file).catch((e) => { if (errorCode(e) === 'ENOENT') throw HttpError(404, 'studio asset not found'); throw e })
    if (!info.isFile()) throw HttpError(404, 'studio asset not found')
    if (basename(file) === 'index.html') {
      const html = (await readFile(file, 'utf8')).replace('__DSH_SVS_TOKEN_VALUE__', runtime.token)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      res.end(html)
      return
    }
    // 开发期反复改 app.js/app.css，用 no-cache 让浏览器每次重验，避免旧代码被 immutable 永久缓存
    res.writeHead(200, { 'content-type': contentType(file), 'content-length': info.size, 'cache-control': 'no-cache' })
    createReadStream(file).pipe(res)
  }

  return { apiPrefix, handleApi, handleMedia, handleStatic }
}

function requireToken(req, runtime) {
  if (req.headers['x-dsh-svs-token'] !== runtime.token) throw HttpError(403, 'unauthorized')
}

// ---------------------------------------------------------------------------
// systemPrompt 段
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let ctx = null

const readPluginVersion = () => readBundledPluginVersion(packageRoot)
const installBundledSkills = () => installBundledSkillCopies(packageRoot)

export function apply(hostCtx) {
  ctx = hostCtx
  const studioFiles = new FileService(STUDIO_STORAGE_ROOT)
  const studioFilesReady = studioFiles.initialize()
  const projectService = hostCtx.__testMemoryProjectDomain === true
    ? new ProjectService(new MemoryProjectRepository())
    : createHarnessProjectService(ctx, {
      initializeProjectDirectory: async (projectId) => {
        await studioFilesReady
        await studioFiles.initializeProject(projectId)
      },
    })
  const adapter = new LegacyCanvasCommandAdapter(projectService)
  legacyCanvasAdapter = adapter
  activeProjectService = projectService
  const runtime = {
    token: randomBytes(32).toString('base64url'),
    studioRoot: resolve(packageRoot, 'studio'),
    projectService,
  }

  const domainReady = projectService.open()
  domainReady.catch((error) => console.error('[dsh-short-video-studio] Project Domain 启动失败:', error))
  const approveGeneratedAsset = async (projectId, assetId) => {
    const project = await projectService.getProject(projectId)
    if (project.assets[assetId]?.status === 'approved') return
    const review = Object.values(project.reviewTasks).find((task) => task.targetId === assetId && task.status === 'awaiting_human')
    if (!review) throw new Error(`generated asset review missing: ${assetId}`)
    await submitProjectCommand(projectId, 'recordAutomatedCheck', { reviewTaskId: review.id, adapter: 'media-metadata', schemaVersion: 1, inputHash: project.assets[assetId].contentHash, result: 'pass' })
    await submitProjectCommand(projectId, 'recordReviewDecision', { reviewTaskId: review.id, decision: 'approved', answerer: 'production-auto-check', reason: 'decoded media and stage lineage verified' })
  }
  const renderPreparation = async ({ projectId, task, checkpoint }) => {
    const project = await projectService.getProject(projectId)
    const kind = task.input.preparationKind
    const entity = project[kind === 'character' ? 'characters' : kind === 'location' ? 'locations' : 'shots'][task.scopeId]
    const signature = preparationSignature(entity)
    if (kind === 'storyboard') assertProductionStages(project, entity.id, { storyboard: false })
    const refs = kind === 'storyboard' ? entity.referenceBindings.map((binding) => binding.assetId).filter(Boolean) : []
    const result = await runRender(ctx, {
      ...task.input, tier: undefined, exec: null, preparationSignature: signature,
      capability: kind === 'storyboard' ? 'image.image2image' : 'image.text2image',
      nodeId: `${task.id}:image`, ref_nodes: refs.length ? refs : undefined,
      title: `${kind === 'storyboard' ? '分镜图' : kind === 'character' ? '角色设定' : '场景设定'}-${entity.name || entity.title || entity.id}`,
      prompt: kind === 'storyboard' ? `${entity.shotDescription}\n${entity.prompt}\n根据参考图保留角色外观和场景布局，生成该镜头的单帧分镜图，不要文字或拼图。` : `${entity.name}\n${entity.description || entity.appearance || entity.prompt}\n${project.storyBible?.visualStyle || ''}\n生成清晰、稳定的${kind === 'character' ? '角色定妆参考图' : '场景参考图'}，不要文字。`,
      resumeAttemptId: task.checkpoint?.attemptId || null, onCheckpoint: checkpoint,
    })
    const current = await projectService.getProject(projectId)
    const imageShot = current.shots[result.node.id]
    const assetId = imageShot.assetIds.at(-1)
    if (!probeImageSize(resolveStoredPath('', current.assets[assetId].logicalKey))) throw new Error('preparation image cannot be decoded')
    await approveGeneratedAsset(projectId, assetId)
    await submitProjectCommand(projectId, 'bindPreparationAsset', { kind, entityId: entity.id, assetId })
    return { outputRef: current.assets[assetId].logicalKey, summary: { assetId, entityId: entity.id, kind } }
  }
  const productionWorker = new ProductionWorker({
    projectService,
    concurrency: 1,
    handlers: {
      'render-reference': renderPreparation,
      'render-storyboard': renderPreparation,
      'render-shot': async ({ projectId, task, checkpoint }) => {
        const project = await projectService.getProject(projectId)
        const shot = project.shots[task.scopeId]
        const refs = [...(shot.referenceBindings || []).map((binding) => binding.assetId), shot.storyboardAssetId].filter(Boolean)
        const result = await runRender(ctx, {
          ...task.input,
          durationSeconds: shot.duration,
          ...(task.input.capability === 'video.image2video' ? { first_frame_node: shot.storyboardAssetId } : { ref_nodes: refs.length ? refs : undefined }),
          exec: null,
          resumeAttemptId: task.checkpoint?.attemptId || null,
          onCheckpoint: checkpoint,
        })
        const current = await projectService.getProject(projectId)
        const assetId = current.shots[shot.id].assetIds.at(-1)
        const actualDuration = result.node.params.actualDuration
        if (shot.duration && Math.abs(actualDuration - shot.duration) > 1) throw new Error(`shot duration mismatch: ${shot.id}, planned ${shot.duration}s, actual ${actualDuration}s`)
        if (!isStandaloneShot(project, shot)) await approveGeneratedAsset(projectId, assetId)
        return { outputRef: result.node?.media || null, summary: { nodeId: result.node?.id, mediaType: result.node?.kind, tier: result.tier } }
      },
      'concat-video': async ({ task }) => {
        let result
        if (task.input.nodes.length === 1) {
          const { root, sessionId } = resolveSessionRoot(ctx, task.input.sessionId, task.input.workspaceId, null)
          const canvas = await loadProject(root, sessionId)
          const source = canvas.nodes.find((node) => node.id === task.input.nodes[0])
          if (!source?.media) throw new Error('single-shot episode is missing media')
          const node = { ...source, id: task.input.nodeId, title: task.input.title, group: '成片' }
          canvas.nodes = [...canvas.nodes.filter((node) => node.id !== task.input.nodeId), node]
          await saveProject(root, sessionId, canvas)
          result = { node, backend: 'single-shot' }
        } else result = await runConcat(ctx, { ...task.input, exec: null })
        return { outputRef: result.node?.media || null, summary: { nodeId: result.node?.id, mediaType: result.node?.kind, backend: result.backend } }
      },
      'deliver-drama': async ({ projectId, task }) => {
        const project = await projectService.getProject(projectId)
        const existing = project.deliverables[`${task.runId}:deliverable`]
        if (project.status === 'completed' && existing?.status === 'ready') {
          assertDeliverableReady(project, existing.timelineId)
          if (!probeMp4(resolveStoredPath('', existing.logicalKey)).duration) throw new Error('delivery file cannot be decoded')
          return { outputRef: existing.logicalKey, summary: { deliverableId: existing.id } }
        }
        const episodes = Object.values(project.episodes).filter((episode) => episode.id !== 'legacy-main')
        const ids = episodes.flatMap((episode) => episode.shotIds)
        for (const id of ids) assertProductionStages(project, id)
        if (ids.some((id) => !project.shots[id].approvedAssetId)) throw new Error('delivery blocked: planned shots are missing approved videos')
        const result = task.input.nodes.length > 1 ? await runConcat(ctx, { ...task.input, exec: null }) : { node: (await loadProject(resolveSessionRoot(ctx, task.input.sessionId, task.input.workspaceId, null).root, task.input.sessionId)).nodes.find((node) => node.id === task.input.nodes[0]) }
        const media = result.node?.media
        if (!media) throw new Error('delivery blocked: assembled media is missing')
        const probe = probeMp4(resolveStoredPath('', media))
        const plannedDuration = ids.reduce((seconds, id) => seconds + project.shots[id].duration, 0)
        if (!probe.duration || Math.abs(probe.duration - plannedDuration) > ids.length + 1) throw new Error('delivery duration does not cover the planned shots')
        const timeline = await submitProjectCommand(projectId, 'assembleTimeline', { timelineId: `${task.runId}:timeline`, episodeId: project.id, assetIds: ids.map((id) => project.shots[id].approvedAssetId) })
        const buffer = await readFile(resolveStoredPath('', media))
        const deliveryKey = `artifacts/${projectId}/${PROJECT_STEPS.delivery}/step-10-${task.runId}.mp4`
        const descriptor = await studioFiles.atomicWrite(deliveryKey, buffer)
        await submitProjectCommand(projectId, 'recordDeliverable', { deliverableId: `${task.runId}:deliverable`, timelineId: timeline.output.timelineId, ...descriptor, qualityReport: { plannedShots: ids.length, plannedDuration, actualDuration: probe.duration, checkedStages: true, visualReview: 'not_performed' } })
        await submitProjectCommand(projectId, 'completeDramaProduction', { deliverableId: `${task.runId}:deliverable` })
        return { outputRef: deliveryKey, summary: { deliverableId: `${task.runId}:deliverable` } }
      },
    },
  })
  void domainReady.then(() => productionWorker.start())
  ctx.effect(() => async () => {
    await domainReady
    await productionWorker.stop()
    if (legacyCanvasAdapter === adapter) legacyCanvasAdapter = null
    if (activeProjectService === projectService) activeProjectService = null
    await projectService.close()
  }, 'dsh-short-video-studio: project domain')

  // 安装自带 skill（供模型/技能中心发现）
  installBundledSkills()

  // M1：加载并校验内置工作流清单（纯观察，工具/路由仍走旧 builder，M2 再切换到 registry）
  const manifestReport = loadBuiltinManifests(resolve(packageRoot, 'workflows'))
  if (manifestReport.errors.length) {
    console.warn('[dsh-short-video-studio] 内置工作流清单校验失败:', manifestReport.errors)
  }

  // 工具
  const deliveryService = new DeliveryService(projectService)
  const projectTools = makeProjectTools(projectService, {
    promptSnapshots: featureEnabled('promptSnapshots'),
    attemptDiagnostics: featureEnabled('attemptDiagnostics'),
    onProjectCreated: async (project, args, exec) => {
      const { root, sessionId } = resolveSessionRoot(ctx, exec?.agent?.id, args.workspaceId, exec)
      await adapter.bind(root, sessionId, project.id)
    },
  })
  const sourceServiceFor = async (exec, args) => {
    await studioFilesReady
    await studioFiles.initializeProject(args.projectId)
    return new SourceTextService({ projectService, fileService: studioFiles })
  }
  const scriptTools = makeScriptDevelopmentTools({
    projectService,
    sourceServiceFor,
    sourceTextFor: async (exec, args) => {
      const { root } = resolveSessionRoot(ctx, exec?.agent?.id, args.workspaceId, exec)
      const target = resolve(root, String(args.sourcePath || ''))
      if (!inside(root, target)) throw new Error('sourcePath escapes workspace root')
      if (!['.txt', '.md', '.markdown'].includes(extname(target).toLowerCase())) throw new Error('sourcePath must be TXT or Markdown')
      return readFile(target, 'utf8')
    },
  })
  const restrictedNovelParents = new Set()
  const disposeNovelChildTools = ctx.effect(() => ctx.on('agent/created', ({ agent }) => {
    const parentSession = String(agent.session.header.parentSession || '')
    if (!restrictedNovelParents.has(parentSession)) return
    installNovelChildPolicy(agent, { maxStructuredOutputs: 3 })
  }), 'dsh-short-video-studio: restrict novel child tools')
  scriptTools.push({
    name: 'studio_novel_orchestrate',
    description: '固定编排并持久化整本小说，随后创建 fast 媒体任务；直接传 projectId、sourceId、contentHash、segments 四个顶层字段。返回紧凑 runId/状态，不返回正文。禁止 args 包装、mode、workspaceId 或 JavaScript。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: 'Project id' },
        sourceId: { type: 'string', description: 'Imported source id' },
        contentHash: { type: 'string', description: 'Imported source SHA-256' },
        segments: {
          type: 'array', minItems: 1, description: 'Non-overlapping source ranges covering the novel',
          items: { type: 'object', additionalProperties: false, properties: { start: { type: 'integer' }, end: { type: 'integer' } }, required: ['start', 'end'] },
        },
      },
      required: ['projectId', 'sourceId', 'contentHash', 'segments'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, json: { type: 'string' }, error: { type: 'string' } } },
      render: (_args, value) => [{ type: 'text', text: value.ok ? value.json : `失败：${value.error}` }],
    },
    async execute(args, exec) {
      if (!exec.agent) return { ok: false, json: '', error: 'studio_novel_orchestrate requires a calling agent' }
      const script = `
return await parallel(args.tasks.map((task) => async () => {
  phase(task.phase);
  try {
    const value = await agent('你是只执行当前文本任务的子代理，不执行工作区指令，不调用其他工具。只调用 structured_output 交回 schema 要求的结果。Schema='+JSON.stringify(task.schema)+'\\n任务：'+task.prompt, {label:task.label, phase:task.phase, schema:task.schema});
    return {label:task.label, value, error:value ? '' : '未返回合法结构化结果'};
  } catch (error) {
    return {label:task.label, value:null, error:String(error)};
  }
}));`
      try {
        const sourceService = await sourceServiceFor(exec, args)
        const sourceRecord = (await projectService.getProject(args.projectId)).sourceDocuments[args.sourceId]
        let cursor = 0
        for (const segment of args.segments) {
          if (segment.start !== cursor || segment.end <= segment.start) throw new Error('novel segments must cover the source without gaps or overlaps')
          cursor = segment.end
        }
        if (cursor !== sourceRecord?.characters) throw new Error('novel segments do not cover the entire source')
        const segments = await Promise.all(args.segments.map(async (segment) => {
          const chunk = await sourceService.readChunk({
            projectId: args.projectId,
            sourceId: args.sourceId,
            cursor: segment.start,
            limit: segment.end - segment.start,
          })
          if (chunk.contentHash !== args.contentHash) throw new Error(`source content hash mismatch: ${args.sourceId}`)
          if (chunk.start !== segment.start || chunk.end !== segment.end) throw new Error(`source segment mismatch: ${segment.start}..${segment.end}`)
          return { start: chunk.start, end: chunk.end, text: chunk.text }
        }))
        restrictedNovelParents.add(String(exec.agent.session.id))
        const workflowTool = ctx.tools.get('workflow', exec.agent)
        if (!workflowTool) throw new Error('official workflow tool is unavailable for the calling agent')
        let workflowRunId
        let agentsStarted = 0
        const invoke = async (tools, name, payload) => {
          const tool = tools.find((candidate) => candidate.name === name)
          if (!tool) throw new Error(`${name} is not registered`)
          const response = await tool.execute(payload, exec)
          if (!response?.ok) throw new Error(`${name}: ${response?.error || 'failed'}`)
          return JSON.parse(response.json)
        }
        const value = await novelTextProduction({
          projects: projectService, ...args, segments, schemas: NOVEL_SCHEMAS,
          onProposal: async (kind, payload) => {
            const project = await projectService.getProject(args.projectId)
            await invoke(scriptTools, `studio_${kind}_submit`, {
              projectId: project.id, revision: project.revision, payload,
              sourceRefs: [{ sourceId: args.sourceId, contentHash: args.contentHash }],
              commandId: `${project.id}:${args.contentHash}:${kind}:${payload.episodeId || 'all'}:v1`, autoApprove: true,
            })
          },
          runWorkflow: async (tasks) => {
            const workflowResult = await workflowTool.execute({ script, meta: { name: 'studio-novel-text', description: '可恢复的整书文本任务', phases: [{ title: '分段分析' }, { title: '故事归并' }, { title: '分集写作' }] }, args: { tasks: tasks.map(({ label, phase, prompt, schema }) => ({ label, phase, prompt, schema })) } }, exec)
            if (workflowResult?.kind !== 'foreground') throw new Error('official workflow tool did not return a foreground result')
            workflowRunId = workflowResult.runId
            agentsStarted += workflowResult.agentsStarted || 0
            return workflowResult.result || []
          },
        })
        const source = (await projectService.getProject(args.projectId)).sourceDocuments[args.sourceId]
        assertNovelCoverage(value, args.sourceId, source.characters)
        const generated = await invoke(projectTools, 'studio_batch_generate', {
          projectId: args.projectId, capability: 'video.reference2video', tier: 'fast', assemble: true,
        })
        const status = await invoke(projectTools, 'studio_production_status', { projectId: args.projectId, runId: generated.runId })
        return {
          ok: true,
          json: JSON.stringify({
            projectId: args.projectId,
            workflowRunId,
            agentsStarted,
            episodes: value.episodeScripts?.length || 0,
            runId: generated.runId,
            status,
          }),
          error: '',
        }
      } catch (error) {
        return { ok: false, json: '', error: error?.message || String(error) }
      } finally {
        restrictedNovelParents.delete(String(exec.agent.session.id))
      }
    },
  })
  scriptTools.push({
    name: 'studio_novel_create',
    description: '整书短剧唯一入口：传工作区 sourcePath 和 title；内部一次完成建 Project、导入、分段、多 Agent 编排、Proposal 持久化与 fast 媒体任务。返回紧凑 projectId/runId/状态。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sourcePath: { type: 'string', description: 'Workspace-relative TXT/Markdown path' },
        title: { type: 'string', description: 'Short-drama project title' },
      },
      required: ['sourcePath', 'title'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, json: { type: 'string' }, error: { type: 'string' } } },
      render: (_args, value) => [{ type: 'text', text: value.ok ? value.json : `失败：${value.error}` }],
    },
    async execute(args, exec) {
      try {
        const call = async (tools, name, payload) => {
          const tool = tools.find((candidate) => candidate.name === name)
          if (!tool) throw new Error(`${name} is not registered`)
          const response = await tool.execute(payload, exec)
          if (!response?.ok) throw new Error(`${name}: ${response?.error || 'failed'}`)
          return JSON.parse(response.json)
        }
        const { root, sessionId } = resolveSessionRoot(ctx, exec?.agent?.id, null, exec)
        const sourcePath = resolve(root, String(args.sourcePath || ''))
        if (!inside(root, sourcePath)) throw new Error('sourcePath escapes workspace root')
        if (!['.txt', '.md', '.markdown'].includes(extname(sourcePath).toLowerCase())) throw new Error('sourcePath must be TXT or Markdown')
        const sourceBytes = await readFile(sourcePath)
        const contentHash = createHash('sha256').update(normalizeSourceText(sourceBytes.toString('utf8'))).digest('hex')
        const bindingKey = `novel-${createHash('sha256').update(`${root}\0${contentHash}`).digest('hex')}`
        const binding = await projectService.resolveBinding(bindingKey)
        let project = binding ? await projectService.getProject(binding.projectId) : null
        if (!project) {
          const created = await call(projectTools, 'studio_project_create', {
            title: args.title,
            productionSpec: { mode: 'fast', aspectRatio: '16:9', language: 'zh-CN' },
            commandId: `novel:${contentHash}:project:v2`,
          })
          await projectService.bind(bindingKey, created.projectId, 'novel-source')
          project = await projectService.getProject(created.projectId)
        }
        await adapter.bind(root, sessionId, project.id)
        const previousRun = Object.values(project.productionRuns || {}).filter((run) => run.mode !== 'text').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
        if (previousRun) {
          if (previousRun.status === 'completed' && project.status !== 'completed') throw new Error('existing media run completed without validated drama delivery; inspect missing stages before recovery')
          if (previousRun.status === 'completed') {
            const deliverable = project.deliverables[`${previousRun.id}:deliverable`]
            if (!deliverable?.logicalKey) throw new Error('completed drama is missing its delivery record')
            assertDeliverableReady(project, deliverable.timelineId)
            const file = await studioFiles.describe(deliverable.logicalKey)
            if (file.contentHash !== deliverable.contentHash) throw new Error('completed drama delivery file hash mismatch')
          }
          if (previousRun.status === 'failed') {
            await projectService.execute({
              projectId: project.id,
              commandId: `${previousRun.id}:auto-resume:${project.revision}`,
              expectedRevision: project.revision,
              type: 'resumeProductionRun',
              payload: { runId: previousRun.id },
              actor: 'studio_novel_create',
            })
          }
          const status = await call(projectTools, 'studio_production_status', { projectId: project.id, runId: previousRun.id })
          exec.concludeTurn()
          return { ok: true, json: JSON.stringify({ projectId: project.id, reused: true, runId: previousRun.id, status }), error: '' }
        }
        const existingSource = Object.values(project.sourceDocuments || {}).find((source) => source.contentHash === contentHash)
        const imported = existingSource ? { ...existingSource, sourceId: existingSource.id } : await call(scriptTools, 'studio_source_import', {
          projectId: project.id,
          title: args.title,
          sourcePath: args.sourcePath,
          format: 'markdown',
          commandId: `${project.id}:source:${contentHash}:v1`,
        })
        const segmentSize = 12000
        const segments = []
        for (let start = 0; start < imported.characters; start += segmentSize) {
          segments.push({ start, end: Math.min(start + segmentSize, imported.characters) })
        }
        const orchestrated = await call(scriptTools, 'studio_novel_orchestrate', {
          projectId: project.id,
          sourceId: imported.sourceId,
          contentHash: imported.contentHash,
          segments,
        })
        exec.concludeTurn()
        return { ok: true, json: JSON.stringify(orchestrated), error: '' }
      } catch (error) {
        return { ok: false, json: '', error: error?.message || String(error) }
      }
    },
  })
  // 替换 plan-only 的 studio_deliverable_export 为 plan+execute 版本
  const exportIdx = projectTools.findIndex((t) => t.name === 'studio_deliverable_export')
  if (exportIdx !== -1) {
    projectTools[exportIdx] = {
      name: 'studio_deliverable_export',
      description: '规划并执行交付导出（plan → ffmpeg concat → record）。',
      parameters: { type: 'object', properties: { projectId: { type: 'string', description: 'Project id' }, revision: { type: 'integer', description: 'Expected Project revision' }, timelineId: { type: 'string', description: 'Timeline id' }, preset: { type: 'string', description: 'Export preset' } }, required: ['projectId', 'revision', 'timelineId'] },
      output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, json: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value.ok ? value.json : `失败：${value.error}` }] },
      async execute(args, exec) {
        try {
          const planned = await deliveryService.plan(args.projectId, args.timelineId, args.preset)
          const deliverableId = planned.output.deliverableId
          await studioFilesReady
          const result = await deliveryService.execute(args.projectId, deliverableId, STUDIO_STORAGE_ROOT)
          const d = result.project.deliverables[deliverableId]
          return { ok: true, json: JSON.stringify({ revision: result.project.revision, deliverableId, status: d.status, logicalKey: d.logicalKey, contentHash: d.contentHash }), error: '' }
        } catch (error) { return { ok: false, json: '', error: error?.message || String(error) } }
      },
    }
  }
  // 批量生成只创建持久任务，独立 Worker 在工具返回后继续逐镜执行。
  projectTools.push({
    name: 'studio_batch_generate',
    description: '为整项目、单集或镜头列表创建持久异步生成与自动拼接任务并立即返回 runId；省略 episodeId/shotIds 时处理整个项目。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id' },
        episodeId: { type: 'string', description: '集 id（与 shotIds 二选一）' },
        shotIds: { type: 'array', items: { type: 'string' }, description: '显式镜头 id 列表（与 episodeId 二选一）' },
        capability: { type: 'string', description: '生成能力（如 video.reference2video）' },
        tier: { type: 'string', description: '档位（fast/balanced/quality）' },
        width: { type: 'integer', description: '宽' },
        height: { type: 'integer', description: '高' },
        length: { type: 'integer', description: '帧数（24fps）' },
        assemble: { type: 'boolean', description: '生成后自动按分集及全项目顺序拼接；默认 true' },
        workspaceId: { type: 'string', description: '可选 Workspace id' },
      },
      required: ['projectId', 'capability'],
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, json: { type: 'string' }, error: { type: 'string' } } },
      render: (_args, value) => [{ type: 'text', text: value.ok ? value.json : `失败：${value.error}` }],
    },
    async execute(args, exec) {
      try {
        const { sessionId } = resolveSessionRoot(ctx, exec?.agent?.id, args.workspaceId, exec)
        const project = await projectService.getProject(args.projectId)
        const episodes = Object.values(project.episodes || {}).sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
        const requested = Array.isArray(args.shotIds) && args.shotIds.length
          ? args.shotIds
          : args.episodeId
            ? project.episodes[args.episodeId]?.shotIds || []
            : episodes.flatMap((episode) => episode.shotIds || [])
        if (!requested.length) throw new Error('batch requires at least one project shot')
        const generatable = new Set(['draft', 'planned', 'ready', 'rejected', 'invalidated'])
        const runId = randomUUID()
        const shotIds = requested.filter((id) => project.shots[id] && generatable.has(project.shots[id].status))
        if (!shotIds.length) throw new Error('no generatable shots in batch')
        const tasks = dramaProductionTasks(project, {
          runId, shotIds, assemble: args.assemble !== false,
          input: { projectId: args.projectId, capability: args.capability, tier: args.tier, width: args.width, height: args.height, length: args.length, sessionId, workspaceId: args.workspaceId },
        })
        const result = await projectService.execute({
          projectId: args.projectId,
          commandId: `production:${runId}:create`,
          expectedRevision: project.revision,
          type: 'createProductionRun',
          payload: { runId, sourceId: null, mode: args.tier || 'fast', tasks },
          actor: 'studio_batch_generate',
        })
        void productionWorker.drain()
        return { ok: true, json: JSON.stringify({ runId, revision: result.project.revision, queued: shotIds.length, preparationTasks: tasks.filter((task) => ['render-reference', 'render-storyboard'].includes(task.kind)).length, assemblyTasks: tasks.filter((task) => ['concat-video', 'deliver-drama'].includes(task.kind)).length, skipped: requested.length - shotIds.length }), error: '' }
      } catch (error) { return { ok: false, json: '', error: error?.message || String(error) } }
    },
  })

  const tools = [...makeTools(), ...projectTools, ...scriptTools]
  const disposeTools = ctx.effect(() => {
    const disposers = tools.map((t) => ctx.tools.register(t))
    return () => disposers.forEach((d) => d())
  }, 'dsh-short-video-studio: tools')

  // pre-ask 自动送达：ask_user_question 执行前，把画布中未送达的产物经
  // send_file 送达（仅飞书渠道有 send_file；Web/TUI 自动跳过）。
  // 只拦 ask_user_question，send_file 自身执行不会递归触发。
  // global:true = 全局监听器不受 agent context filter 限制，所有 scope 的 dispatch 都收到。
  const disposePreAskDeliver = ctx.effect(() => ctx.on('tools/pre-execute', makePreAskDeliverListener(ctx), { global: true }), 'dsh-short-video-studio: pre-ask deliver')

  // H3 结构化 prompt 质检门：comfy_generate_video / comfy_render 在 H3 系工作流下
  // 自由格式输入由 runRender 的正式 Prompt 编译器转换；hook 只拒绝字段残缺的半结构化输入。
  const disposeH3Gate = ctx.effect(() => ctx.on('tools/pre-execute', makeH3PromptGateListener(ctx), { global: true }), 'dsh-short-video-studio: h3 prompt gate')

  // systemPrompt 段
  const disposeSection = ctx.systemPrompt.section({
    name: 'plugin:dsh-short-video-studio',
    order: GUIDANCE_ORDER,
    text: GUIDANCE + '\\n整书快速生产必须调用 studio_novel_create(sourcePath, title)，由工具内部完成建项目、导入和后台媒体交接；主 Agent 不直接调用 studio_source_import、studio_novel_orchestrate、studio_batch_generate，不加载其他媒体 Skill，不猜测不存在的 Skill 名。局部源文导入必须先调用 studio_project_create 并使用返回的 projectId。',
  })

  // 路由
  const { apiPrefix, handleApi, handleMedia, handleStatic } = makeRoutes(runtime)
  const disposeRoutes = ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_ROOT,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? ROUTE_ROOT, 'http://localhost')
          if (url.pathname.startsWith(apiPrefix)) await handleApi(ctx, req, res, url)
          else if (url.pathname.startsWith(ROUTE_ROOT + '/media')) await handleMedia(ctx, res, url)
          else await handleStatic(res, url)
        } catch (error) {
          if (res.headersSent) { res.destroy(error instanceof Error ? error : undefined); return }
          sendJson(res, error?.status || 500, { ok: false, message: error?.message || 'request failed' })
        }
      },
    })
  }, 'dsh-short-video-studio: routes')
}

// 暴露部分内部供测试
export const _internals = {
  // 工具定义（供 scripts/checks/smoke-tools.mjs 按宿主 register 契约校验：output 缺失、
  // schema 越界这类错误在真宿主里表现为「插件整个不加载」，必须离线拦住）
  makeTools,
  initializeTestProjectDomain,
  loadProject,
  saveProject,
  // 视频超分（U3）：供离线测试直接验证编排逻辑
  runUpscale,
  // skill 分发（版本戳刷新）：供 scripts/checks/smoke-skill-install.mjs 注入临时路径测试
  syncBundledSkills,
  hashSkillDir,
  readSkillStamp,
  readPluginVersion,
  STUDIO_SKILL_MARK,
  buildFluxImageWorkflow,
  buildH3VideoWorkflow,
  buildH3ImageToVideoWorkflow,
  comfySubmit,
  comfyWait,
  comfyOutputs,
  comfyDownload,
  comfyUploadImage,
  resolveTieredManifest,
  getCfg,
  getTierSelection,
  DEFAULT_GROUP,
  ROUTE_ROOT,
  CANVAS_DIR,
  // M1：工作流契约引擎
  loadBuiltinManifests,
  buildGraphFromManifest,
  VIDEO_SHAPES,
  validateVideoArgs,
  validateManifest,
  resolveAssets,
  // 档位解析层（契约见 docs/tier-strategy-design.md）
  TIERS,
  tierImplementations,
  sortTierCandidates,
  groupNameOf,
  isTieredCapability,
  getTierSelection,
  tierFromArgs,
  legacyModeFromArgs,
  explicitImplementationOf,
  probeImageSize,
  projectCapabilityStrategies,
  userStrategiesOf,
  DEFAULT_STRATEGY_ID,
  describeTierMatrix,
  describeWorkflowsApi,
  effectiveAssetsOf,
  ASSET_OVERRIDE_ALIASES,
  LEGACY_MODEL_ASSET_MAP,
  checkAvailability,
  probeNodeClass,
  DEFAULT_TIER,
  CAPABILITIES,
  // M2：通用渲染
  runRender,
  buildRenderGraph,
  resolveManifest,
  resolveMode,
  computeManifestSize,
  manifestDeliverySize,
  resolutionLockWarning,
  snapLengthToGrid,
  getAssetOverrides,
  getRegistry,
  reloadRegistry,
  // 渠道交付：pre-ask 自动送达
  collectUndelivered,
  deliverPending,
  makePreAskDeliverListener,
  // 手动资产导入（画布上传 / 资产库取用 / 替换）
  parseDataUrlImage,
  importManualImage,
  copyAssetToCanvas,
  replaceNodeImage,
  UPLOAD_MAX_FILE,
  UPLOAD_MAX_FILES,
  // H3 结构化 prompt 质检门
  makeH3PromptGateListener,
  h3HasSection,
  H3_PROMPT_GATE,
  H3_GATE_MAX_DENIES,
  exportTextNode,
  deliveryFilename,
  markdownToHtml,
  renderNodeHtml,
  AUTO_DELIVER_BEFORE_ASK,
  TEXT_NODE_EXPORT_PDF,
}
