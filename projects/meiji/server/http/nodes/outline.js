import { outlineBudget } from '../../prompts/duration-policy.js';
import promptModel from '../../../shared/prompt-models/outline.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "segments": [
      {
        "sequence": 1,
        "duration_seconds": 1,
        "body": "本段改编后的完整剧情（允许合理增删改）",
        "causal": "与前后段的承接，无明确承接可为空"
      }
    ]
  },
  requirements: '只返回完整JSON。sequence从1连续递增；duration_seconds为有限正数，可用小数；body为可拍摄的非空改编剧情，causal为前后段衔接字符串。小段按播放顺序覆盖本集改编正文，先分配正常表演所需时长再写剧情，合计须在本集参考±30秒内。只输出本集segments，不输出全集规划或其他集正文。',

};

const output1 = {
  "type": "JSON",
  "structure": {
    "是否通过": true,
    "原因": ""
  },
  "requirements": "仅返回 JSON，不附解释或 Markdown 围栏。是否通过为布尔值；通过时原因为空，未通过时写明违反全集规划、核心设定、跨集连续性或剧情与时长明显不匹配的具体问题；不因合理增删改与原文不逐字一致而拒绝。"
};

export default {
  promptModel,
  compose(input) {
    return {
      ...commonValues(input),
      时长规划: outlineBudget(input.duration),
      本集规划: input.plot,
      原始剧本: input.script,
      全集规划: input.episodes,
      本集序号: input.sequence,
      前集实际剧情: input.previous,
      本集时长秒: input.duration,
      本集要求: input.requirements,
    };
  },
  actions: {
    generate: {
      input: {"language":"string","requirements":"string","plot":"string","duration":"number","script":"string","episodes":"array","sequence":"number","previous":["object","null"]},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","plot":"string","duration":"number","script":"string","episodes":"array","sequence":"number","previous":["object","null"],"opinion":"string","content":"object"},
      output: output0,
    },
    review: {
      input: {"language":"string","requirements":"string","plot":"string","duration":"number","script":"string","episodes":"array","sequence":"number","previous":["object","null"],"opinion":"string","content":"object"},
      output: output1,
    },
  },
};
