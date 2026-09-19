// 职责：将 Harness 会话和工具执行参数归一化为 worker 使用的普通调用上下文。
import { mediaCalls } from './events.js'

export const mediaSession = session => session ? {
  sessionId: session.id,
  calls: mediaCalls(session.snapshotEvents?.() || []),
} : {}

export const mediaInvocation = exec => ({
  ...mediaSession(exec?.agent?.session),
  callId: exec?.callId,
  signal: exec?.signal,
})
