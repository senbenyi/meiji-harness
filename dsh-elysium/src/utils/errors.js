// 职责：构造携带 HTTP 状态的通用错误。
export const statusError = (status, message) => Object.assign(new Error(message), { status })
