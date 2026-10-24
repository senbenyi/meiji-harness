/** 为宿主自带模式提供共享业务工具和指导，不覆盖模式自身的身份及能力。 */
import { planningGuidance } from './planning_guidance.js'
export const name = 'drama-session'
export const inject = ['drama', 'tools', 'systemPrompt']

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(ctx.drama.createProjectTool), 'drama: create project tool')
  ctx.effect(() => ctx.tools.register(ctx.drama.optimizeScriptTool), 'drama: optimize script tool')
  if (ctx.drama.generateStoryOutlineTool) ctx.effect(() => ctx.tools.register(ctx.drama.generateStoryOutlineTool), 'drama: generate story outline tool')
  if (ctx.drama.generateCostumeImagesTool) ctx.effect(() => ctx.tools.register(ctx.drama.generateCostumeImagesTool), 'drama: generate costume images tool')
  if (ctx.drama.extractCharactersTool) ctx.effect(() => ctx.tools.register(ctx.drama.extractCharactersTool), 'drama: extract characters tool')
  for (const tool of ctx.drama.planningTools || []) ctx.effect(() => ctx.tools.register(tool), `drama: ${tool.name}`)
  ctx.effect(() => ctx.systemPrompt.section({ name: 'drama:box-planning',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'), text: planningGuidance,
  }), 'drama: box planning guidance')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'drama:project-creation',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: '项目创建：仅当用户明确要求创建短剧项目时，调用 drama-create-project；项目名使用用户指定名称，其他资料仅填写用户已提供的内容，未提供则留空，不编造。工具会创建以项目名称命名的独立工作区和标准模式新会话，保留原会话的归属及消息。以工具结果确认是否成功，失败不得声称创建成功。允许从已有项目会话创建其他项目。',
  }), 'drama: project creation guidance')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'drama:script-optimization',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: '剧本优化：用户明确要求优化或按意见改编当前项目剧本时，调用drama-optimize-script，把用户本次要求准确整理到instruction，不自行添加改编方向、不在会话中直接改写项目文件。工具只读取当前会话绑定项目；创建新项目后应在新项目会话中发起优化，不得在原项目会话误改旧项目。缺少项目或原稿时说明原因并请用户创建项目或导入原稿。工具内部按项目规则生成、审核和修订，返回completed才说明已完成；rejected/failed/cancelled如实说明。规则冲突或上游问题停止，不自行改规则。该动作不自动执行后续节点或重做视频。',
  }), 'drama: script optimization guidance')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'drama:story-outline',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: '故事大纲：用户要求生成故事大纲、故事分段或修改已有大纲时，调用drama-generate-story-outline，instruction准确保留用户本次要求，不自行添加情节或风格。程序只读取当前绑定项目的工作剧本及已有大纲，优化剧本是可选步骤，不强制先优化。工具等待生成、审核及必要修订，completed才表示大纲已保存；其他状态如实说明。不得自行写项目文件、改规则或自动执行人物、场景等后续节点。规则冲突需用户授权后修复，修复后通过retry_of关联原大纲报告。',
  }), 'drama: story outline guidance')
}
