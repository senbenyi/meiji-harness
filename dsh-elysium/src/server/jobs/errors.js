// 职责：定义本地任务对外返回的结构化错误。
export class ModelTaskError extends Error {
  constructor(code, message, status = 500) {
    super(message)
    this.name = 'ModelTaskError'
    this.code = code
    this.status = status
  }
}
