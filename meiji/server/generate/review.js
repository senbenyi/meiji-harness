import { markApiFailure } from '../data/self-checks.js'
import { continuityReviewContext } from '../prompts/continuity-review.js'
import { askSkill } from './chat.js'
export async function reviewContent({ project, stage, shotId, text, route, request = askSkill }) {
  let result
  try { result = await request('skill-gongyong-content-review', `只审核已编辑原文，不生成或改写内容。首行 PASS 或 FAIL，失败后用项目语言写原因。\n阶段：${stage}\n本集摘要：${project.summary.content}\n大纲：${project.plot.outline.content || ''}${continuityReviewContext(project, shotId)}\n待审内容：\n${text}`, { project, route, json: false, includeReview: false, maxTokens: 4096 }) } catch (error) { throw markApiFailure(error) }
  return result.trim() === 'PASS' ? { passed: true, failures: [] } : { passed: false, failures: [result] }
}
