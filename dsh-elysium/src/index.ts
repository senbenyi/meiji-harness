/**
 * Elysium package and runtime composition entrypoint.
 *
 * The sidebar platform and video-production domain remain independent
 * modules; this file only wires them into one DSH plugin instance.
 */
import type { Context as PluginContext, SidebarHttpRequest } from './sidebar/context-types.ts'
import { applySidebar } from './sidebar/server.ts'
import { isTrustedApiRequest } from './sidebar/trust-fence.ts'
import { apply as applyVideos } from './videos/server/index.js'
import {
  Config,
  type ElysiumConfig,
  type ResolvedElysiumConfig,
  type ResolvedSidebarConfig,
  type SidebarConfig,
} from './config.ts'

export { Config }
export type { ElysiumConfig, ResolvedElysiumConfig, ResolvedSidebarConfig, SidebarConfig }
export type { Context } from './sidebar/context-types.ts'
export type {
  BetterSidebarService,
  TabDescriptor,
  TabComponentProps,
  FileViewerDescriptor,
  FileViewerProps,
  FileFetchStrategy,
} from './sidebar/client/service.ts'
export { mediaTypeForPath, type SidebarSettingsFace } from './sidebar/server.ts'

/** Plugin identity used by the DSH loader. */
export const name = '@dsh-external/dsh-elysium'

/** Host services required by the combined sidebar and video modules. */
export const inject = ['webServer', 'sessions', 'webRuntime', 'tools', 'llm']

/** Mount every internal module behind one plugin identity and trust boundary. */
export function apply(ctx: PluginContext, config?: SidebarConfig): void {
  const fence = (req: SidebarHttpRequest): boolean => isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)
  applyVideos(ctx, config ?? {}, fence)
  applySidebar(ctx, config)
}
