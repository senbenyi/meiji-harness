// 职责：提供 Agent 预设、事件解析和工具投影的稳定公共入口；具体逻辑位于 agent/ 子包。
export { ELYSIUM_AGENT_PRESETS, currentAgentPreset, isElysiumAgent, isElysiumFreeAgent, isElysiumStandaloneAgent, isElysiumProjectAgent } from './agent/presets.js'
export { loadedToolNames } from './agent/events.js'
export { TOOL_GROUPS, projectTools } from './agent/projection.js'
