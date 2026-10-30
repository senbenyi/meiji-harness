import {UnitProductionExecutor} from './unit_executor.js'
import {uid} from './execution_support.js'
import {nodeBoxes} from '../node_box/registry.js'

/** 程序盒子执行原文赋值、绑定、分片、剪辑和导出，不调用生成模型。 */
export class ProgramProductionExecutor extends UnitProductionExecutor {
  constructor(service){super(service,Object.values(nodeBoxes).filter(box=>box.type==='program'&&box.execute).map(box=>box.id))}
  async createUnits(ctx){return [{id:uid('unit'),kind:ctx.task.node_type}]}
  async executeUnit(ctx){const result=await nodeBoxes[ctx.task.node_type].execute.call(this,ctx);return this.acceptUnit(ctx,result)}
}
