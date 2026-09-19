// 职责：校验 AutoDL 双服务器已有的 MiniMax H3 与 Qwen 服务声明。
import { readFileSync } from 'node:fs'
import { validateStandard } from '../../protocols/comfyui/adapter.js'
const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8'))

export function validateAutodl(backend) {
  validateStandard(backend, definition.services)
  if (!backend.legacy && (!backend.instance_id || !backend.deployment_id)) throw new Error('AutoDL 连接必须登记实例及部署身份')
}
