// 职责：组装 Harness 工具清单（加载、媒体、任务、项目）；工具只定义参数并调用 worker 门面。
import { createCallToolsProjectActions } from './project/project.js'
import { createCallToolsDirectorList } from './project/director.js'
import { createCallToolsJobResult, createCallToolsJobStatus } from './task/model.js'
import { createCallToolsVideo, createCallToolsVideoRecover } from './media/video.js'
import { createCallToolsImage, createCallToolsImageRecover } from './media/image.js'
import { createCallToolsWorkcard } from './card/workcard.js'
import { createCallToolsLoad } from './load.js'

// 组装与模型任务状态和结果查询相关的工具。
const createCallToolsJobs = () => [createCallToolsJobStatus(), createCallToolsJobResult()]
// 组装面向用户的图片与视频工具。
const createCallToolsMedia = () => [createCallToolsImage(), createCallToolsImageRecover(), createCallToolsVideo(), createCallToolsVideoRecover()]
// 组装导演查询与项目管理工具。
export const createCallToolsProject = ({ projects, directors }, ctx) => [
  ...createCallToolsDirectorList(directors),
  ...createCallToolsProjectActions(projects),
]
// 组装插件启动时注册的完整运行时工具清单。
export const createCallToolsRuntime = ctx => [createCallToolsLoad(ctx), ...createCallToolsMedia(), ...createCallToolsJobs()].map(createCallToolsWorkcard)
