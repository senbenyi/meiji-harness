import { isDeepStrictEqual } from 'node:util'
import { nodeRules } from '../../node_runtime/node_state.js'
import { runBoxModelTurn } from '../../node_runtime/box_model_runner.js'
import { parseNodeOutput } from '../../node_runtime/output_response_parser.js'
import { validateCharacterCandidate } from './state.js'

const step = (kind, round = 0) => ({ kind, round, name: { generate: '生成角色', revise: '按意见修订角色', review: '角色本地审核' }[kind], executor: 'ai' })
const issueReason = review => review.issues.map(issue => `${issue.location}：${issue.reason}；${issue.suggestion}`).join('\n')

/** 分阶段工具调用worker；每轮模型请求独立记录，阶段内续接读取及校验上下文。 */
export class CharacterExtractionExecutor {
  constructor({ projects, records, models, getMaxRevisionRounds }) {
    Object.assign(this, { projects, records, models, getMaxRevisionRounds })
    records.tasks.register('character_extraction', {
      label: '角色', plan: task => [step(task.action === 'revise' ? 'revise' : 'generate')],
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
    const input = {
      story_outline: savedInput.story_outline,
      scene_extraction: savedInput.scene_extraction || { scenes: [] },
      group_setting: savedInput.group_setting || { groups: [] },
      current_characters: generated ? generated.result.output : savedInput.current_characters,
      output_language: savedInput.output_language,
      instruction: savedInput.instruction,
      ...(kind === 'review' ? { previous_issues: lastReview?.result.review.issues || metadata.retry_review_issues || [] } : {}),
      ...(kind === 'revise' && (lastReview || metadata.retry_review_issues) ? { review_issues: lastReview?.result.review.issues || metadata.retry_review_issues } : {}),
    }
    const record = async (transfer, options) => {
      transfer.title = `角色 · ${ctx.step.name}`
      try { transfer.id = ctx.recordHttp(transfer, options) || transfer.id }
      catch (error) {
        if (error.code === 'STEP_CLOSED' && transfer.id) await this.records.http.record(transfer, options)
        throw error
      }
      await this.records.http.record(transfer, options)
    }
    const turn = await runBoxModelTurn({ ctx, nodeType: 'character_extraction', action, input, rules: metadata.input_snapshot.rules || nodeRules(project.character_extraction.node_state), goal: metadata.instruction, config, record,
      validate: value => { const output = parseNodeOutput('character_extraction', action, value); return kind === 'review' ? output : validateCharacterCandidate(output, { segments: savedInput.story_outline.segments, groups: savedInput.group_setting?.groups || [] }) },
    })
    if (turn.pending) return turn.pending
    const output = turn.output
    if (kind === 'generate' || kind === 'revise') {
      await this.projects.saveCharacterCandidate(ctx, output)
      return { result: { output, saved: true, box_turn: turn.trace }, nextSteps: [step('review', ctx.step.round)] }
    }
    const review = output
    if (review.status === 'passed') {
      await this.projects.saveCharacterCandidate(ctx, generated.result.output, { passed: true })
      return { result: { review, box_turn: turn.trace } }
    }
    const signature = { candidate: generated.result.output, issues: [...review.issues].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), status: review.status }
    const repeated = previousResults.some(row => isDeepStrictEqual(row.result?.signature, signature))
    const limit = this.getMaxRevisionRounds()
    const exhausted = ctx.step.round >= limit
    const reason = issueReason(review)
    if (review.status !== 'content_issue' || repeated || exhausted) return { status: 'rejected', reason, result: { review, signature, stop_code: review.status, box_turn: turn.trace } }
    return { result: { review, signature, box_turn: turn.trace }, nextSteps: [step('revise', ctx.step.round + 1)] }
  }
}
