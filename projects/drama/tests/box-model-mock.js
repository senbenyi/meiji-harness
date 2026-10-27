/** 旧业务场景的模型模拟器：先原生调用读取工具，再把已读上下文交给场景回调。
 * 专门的box-model-runner测试直接检查原始消息，不使用此投影。
 */
export function advanceBoxMock(body, res) {
  if (!body.tools?.some(tool => tool.function.name === 'read_material')) return false
  const catalog = JSON.parse(body.messages.find(row => row.role === 'user').content)
  const read = body.messages.filter(row => row.role === 'tool').map(row => ({ row, value: JSON.parse(row.content) }))
  const values = read.map(row => row.value)
  const calls = []
  const add = (name, args) => calls.push({ id: `mock_${body.messages.length}_${calls.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
  for (const skill of catalog.skills) if (!values.some(value => value.name === skill.name && typeof value.content === 'string')) add('read_skill', { name: skill.name })
  for (const material of catalog.materials) if (!values.some(value => value.name === material.name && value.pointer === '')) add('read_material', { name: material.name })
  const contractCalls = new Set(body.messages.flatMap(row => row.tool_calls || []).filter(call => call.function.name === 'read_contract').map(call => call.id))
  if (!read.some(({ row }) => contractCalls.has(row.tool_call_id))) add('read_contract', {})
  if (calls.length) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: calls } }] }))
    return true
  }
  const input = Object.fromEntries(values.filter(value => value.name && value.name !== 'rules' && value.pointer === '').map(value => [value.name, value.content]))
  if (catalog.node_type !== 'project') input.instruction = catalog.goal
  input.output_language = catalog.output_language
  const errors = body.messages.filter(row => row.role === 'user').slice(1).map(row => { try { return JSON.parse(row.content) } catch { return null } }).filter(value => value?.error && value.error.code !== 'BOX_READ_REQUIRED')
  if (errors.length) input.output_repair = { attempt: errors.length, validation_error: errors.at(-1).error }
  let system = body.messages[0].content + '\n' + values.filter(value => value.name && !Object.hasOwn(value, 'pointer')).map(value => value.content).join('\n\n')
  if (input.current_outline) system = system.replaceAll('{{segment_count}}', String(input.current_outline.segments.length)).replaceAll('{{segment_ids}}', input.current_outline.segments.map(row => row.id).join('、'))
  body.messages = [{ role: 'system', content: system }, { role: 'user', content: '# 本次资料\n' + JSON.stringify(input) }]
  return false
}

export const completedBusinessSteps = detail => detail.steps.filter(row => !row.result?.box_turn || row.result?.output || row.result?.review || row.result?.summary_error || row.result?.box_turn?.validation_error)
