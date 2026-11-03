/** 为宿主自带模式提供共享业务工具和指导，不覆盖模式自身的身份及能力。 */
export const name = 'drama-session'
export const inject = ['drama', 'tools', 'systemPrompt']

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(ctx.drama.createProjectTool), 'drama: create project tool')
  if(ctx.drama.documentVersion===3){
    for(const tool of ctx.drama.productionTools||[])ctx.effect(()=>ctx.tools.register(tool),`drama: ${tool.name}`)
    ctx.effect(()=>ctx.systemPrompt.section({name:'drama:production',order:ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),text:'长期记忆仅服务视频制作（剧本改编、人物剧情、镜头、画面、声音、字幕、剪辑等），不保存代码风格、技术选型或开发流程。宿主对话会按阈值自动提炼；长对话结束、明确修改决定后可用drama-maintain-memory的extract整理当前已记录对话，reconcile核对重复冲突，compress压缩长期记忆；先读已有记忆避免重复保存，只有用户原话可作证据，压缩保留原文和硬约束。跨会话先用drama-read-memory按主题读取project和engineering范围，project是本短剧决定/约束/偏好/未决问题，engineering只在Drama跨短剧共享用户偏好。只在用户明确表达决定或偏好时用drama-write-memory，保留原话；仅用户明确跨短剧复用时保存engineering，不自动提升AI推断或审核意见。主题key一致时本次明确目标优先于短剧记忆，短剧优先于工程偏好；记忆不替代当前正式产物，不越过程序契约。短剧创建：仅当用户明确要求创建短剧时，调用drama-create-project。工具以纯程序建立新结构、工作区和标准模式新会话，不生成摘要、不改写原稿。原著解析、联合改编规划、连续故事分段定稿、文字分镜、素材准备、参考确认、分片、视频与后期分别保存产物，前期不分集。仅调用已注册的业务工具；尚未接入的节点明确说明，不声称已生成，不绕过校验直接修改project.json。人工编辑可以在每一步面板中进行，保存不等于审核通过。先用drama-production-context按索引/Pointer/范围读取，再用drama-run-stage执行已确认目标；修改已有文本可用revise=true，失败可用resume_of检查点续接。用户要求整条流程时依次推进，但素材图和视频生成只产生候选，须由用户检查、明确选用并确认后再继续；不能把生成成功当人工确认，不代替用户做选用决定。剪辑之后才按节奏确定集界并真实导出。'}),'drama: production guidance')
    return
  }

}
