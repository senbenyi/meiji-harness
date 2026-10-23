import { nodeRules } from '../../node_runtime/node_state.js'
import { modelClient } from '@agent-modules/http-client'
import { composeNodePrompt } from '../../node_runtime/node_prompt_composer.js'
import { parseNodeOutput } from '../../node_runtime/output_response_parser.js'
import { digest, storyFingerprint, storyOutput, validateStoryCandidate } from './state.js'

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
    if (storyFingerprint(project) !== metadata.input_hash) throw new Error('大纲输入或规则已变化，请重新提交')
    const generated = previousResults.findLast(row => ['generate', 'revise'].includes(row.kind))
    const expectedOutput = generated ? digest(generated.result.output) : metadata.output_hash
    if (digest(storyOutput(project)) !== expectedOutput) throw new Error('大纲已被其他操作修改，请重新提交')
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
必须逐一追踪人物、物件、舱门等关键状态的完整变化链：变化前状态、触发动作、执行者和变化后状态；检查前后段与辅助字段是否仍残留相反状态。
完成全篇检查后，再把本轮所有仍成立且有具体依据的问题一次性汇总到issues，每项独立定位真实故事段ID及字段。同源问题可合并并列出所有受影响位置，不截断为第一个问题。无问题才passed。
逐字文本比较必须引用真实差异，前后相同的引文不能判为被改动；合理改编不等于违反原稿，不能把未明确锁定的细节自行升级为逐字要求。`
    if (kind === 'revise') prompt.messages[0].content += `
# 整轮修订
逐项处理review_issues中的全部问题，不得只修第一项。对同一人物/物件的时间、位置、进出、开闭和持有状态，沿全篇同步修正正文、continuity及相关辅助字段，清除旧状态残留。
修改完成后，重新通读全部故事段，逐项确认已报告问题已关闭，再核对跨段衔接，避免局部改动在后文造成新矛盾。输出完整集合，不只返回发生修改的一段。`
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
      await this.projects.saveStoryCandidate(ctx, output, { expectedOutput })
      return { result: { output, saved: true }, nextSteps: [step('review', ctx.step.round)] }
    }
    const review = output
    if (review.status === 'passed') {
      await this.projects.saveStoryCandidate(ctx, generated.result.output, { expectedOutput, passed: true })
      return { result: { review } }
    }
    const signature = digest({ input: metadata.input_hash, candidate: digest(generated.result.output), issues: [...review.issues].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), status: review.status })
    const repeated = previousResults.some(row => row.result?.signature === signature)
    const limit = this.getMaxRevisionRounds()
    const exhausted = ctx.step.round >= limit
    const reason = issueReason(review)
    if (review.status !== 'content_issue' || repeated || exhausted) return { status: 'rejected', reason, result: { review, signature, stop_code: review.status } }
    return { result: { review, signature }, nextSteps: [step('revise', ctx.step.round + 1)] }
  }
}
