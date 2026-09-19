// 职责：worker 唯一门面；session、tools 与 server 只通过此文件使用任务管理器、结果汇总和模型设置。

// 任务管理：提交与恢复只返回句柄，等待由调用方决定（Agent 工具等待，工作卡按钮不等待）。
export { submitTask, retryTask } from './manager/manager.js'
export { waitJob } from './runner/wait.js'
export { getJob } from './runner/inspect.js'

// 受理：项目归属与会话调用绑定。
export { ensureFreeProject } from './intake/project.js'
export { MEDIA_TOOLS, mediaToolNames, findJobCall } from './intake/calls.js'

// 结果：统一汇总口径与本地媒体。
export { completedResult, jobSummary } from './results/summary.js'
export { openLocalMedia } from './store/media.js'
export { saveStatus } from './store/status.js'

// 路由与模型设置：设置页的服务器、三方渠道与连接管理。
export { thirdPartyModels, thirdPartyChannels, thirdPartySelection, selectThirdPartyModel } from './routing/backends.js'
export { VIDEO_MODES, listProviders, validateBackend, probeBackend, connectBackend, checkBackend, backendFromServer, resolveServer, legacyTunnelBackend,
  readRegistry, writeRegistry, readSelection, validateRegistry, sshIdentity, checkServer, switchServer, defaultTunnelModel, updateSettings } from './models/index.js'
