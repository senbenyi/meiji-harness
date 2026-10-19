import promptModel from '../../../shared/prompt-models/script-review.js';
import { commonValues } from '../../prompts/inputs.js';
const output = { type:'文本', requirements:'只返回改编后的完整剧本全文，不附解释、修改清单、JSON或代码围栏；未涉及本次意见的剧情保持，相关设定和动作前后一致。' };
const base = {language:'string',requirements:'string'};
export default {
  promptModel,
  compose: input => ({...commonValues(input),当前剧本:input.script}),
  actions: {
    generate:{input:{...base,script:'string'},output},
    regenerate:{input:{...base,opinion:'string',content:'string'},output},
    review:{input:{...base,script:'string',opinion:'string',content:'string'},output:{type:'JSON',structure:{是否通过:true,原因:''},requirements:'仅返回审核结果，通过原因留空；拒绝时写明最新正文中的具体问题及处理方向。'}},
  },
};
