/**
 * P4 单意图端到端基线。
 *
 * 跑通"一句话 → 规划 → 生产 → QC → 结果"，把决策门需要的实测数据落成一份报告。
 * 这个脚本**不写新功能，只测量**——P4 阶段只允许修 bug，不允许加能力。
 *
 * 它打的是正在运行的 dsh web 的 HTTP 接口，而不是直接 import 服务：规划要走宿主的
 * LLM，只有真实服务进程里才有。
 *
 *   node scripts/baseline-run.mjs \
 *     --base-url http://127.0.0.1:3080 \
 *     --workspace /root/autodl-fs/elysium-workspace \
 *     --repeat 3 --out baseline-report.json
 *
 * --workspace 可选；给了才能读 receipt 做泄漏率核对（脚本需与服务同机）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const FIXED_INTENT = '雨夜末班列车上，两名旧识重逢，在到站前必须对一段未了结的关系作出选择。'

function parseArgs(argv) {
  const args = { baseUrl: 'http://127.0.0.1:3080', workspace: '', repeat: 1, out: 'baseline-report.json', durationSec: 20, sourceText: FIXED_INTENT, timeoutMs: 45 * 60 * 1000 }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--base-url') { args.baseUrl = value.replace(/\/$/, ''); index += 1 }
    else if (key === '--workspace') { args.workspace = value; index += 1 }
    else if (key === '--repeat') { args.repeat = Math.max(1, Number(value) || 1); index += 1 }
    else if (key === '--out') { args.out = value; index += 1 }
    else if (key === '--duration') { args.durationSec = Number(value) || 20; index += 1 }
    else if (key === '--source-text') { args.sourceText = value; index += 1 }
    else if (key === '--timeout-min') { args.timeoutMs = (Number(value) || 45) * 60 * 1000; index += 1 }
  }
  return args
}

async function call(baseUrl, route, body = {}) {
  const response = await fetch(`${baseUrl}/elysium/api${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = { ok: false, raw: text.slice(0, 500) } }
  if (!response.ok || data?.ok === false) {
    const error = new Error(`${route} 失败：${data?.message || data?.error || response.status}`)
    error.route = route
    error.data = data
    throw error
  }
  return data
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function percentile(values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index]
}

/** 读产物旁边的 receipt，核对"标了 succeeded 的东西是否真的过了闸门"。 */
function auditReceipts(workspace, projectId, episodeId, tasks) {
  if (!workspace) return { checked: 0, missing: [], leaked: [], skipped: '未提供 --workspace' }
  const episodeDir = path.join(workspace, 'projects', projectId, 'episodes', episodeId)
  const missing = []
  const leaked = []
  let checked = 0
  for (const task of tasks) {
    if (task.status !== 'succeeded' || !task.path) continue
    const receiptPath = path.join(episodeDir, `${task.path}.receipt.json`)
    if (!fs.existsSync(receiptPath)) { missing.push(task.id); continue }
    try {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
      checked += 1
      // 泄漏 = 标了成功、但 receipt 说技术判据没过。目标为 0。
      if (receipt?.qc?.technical?.pass !== true) leaked.push({ taskId: task.id, failures: receipt?.qc?.technical?.failures || [] })
    } catch (error) {
      missing.push(`${task.id}（receipt 无法解析：${error.message}）`)
    }
  }
  return { checked, missing, leaked }
}

function summarizeTasks(tasks) {
  const terminal = tasks.filter(task => ['succeeded', 'needs_attention'].includes(task.status))
  const succeeded = tasks.filter(task => task.status === 'succeeded')
  const firstPass = succeeded.filter(task => (task.attempt || 1) <= 1)
  const retried = succeeded.filter(task => (task.attempt || 1) > 1)
  const attempts = terminal.map(task => task.attempt || 1)
  const shotTasks = tasks.filter(task => ['start_frame', 'keyframe'].includes(task.type))
  return {
    total: tasks.length,
    succeeded: succeeded.length,
    needsAttention: tasks.filter(task => task.status === 'needs_attention').length,
    // 首次通过率：终态任务里一次就过的比例。
    firstPassRate: terminal.length ? Number((firstPass.length / terminal.length).toFixed(4)) : null,
    // 自动恢复率：失败过但最终自己跑通的比例（分母是所有失败过的任务）。
    autoRecoveryRate: (retried.length + tasks.filter(t => t.status === 'needs_attention').length)
      ? Number((retried.length / (retried.length + tasks.filter(t => t.status === 'needs_attention').length)).toFixed(4))
      : null,
    avgAttempts: attempts.length ? Number((attempts.reduce((sum, value) => sum + value, 0) / attempts.length).toFixed(3)) : null,
    shotAvgAttempts: shotTasks.length
      ? Number((shotTasks.reduce((sum, task) => sum + (task.attempt || 1), 0) / shotTasks.length).toFixed(3))
      : null,
  }
}

