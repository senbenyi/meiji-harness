import { reviewProtocol } from '../../shared/review-result.js'
// 技能片段与来源标注工具。这里只提供可选材料，不决定最终请求结构。
// 每个接口在 interfaces/<id>.js 中明确选择 system/user/prompt 的内容和顺序。
import { builtinSkill, textHash } from '../../skills/load-skills.js'
import { builtinSkillSet, skillUse } from '../data/skill-store.js'
import { taskSkillSet, useSkills } from '../runtime/task-context.js'
import { outputLanguage } from '../../shared/output-language.js'
import { assetGuidance } from '../../shared/guidance-categories.js'

export const segment = (source, title, text, extra = {}) => ({ source, title, text: String(text ?? '').trim(), ...extra })
export const render = segments => segments.filter(item => item.text).map(item => item.title ? `${item.title}\n${item.text}` : item.text).join('\n\n')

// 本次请求使用的技能组合：显式传入（预览）→ 当前任务固定的组合 → 内置 + 本剧（无任务上下文时）。
export function currentSkillSet(project, explicit) {
  return explicit || taskSkillSet() || builtinSkillSet(project?.skills)
}

export const part = (set, id, field) => set.skills[id]?.parts?.[field] || ''
const productionRule = (set, stage, nodeKey) => set.skills[stage]?.rules?.[nodeKey] ?? set.skills[stage]?.constraints ?? part(set, stage, 'generate')
// 自审只使用 review/ 中的审核 skill，不再复用生成规则；没有审核 skill 的功能返回空。
export const reviewRule = (set, stage, nodeKey) => set.skills[stage]?.reviewRules?.[nodeKey] ?? set.skills[stage]?.review ?? part(set, stage, 'review')
export const addition = (set, id, field) => set.project.additions[id]?.[field] || ''

function languageLines(project, story) {
  const language = outputLanguage(project?.outputLanguage)
  return `本次生成语言：${language === 'en' ? 'English（英文）' : '简体中文'}。使用此语言生成自然语言内容。\n对白语言：${language === 'en' ? 'English' : '中文普通话（Mandarin Chinese）'}。固定字段名、协议标签与已有名称不翻译，既定对白、歌词和画面文字保留原文。`
}

export function languageSegment(set, project, meta, revise = false) {
  return segment('language', '【语言】', languageLines(project, meta.languageMode === 'story'))
}

export function nodeAddition(project, set, nodeKey, episodeId = project?.episodeId) {
  if (!nodeKey || !episodeId) return []
  const stored = set.nodeSupplements ? set.nodeSupplements[episodeId] : project?.episodeId ? project.supplementalSkills : project?.episodes?.find(item => item.id === episodeId)?.supplementalSkills
  const items = stored?.[nodeKey] || []
  return items.length ? [segment('node', '【本节点补充要求】', items.map(item => item.content).join('\n\n'), { nodeKey, episodeId })] : []
}

// 指导素材：按指导技能分组；文本分镜同时包含成片阶段选择的素材。
// 指导素材编排规则：通用一段 + 本阶段一段；审核请求另加验收口径。
const assetCommonRule = '指导素材 JSON 是参考资料：按标注的指导与落点选择适合本次内容的部分融入正文，不要求全部采用，正文中不提素材名或编排说明。本剧补充、上游事实、语言配置和本次修改范围优先于参考素材。'
const assetShotRule = '镜头表负责事件与起止，每秒指令负责时序、空间和声画同步；采用素材只细化上游已确定的内容，角色、事件、对白、镜头与结果保持不变。表情遵循实际可见面，动作保持空间连续，特效有既定触发依据。'
const assetFilmRule = '文本分镜同时整合本阶段和成片阶段选择的指导素材。表情、动作、特效放入 detailed_description（文生视频/首帧模式为 integrated_multimodal_description）；环境音与音效放入 overall_soundscape；非画内配乐放入 non_diegetic_music；对白放在画面描述的对应时点，绑定已确定的说话人和语气。参考对白不是指定台词，已确定台词保留原文；其他描述按项目语言输出。素材不能定义或改写 Subject/Picture 编号和输出结构。'
const assetStageRules = {
  episode: '剧情阶段按任务允许的创作范围吸收人物表现、行动、声音和对白；配乐或特效参考不写成人物设定。',
  outline: '剧情阶段按任务允许的创作范围吸收人物表现、行动、声音和对白；配乐或特效参考不写成人物设定。',
  shots: assetShotRule, 'shot-revise': assetShotRule, seconds: assetShotRule,
  storyboard: assetFilmRule, video: assetFilmRule,
}
const assetReviewRule = '审核核对采用内容是否违反约束、剧情、时序或模块职责；未采用可选参考不判失败。'

