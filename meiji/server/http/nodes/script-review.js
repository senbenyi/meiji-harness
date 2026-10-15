import promptModel from '../../prompts/models/script-review.js';
import { commonValues } from '../../prompts/inputs.js';
import { invalid } from '../../../shared/task_contract.js';

const output = {
  type: 'JSON',
  structure: { story_continuous: true, continuity: '', filmable: true, filmability: '', suggestions: '' },
  requirements: '1. 仅返回符合上述结构的JSON，不附解释或Markdown代码围栏。\n2. story_continuous 表示剧情是否连续，continuity 写明连续性判断依据；filmable 表示是否适合拍摄成视频，filmability 写明拍摄适配判断依据。\n3. 两项均为 true 时 suggestions 为空字符串；任一项为 false 时 suggestions 必须写出逐条、可执行的剧本修改意见。',
};

export default {
  promptModel,
  compose(input) {
    return { ...commonValues(input), 完整剧本: input.script };
  },
  // 结论与修改意见需自洽；不适合却没有修改意见属于响应结构错误，任务失败而不是写入节点。
  validateResult(value) {
    for (const key of ['continuity', 'filmability'])
      if (!value[key].trim()) invalid(`响应.${key}`, '需写明判断依据');
    const passed = value.story_continuous && value.filmable;
    if (passed && value.suggestions.trim()) invalid('响应.suggestions', '通过时修改意见应为空');
    if (!passed && !value.suggestions.trim()) invalid('响应.suggestions', '不适合时需给出修改意见');
  },
  actions: {
    generate: {
      input: { language: 'string', requirements: 'string', script: 'string' },
      output,
    },
  },
};
