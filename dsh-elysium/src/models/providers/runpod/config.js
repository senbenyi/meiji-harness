// 职责：声明当前 Runpod 镜像的部署约定和支持的模型服务。
import { readFileSync } from 'node:fs'
import { validateStandard } from '../../managers/runtime/adapter.js'
const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8'))
export const deployment = Object.freeze({ root: '/workspace/runpod-slim', port: 8188, venvSuffix: 'cu130' })
export function validateRunpod(backend) {
  validateStandard(backend, definition.services)
  if (!backend.legacy && (!backend.instance_id || !backend.deployment_id)) throw new Error('Runpod 连接必须登记实例及部署身份')
}
