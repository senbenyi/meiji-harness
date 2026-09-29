// shots 接口：在此独立定义生成、审核、修订的角色、顺序与输出格式。
// 下列片段均为显式选择；可删减、移动到另一角色，或替换为本接口自己的 segment。
import { generationParts, reviewParts } from '../skill-prompts.js'
import { withRequirements, revisionTask } from './text-context.js'

function compose(task, kind) {
  const p = generationParts({ ...task, stage: 'shots', kind, outputProtocol: '本阶段只返回自由文本正文，禁止 JSON 包装。镜头表按要求用标题提供编号和可变时长，程序只读取标题元数据；其余阶段沿用已存编号和时长。剧情正文不解析字段，素材列表由程序管理。此输出协议优先于官方参考中的示例格式。' })
  return {
    json: false,
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
  const p = reviewParts({ ...withRequirements(task), stage: 'shots' }, content)
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
