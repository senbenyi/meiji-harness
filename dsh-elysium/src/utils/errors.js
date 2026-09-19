// 职责：定义跨模块共享的结构化错误。
export const statusError = (status, message) => Object.assign(new Error(message), { status })

export class ModelTaskError extends Error {
  constructor(code, message, status = 500) {
    super(message)
    this.name = 'ModelTaskError'
    this.code = code
    this.status = status
  }
}
