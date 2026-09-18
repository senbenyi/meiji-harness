// 职责：提供 Agent 预设、事件解析和工具投影的稳定公共入口；具体逻辑由同目录模块实现。
export { ELYSIUM_AGENT_PRESETS, currentAgentPreset, isElysiumAgent, isElysiumFreeAgent, isElysiumStandaloneAgent, isElysiumProjectAgent } from './presets.js'
export { loadedToolNames } from './events.js'
export { TOOL_GROUPS, projectTools } from './projection.js'
