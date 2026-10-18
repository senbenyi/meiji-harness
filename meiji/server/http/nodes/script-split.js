import { splitBudget } from '../../prompts/duration-policy.js';
import promptModel from '../../prompts/models/script-split.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  type: 'JSON',
  structure: { 剧集: [{ 序号: 1, 本集规划: '本集核心事件、冲突、转折、阶段性结果、开场承接、结尾钩子及伏笔安排', 预估时长秒: 150 }] },
  requirements: '只返回完整JSON。序号从1连续递增；本集规划为非空文本；预估时长秒为时长规划上下限内的正整数。一次规划全部剧集，数组顺序就是播放顺序。无需输出分集正文、原文段落范围或排除段落。',
};

export default {
  promptModel,
  compose(input) {
    return {
      ...commonValues(input),
      时长规划: splitBudget(input.duration),
      原始剧本: input.script,
      参考单集时长秒: input.duration,
    };
  },
  actions: {
    generate: {
      input: {"language":"string","requirements":"string","script":"string","duration":"number","opinion":"string"},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","script":"string","duration":"number","opinion":"string","content":"object"},
      output: output0,
    },
    review: {
      input: {language:"string", requirements:"string", script:"string", duration:"number", opinion:"string", content:"object"},
      output: {
        type: "JSON",
        structure: {"是否通过": true, "原因": ""},
        requirements: "只返回JSON。是否通过为布尔值，通过时原因为空；拒绝时一次列出具体集号、规划缺口、因果或衔接矛盾及最小修正方向。不输出修订后的规划。",
      },
    },
  },
};
