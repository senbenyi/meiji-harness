// outline 接口：在此独立定义生成、审核、修订的角色、顺序与输出格式。
// 下列片段均为显式选择；可删减、移动到另一角色，或替换为本接口自己的 segment。
import { generationParts, reviewParts } from '../skill-prompts.js'
import { withRequirements, revisionTask } from './text-context.js'

function compose(task, kind) {
  const p = generationParts({ ...task, stage: 'outline', kind, outputProtocol: '只输出完整合法 JSON 对象。字符串内双引号、反斜杠和换行必须转义；对白优先用中文引号「」或单引号，禁止 Markdown 围栏、注释和尾随逗号。' })
  return {
    json: true,
    system: [
      p.common, ...p.commonShared, p.generate,
      ...p.guidance, ...p.additions, ...p.assetRules,
      ...(kind === 'revise' ? p.revisionBoundary : p.selfCheck),
      ...(kind === 'modify' ? p.revisionBoundary : []),
      p.language, p.priority, p.protocol,
    ],
    user: [p.context, ...p.assetContent, p.opinion],
  }
}

function generate(task) {
  return compose(withRequirements(task), task.modify ? 'modify' : 'generate')
}

function review(task, content) {
  const p = reviewParts({ ...withRequirements(task), stage: 'outline' }, content)
  return {
    json: false,
    system: [p.commonProtocol, ...p.shared, ...p.assetRules, p.language, p.protocol],
    user: [p.stage, p.context, p.opinion, p.criteria, ...p.guidance, ...p.additions,
      ...p.assetContent, p.continuity, p.content, p.scope],
  }
}

function revise(task, content, review) {
  return compose(revisionTask(withRequirements(task), content, review), 'revise')
}

export default { generate, review, revise }
