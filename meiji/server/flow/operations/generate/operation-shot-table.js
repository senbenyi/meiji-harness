import { canGenerate, gateMessage } from '../../../../shared/generation-gates.js'
export const operation = { label: '生成镜头表', scope: 'episode', agent: true, kind: 'generate',
  precheck(project) { if (!canGenerate(project, 'shots')) throw Object.assign(new Error(gateMessage(project, 'shots')), { status: 409 }) }, tasks: () => [{ type: 'shot-table' }] }
