/**
 * 输出健康闸门的判定规则。纯逻辑，无 I/O——指标由 infrastructure 层采集后传入。
 *
 * 与 llm-ai-model/services/model_api/media_gate.py 的 evaluate 必须保持同义：
 * 两侧跑同一套样本集，判定不得分叉。
 */
import { CONTRACT } from './media-gate-contract.js'

function resolveExpected(spec, request) {
  if (!spec || typeof spec !== 'object' || !('expectedFrom' in spec)) return spec
  let cursor = { request: request || {} }
  for (const segment of String(spec.expectedFrom).split('.')) {
    if (!cursor || typeof cursor !== 'object' || !(segment in cursor)) return null
    cursor = cursor[segment]
  }
  return cursor
}

/** 返回 { passed, expected }；passed 为 null 表示指标缺失或期望未知，规则跳过。 */
function checkRule(rule, metrics, request) {
  const actual = metrics[rule.metric]
  if (actual === undefined || actual === null) return { passed: null, expected: null }
  const { op, value } = rule
  if (op === 'withinRatioOf') {
    const target = resolveExpected(value, request)
    if (target === null || target === undefined) return { passed: null, expected: null }
    const tolerance = target * value.toleranceRatio
    return { passed: Math.abs(actual - target) <= tolerance, expected: `${target} ± ${tolerance}` }
  }
  if (op === 'gt') return { passed: actual > value, expected: `> ${value}` }
  if (op === 'gte') return { passed: actual >= value, expected: `>= ${value}` }
  if (op === 'lte') return { passed: actual <= value, expected: `<= ${value}` }
  if (op === 'eq') return { passed: actual === value, expected: value }
  if (op === 'in') return { passed: value.includes(actual), expected: value }
  throw new Error(`契约中出现未支持的算子：${op}`)
}

/**
 * 按契约判定指标。
 * @param {Record<string, unknown>} metrics infrastructure 层采集的实测值
 * @param {string[]} kinds 'image' | 'video' | 'audio'
 * @param {Record<string, unknown>} [request] 供 withinRatioOf 解析期望值
 */
export function evaluateMedia(metrics, kinds, request = null, contract = CONTRACT) {
  const selected = new Set(kinds)
  const failures = []
  const warnings = []
  for (const rule of contract.rules) {
    if (!rule.appliesTo.some(kind => selected.has(kind))) continue
    const { passed, expected } = checkRule(rule, metrics, request)
    if (passed !== false) continue
    const record = { ruleId: rule.id, actual: metrics[rule.metric], expected, message: rule.message }
    if (rule.severity === 'fail') failures.push(record)
    else warnings.push(record)
  }
  return { pass: failures.length === 0, kind: [...kinds], metrics, failures, warnings }
}

/** 给 issue/error 用的一行摘要，必须带规则 id——重试要靠它决定改哪个变量。 */
export function mediaFailureSummary(technical) {
  if (!technical?.failures?.length) return '未知质检失败'
  return technical.failures
    .map(item => `${item.ruleId}（实测 ${item.actual}，要求 ${item.expected}）`)
    .join('；')
}
