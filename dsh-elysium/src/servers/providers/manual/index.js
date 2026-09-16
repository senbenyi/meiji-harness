// 职责：拥有手工连接的兼容约定；工作流通过公共入口显式委托。
import { readFileSync } from 'node:fs'
import { createStandardAdapter } from '../../runtime/standard-adapter.js'
import { delegateProvider } from '../../runtime/index.js'
const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8'))
const adapter = createStandardAdapter({ id: 'manual', label: '通用手工连接', services: definition.services, llmRoute: definition.llm_route, checkPlans: definition.check_plans,
  buildGraph: (...args) => delegateProvider('manual', 'buildGraph', ...args),
  validatePlan: (...args) => delegateProvider('manual', 'validatePlan', ...args),
})
adapter.syncWorkflows = args => delegateProvider('manual', 'syncWorkflows', args)
adapter.guidance = () => delegateProvider('manual', 'creationGuidance')
export default adapter
