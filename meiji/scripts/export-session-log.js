// 只读取 Harness 的公开会话导出及 meiji 历史，不访问 Harness 内部存储。
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runStore } from '../server/data/run-store.js'
import { redactJson } from '../server/gateway/redact.js'

export async function readSessionExport(file) {
  if (!file.toLowerCase().endsWith('.zip')) return readFile(file, 'utf8')
  try {
    const run = promisify(execFile)
    const { stdout: listing } = await run('unzip', ['-Z1', resolve(file)], { maxBuffer: 4 * 1024 * 1024 })
    const roots = listing.split(/\r?\n/).filter(name => /^session(?:\.v[1-9]\d*)?\.jsonl$/.test(name))
    if (roots.length !== 1) throw new Error(roots.length ? 'ZIP 中存在多个根会话日志，无法确定会话归属' : 'ZIP 中缺少根会话日志 session.jsonl 或 session.vN.jsonl')
    const { stdout } = await run('unzip', ['-p', resolve(file), roots[0]], { maxBuffer: 128 * 1024 * 1024 })
    if (!stdout.trim()) throw new Error('ZIP 中的根会话日志为空')
    return stdout
  } catch (error) { throw new Error(`无法读取 ZIP，请先解压根会话 JSONL：${error.message}`) }
}

export async function exportSessionLog({ sessionLog, projectId, home = process.env.DSH_HOME || join(homedir(), '.dsh') }) {
  const lines = (await readSessionExport(sessionLog)).split(/\r?\n/).filter(line => line.trim())
  const entries = lines.map((line, index) => { try { return JSON.parse(line) } catch { throw new Error(`会话导出第 ${index + 1} 行不是有效 JSON`) } })
  const header = entries.find(entry => (entry.type === 'session' || !entry.type) && (entry.id || entry.sessionId))
  const sessionId = header?.id || header?.sessionId
  if (!sessionId) throw new Error('公开会话导出缺少会话 ID')
  const history = runStore(home, projectId)
  const runs = (await history.list()).filter(run => run.sessionId === sessionId || run.goalSessionId === sessionId)
  const runMap = new Map(runs.map(run => [run.id, run]))
  const rows = [], commands = new Map()
  const timestamp = value => typeof value === 'number' ? value : Date.parse(value || '') || 0
  const add = (type, value, time, callId, limit = false) => {
    let text = JSON.stringify(redactJson(value), null, 2) || ''
    if (limit && text.length > 2000) text = text.slice(0, 2000) + '\n…（已截断）'
    rows.push({ type, text, time: timestamp(time), callId })
  }
  for (const raw of entries) {
    const event = raw.event || raw
    if (!event.type || event.type === 'session') continue
    const data = event.data || {}, callId = data.callId || data.toolCallId || data.id
    if (event.type === 'command/run') { commands.set(data.commandId, event); continue }
    if (event.type === 'command/done') {
      const start = commands.get(data.commandId)
      add('命令日志', { name: start?.data?.name, ...data }, event.time || event.createdAt, callId)
      commands.delete(data.commandId); continue
    }
    add(event.type, data, event.time || event.createdAt, callId, /tool/i.test(event.type))
  }
  for (const event of commands.values()) add('未完成命令', event.data, event.time)
  for (const run of runs) add('meiji 任务与步骤', run, run.startedAt || run.createdAt, run.callId)
  for (const kind of ['prompts', 'responses']) for (const record of await history.listRecords(kind)) {
    const run = runMap.get(record.runId)
    if (run) add(kind === 'prompts' ? 'meiji 提示词' : 'meiji 原始返回', record, record.createdAt, run.callId)
  }
  rows.sort((a, b) => a.time - b.time)
  const output = [`# 会话调试记录\n\n会话：${sessionId}\n项目：${projectId}`]
  for (const row of rows) output.push(`## ${row.time ? new Date(row.time).toISOString() : '时间未知'} · ${row.type}${row.callId ? ` · callId=${row.callId}` : ''}\n\n\`\`\`json\n${row.text.replaceAll('```', '\\`\\`\\`')}\n\`\`\``)
  return output.join('\n\n') + '\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--session-log', '--project', '--home', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('用法：--session-log <jsonl|zip> --project <id> [--home <DSH_HOME>] [--out <md>]')
    options[args[i]] = args[i + 1]
  }
  if (!options['--session-log'] || !options['--project']) throw new Error('必须指定 --session-log 与 --project')
  const markdown = await exportSessionLog({ sessionLog: options['--session-log'], projectId: options['--project'], home: options['--home'] })
  if (options['--out']) await writeFile(resolve(options['--out']), markdown, { mode: 0o600 })
  else process.stdout.write(markdown)
}
