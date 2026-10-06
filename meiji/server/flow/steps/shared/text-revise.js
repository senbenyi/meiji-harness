import { generateStep } from './text-generate.js'

// 修订复用文本请求与保存机制，但独立记录为 revise，不隐式复审。
export const reviseStep = options => generateStep({ ...options, kind: 'revise' })
