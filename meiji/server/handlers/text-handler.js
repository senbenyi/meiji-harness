import { prepareContent } from './content.js';
import { taskNodeInput } from './node-inputs.js';

export function createTextHandler({ ai, readLanguage = async () => 'zh-CN' }) {
  return async ({ snapshot, task, step, draft, signal, record }) => {
    const action = step.kind === 'review' ? 'review' : step.kind === 'revise' || task.action === 'revise' ? 'regenerate' : 'generate';
    const input = taskNodeInput(snapshot, task, draft, action, step, await readLanguage());
    // 首次生成和重新生成都只按剧本提取，不提交已有角色库。审核仍可对照库内资料。
    if (task.business_type === 'project-characters' && action !== 'review') input.characters = [];
    let response;
    try { response = await ai(task.business_type, action, input, { signal, record, task, step }); }
    catch (error) {
      if (action !== 'review' && Object.hasOwn(error, 'candidate'))
        return { result: error.candidate, prompt: error.prompt, http: error.http, content: null, validationFailure: error.message };
      throw error;
    }
    if (step.kind === 'review') return task.business_type === 'script-review'
      ? {...response,content:draft ?? {body:snapshot.project.script.body}} : response;
    try { return { ...response, content: prepareContent(snapshot, task, response.result) }; }
    catch (error) {
      if (error.code === 'INVALID_CONTRACT')
        return { ...response, content: null, validationFailure: error.message };
      throw error;
    }
  };
}