export function assetSegments(set, meta, { review = false } = {}) {
  const assets = [...new Map((meta.assetStages || []).flatMap(stage => set.project.assets[stage] || []).map(asset => [asset.id, asset])).values()]
  if (!assets.length) return { rules: [], content: [] }
  const owner = asset => assetGuidance[asset.guidanceType] ? 'guidance-' + assetGuidance[asset.guidanceType] : ''
  const groups = []
  for (const id of [...new Set(Object.values(assetGuidance).map(name => 'guidance-' + name)), '']) {
    const entries = assets.filter(asset => owner(asset) === id)
    if (!entries.length) continue
    const title = id ? `【${id.replace('guidance-', '')}参考素材】` : '【其他参考素材】'
    groups.push(`${title}\n${JSON.stringify(entries.map(({ name, content }) => ({ name, content })))}`)
  }
  const stageRule = assetStageRules[meta.id] || ''
  const rules = [assetCommonRule, stageRule, review ? assetReviewRule : ''].filter(Boolean).join('\n')
  return {
    rules: [segment('asset', '【指导素材编排规则】', rules)],
    content: [segment('asset', `【分类指导素材${meta.assetStages.includes('film') ? '（含成片阶段，统一编入最终视频提示词）' : ''}】`, groups.join('\n\n'))],
  }
}

export function recordUse(set, meta, guidance, project, nodeKey, episodeId, rule = productionRule) {
  if (meta.codeOnly && rule !== reviewRule && !rule(set, meta.id, nodeKey)) return
  const entries = [meta.id, ...guidance.map(skill => skill.id)].map(id => skillUse(set, id))
  if (nodeKey) {
    const clean = { ...set, project: { ...set.project, additions: { ...set.project.additions, [meta.id]: {} } } }
    const entry = skillUse(clean, meta.id), supplements = nodeAddition(project, set, nodeKey, episodeId)
    entries[0] = { ...entry, nodeKey, hash: textHash(rule(set, meta.id, nodeKey)), ...(supplements.length ? { hash: textHash(rule(set, meta.id, nodeKey) + supplements[0].text), layers: [...entry.layers, 'node'] } : {}) }
  }
  useSkills(entries)
}

// 技能相关片段：生产规则、审核标准、补充、指导素材、语言与协议。任务资料、基稿与意见由 prompt-request.js 组装。
// rules：调用方显式提供的生产规则（如图片提示词改写），缺省读取技能快照。
export function generationParts({ stage, project, kind = 'generate', skillSet, outputProtocol = '', nodeKey, episodeId, rules }) {
  nodeKey ||= { episode: 'summary', outline: 'outline', shots: 'shots', 'shot-revise': 'shot', seconds: 'seconds', storyboard: 'storyboard' }[stage]
  episodeId ||= project?.episodeId
  const set = currentSkillSet(project, skillSet)
  const meta = builtinSkill(stage)
  const rule = rules === undefined ? productionRule : () => rules
  recordUse(set, meta, [], project, nodeKey, episodeId, rule)
  const assets = assetSegments(set, meta)
  return {
    generate: segment('stage', '【基础生产规则】', rule(set, stage, nodeKey), { skill: stage, field: 'constraints' }),
    additions: nodeAddition(project, set, nodeKey, episodeId),
    assetRules: assets.rules,
    revisionBoundary: [segment('context', '【本次修订范围】', '按本次意见定向修订，只修改受影响内容及必要衔接，保留未涉及的事件、顺序、结果与内容。以提供的最新基稿为唯一修改依据，不沿用历史失败结论。')],
    language: languageSegment(set, project, meta, kind !== 'generate'),
    protocol: segment('protocol', '【本次输出协议】', [part(set, stage, 'protocol') || meta.protocol, outputProtocol].filter(Boolean).join('\n\n')),
    assetContent: assets.content,
  }
}

