#!/usr/bin/env node
// Claude Code 钩子：强制执行 AGENTS.md 中的修改代码流程。
// 用法：node .claude/guard.mjs <prompt|edit>，事件 JSON 从 stdin 读入。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, isAbsolute } from 'node:path'

const mode = process.argv[2]
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const PLAN_MAX_AGE = 24 * 3600 * 1000
let input = {}
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch {}

const mtime = file => { try { return statSync(file).mtimeMs } catch { return 0 } }
const guarded = rel => rel.startsWith('meiji/') && !rel.startsWith('meiji/docs/') && !rel.startsWith('meiji/reports/')

function latestPlan() {
  const dir = join(root, 'docs', 'plans')
  if (!existsSync(dir)) return 0
  return Math.max(0, ...readdirSync(dir).filter(f => /^计划-.*\.md$/.test(f)).map(f => mtime(join(dir, f))))
}

if (mode === 'prompt') {
  process.stdout.write([
    '【仓库强制流程】若本次需求涉及修改 meiji/ 下代码：',
    '1) 先读 .agents/architecture.md、.agents/development.md；',
    '2) 回复开头写明「档位：完整流程 / 小改动」及理由（定义见 development.md 第 1 节）；',
    '3) 完整流程：调研 → 计划 → 实施（development.md 第 6–8 节）；小改动：简短计划 → 实施；',
    '4) 改代码前必须已有 docs/plans/计划-*.md（钩子会拦截）；',
    '5) 完成后 cd meiji && npm test，不得新增失败。',
    '只回答问题或只改文档时忽略本提醒。',
  ].join('\n') + '\n')
  process.exit(0)
}

if (mode === 'edit') {
  const ti = input.tool_input || {}
  const target = ti.file_path || ti.notebook_path || ti.path
  if (!target) process.exit(0)
  const rel = relative(root, isAbsolute(target) ? target : resolve(root, target)).split('\\').join('/')
  if (!guarded(rel)) process.exit(0)
  const age = Date.now() - latestPlan()
  if (age > PLAN_MAX_AGE) {
    process.stderr.write(
      `已拒绝修改 ${rel}：docs/plans/ 中没有 24 小时内更新的 计划-*.md。\n` +
      '请按 .agents/development.md 第 1 节判定档位：完整流程先调研（第 6 节）再写计划（第 7 节）；' +
      '小改动按第 7 节写简短计划（类型「小改动」）。写好计划后再修改代码。\n')
    process.exit(2)
  }
  process.exit(0)
}
