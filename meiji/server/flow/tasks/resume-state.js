import { TEXT_BUSINESSES } from '../../../shared/node-state.js';
import { prepareContent } from '../../handlers/content.js';
import { validateNodeResult } from '../../http/ai-routes.js';
import { taskNodeInput } from '../../handlers/node-inputs.js';

export function resumeState(snapshot, task) {
  const completed = snapshot.steps.filter(step => step.task_id === task.id && step.step_status === 'done' &&
    ['generate', 'revise', 'manual_edit', 'download', 'apply'].includes(step.kind)).sort((a, b) => a.seq - b.seq);
  let draft = null, validationFailure = '';
  for (const step of completed) {
    if (TEXT_BUSINESSES.includes(task.business_type)) {
      try {
        const action = step.kind === 'revise' || task.action === 'revise' ? 'regenerate' : 'generate';
        const input = taskNodeInput(snapshot, task, draft, action, step);
        const raw = validateNodeResult(task.business_type, action, structuredClone(step.result), input);
        draft = prepareContent(snapshot, task, raw);
        validationFailure = '';
      } catch (error) {
        if (error.code !== 'INVALID_CONTRACT') throw error;
        draft = null;
        validationFailure = error.message;
      }
    } else {
      draft = structuredClone(step.result);
      if (draft?.duration !== undefined) draft.actual_duration_seconds = draft.duration;
    }
  }
  return { draft, validationFailure };
}
