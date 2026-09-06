/**
 * Serializable configuration and defaults for the sidebar host half. Loader
 * schema validation normally fills defaults; {@link resolveSidebarConfig}
 * applies the same defaults for direct callers that bypass the Loader.
 * @module @dsh-external/dsh-elysium/config
 */

import z from 'schemastery'
import {
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  type SidebarPrefs,
} from '../shared/sidebar-preferences.ts'

export {
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  type SidebarPrefs,
} from '../shared/sidebar-preferences.ts'

/** Unified single-plugin configuration for video production and the embedded Sidebar. */
export interface ElysiumConfig {
  /** Elysium project storage root. Relative paths resolve from the DSH process cwd. */
  workspace?: string
  /** Elysium generation model templates and arguments, keyed by generation stage. */
  models?: Record<string, unknown>
  /** Qwen producer model used to turn a story into a validated chapter and anchor plan. */
  planner?: {
    provider?: string
    model?: string
    maxTokens?: number
  }
  /** Internal ComfyUI driver. All image/video inference stays on the remote server behind this endpoint. */
  comfyui?: {
    baseUrl?: string
    templatesDir?: string
    outputDir?: string
    /** Local path that is the same directory ComfyUI serves as its input/. Set it only when the filesystem is genuinely shared; empty keeps the HTTP upload path. */
    sharedInputRoot?: string
  }
  /** Local post-production executables. Media generation itself remains remote. */
  ffmpeg?: string
  ffprobe?: string
  /** Read cap of one text file (bytes); larger files return truncated. */
  readLimit?: number
  /** Media route cap (bytes); larger binaries are refused. */
  mediaLimit?: number
  /** Upload route cap (bytes); larger files are refused without touching disk. */
  uploadLimit?: number
  /** Explorer row bound of one level. */
  listLimit?: number
}

/** Schemastery schema for the plugin configuration. */
/** Backward-compatible name retained for existing consumers. */
export type SidebarConfig = ElysiumConfig

export const Config: z<ElysiumConfig> = z.object({
  workspace: z.string().default('./elysium-workspace'),
  models: z.dict(z.any()).default({}),
  planner: z.object({
    provider: z.string().default('qwen38-local'),
    model: z.string().default('qwen3.8-27b-elysium'),
    maxTokens: z.number().step(1).min(512).max(32768).default(4096),
  }).default({ provider: 'qwen38-local', model: 'qwen3.8-27b-elysium', maxTokens: 4096 }),
  comfyui: z.object({
    baseUrl: z.string().default('http://127.0.0.1:8189'),
    templatesDir: z.string().default(''),
    outputDir: z.string().default(''),
    sharedInputRoot: z.string().default(''),
  }).default({ baseUrl: 'http://127.0.0.1:8189', templatesDir: '', outputDir: '', sharedInputRoot: '' }),
  ffmpeg: z.string().default('ffmpeg'),
  ffprobe: z.string().default('ffprobe'),
  readLimit: z.number().step(1).min(1).default(512 * 1024),
  mediaLimit: z.number().step(1).min(1).default(20 * 1024 * 1024),
  uploadLimit: z.number().step(1).min(1).default(128 * 1024 * 1024),
  listLimit: z.number().step(1).min(1).default(1000),
})

/** Fully defaulted sidebar host settings. */
export interface ResolvedSidebarConfig {
  readLimit: number
  mediaLimit: number
  uploadLimit: number
  listLimit: number
}

/** Canonical name for new code; the old name stays public for compatibility. */
export type ResolvedElysiumConfig = ResolvedSidebarConfig

/**
 * Apply direct-call defaults after Loader schema validation has normally run.
 *
 * @param config - Deployment-provided sidebar host settings.
 * @returns Complete settings consumed by the host half.
 */
export function resolveSidebarConfig(config: ElysiumConfig | undefined): ResolvedSidebarConfig {
  return {
    readLimit: config?.readLimit ?? 512 * 1024,
    mediaLimit: config?.mediaLimit ?? 20 * 1024 * 1024,
    uploadLimit: config?.uploadLimit ?? 128 * 1024 * 1024,
    listLimit: config?.listLimit ?? 1000,
  }
}

// ── User-facing "Side card" preferences ─────────────────────────────────────

/** Schemastery schema for the user-facing preferences (validated by the settings service). */
export const PrefsSchema: z<SidebarPrefs> = z.object({
  defaultWidthPercent: z.number().min(1).max(100).default(SIDEBAR_PREFS_DEFAULTS.defaultWidthPercent),
  autoOpenSubagent: z.boolean().default(true),
  autoOpenJobs: z.boolean().default(true),
  editorExplorer: z.boolean().default(false),
  workspaceFence: z.boolean().default(true),
  htmlViewerNoSandbox: z.boolean().default(false),
  htmlViewerDefaultUnsafe: z.boolean().default(false),
  browserNoSandbox: z.boolean().default(false),
  browserInterceptLinks: z.boolean().default(true),
  browserInterceptHttp: z.boolean().default(true),
  browserInterceptHttps: z.boolean().default(false),
  browserAllowedLoopback: z.string().default(''),
  // Per-feature enable switches are OPEN maps (any tab/viewer id, built-in or
  // external): an absent key means enabled, so old documents resolve to {}
  // (everything on) with no migration. Non-boolean values fail validation.
  tabsEnabled: z.dict(z.boolean()).default({}),
  viewersEnabled: z.dict(z.boolean()).default({}),
  // Plugin-owned settings blobs (v0.12.0+) are an OPEN nested map: any
  // descriptor id may carry any JSON-serializable values. This is the
  // "settings seam" opening — without it the seam would drop third-party
  // keys as unknown schema fields.
  pluginSettings: z.dict(z.dict(z.any())).default({}),
})
