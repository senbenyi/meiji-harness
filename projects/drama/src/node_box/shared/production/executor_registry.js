import {TextProductionExecutor} from './text_executor.js'
import {ImageProductionExecutor} from '../../asset_preparation/runtime/executor.js'
import {VideoProductionExecutor} from '../../video_render/runtime/executor.js'
import {ProgramProductionExecutor} from './program_executor.js'

/** 仅装配类型到执行器的映射；具体步骤由各执行器维护。 */
export function createProductionExecutors(service){
  const registry=new Map()
  for(const executor of [new TextProductionExecutor(service),new ImageProductionExecutor(service),new VideoProductionExecutor(service),new ProgramProductionExecutor(service)])
    for(const stage of executor.stages){if(registry.has(stage))throw new TypeError(`制作步骤重复注册：${stage}`);registry.set(stage,executor)}
  return registry
}
