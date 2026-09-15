// 职责：声明当前 Runpod 镜像的部署约定；公共协议和模型工作流不放在平台目录。
import { validateStandard } from '../../standard-adapter.js'
export const deployment = Object.freeze({ root: '/workspace/runpod-slim', port: 8188, venvSuffix: 'cu130' })
export function validateRunpod(backend) {
  validateStandard(backend)
  if (!backend.legacy && (!backend.instance_id || !backend.deployment_id)) throw new Error('Runpod 连接必须登记实例及部署身份')
}
