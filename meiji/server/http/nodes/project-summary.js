import promptModel from '../../prompts/models/project-summary.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "文本",
  "requirements": "1. 只返回一段摘要，不使用JSON、不附解释或Markdown代码围栏。\n2. 仅写入源文档规定的已发生人物与事件，不新增或改变剧情。"
};

const output1 = {
  "type": "JSON",
  "structure": {
    "是否通过": true,
    "原因": ""
  },
  "requirements": "1. 仅返回符合上述结构的JSON，不附解释、修订正文或Markdown代码围栏。\n2. “是否通过”为 true 或 false。为 true 时“原因”为空字符串，为 false 时写明具体问题。"
};

export default {
  promptModel,
  compose(input) {
    return {
      ...commonValues(input),
      完整剧本: input.script,
    };
  },
  actions: {
    generate: {
      input: {"language":"string","rules":"array","requirements":"string","script":"string"},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","rules":"array","requirements":"string","script":"string","opinion":"string","content":"string"},
      output: output0,
    },
    review: {
      input: {"language":"string","rules":"array","requirements":"string","script":"string","opinion":"string","content":"string"},
      output: output1,
    },
  },
};
