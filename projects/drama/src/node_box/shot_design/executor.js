import { isDeepStrictEqual } from 'node:util'
import { nodeRules } from '../../node_runtime/node_state.js'
import { runBoxModelTurn } from '../../node_runtime/box_model_runner.js'
import { parseShotCandidate } from './state.js'
import { shotReviewHistory } from './review_context.js'
import { parseShotReview } from './review_validation.js'

const step = (kind, round = 0) => ({ kind, round, name: { generate: '生成分镜', revise: '按意见修订分镜', review: '分镜本地审核' }[kind], executor: 'ai' })
const issueReason = review => review.issues.map(issue => `${issue.location}：${issue.reason}；${issue.suggestion}`).join('\n')

/** 分阶段工具调用worker；每轮模型请求独立记录，阶段内续接读取及校验上下文。 */
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
    const generated = previousResults.findLast(row => ['generate', 'revise'].includes(row.kind) && row.result?.output)
    const config = await this.models.read(), kind = ctx.step.kind, action = kind
    const lastReview = previousResults.findLast(row => row.result?.review)
    const savedInput = metadata.input_snapshot
    const reviewHistory = shotReviewHistory(previousResults, { retryIssues: metadata.retry_review_issues, initialOutput: savedInput.current_shots })
    const input = {
      story_outline: savedInput.story_outline,
      scene_extraction: savedInput.scene_extraction, group_setting: savedInput.group_setting, character_extraction: savedInput.character_extraction,
      current_shots: generated ? generated.result.output : savedInput.current_shots,
      output_language: savedInput.output_language,
      instruction: savedInput.instruction,
      ...(kind === 'review' ? { previous_issues: lastReview?.result.review.issues || metadata.retry_review_issues || [] } : {}),
      ...(['revise', 'review'].includes(kind) && reviewHistory.length ? { review_history: reviewHistory } : {}),
      ...(kind === 'revise' && (lastReview || metadata.retry_review_issues) ? { review_issues: lastReview?.result.review.issues || metadata.retry_review_issues } : {}),
    }
    const record = async (transfer, options) => {
      transfer.title = `分镜 · ${ctx.step.name}`
      try { transfer.id = ctx.recordHttp(transfer, options) || transfer.id }
      catch (error) {
        if (error.code === 'STEP_CLOSED' && transfer.id) await this.records.http.record(transfer, options)
        throw error
      }
      await this.records.http.record(transfer, options)
    }
    const turn = await runBoxModelTurn({ ctx, nodeType: 'shot_design', action, input, rules: metadata.input_snapshot.rules || nodeRules(project.shot_design.node_state), goal: metadata.instruction, config, record,
      validate: value => kind === 'review' ? parseShotReview(value, input, metadata.input_snapshot.rules || nodeRules(project.shot_design.node_state)) : parseShotCandidate(value, savedInput),
      maxOutputRepairs: this.getMaxOutputRepairs(),
    })
    if (turn.pending) return turn.pending
    const output = turn.output
    if (kind === 'generate' || kind === 'revise') {
      await this.projects.saveShotCandidate(ctx, output)
      return { result: { output, saved: true, box_turn: turn.trace }, nextSteps: [step('review', ctx.step.round)] }
    }
    const review = output
    if (review.status === 'passed') {
      await this.projects.saveShotCandidate(ctx, generated.result.output, { passed: true })
      return { result: { review, box_turn: turn.trace } }
    }
    const evidence = review.issues.map(({ category, source_path, source_quote, candidate_path, candidate_quote }) => ({ category, source_path, source_quote, candidate_path, candidate_quote }))
    const signature = { candidate: generated.result.output, issues: evidence.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), status: review.status }
    const repeated = previousResults.some(row => isDeepStrictEqual(row.result?.signature, signature))
    const limit = this.getMaxRevisionRounds()
    const exhausted = ctx.step.round >= limit
    const reason = issueReason(review)
    if (review.status !== 'content_issue' || repeated || exhausted) return { status: 'rejected', reason, result: { review, signature, stop_code: review.status, box_turn: turn.trace } }
    return { result: { review, signature, box_turn: turn.trace }, nextSteps: [step('revise', ctx.step.round + 1)] }
  }
}
