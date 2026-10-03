import { canGenerate } from '../../../../shared/generation-gates.js'
export const operation = { label: '生成剧情', scope: 'episode', agent: true, kind: 'generate',
  completed: (project, op) => (op.only ? [op.only] : ['outline', 'characters', 'scenes', 'props']).every(key => project.plot[key].check.passed === true && !project.plot[key].stale),
  precheck(project, op) { if (!canGenerate(project, 'outline')) throw Object.assign(new Error('本集摘要尚未通过审核，请先完成摘要'), { status: 409 }); if (op.only && !['outline', 'characters', 'scenes', 'props'].includes(op.only)) throw new Error('剧情任务类型无效') },
  tasks: (_project, op) => (op.only ? [op.only] : ['outline', 'characters', 'scenes', 'props']).map(type => ({ type, params: { extraction: !op.only && type !== 'outline', ...(type !== 'outline' && !op.only ? { generationMode: 'regenerate', review: '', instruction: '' } : {}) } })) }
