// 职责：worker 唯一门面；session、tools 与 server 只通过此文件使用任务管理器、结果汇总和模型设置。

// 任务管理：提交与恢复只返回句柄，等待由调用方决定（Agent 工具等待，工作卡按钮不等待）。
export { submit, submitTask, retry, retryTask, cancel, cancelLane, pause, resume, getLane, removeProjectTasks } from './manager/manager.js'
export { taskId } from './manager/tasks.js'
export { registerSink } from './manager/sinks.js'
export { createTaskDriver } from './driver/driver.js'
export { waitJob } from './runner/wait.js'
export { getJob } from './runner/inspect.js'

// 受理：项目归属与运行中调用关联；已完成调用以 Harness 日志为准。
export { ensureFreeProject } from './intake/project.js'
export { MEDIA_TOOLS, mediaToolNames, findJobCall, releaseActiveJobCall } from './intake/call-bindings.js'

// 结果：统一汇总口径与本地媒体。
export { completedResult, jobSummary } from './results/summary.js'
export { closeLocalMedia, localMediaInput, openLocalMedia, readLocalMedia, saveFilmJob, saveMedia, streamLocalMedia } from './store/media.js'
export { openLocalPreview, openRemotePreview } from './store/preview.js'
export { withLaunchLock } from './store/lock.js'
export { saveStatus } from './store/status.js'

// 路由与模型设置：设置页的服务器、三方渠道与连接管理。
export { thirdPartyModels, thirdPartyChannels, thirdPartySelection, selectThirdPartyModel } from './routing/selection.js'
export { VIDEO_MODES, listProviders, validateBackend, probeBackend, checkBackend, backendFromServer, resolveServer,
  readRegistry, writeRegistry, readSelection, validateRegistry, checkServer, switchServer, updateSettings, completeStructured } from './models/index.js'
