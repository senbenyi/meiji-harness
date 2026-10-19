import promptModel from '../../../shared/prompt-models/project-characters.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "characters": [
      {
        "name": "角色姓名",
        "gender": "性别",
        "era": "年代或故事时空设定",
        "position": "核心身份及剧情作用",
        "age_range": "年龄段",
        "body_type": "身材",
        "hairstyle": "发型",
        "facial_features": "面部特征",
        "height": "身高观感",
        "nationality": "国籍或地域文化背景；无需国别设定时可为空",
        "voice": "声线",
        "signature_props": [
          "签名道具"
        ],
        "immutable_traits": [
          "不可改特征"
        ],
        "costumes": [
          {
            "name": "服装名称",
            "color": "服装颜色",
            "material": "服装材质",
            "props": [
              "随服装出现的道具"
            ]
          }
        ]
      }
    ]
  },
  "requirements": "1. 只返回上述JSON结构和完整资料，不附解释或Markdown代码围栏。依据完整剧本返回应保留的全部重要角色，不以空数组表示沿用旧资料。资料提取、补全和优化遵循当前动作的执行规则，直接填写角色设定，不附来源标签。\n2. 每个角色至少一套服装；性别、年代、定位、年龄段、身材、发型、面部特征、身高观感、声线及服装名称/颜色/材质为非空字符串，不用未知或待补充的占位描述。国籍可按执行规则留空。\n3. 角色及服装字段严格遵守上述结构；不生成ID、number、默认服装编号、图片地址或额外字段。程序首次保存时分配唯一ID，后续任务引用原ID。\n4. signature_props、immutable_traits、costumes[].props必须为字符串数组，每项一条，没有内容时返回[]；禁止返回字符串、对象或null。其余人物和服装资料字段返回字符串。"
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
      input: {"language":"string","requirements":"string","script":"string","characters":"array"},
      output: { ...output0, requirements: "只返回上述 JSON，不附解释或 Markdown 代码围栏。不返回 ID、编号、图片地址或额外字段。数组没有内容时返回 []。" },
    },
    regenerate: {
      input: {"language":"string","requirements":"string","script":"string","characters":"array","opinion":"string","content":"object"},
      output: { ...output0, requirements: "只返回上述 JSON，不附解释或 Markdown 代码围栏。不返回 ID、编号、图片地址或额外字段。必须返回完整角色数组，不能只返回被点名的人。道具没有内容时返回 []。" },
    },
    review: {
      input: {"language":"string","requirements":"string","script":"string","characters":"array","opinion":"string","content":"object"},
      output: output1,
    },
  },
};
