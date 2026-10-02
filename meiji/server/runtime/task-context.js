// 任务内存上下文；不依赖存储或执行器。
import { AsyncLocalStorage } from 'node:async_hooks'

export const executionContext = new AsyncLocalStorage()
export const liveTasks = new Map()
export const liveTask = id => liveTasks.get(id) || null

// 当前任务固定的技能组合；不在任务中时为 null（由调用方使用内置 + 本剧）。
export const taskSkillSet = () => executionContext.getStore()?.skillSet || null

// 记录本任务实际使用的技能（写入任务记录 skills，历史中显示所用技能与层）。
export function useSkills(entries) {
  const context = executionContext.getStore()
  if (!context?.skills) return
  for (const entry of entries) context.skills.set(entry.id + ':' + (entry.nodeKey || ''), entry)
}

// 本操作执行过的步骤（执行器之外为空；一键成片的每个子操作只看自己的步骤），以及正在执行的步骤。
export function executionSteps(context = executionContext.getStore()) {
  return context ? context.steps.filter(step => step.scope === context.scope) : []
}
export function activeStep() {
  const context = executionContext.getStore()
  return context?.steps.find(item => item.id === context.stepId) || null
}

export const usedSkills = context => context.skills?.size ? { skills: [...context.skills.values()] } : {}
