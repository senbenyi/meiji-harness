import { comfyuiTaskTool } from './comfyui-task.js'

export const createComfyuiTaskCancelTool = () => comfyuiTaskTool('cancel', '仅移除指定 ComfyUI 排队任务；运行中的任务不执行全局中断。')
