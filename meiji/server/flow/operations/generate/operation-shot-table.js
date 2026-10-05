import { canGenerate, gateMessage } from '../../../../shared/generation-gates.js'
export const operation = { session: {"tool": "meiji_generate_shot_table", "description": "生成镜头表。", "episode": true, "params": {}, "modes": ["generate", "regenerate", "modify"]}, label: '生成镜头表', scope: 'episode', agent: true, kind: 'generate',
  precheck(project) { if (!canGenerate(project, 'shots')) throw Object.assign(new Error(gateMessage(project, 'shots')), { status: 409 }) }, tasks: () => [{ type: 'shot-table' }] }
