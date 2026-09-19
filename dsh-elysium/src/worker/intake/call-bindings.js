// 职责：定义媒体工具名称，并临时关联尚未写入 Harness 日志的工具调用与 Job。

// 媒体工具唯一名单；generate 创建或复用任务，recover 恢复原任务。
export const MEDIA_TOOLS = Object.freeze({
  image: Object.freeze({ generate: 'call_tools_image', recover: 'call_tools_image_recover' }),
  video: Object.freeze({ generate: 'call_tools_video', recover: 'call_tools_video_recover' }),
})
export const mediaToolNames = kind => kind ? Object.values(MEDIA_TOOLS[kind]) : Object.keys(MEDIA_TOOLS).flatMap(mediaToolNames)

const activeJobs = new Map()
const key = (sessionId, callId) => JSON.stringify([sessionId, callId])

export function bindActiveJobCall(jobId, invocation) {
  if (invocation?.sessionId && invocation.callId) activeJobs.set(key(invocation.sessionId, invocation.callId), jobId)
}

export function releaseActiveJobCall(invocation) {
  if (invocation?.sessionId && invocation.callId) activeJobs.delete(key(invocation.sessionId, invocation.callId))
}

export async function findJobCall(sessionId, callId, history) {
  const identity = key(sessionId, callId)
  if (history?.sessionId === sessionId) {
    const logged = history.calls?.find(call => call.callId === callId)?.jobId
    if (logged) {
      activeJobs.delete(identity)
      return logged
    }
  }
  return activeJobs.get(identity) || null
}
