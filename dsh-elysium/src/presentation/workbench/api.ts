/**
 * Typed fetch wrapper over the /sidebar JSON API. Every call posts to
 * `/sidebar/api/<method>` with the sessionId and — when known — the session's
 * cwd from the client's own list summary. The host prefers its attached
 * session header and uses the summary cwd only while the session is still
 * hydrating at page load (a detached session would otherwise fail the
 * request). Failures surface as {@link SidebarApiError} with the wire code.
 */
import { encodeHtmlUrl } from '../dsh/html-route.ts'
import type { LastActivity } from '../dsh/subagent-activity.ts'
import type { BrowserProbeResult } from './browser.ts'

/** One wire failure. */
export class SidebarApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Whether a wire failure is the workspace fence refusing a path outside the
 * session workspace (the host message reads `path "..." is outside
 * workspace`). The request-trust fence answers code `forbidden` with the
 * bare message 'forbidden', so the message fragment — not the code alone —
 * identifies this case.
 */
export function isOutsideWorkspaceError(error: unknown): boolean {
  return error instanceof SidebarApiError && isOutsideWorkspaceMessage(error.message)
}

/** Message-level variant for surfaces that stored the raw text (file-tree level errors). */
export function isOutsideWorkspaceMessage(message: string): boolean {
  return message.includes('outside workspace')
}

/** Explorer row (host fs-tree shape). */
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
  /** Whether the row is a symlink; `isDir` then describes the link's target. */
  isSymlink: boolean
  /** For symlinks: the target is missing or unreadable (stat failed). */
  broken: boolean
}

/** Text read result. */
export interface FsTextResult { kind: 'text'; content: string; truncated: boolean }
/** Binary read result (no content; images load through the media route).
 *  `head` carries the first bytes (base64) for viewer detect sniffing. */
export interface FsBinaryResult { kind: 'binary'; size: number; truncated: boolean; head: string }

/**
 * One jobs.output response: the output the MODEL has read so far for the
 * job (replayed from the owner session's event log — the model's
 * job_output cursor is never touched, so the pane can never steal the
 * agent's bytes). `read` is false until the model actually called
 * job_output for the job.
 */
export interface JobOutputResult {
  text: string
  /** True when the host capped the text at its output limit. */
  truncated: boolean
  /** Whether the model has read the job at least once. */
  read: boolean
}

/** The `subagents.live` response: running child id → latest activity. */
export type SubagentLiveResult = { live: Record<string, LastActivity> }

