import { nodeRules } from '../../node_runtime/node_state.js'
import { modelClient } from '@agent-modules/http-client'
import { composeNodePrompt } from '../../node_runtime/node_prompt_composer.js'
import { digest, shotFingerprint, shotOutput, parseShotCandidate } from './state.js'
import { shotReviewHistory } from './review_context.js'
import { parseShotReview } from './review_validation.js'

const step = (kind, round = 0) => ({ kind, round, name: { generate: '生成分镜', revise: '按意见修订分镜', review: '分镜本地审核' }[kind], executor: 'ai' })
const issueReason = review => review.issues.map(issue => `${issue.location}：${issue.reason}；${issue.suggestion}`).join('\n')

/** 无会话历史、无工具权限的独立模型worker；每次调用为独立可追踪步骤。 */
export class ShotDesignExecutor {
  constructor({ projects, records, models, getMaxRevisionRounds, getMaxOutputRepairs = () => 2 }) {
    Object.assign(this, { projects, records, models, getMaxRevisionRounds, getMaxOutputRepairs })
    records.tasks.register('shot_design', {
      label: '分镜', plan: task => [step(task.action === 'revise' ? 'revise' : 'generate')],
      execute: ctx => this.execute(ctx),
    })
    records.tasks.recover(records.scope)
  }

  async execute(ctx) {
    const { task, signal, previousResults } = ctx, metadata = task.metadata
    const snapshot = await this.projects.snapshot(metadata.session_id), project = snapshot.project
    if (!project || project.basic_info.id !== metadata.project_id) throw new Error('项目已删除或会话归属已改变')
    if (shotFingerprint(project) !== metadata.input_hash) throw new Error('分镜输入或规则已变化，请重新提交')
    const generated = previousResults.findLast(row => ['generate', 'revise'].includes(row.kind) && row.result?.output)
    const expectedOutput = generated ? digest(generated.result.output) : metadata.output_hash
    if (digest(shotOutput(project)) !== expectedOutput) throw new Error('分镜已被其他操作修改，请重新提交')
    const config = await this.models.read(), kind = ctx.step.kind, action = kind
    const lastReview = previousResults.findLast(row => row.result?.review)
    const savedInput = metadata.input_snapshot
    const repair = ctx.step.metadata.output_repair_attempt || 0
    const invalidResult = previousResults.at(-1)?.result
    const reviewHistory = shotReviewHistory(previousResults, { retryIssues: metadata.retry_review_issues, initialOutput: savedInput.current_shots })
    const input = {
      story_outline: savedInput.story_outline,
      scene_extraction: savedInput.scene_extraction, group_setting: savedInput.group_setting, character_extraction: savedInput.character_extraction,
      current_shots: generated ? generated.result.output : savedInput.current_shots,
      output_language: savedInput.output_language,
      instruction: savedInput.instruction,
      ...(kind === 'review' ? { previous_issues: lastReview?.result.review.issues || metadata.retry_review_issues || [] } : {}),
      ...(repair ? { output_repair: { attempt: repair, validation_error: invalidResult.validation_error,
        invalid_output: invalidResult.invalid_output, instruction: '仅修复本动作输出。生成/修订返回完整非空有效分镜；审核仅重核当前候选并修正证据，不改写分镜、不无据通过。' } } : {}),
      ...(['revise', 'review'].includes(kind) && reviewHistory.length ? { review_history: reviewHistory } : {}),
      ...(kind === 'revise' && (lastReview || metadata.retry_review_issues) ? { review_issues: lastReview?.result.review.issues || metadata.retry_review_issues } : {}),
    }
    const prompt = composeNodePrompt({ nodeType: 'shot_design', action, rules: nodeRules(project.shot_design.node_state), input, goal: metadata.instruction })
    const model = config.text.model
    ctx.recordPrompt({ model, messages: prompt.messages, input })
    const record = async (transfer, options) => {
      transfer.title = `分镜 · ${ctx.step.name}`
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
    let output
    try {
      output = kind === 'review' ? parseShotReview(response, input, nodeRules(project.shot_design.node_state)) : parseShotCandidate(response, savedInput)
    } catch (error) {
      // 仅模型输出解析/校验进入修复；网络、存储、取消及并发错误不会被吞掉或重试。
      if (!(error instanceof TypeError)) throw error
      const result = { validation_error: { code: error.code || 'INVALID_SHOT_OUTPUT', message: error.message }, invalid_output: response, output_repair_attempt: repair }
      if (repair >= this.getMaxOutputRepairs()) throw new TypeError(`分镜${kind === 'review' ? '审核' : '生成'}输出修复次数已用尽：${error.message}`)
      return { result, nextSteps: [{ ...step(kind, ctx.step.round), name: kind === 'review' ? '修复分镜审核输出' : '修复分镜输出', metadata: { output_repair_attempt: repair + 1 } }] }
    }
    if (kind === 'generate' || kind === 'revise') {
      await this.projects.saveShotCandidate(ctx, output, { expectedOutput })
      return { result: { output, saved: true }, nextSteps: [step('review', ctx.step.round)] }
    }
    const review = output
    if (review.status === 'passed') {
      await this.projects.saveShotCandidate(ctx, generated.result.output, { expectedOutput, passed: true })
      return { result: { review } }
    }
    const evidence = review.issues.map(({ category, source_path, source_quote, candidate_path, candidate_quote }) => ({ category, source_path, source_quote, candidate_path, candidate_quote }))
    const signature = digest({ input: metadata.input_hash, candidate: digest(generated.result.output), issues: evidence.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), status: review.status })
    const repeated = previousResults.some(row => row.result?.signature === signature)
    const limit = this.getMaxRevisionRounds()
    const exhausted = ctx.step.round >= limit
    const reason = issueReason(review)
    if (review.status !== 'content_issue' || repeated || exhausted) return { status: 'rejected', reason, result: { review, signature, stop_code: review.status } }
    return { result: { review, signature }, nextSteps: [step('revise', ctx.step.round + 1)] }
  }
}
