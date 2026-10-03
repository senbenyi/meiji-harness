// 停止按钮：调用操作管理器停止整个操作（按操作 id 或其任务 id），连带停止同操作其余任务；不创建任何记录。
// 面板可停止本项目任意操作；会话只能停止本会话发起的操作（占用本集的他方操作只能等待）。
export function cancelOperation(manager, { id, projectId, sessionId, initiator = 'panel' }) {
  if (!id) throw Object.assign(new Error('缺少要停止的操作'), { status: 400 })
  manager.cancel(id, projectId, initiator === 'session' ? { sessionId } : {})
}
