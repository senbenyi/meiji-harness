// 执行占用：Run 步骤与即时保存共用的唯一内存锁。
// 按实际写入范围占用：项目级写入与一切互斥，其余按集、按对象互斥。
import { resolve } from 'node:path'
import { conflicts, operationScope } from '../../../shared/operation-conflicts.js'

const holders = new Map()
const projectKey = (home, projectId) => resolve(home, 'storages', 'meiji', 'projects', projectId)
const overlaps = (a, b) => a.key === b.key && conflicts(a, b)
const entry = (home, operation) => ({ key: projectKey(home, operation.projectId), projectId: operation.projectId, ...operationScope(operation) })

export const holderOf = id => holders.get(id) || null

// 与 operation 冲突的占用者（排除 exceptId 自身）；没有项目归属的操作不占用。
export function occupant(home, operation, exceptId = null) {
  if (!operation?.projectId) return null
  const wanted = entry(home, operation)
  for (const holder of holders.values()) if (holder.id !== exceptId && overlaps(holder, wanted)) return holder
  return null
}

export function busyError(holder) {
  const by = holder.initiator === 'session' ? '会话' : '面板'
  const state = holder.lock === 'project' ? '本项目正在修改项目资料' : '本集正在修改'
  return Object.assign(new Error(`${state}：${holder.label}（${by}发起），请等待结束或暂停任务后再试`), {
    status: 409, code: 'TARGET_BUSY', busy: { writeToken: holder.id, projectId: holder.projectId, action: holder.action, lock: holder.lock, label: holder.label, initiator: holder.initiator, episodeId: holder.episodeId, target: holder.target },
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
