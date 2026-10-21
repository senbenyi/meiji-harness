import { modelClient } from '@agent-modules/http-client'
import { composeNodePrompt } from '../../node_runtime/node_prompt_composer.js'
import { parseNodeOutput } from '../../node_runtime/output_response_parser.js'
import { digest, scriptFingerprint } from './state.js'

const step = (kind, round = 0) => ({ kind, round, name: { generate: '生成优化剧本', revise: '按意见修订剧本', review: '剧本本地审核', project_review: '主Agent项目审核' }[kind], executor: 'ai' })
const issueReason = review => review.issues.map(issue => `${issue.location}：${issue.reason}；${issue.suggestion}`).join('\n')

/** 无会话历史、无工具权限的独立模型worker；每次调用为独立可追踪步骤。 */
export class ScriptRevisionExecutor {
  constructor({ projects, records, models }) {
    Object.assign(this, { projects, records, models })
    records.tasks.register('script_revision', {
      label: '剧本优化', plan: task => [step(task.action === 'revise' ? 'revise' : 'generate')],
      execute: ctx => this.execute(ctx),
    })
    records.tasks.recover(records.scope)
  }

  async execute(ctx) {
    const { task, signal, previousResults } = ctx, metadata = task.metadata
    const snapshot = await this.projects.snapshot(metadata.session_id), project = snapshot.project
    if (!project || project.basic_info.id !== metadata.project_id) throw new Error('项目已删除或会话归属已改变')
    if (scriptFingerprint(project) !== metadata.input_hash) throw new Error('剧本资料或规则已变化，请重新提交')
    const generated = previousResults.findLast(row => ['generate', 'revise'].includes(row.kind))
    const expectedOutput = generated ? digest(generated.result.output) : metadata.output_hash
    if (digest(project.script_revision.output) !== expectedOutput) throw new Error('优化稿已被其他操作修改，请重新提交')
    const config = await this.models.read(), kind = ctx.step.kind, action = kind === 'project_review' ? 'review' : kind
    const lastReview = previousResults.findLast(row => row.result?.review)
    const input = {
      original_script: project.basic_info.original_script,
      current_script: project.script_revision.output.body ? project.script_revision.output : null,
      creative_requirements: project.basic_info.creative_requirements,
      reference_episode_duration_seconds: project.basic_info.reference_episode_duration_seconds,
      output_language: metadata.language,
      instruction: metadata.instruction,
      ...(kind === 'revise' && lastReview ? { review_issues: lastReview.result.review.issues } : {}),
    }
    const prompt = composeNodePrompt({ nodeType: 'script_revision', action, rules: project.script_revision.rules, input, goal: metadata.instruction })
    if (kind === 'project_review') prompt.messages.unshift({ role: 'system', content: '你是主Agent的项目审核。仅核对当前目标、本次候选、实际引用的原始剧本和本节点规则。返回规定的四种审核结论之一，不读取或推测其他节点，不修改规则。' })
    const model = kind === 'project_review' ? config.session.model : config.text.model
    ctx.recordPrompt({ model, messages: prompt.messages, input })
    const record = async (transfer, options) => {
      transfer.title = `剧本优化 · ${ctx.step.name}`
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
    const output = parseNodeOutput('script_revision', action, response)
    if (kind === 'generate' || kind === 'revise') {
      await this.projects.saveScriptCandidate(ctx, output, { expectedOutput, reason: '候选已保存，等待审核' })
      return { result: { output }, nextSteps: [step('review', ctx.step.round)] }
    }
    const review = output
    if (review.status === 'passed') {
      if (kind === 'review') return { result: { review }, nextSteps: [step('project_review', ctx.step.round)] }
      await this.projects.saveScriptCandidate(ctx, project.script_revision.output, { expectedOutput, passed: true })
      return { result: { review } }
    }
    const signature = digest({ input: metadata.input_hash, candidate: expectedOutput, issues: [...review.issues].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), status: review.status })
    const repeated = previousResults.some(row => row.result?.signature === signature)
    const reason = repeated ? '相同内容与规则下重复出现相同审核问题，已停止修订。\n' + issueReason(review) : issueReason(review)
    await this.projects.saveScriptCandidate(ctx, project.script_revision.output, { expectedOutput, reason })
    if (review.status !== 'content_issue' || repeated) return { status: 'rejected', reason, result: { review, signature } }
    return { result: { review, signature }, nextSteps: [step('revise', ctx.step.round + 1)] }
  }
}
