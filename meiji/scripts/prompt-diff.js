// 开发脚本：比较改造前后同一批提示词场景（tests/fixtures/prompt-scenarios.js 生成）的句子差集。
// 用法：node meiji/scripts/prompt-diff.js <before.json> <after.json> [报告.md]
//   1. 各场景各请求的字数变化；
//   2. 全局删除：改造前出现、改造后任何请求都没有的句子，按理由分类（未归类的需人工确认）；
//   3. 按请求移出：该请求不再包含、但仍在其他请求中的句子数量（例如审核不再附整份生成技能）。
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 技能目录下全部 Markdown 正文（判断删除的句子是否仍在技能文件中）。
async function skillsText(dir = fileURLToPath(new URL('../skills/', import.meta.url))) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(await skillsText(join(dir, entry.name)))
    else if (entry.name.endsWith('.md')) out.push(await readFile(join(dir, entry.name), 'utf8'))
  }
  return out.join('\n')
}

export const sentences = text => String(text || '').split(/\n|(?<=[。；！？])/).map(line => line.replace(/^[-*\d.、\s]+|[\s]+$/g, '').replace(/^【[^】]*】/, '').trim()).filter(line => line.length >= 6)

// 删除理由（按顺序匹配第一条）：流程说明、重复的语言规则、官方链接与出处、图片接口不需要的文本模型说明、
// 按结构承担的旧标题与跳过说明、与输出协议重复、随组装方式更新的措辞。
export const reasons = [
  ['原文仍在技能文件中，本场景不加入（未启用的指导、其他模式或其他请求类型）', null],
  ['旧章节标题（按字段重组，改用来源标题）', /^#/],
  ['流程说明（由程序调度，不再发给模型）', /服务端|流程层|分别发起|独立自审|自动修订|最多自动修订|第二次仍失败|再次失败保存并停止|接口异常|格式\/语法错误|不自行调用|不自行重复调用|再次调用工具|自行循环|无限循环|直接编辑保存仅审核|旧的“失败不自动修订”|禁止自动修订描述|不自动反复重写|不自动无限重试|共用执行器|草稿完成后的自检|独立审核节点|生成完成后的独立审核|审核节点协议|先完成摘要草稿|续传内容由程序合并|整集统一审核|统一提交整集修改|独立提交入口|给出一个整体结论|每个节点只执行本次任务|返回全部镜头正文及完成标记/],
  ['重复的语言规则（统一为共享模块「语言」与代码注入的本次生成语言）', /outputLanguage|本次生成语言|未配置默认|默认简体中文|资产名称、ID、枚举和引用标签不翻译|角色名、场景名和 ID 不翻译|字段名与固定 look 标签不翻译|不根据输入语言猜测|对白沿用已确定原文及配置语言|生成语言始终采用项目配置|项目语言用于审稿内容/],
  ['官方出处与链接（参考原文仍按模式注入）', /github\.com|查阅日期|官方工作流|官方规范|文本分镜指南|基础模式指南|多模态参考指南|Meiji 适配：|人数限制按同一时刻画面统计|官方画布|模板并非完整成片提示词|单文本分镜文档/],
  ['图片接口不需要的文本模型说明（身份、只输出产物、修订边界）', /身份与职责|只输出本技能要求的产物|此操作返回图片/],
  ['阶段专属规则改为按阶段组装（跳过说明与技能名改为阶段名称）', /此阶段跳过以下镜头专用检查|当 stage 为|阶段：skill-|审核范围：skill-/],
  ['与输出协议重复（协议保留一份）', /输出结构：顶层仅含|summary 为非空字符串|不得附解释、审核报告或 Markdown 围栏|本协议覆盖上文 JSON 输出协议/],
  ['措辞随组装方式更新（本剧补充、指导分组、参考位置、引用上下文）', /补充 skill 是另列的用户约束|本阶段自定义 skill|按标注模块选择|以上文为准|自审按上述两类关系检查|生成规范（仅作验收依据|声源与动作边界：/],
  ['其他（需人工确认）', /./],
]
const requestsOf = scenario => Object.entries(scenario).flatMap(([kind, message]) => typeof message === 'string'
  ? [[kind, 'prompt', message]]
  : message.system !== undefined ? [[kind, 'system', message.system], [kind, 'user', message.user]] : [[kind, 'prompt', message.prompt]])

export function diff(before, after, skillText = '') {
  const afterAll = new Set(Object.values(after).flatMap(scenario => requestsOf(scenario).flatMap(([, , text]) => sentences(text))))
  const sizes = []
  const removed = new Map()
  const moved = []
  for (const [name, scenario] of Object.entries(before)) {
    const next = after[name]
    if (!next) continue
    for (const [kind, role, text] of requestsOf(scenario)) {
      const current = requestsOf(next).find(([k, r]) => k === kind && r === role)?.[2] ?? ''
      sizes.push({ name, kind, role, before: text.length, after: current.length })
      const now = new Set(sentences(current))
      const nextAll = new Set(requestsOf(next).flatMap(([, , value]) => sentences(value)))
      let movedCount = 0
      for (const sentence of new Set(sentences(text))) {
        if (now.has(sentence)) continue
        if (!afterAll.has(sentence)) {
          if (!removed.has(sentence)) removed.set(sentence, new Set())
          removed.get(sentence).add(`${name}/${kind}`)
        } else if (!nextAll.has(sentence) || !now.has(sentence)) movedCount++
      }
      if (movedCount) moved.push({ name, kind, role, count: movedCount })
    }
  }
  const inSkills = sentence => skillText.includes(sentence.replace(/^#+\s*/, ''))
  const classified = [...removed.entries()].map(([sentence, where]) => ({ sentence, where: [...where], reason: reasons.find(([, pattern]) => pattern ? pattern.test(sentence) : inSkills(sentence) && !/^#/.test(sentence))[0] }))
  return { sizes, removed: classified, moved }
}

export function report({ sizes, removed, moved }) {
  const lines = ['# 提示词差集报告', '', '## 字数（改造前 → 改造后）', '', '| 场景 | 请求 | 角色 | 改造前 | 改造后 | 变化 |', '|---|---|---|---:|---:|---:|']
  for (const row of sizes) lines.push(`| ${row.name} | ${row.kind} | ${row.role} | ${row.before} | ${row.after} | ${row.after - row.before} |`)
  lines.push('', '## 全局删除（改造后任何请求都不再出现的句子）', '')
  const groups = new Map()
  for (const item of removed) {
    if (!groups.has(item.reason)) groups.set(item.reason, [])
    groups.get(item.reason).push(item)
  }
  for (const [reason, items] of groups) {
    lines.push(`### ${reason}（${items.length}）`, '')
    for (const item of items) lines.push(`- ${item.sentence}　〔${item.where.length} 处，如 ${item.where[0]}〕`)
    lines.push('')
  }
  lines.push('## 按请求移出（仍在其他请求或场景中）', '', '| 场景 | 请求 | 角色 | 句数 |', '|---|---|---|---:|')
  for (const row of moved) lines.push(`| ${row.name} | ${row.kind} | ${row.role} | ${row.count} |`)
  return lines.join('\n') + '\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [beforeFile, afterFile, output] = process.argv.slice(2)
  if (!beforeFile || !afterFile) throw new Error('用法：node meiji/scripts/prompt-diff.js <before.json> <after.json> [报告.md]')
  const result = diff(JSON.parse(await readFile(beforeFile, 'utf8')), JSON.parse(await readFile(afterFile, 'utf8')), await skillsText())
  const text = report(result)
  if (output) await writeFile(output, text)
  const counts = {}
  for (const item of result.removed) counts[item.reason] = (counts[item.reason] || 0) + 1
  console.log(JSON.stringify({ removed: result.removed.length, byReason: counts }, null, 2))
}
