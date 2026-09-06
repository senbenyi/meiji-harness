import { comfyuiTaskTool } from './comfyui-task.js'

export const createComfyuiTaskResultTool = () => comfyuiTaskTool('result', '查询任务历史中的产物、派生 ID 与访问 URL；不表示文件已验收。')
