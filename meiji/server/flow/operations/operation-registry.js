// 操作定义：每个操作（按钮或会话工具）做什么。操作只存在于代码中，每次执行生成一个任务。
//   label  显示名称
//   scope  作用范围：project / episode / shot（决定是否需要剧集作用域，以及与哪些任务冲突）
//   queue  队列类别：text / image / video（只有调用图片或视频接口的操作占用 image / video 名额）
//   plan   根据当前项目生成步骤计划 [{ kind, target }]，步骤由处理函数经 runStep 执行
//   step   没有 plan 的操作整体作为一个步骤由执行入口执行：返回 { kind, target }，默认 execute
//   agent  会话工具（agent）能否发起；人工专属操作为 false
//   task   能否经任务管理启动（排队执行）；false 的操作只能由面板直接执行
import { projectStore } from '../../data/project-store.js'
import { materialize } from '../../../shared/episode-rules.js'
import { operations } from './registry.js'

// 操作定义分布在 tasks/ 与 actions/ 下的独立文件中，由 registry.js 汇总。
export const definitions = operations

export const labels = Object.fromEntries(Object.entries(definitions).map(([action, value]) => [action, value.label]))
// 需要剧集作用域的操作（剧集级与镜头级；项目级和一键成片类自行读取剧集）。
export const episodeScoped = new Set(Object.entries(definitions).filter(([action, value]) => value.scope !== 'project' && !['episode-delete', 'produce', 'produce-all'].includes(action)).map(([action]) => action))

export const queueOf = action => definitions[action]?.queue || 'text'

export function operationLabel(operation) { return `${labels[operation.action] || operation.action}${operation.track ? ' ' + operation.track : ''}${operation.generationMode ? '·' + (operation.generationMode === 'modify' ? '按意见修改' : '重新生成') : ''}` }

export function validateOperation(input) {
  if (input?.action === 'shot-seconds') throw Object.assign(new Error('每秒指令请从卡片集顶部统一提交'), { status: 400 })
  if (!Object.hasOwn(definitions, input?.action)) throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
  const definition = definitions[input.action]
  // 人工专属操作（忽略自审、确认图片、编辑与删除等）不允许由会话工具发起。
  if (input.origin === 'session' && definition.agent !== true) throw Object.assign(new Error('该操作只能由人在面板上执行'), { status: 403 })
  if (definition.task === false) throw Object.assign(new Error('不支持的面板操作'), { status: 400 })
}

// 没有 plan 的操作由执行入口整体作为一个步骤执行；有 plan 的操作返回 null（步骤由处理函数执行）。
export function runnerStep(operation) {
  const definition = definitions[operation.action]
  if (definition?.plan) return null
  return definition?.step?.(operation) || { kind: 'execute', target: null }
}

// 按当前项目生成步骤计划；读取失败时退回单个 execute 步骤（错误在执行时报告）。
export async function planSteps(home, operation) {
  const single = runnerStep(operation)
  if (single) return [single]
  let project = null
  try {
    if (operation.projectId) {
      const root = await projectStore(home).read(operation.projectId)
      const episodeId = operation.episodeId || (root.episodes.length === 1 ? root.episodes[0].id : null)
      project = episodeId ? materialize(root, episodeId) : root
    }
  } catch { return [{ kind: 'execute', target: null }] }
  const steps = definitions[operation.action].plan(project, operation)
  return steps.length ? steps : [{ kind: 'execute', target: null }]
}