async function call<T>(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/sidebar/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    throw new SidebarApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new SidebarApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

/**
 * Upload one file to the sidebar's raw upload route: the File goes straight
 * into the POST body (no JSON/base64 re-encoding — the host streams it into
 * the workspace). Failure surfaces as {@link SidebarApiError} with the wire
 * code, exactly like every `/sidebar/api` call. An aborted `signal` rejects
 * with the DOMException as-is (the caller decides whether that is an error).
 */
async function fetchUpload<T>(
  scope: SessionScope,
  dir: string,
  relativePath: string,
  body: Blob,
  signal?: AbortSignal,
): Promise<T> {
  const params = new URLSearchParams({ sessionId: scope.sessionId, dir, relativePath })
  if (scope.cwd !== undefined && scope.cwd !== '') params.set('cwd', scope.cwd)
  let response: Response
  try {
    response = await fetch(`/sidebar/upload?${params.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body,
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new SidebarApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new SidebarApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

/** One request's session scope: the conversation id plus its cwd when known. */
export interface SessionScope {
  sessionId: string
  /** The session's working directory from the client list summary (optional). */
  cwd?: string
}

/** Fold a scope into a JSON payload ({cwd} only when present). */
function scopePayload(scope: SessionScope, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: scope.sessionId,
    ...(scope.cwd !== undefined && scope.cwd !== '' ? { cwd: scope.cwd } : {}),
    ...extra,
  }
}

/** The sidebar API surface (session scope threaded through every call). */
export const api = {
  sessionCwd: (scope: SessionScope, signal?: AbortSignal) =>
    call<{ sessionId: string; cwd: string; root: string; parent: string | null }>('session.cwd', scopePayload(scope, {}), signal),
  fsTree: (scope: SessionScope, path: string, signal?: AbortSignal) =>
    call<{ path: string; entries: FsEntry[]; truncated: boolean }>('fs.tree', scopePayload(scope, { path }), signal),
  /** Global recursive file-name search rooted at the session cwd (the editor
   *  side panel's search box); matches are cwd-relative '/'-separated paths. */
  fsSearch: (scope: SessionScope, query: string, signal?: AbortSignal) =>
    call<{ matches: string[]; truncated: boolean }>('fs.search', scopePayload(scope, { query }), signal),
  fsRead: (scope: SessionScope, path: string, signal?: AbortSignal) =>
    call<FsTextResult | FsBinaryResult>('fs.read', scopePayload(scope, { path }), signal),
  fsWrite: (scope: SessionScope, path: string, content: string) =>
    call<{ ok: true }>('fs.write', scopePayload(scope, { path, content })),
  /** Upload one file's raw bytes into `dir` (keeps the folder tree via
   *  `relativePath`); the host streams it under the session workspace. */
  uploadFile: (scope: SessionScope, dir: string, relativePath: string, body: Blob, signal?: AbortSignal) =>
    fetchUpload<{ path: string; size: number }>(scope, dir, relativePath, body, signal),
  /**
   * The output the model has read so far for one background job (replayed
   * from the owner session's event log — never the model's job_output
   * cursor). The scope MUST be the job's OWNER session.
   */
  jobOutput: (scope: SessionScope, id: string, signal?: AbortSignal) =>
    call<JobOutputResult>('jobs.output', scopePayload(scope, { id }), signal),
  /** Request cancellation of one background job (live jobs flip to stopping). */
  jobKill: (scope: SessionScope, id: string, reason?: string) =>
    call<{ ok: true; outcome: 'requested' | 'already-finished' }>('jobs.kill', scopePayload(scope, {
      id,
      ...(reason !== undefined ? { reason } : {}),
    })),
  /**
   * One batch live-preview fetch for the whole Subagent tree. The payload is
   * the already-resolved topology ROOT (not a session scope); the host
   * enumerates descendants once and folds running children's activity.
   */
  subagentsLive: (rootSessionId: string, signal?: AbortSignal) =>
    call<SubagentLiveResult>('subagents.live', { rootSessionId }, signal),
  /** Read the side card preferences (plugin-global, no session scope). */
  settingsGet: () =>
    call<{ value?: unknown; revision?: number; externalDisable?: boolean }>('settings.get', {}),
  /** Merge a patch into the side card preferences (revision-guarded). */
  settingsUpdate: (patch: Record<string, unknown>, expectedRevision?: number) =>
    call<{ value?: unknown; revision?: number }>('settings.update', {
      patch,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    }),
  /** Probe a URL's response headers (the sidebar browser's embeddability
   *  check; see the host's browser.probe route). */
  browserProbe: (url: string, signal?: AbortSignal) =>
    call<BrowserProbeResult>('browser.probe', { url }, signal),
  /** External open for the file tree's "open with" menu: reveal a path in
   *  the OS file manager, or hand a custom-scheme URL (vscode://, cursor://,
   *  zed://, custom editors) to its registered handler. The host launches
   *  the platform opener (argv, no shell). */
  openExternal: (payload: { action: 'reveal'; path: string } | { action: 'url'; url: string }) =>
    call<{ started: boolean }>('open.external', payload),
}

/** Absolute URL of the media route for one path (images only). */
export function mediaUrl(scope: SessionScope, path: string): string {
  return fileUrl(scope, path, false)
}

/** Absolute URL of the download route: serves raw bytes (binary-safe) with
 *  `Content-Disposition: attachment`, so the browser saves the file. */
export function downloadUrl(scope: SessionScope, path: string): string {
  return fileUrl(scope, path, true)
}

/** Shared URL builder for the /sidebar/file route (media vs download). */
function fileUrl(scope: SessionScope, path: string, download: boolean): string {
  const params = new URLSearchParams({ sessionId: scope.sessionId, path })
  if (scope.cwd !== undefined && scope.cwd !== '') params.set('cwd', scope.cwd)
  if (download) params.set('download', '1')
  return `/sidebar/file?${params.toString()}`
}

/**
 * Absolute URL of the HTML preview route (see html-route.ts): the path is
 * fully encoded so the previewed page's relative assets resolve back into
 * the same route with the session scope intact. The UNC marker is
 * platform-neutral — the host's requireAbsolute resolves the decoded
 * forward-slash `//server/share/...` form on both win32 and POSIX — so no
 * client-side platform signal is needed.
 */
export function htmlUrl(scope: SessionScope, path: string): string {
  return encodeHtmlUrl(scope.sessionId, path)
}
