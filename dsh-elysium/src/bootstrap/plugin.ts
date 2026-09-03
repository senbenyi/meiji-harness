/**
 * Elysium package and runtime composition entrypoint.
 *
 * The sidebar platform and video-production domain remain independent
 * modules; this file only wires them into one DSH plugin instance.
 */
import type { Context as PluginContext, SidebarHttpRequest } from '../presentation/dsh/context-types.ts'
import { applySidebar } from '../presentation/dsh/workbench-host.ts'
import { isTrustedApiRequest } from '../presentation/dsh/trust-fence.ts'
import { apply as applyStudio } from '../presentation/dsh/studio-host.js'
import {
  Config,
  type ElysiumConfig,
  type ResolvedElysiumConfig,
  type ResolvedSidebarConfig,
  type SidebarConfig,
} from './config.ts'

export { Config }
export type { ElysiumConfig, ResolvedElysiumConfig, ResolvedSidebarConfig, SidebarConfig }
export type { Context } from '../presentation/dsh/context-types.ts'
export type {
  BetterSidebarService,
  TabDescriptor,
  TabComponentProps,
  FileViewerDescriptor,
  FileViewerProps,
  FileFetchStrategy,
} from '../presentation/workbench/service.ts'
export { mediaTypeForPath, type SidebarSettingsFace } from '../presentation/dsh/workbench-host.ts'

/** Plugin identity used by the DSH loader. */
export const name = '@dsh-external/dsh-elysium'

/** Host services required by the combined sidebar and video modules. */
export const inject = ['webServer', 'sessions', 'webRuntime', 'tools', 'llm']

/** Mount every internal module behind one plugin identity and trust boundary. */
export function apply(ctx: PluginContext, config?: SidebarConfig): void {
  const fence = (req: SidebarHttpRequest): boolean => isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)
  applyStudio(ctx, config ?? {}, fence)
  applySidebar(ctx, config)
}
