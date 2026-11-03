import { createHash } from 'node:crypto'

// 保持既有请求/任务幂等标识；不用于内容校验或下游过期判断。
export const requestIdentity = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const fileIdentity = body => createHash('sha256').update(body).digest('hex')
