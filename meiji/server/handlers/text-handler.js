import { prepareContent } from './content.js';
import { taskNodeInput } from './node-inputs.js';

export function createTextHandler({ ai, readLanguage = async () => 'zh-CN' }) {
  return async ({ snapshot, task, step, draft, signal, record }) => {
    const action = step.kind === 'review' ? 'review' : step.kind === 'revise' || task.action === 'revise' ? 'regenerate' : 'generate';
    const input = taskNodeInput(snapshot, task, draft, action, step, await readLanguage());
    // 重新提取按剧本重做，不把已有角色库送进提示词；审核仍对照库内资料。
    if (task.business_type === 'project-characters' && task.action === 'regenerate' && action !== 'review') input.characters = [];
    const response = await ai(task.business_type, action, input, { signal, record, task, step });
    if (step.kind === 'review') return response;
    return { ...response, content: prepareContent(snapshot, task, response.result) };
  };
}
