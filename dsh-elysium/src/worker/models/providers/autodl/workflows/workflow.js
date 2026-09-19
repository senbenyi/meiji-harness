// 职责：把 AutoDL 提交的 API 图还原成可在 ComfyUI 中检查的可视工作流。
export function executionWorkflow(graph, source) {
  const templates = new Map([...source.nodes, ...(source.definitions?.subgraphs || []).flatMap(g => g.nodes)].map(node => [node.id, node]))
  const nodes = [], links = [], groups = new Map()
  for (const [id, api] of Object.entries(graph)) {
    const prototype = templates.get(api._meta?.source_id)
    if (!prototype || prototype.type !== api.class_type) throw new Error(`Missing visual node template: ${id}`)
    const node = structuredClone(prototype)
    node.id = id; node.order = nodes.length; node.mode = 0
    node.title = `${id} · ${api.class_type}`
    node.properties.harness.id = id
    node.properties.harness.inputs = Object.keys(api.inputs)
    for (const port of node.inputs) port.link = null
    for (const port of node.outputs) port.links = []
    for (const [name, value] of Object.entries(api.inputs)) {
      const widgetIndex = node.properties.harness.widgets.indexOf(name)
      if (Array.isArray(value) && graph[value[0]]) {
        let slot = node.inputs.findIndex(port => port.name === name)
        if (slot < 0) {
          const output = templates.get(graph[value[0]]._meta.source_id).outputs[value[1]]
          slot = node.inputs.length
          node.inputs.push({ name, type: output.type, link: null, ...(widgetIndex >= 0 ? { widget: { name } } : {}) })
        }
        const link = links.length + 1
        node.inputs[slot].link = link
        links.push([link, value[0], value[1], id, slot, node.inputs[slot].type])
      } else if (widgetIndex >= 0) node.widgets_values[widgetIndex] = value
      else throw new Error(`Input cannot be displayed: ${id}.${name}`)
    }
    const key = id.match(/^s\d+_/)?.[0] || (id.startsWith('first_') ? 'first_' : 'final')
    const list = groups.get(key) || []
    groups.set(key, list)
    const compact = /_frames?_/.test(id)
    const index = list.filter(n => Boolean(n.flags.collapsed) === compact).length
    node.flags = { ...node.flags, collapsed: compact }
    node.size = [400, compact ? 80 : 700]
    node.pos = [(index % 12) * 450, (compact ? 2400 + Math.floor(index / 12) * 140 : Math.floor(index / 12) * 780)]
    list.push(node); nodes.push(node)
  }
  const byId = new Map(nodes.map(node => [node.id, node]))
  for (const [id, origin, slot] of links) byId.get(origin).outputs[slot].links.push(id)
  let top = 0
  const layout = [...groups].map(([title, items], index) => {
    const height = Math.max(...items.map(n => n.pos[1] + n.size[1])) + 120
    for (const node of items) node.pos[1] += top
    const group = { id: index + 1, title, bounding: [-40, top - 80, 5500, height], color: '#3f789e', font_size: 28, flags: {} }
    top += height + 250
    return group
  })
  return { version: 0.4, last_node_id: nodes.length, last_link_id: links.length, nodes, links, config: {},
    groups: layout,
    extra: { ds: { scale: 0.15, offset: [150, 250] }, harness: { name: source.extra.harness.name } } }
}
