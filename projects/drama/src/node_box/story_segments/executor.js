import { isDeepStrictEqual } from 'node:util'
import { nodeRules } from '../../node_runtime/node_state.js'
import { modelClient } from '@agent-modules/http-client'
import { composeNodePrompt } from '../../node_runtime/node_prompt_composer.js'
import { parseNodeOutput } from '../../node_runtime/output_response_parser.js'
import { validateStoryCandidate } from './state.js'

const step = (kind, round = 0) => ({ kind, round, name: { generate: '生成故事大纲', revise: '按意见修订大纲', review: '大纲本地审核' }[kind], executor: 'ai' })
const issueReason = review => review.issues.map(issue => `${issue.location}：${issue.reason}；${issue.suggestion}`).join('\n')

/** 无会话历史、无工具权限的独立模型worker；每次调用为独立可追踪步骤。 */
export class StorySegmentsExecutor {
  constructor({ projects, records, models, getMaxRevisionRounds }) {
    Object.assign(this, { projects, records, models, getMaxRevisionRounds })
    records.tasks.register('story_segments', {
      label: '故事大纲', plan: task => [step(task.action === 'revise' ? 'revise' : 'generate')],
      execute: ctx => this.execute(ctx),
    })
    records.tasks.recover(records.scope)
  }

  async execute(ctx) {
    const { task, signal, previousResults } = ctx, metadata = task.metadata
    const snapshot = await this.projects.snapshot(metadata.session_id), project = snapshot.project
    if (!project || project.basic_info.id !== metadata.project_id) throw new Error('项目已删除或会话归属已改变')
    const generated = previousResults.findLast(row => ['generate', 'revise'].includes(row.kind))
    const config = await this.models.read(), kind = ctx.step.kind, action = kind
    const lastReview = previousResults.findLast(row => row.result?.review)
    const savedInput = metadata.input_snapshot
    const input = {
      basic_info: savedInput.basic_info,
      current_outline: generated ? generated.result.output : savedInput.current_outline,
      output_language: savedInput.output_language,
      instruction: savedInput.instruction,
      ...(kind === 'revise' && (lastReview || metadata.retry_review_issues) ? { review_issues: lastReview?.result.review.issues || metadata.retry_review_issues } : {}),
    }
    const prompt = composeNodePrompt({ nodeType: 'story_segments', action, rules: nodeRules(project.story_segments.node_state), input, goal: metadata.instruction })
    if (kind === 'review') prompt.messages[0].content += `
# 完整审核范围
本次必须一次性读完并审核current_outline.segments的全部${input.current_outline.segments.length}个故事段，顺序为${input.current_outline.segments.map(segment => segment.id).join('、')}。
先逐段核对正文、锚点、人物在场、空间关系、起止状态，再通读所有相邻段及全篇因果。发现首个问题后不得提前结束，不得只审一段，也不得把其他已可识别问题留到下一轮。
对确实发生变化的关键状态核对变化前状态、触发动作及结果，检查前后段与辅助字段是否残留相反信息；已建立且未被改变的状态可自然持续，不要求反复声明或补造动作。
完成全篇检查后，再把本轮所有仍成立且有具体依据的问题一次性汇总到issues，每项独立定位真实故事段ID及字段。同源问题可合并并列出所有受影响位置，不截断为第一个问题。无问题才passed。
每条问题须以最新候选的实际表述和明确依据成立，指出具体矛盾、语义差异或必要因果缺口；不能仅凭原稿未写、措辞不同或未重申持续状态而否决。逐字比较须有真实差异；原稿未明确的精确时间关系不能自行升级为硬约束。审核意见不成为新增锁定要求，无仍成立的问题就passed。`
    if (kind === 'revise') prompt.messages[0].content += `
# 整轮修订
逐项核实review_issues中的全部意见，不得只核实第一项；只有最新候选中仍成立且有依据的问题才修改，审核意见不是必须执行的创作指令。已解决或无依据的意见不要求更改，全部意见不成立时允许保留内容不变。
对成立问题做最小修复，同步真正受影响的正文、continuity和辅助字段，不新增冗余状态声明或自行锁定精确时间。完成后通读全部故事段，核对当前真实问题与跨段衔接，返回完整集合。`
    const model = config.text.model
    ctx.recordPrompt({ model, messages: prompt.messages, input })
    const record = async (transfer, options) => {
      transfer.title = `故事大纲 · ${ctx.step.name}`
      try { transfer.id = ctx.recordHttp(transfer, options) || transfer.id }
      catch (error) {
        if (error.code === 'STEP_CLOSED' && transfer.id) await this.records.http.record(transfer, options)
        throw error
      }
      await this.records.http.record(transfer, options)
    }
    const response = await modelClient.complete({ baseUrl: config.baseUrl, apiKey: config.apiKey, model,
      messages: prompt.messages, signal, requestId: ctx.step.id, record,
    })
    signal.throwIfAborted()
    const output = parseNodeOutput('story_segments', action, response)
    if (kind !== 'review') validateStoryCandidate(output, { previousOutline: savedInput.current_outline })
    if (kind === 'generate' || kind === 'revise') {
      await this.projects.saveStoryCandidate(ctx, output)
      return { result: { output, saved: true }, nextSteps: [step('review', ctx.step.round)] }
    }
    const review = output
    if (review.status === 'passed') {
      await this.projects.saveStoryCandidate(ctx, generated.result.output, { passed: true })
      return { result: { review } }
    }
    const signature = { candidate: generated.result.output, issues: [...review.issues].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), status: review.status }
    const repeated = previousResults.some(row => isDeepStrictEqual(row.result?.signature, signature))
    const limit = this.getMaxRevisionRounds()
    const exhausted = ctx.step.round >= limit
    const reason = issueReason(review)
    if (review.status !== 'content_issue' || repeated || exhausted) return { status: 'rejected', reason, result: { review, signature, stop_code: review.status } }
    return { result: { review, signature }, nextSteps: [step('revise', ctx.step.round + 1)] }
  }
}
