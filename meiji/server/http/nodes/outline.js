import promptModel from '../../prompts/models/outline.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "segments": [
      {
        "sequence": 1,
        "duration_seconds": 1,
        "body": "本段完整原剧情",
        "causal": "与前后段的承接，无明确承接可为空"
      }
    ]
  },
  "requirements": "仅返回 JSON，不附解释或 Markdown 围栏。sequence 从 1 连续递增；duration_seconds 为有限正数，允许小数；body 为完整剧情的非空字符串；causal 为字符串。每项剧情必须保留在 body。"
};

const output1 = {
  "type": "JSON",
  "structure": {
    "是否通过": true,
    "原因": ""
  },
  "requirements": "仅返回 JSON，不附解释或 Markdown 围栏。是否通过为布尔值；通过时原因为空，未通过时写明有原文依据的具体问题。"
};

export default {
  promptModel,
  compose(input) {
    return {
      ...commonValues(input),
      本集剧情: input.plot,
      本集时长秒: input.duration,
      本集要求: input.requirements,
    };
  },
  actions: {
    generate: {
      input: {"language":"string","rules":"array","requirements":"string","plot":"string","duration":"number"},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","rules":"array","requirements":"string","plot":"string","duration":"number","opinion":"string","content":"object"},
      output: output0,
    },
    review: {
      input: {"language":"string","rules":"array","requirements":"string","plot":"string","duration":"number","opinion":"string","content":"object"},
      output: output1,
    },
  },
};