async function runOnce(args, index) {
  const startedAt = Date.now()
  const marks = {}
  await call(args.baseUrl, '/comfyui.reset_transfer_stats').catch(() => null)

  const project = await call(args.baseUrl, '/project.create', { title: `P4 基线 ${new Date().toISOString()} #${index + 1}` })
  const projectId = project.project?.id || project.projectId
  const episodeId = 'episode-01'

  // 规划：一句话进去，章节与锚点出来。
  await call(args.baseUrl, '/episode.create', {
    projectId, episodeId, title: '基线单集',
    sourceText: args.sourceText, targetDurationSec: args.durationSec,
  })
  marks.planningMs = Date.now() - startedAt

  await call(args.baseUrl, '/production.start', { projectId, episodeId, confirmAuthorizedContent: true })
  marks.submittedMs = Date.now() - startedAt

  let status = null
  let firstArtifactMs = null
  const deadline = Date.now() + args.timeoutMs
  for (;;) {
    if (Date.now() > deadline) throw new Error(`基线超时：超过 ${Math.round(args.timeoutMs / 60000)} 分钟仍未收敛`)
    status = await call(args.baseUrl, '/production.status', { projectId, episodeId })
    const tasks = status.tasks || []
    if (firstArtifactMs === null && tasks.some(task => task.status === 'succeeded')) {
      // 一句话到首个可见产物：用户感知的"多久能看到东西"。
      firstArtifactMs = Date.now() - startedAt
    }
    const settled = !['running', 'queued'].includes(status.state?.status)
      && !tasks.some(task => ['running', 'queued'].includes(task.status))
    if (settled) break
    await sleep(3000)
  }
  marks.settledMs = Date.now() - startedAt
  marks.firstArtifactMs = firstArtifactMs

  const transfer = await call(args.baseUrl, '/comfyui.transfer_stats').catch(() => ({ stats: null }))
  const tasks = status.tasks || []
  const audit = auditReceipts(args.workspace, projectId, episodeId, tasks)
  const videoSeconds = Number(status.episode?.targetDurationSec || args.durationSec)

  return {
    iteration: index + 1,
    projectId,
    episodeId,
    finalStatus: status.state?.status || null,
    marks,
    // GPU 时间按每分钟成片折算，便于横向比较不同时长的跑批。
    gpuSecondsPerVideoMinute: videoSeconds ? Number(((marks.settledMs / 1000) / (videoSeconds / 60)).toFixed(1)) : null,
    tasks: summarizeTasks(tasks),
    receipts: audit,
    transfer: transfer.stats || null,
    sharedInputRoot: transfer.sharedInputRoot || '',
    issues: (status.issues || []).map(issue => ({ taskId: issue.taskId, code: issue.code, message: issue.message })),
  }
}

function decisionGate(runs) {
  const leaked = runs.flatMap(run => run.receipts.leaked || [])
  const missingReceipts = runs.flatMap(run => run.receipts.missing || [])
  const uploads = runs.reduce((sum, run) => sum + (run.transfer?.upload || 0), 0)
  const sharedConfigured = runs.some(run => Boolean(run.sharedInputRoot))
  const reviewed = runs.filter(run => run.finalStatus === 'awaiting_review').length
  return {
    // 决策门第一条：不再出现"全黑文件却 succeeded"。
    noFakeSuccess: { pass: leaked.length === 0, leaked },
    receiptsComplete: { pass: missingReceipts.length === 0, missing: missingReceipts },
    // 零上传只在共享文件系统下可判定；否则如实记为不适用，不谎报通过。
    zeroUpload: sharedConfigured
      ? { pass: uploads === 0, uploads }
      : { pass: null, uploads, note: '未配置 comfyui.sharedInputRoot，该部署形态下零上传不适用' },
    reachedReview: { pass: reviewed === runs.length, reviewed, total: runs.length },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const runs = []
  const failures = []
  for (let index = 0; index < args.repeat; index += 1) {
    process.stdout.write(`[基线] 第 ${index + 1}/${args.repeat} 轮开始\n`)
    try {
      const run = await runOnce(args, index)
      runs.push(run)
      process.stdout.write(`[基线] 第 ${index + 1} 轮结束：${run.finalStatus}，耗时 ${Math.round(run.marks.settledMs / 1000)}s\n`)
    } catch (error) {
      failures.push({ iteration: index + 1, message: error.message, route: error.route || null })
      process.stdout.write(`[基线] 第 ${index + 1} 轮失败：${error.message}\n`)
    }
  }

  const settleTimes = runs.map(run => run.marks.settledMs).filter(Number.isFinite)
  const previewTimes = runs.map(run => run.marks.firstArtifactMs).filter(Number.isFinite)
  const report = {
    reportVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    intent: args.sourceText,
    targetDurationSec: args.durationSec,
    repeat: args.repeat,
    completedRuns: runs.length,
    failedRuns: failures,
    latency: {
      previewP50Ms: percentile(previewTimes, 0.5),
      previewP95Ms: percentile(previewTimes, 0.95),
      settleP50Ms: percentile(settleTimes, 0.5),
      settleP95Ms: percentile(settleTimes, 0.95),
    },
    decisionGate: decisionGate(runs),
    runs,
    // 角色一致性与镜头连续性是人工评分，脚本量不出来，留位给评审填。
    manualScores: { characterConsistency: null, shotContinuity: null, ratedBy: null, ratedAt: null },
  }
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)

  const gate = report.decisionGate
  const verdict = Object.entries(gate)
    .filter(([, value]) => value.pass === false)
    .map(([name]) => name)
  process.stdout.write(`\n[基线] 报告已写入 ${args.out}\n`)
  process.stdout.write(verdict.length
    ? `[基线] 决策门未通过：${verdict.join('、')}\n`
    : '[基线] 决策门各项未见失败（pass=null 的项表示该部署形态下不适用）\n')
  process.exitCode = verdict.length ? 1 : 0
}

main().catch(error => {
  process.stderr.write(`[基线] 中止：${error?.stack || error}\n`)
  process.exitCode = 1
})
