// 剧集占用：面板与会话、生成与直接操作共用的唯一锁。
// 同一集同一时间只允许一个操作（生成任务从入队起占用，直接操作在执行期间占用）；没有剧集的项目级操作占用整个项目。
// 冲突时抛出 409（code EPISODE_BUSY），附带占用者信息，供面板提示与会话返回 busy。
import { resolve } from 'node:path'

const holders = new Map()
const projectKey = (home, projectId) => resolve(home, 'storages', 'meiji', 'projects', projectId)
const overlaps = (a, b) => a.key === b.key && (!a.episodeId || !b.episodeId || a.episodeId === b.episodeId)
const entry = (home, operation) => ({ key: projectKey(home, operation.projectId), projectId: operation.projectId, episodeId: operation.episodeId || null })

export const holderOf = id => holders.get(id) || null

// 与 operation 冲突的占用者（排除 exceptId 自身）；没有项目归属的操作不占用。
export function occupant(home, operation, exceptId = null) {
  if (!operation?.projectId) return null
  const wanted = entry(home, operation)
  for (const holder of holders.values()) if (holder.id !== exceptId && overlaps(holder, wanted)) return holder
  return null
}

export function busyError(holder) {
  const scope = holder.episodeId ? '本集' : '本项目'
  const by = holder.initiator === 'session' ? '会话' : '面板'
  return Object.assign(new Error(`${scope}正在执行：${holder.label}（${by}发起），请等待结束或停止后再试`), {
    status: 409, code: 'EPISODE_BUSY', busy: { operationId: holder.id, label: holder.label, initiator: holder.initiator, episodeId: holder.episodeId },
  })
}

// 登记占用并返回释放函数；已被占用时抛出 busyError。没有项目归属的操作返回空释放函数。
export function occupy(home, operation, { id, label }) {
  if (!operation?.projectId) return () => {}
  const holder = occupant(home, operation, id)
  if (holder) throw busyError(holder)
  holders.set(id, { id, label: label || operation.action, action: operation.action, initiator: operation.origin === 'session' ? 'session' : 'panel', sessionId: operation.sessionId || null, since: new Date().toISOString(), ...entry(home, operation) })
  return () => { holders.delete(id) }
}
