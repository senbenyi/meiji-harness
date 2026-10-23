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
    const expectedOutput = metadata.output_hash
    if (digest(storyOutput(project)) !== expectedOutput) throw new Error('大纲已被其他操作修改，请重新提交')
    const config = await this.models.read(), kind = ctx.step.kind, action = kind
    const lastReview = previousResults.findLast(row => row.result?.review)
    const savedInput = metadata.input_snapshot
    const input = {
      basic_info: savedInput.basic_info,
      current_outline: generated ? generated.result.output : savedInput.current_outline,
      output_language: savedInput.output_language,
      instruction: savedInput.instruction,
      ...(kind === 'revise' && lastReview ? { review_issues: lastReview.result.review.issues } : {}),
    }
    const prompt = composeNodePrompt({ nodeType: 'story_segments', action, rules: nodeRules(project.story_segments.node_state), input, goal: metadata.instruction })
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
      return { result: { output }, nextSteps: [step('review', ctx.step.round)] }
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
    const reason = (repeated ? '相同内容与规则下重复出现相同审核问题，已停止修订。\n'
      : exhausted && review.status === 'content_issue' ? `已达到最大修订轮次（${limit}轮），仍未通过审核。\n` : '') + issueReason(review)
    if (review.status !== 'content_issue' || repeated || exhausted) return { status: 'rejected', reason, result: { review, signature, stop_code: exhausted && review.status === 'content_issue' ? 'revision_limit_reached' : review.status } }
    return { result: { review, signature }, nextSteps: [step('revise', ctx.step.round + 1)] }
  }
}
