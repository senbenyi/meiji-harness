// 操作：修改原始资料
import { saveStep } from '../plan-steps.js'

// if (operation.action === 'source')
export async function opSource(c) {
  let { operation, projects, project, trace, note } = c
  const saved = await projects.saveSource(project.id, operation.fields)
  note(`已保存资料：${saved.title}，${saved.durationSeconds} 秒，${saved.aspectRatio}`)
  note('时长、画幅或摘要一变，后面的内容已清空，等待重新生成')
  return trace
}

export const operations = {
  source: { label: '修改原始资料', scope: 'episode', queue: 'text', agent: false, step: saveStep('summary'), stage: 'episode', run: opSource },
}
