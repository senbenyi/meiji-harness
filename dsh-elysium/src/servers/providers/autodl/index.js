// 职责：组合 AutoDL 双服务器契约；工作流实现由本 provider 自身提供。
import { readFileSync } from 'node:fs'
import { createStandardAdapter } from '../../runtime/standard-adapter.js'
import { validateAutodl } from './config.js'
import { guidance } from './guidance.js'

const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8'))
const unsupported = async () => { throw Object.assign(new Error('AutoDL 工作流尚未接入'), { code: 'PROVIDER_OPERATION_UNSUPPORTED', status: 422 }) }
const adapter = createStandardAdapter({
  id: 'autodl', label: 'AutoDL', services: definition.services, llmRoute: definition.llm_route,
  checkPlans: definition.check_plans, validate: validateAutodl, buildGraph: unsupported,
})

adapter.guidance = guidance
adapter.creationGuidance = () => guidance
export default adapter