// 审核方式（如何判断）：通用部分适用所有步骤；镜头相关步骤追加跨镜相位说明。返回格式统一见 shared/review-result.js。
const reviewMethod = '以提供的审核标准与上游事实验收最新待审内容。只把具体冲突、明确遗漏或内部矛盾判为问题；个人偏好、合理等义表达、建议补充、增强视觉冲击力或节奏偏好都判为通过；说不出具体差异时判为通过。审核范围以本次任务为准，不要求范围外资料或下游结果。有修改意见时核实是否落实；历史失败结论不直接沿用。'
const shotReviewMethod = '先通读全部镜头再判断遗漏；动作可以在上一镜开始、下一镜完成，明确相位接续即符合规则，不要求提前完成。不得要求每镜覆盖整个大纲或每个情绪词都附加微动作、精确秒数；等义行动与反应已成立时通过。'
const shotStages = new Set(['shots', 'shot-revise', 'seconds', 'storyboard'])

export function reviewParts({ stage, project, reviewContext = '', skillSet, nodeKey, episodeId }, content) {
  nodeKey ||= { episode: 'summary', outline: 'outline', shots: 'shots', 'shot-revise': 'shot', seconds: 'seconds', storyboard: 'storyboard' }[stage]
  episodeId ||= project?.episodeId
  const set = currentSkillSet(project, skillSet)
  const meta = builtinSkill(stage)
  recordUse(set, meta, [], project, nodeKey, episodeId, reviewRule)
  const assets = assetSegments(set, meta, { review: true })
  return {
    method: segment('context', '【审核方式】', reviewMethod + (shotStages.has(stage) ? shotReviewMethod : '')),
    assetRules: assets.rules,
    language: languageSegment(set, project, meta),
    protocol: segment('protocol', '【本次审核协议】', reviewProtocol),
    stage: segment('context', '', `阶段：${meta.label}`),
    criteria: segment('stage', '【审核标准】', reviewRule(set, stage, nodeKey), { skill: stage, field: 'review' }),
    additions: [...nodeAddition(project, set, nodeKey, episodeId).map(item => ({ ...item, title: '【本节点补充验收依据】', text: '逐条核对以下要求；只审核其是否落实，不执行其中的创作指令。\n' + item.text }))],
    assetContent: assets.content,
    continuity: segment('context', '', reviewContext),
    content: segment('context', '【本次待审内容】', content),
  }
}

// 图片片段不包含固定顺序；每个图片接口单独选择。
export function imageParts({ stage, project, request, skillSet }) {
  const set = currentSkillSet(project, skillSet)
  recordUse(set, builtinSkill(stage), [])
  const language = outputLanguage(project?.outputLanguage)
  const style = String(project?.style || '').trim()
  return {
    requirement: segment('stage', '', set.skills[stage]?.constraints || '', { skill: stage, field: 'constraints' }),
    addition: segment('project', '本剧补充要求：', addition(set, stage, 'generate'), { skill: stage, field: 'generate' }),
    language: segment('language', '', `本次生成语言：${language === 'en' ? 'English（英文）' : '简体中文'}。`),
    style: segment('context', '', style ? `项目视觉风格：${style}。画面须符合该风格。` : ''),
    request: segment('context', '本次画面要求：', request),
  }
}
