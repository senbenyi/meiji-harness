import { prepareContent } from './content.js';
import { taskNodeInput } from './node-inputs.js';

export function createTextHandler({ ai, readLanguage = async () => 'zh-CN' }) {
  return async ({ snapshot, task, step, draft, signal, record }) => {
    const action = step.kind === 'review' ? 'review' : step.kind === 'revise' || (task.action === 'regenerate' && task.opinion?.trim()) ? 'regenerate' : 'generate';
    const input = taskNodeInput(snapshot, task, draft, action, step, await readLanguage());
    const response = await ai(task.business_type, action, input, { signal, record, task, step });
    if (step.kind === 'review') return response;
    return { ...response, content: prepareContent(snapshot, task, response.result) };
  };
}
