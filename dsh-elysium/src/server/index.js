// 职责：创建 Web 共享 Store 并组合插件路由；Store 依赖、路由常量和认证凭据不泄漏到插件入口。
import { registerMediaRoutes } from './routes/media.js'
import { registerProjectRoutes, PROJECT_ROUTE } from './routes/projects.js'
import { registerDirectorRoutes, DIRECTOR_ROUTE } from './routes/directors.js'
import { registerSettingsRoutes, SETTINGS_ROUTE } from './routes/settings.js'
import { createProjectStore, registerProjectSinks } from './projects/service.js'
import { createDirectorStore } from './directors/service.js'

// 创建导演与项目共用的数据入口，并绑定项目对导演存在性的校验。
export function createWebStores() {
  const directors = createDirectorStore()
  const projects = createProjectStore({ directorExists: name => directors.has(name) })
  return { projects, directors }
}

// 使用同一页面凭据注册媒体、设置、项目和导演路由。
export function registerWebRoutes(ctx, runtime, { projects, directors }) {
  registerProjectSinks(ctx, projects)
  const pageToken = registerMediaRoutes(ctx, runtime, PROJECT_ROUTE, DIRECTOR_ROUTE, SETTINGS_ROUTE)
  registerSettingsRoutes(ctx, runtime, pageToken)
  registerProjectRoutes(ctx, runtime, pageToken, projects)
  registerDirectorRoutes(ctx, runtime, pageToken, directors, projects)
}
