import { nodeRules } from '../../node_runtime/node_state.js'
import { modelClient } from '@agent-modules/http-client'
import { composeNodePrompt } from '../../node_runtime/node_prompt_composer.js'
import { parseNodeOutput } from '../../node_runtime/output_response_parser.js'
import { digest, groupFingerprint, groupOutput, validateGroupCandidate } from './state.js'

const step = (kind, round = 0) => ({ kind, round, name: { generate: '生成团队', revise: '按意见修订团队', review: '团队本地审核' }[kind], executor: 'ai' })
const issueReason = review => review.issues.map(issue => `${issue.location}：${issue.reason}；${issue.suggestion}`).join('\n')

/** 无会话历史、无工具权限的独立模型worker；每次调用为独立可追踪步骤。 */
export class GroupSettingExecutor {
  constructor({ projects, records, models, getMaxRevisionRounds }) {
    Object.assign(this, { projects, records, models, getMaxRevisionRounds })
    records.tasks.register('group_setting', {
      label: '团队', plan: task => [step(task.action === 'revise' ? 'revise' : 'generate')],
      execute: ctx => this.execute(ctx),
    })
    records.tasks.recover(records.scope)
  }

  async execute(ctx) {
    const { task, signal, previousResults } = ctx, metadata = task.metadata
    const snapshot = await this.projects.snapshot(metadata.session_id), project = snapshot.project
    if (!project || project.basic_info.id !== metadata.project_id) throw new Error('项目已删除或会话归属已改变')
    if (groupFingerprint(project) !== metadata.input_hash) throw new Error('团队输入或规则已变化，请重新提交')
    const generated = previousResults.findLast(row => ['generate', 'revise'].includes(row.kind))
    const expectedOutput = generated ? digest(generated.result.output) : metadata.output_hash
    if (digest(groupOutput(project)) !== expectedOutput) throw new Error('团队已被其他操作修改，请重新提交')
    const config = await this.models.read(), kind = ctx.step.kind, action = kind
    const lastReview = previousResults.findLast(row => row.result?.review)
    const savedInput = metadata.input_snapshot
    const input = {
      story_outline: savedInput.story_outline,
      scene_extraction: savedInput.scene_extraction || { scenes: [] },
      current_groups: generated ? generated.result.output : savedInput.current_groups,
      output_language: savedInput.output_language,
      instruction: savedInput.instruction,
      ...(kind === 'revise' && (lastReview || metadata.retry_review_issues) ? { review_issues: lastReview?.result.review.issues || metadata.retry_review_issues } : {}),
    }
    const prompt = composeNodePrompt({ nodeType: 'group_setting', action, rules: nodeRules(project.group_setting.node_state), input, goal: metadata.instruction })
    const model = config.text.model
    ctx.recordPrompt({ model, messages: prompt.messages, input })
    const record = async (transfer, options) => {
      transfer.title = `团队 · ${ctx.step.name}`
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
    let output = parseNodeOutput('group_setting', action, response)
    if (kind !== 'review') output = validateGroupCandidate(output, { segments: savedInput.story_outline.segments })
    if (kind === 'generate' || kind === 'revise') {
      await this.projects.saveGroupCandidate(ctx, output, { expectedOutput })
      return { result: { output, saved: true }, nextSteps: [step('review', ctx.step.round)] }
    }
    const review = output
    if (review.status === 'passed') {
      await this.projects.saveGroupCandidate(ctx, generated.result.output, { expectedOutput, passed: true })
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
