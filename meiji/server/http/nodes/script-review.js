import promptModel from '../../prompts/models/script-review.js';
import { commonValues } from '../../prompts/inputs.js';

// 剧本节点：review 审核当前剧本；regenerate 按审核意见改写剧本（content 为待修改的剧本）。
const script = {
  type: '文本',
  requirements: '1. 只返回修改后的完整剧本全文，不附解释、修改说明或Markdown代码围栏。\n2. 未涉及修改意见的段落逐字保留。',
};
const review = {
  type: 'JSON',
  structure: { 是否通过: true, 原因: '' },
  requirements: '1. 仅返回符合上述结构的JSON，不附解释或Markdown代码围栏。\n2. 剧情连续且适合拍摄时“是否通过”为 true，“原因”为空字符串；否则为 false，“原因”写出逐条、可执行的剧本修改意见。',
};

export default {
  promptModel,
  compose(input) {
    return { ...commonValues(input) };
  },
  actions: {
    regenerate: {
      input: { language: 'string', requirements: 'string', opinion: 'string', content: 'string' },
      output: script,
    },
    review: {
      input: { language: 'string', requirements: 'string', opinion: 'string', content: 'string' },
      output: review,
    },
  },
};
