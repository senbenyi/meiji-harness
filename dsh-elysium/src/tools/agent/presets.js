// 职责：解析当前 Agent 预设并提供 Elysium 模式分类；不读取工具定义或修改会话。
export const ELYSIUM_AGENT_PRESETS = new Set(['elysium-free', 'elysium-director'])

// 从初始会话头和后续选择事件中解析当前生效的预设，后发生的选择优先。
export const currentAgentPreset = agent => {
  let preset = agent?.session?.header?.agentPreset
  for (const event of agent?.session?.snapshotEvents?.() || []) if (event.type === 'agent-preset/selected') preset = event.data.agentPreset
  return preset
}

export const isElysiumAgent = agent => ELYSIUM_AGENT_PRESETS.has(currentAgentPreset(agent))
export const isElysiumFreeAgent = agent => currentAgentPreset(agent) === 'elysium-free'
export const isElysiumProjectAgent = agent => currentAgentPreset(agent) === 'elysium-director'
