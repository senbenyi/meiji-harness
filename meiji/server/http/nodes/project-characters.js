import promptModel from '../../prompts/models/project-characters.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "characters": [
      {
        "name": "角色姓名",
        "gender": "性别；原文没有时补可拍摄性别，句末标背景补，不要写未明确",
        "era": "年代；时代已经明确时写该时代，确实无法判断才写未明确",
        "position": "角色定位",
        "age_range": "年龄粗段；原文没有时直接补写，句末标背景补，不要写未明确",
        "body_type": "身材；原文没有时直接补写，句末标背景补，不要写未明确",
        "hairstyle": "发型；原文没有时直接补写，句末标背景补，不要写未明确",
        "facial_features": "面部特征；原文没有时直接补写，句末标背景补，不要写未明确",
        "height": "身高观感，不写厘米；原文没有时直接补写，句末标背景补，不要写未明确",
        "nationality": "国籍；故事世界不能确定时为空字符串",
        "voice": "声线；原文没有时直接补写，句末标背景补，不要写未明确",
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
  "requirements": "1. 只返回上述JSON结构；依据完整剧本返回应保留的全部重要角色，不要返回空数组表示沿用旧资料。实际出镜或发声的角色至少返回一套服装；没有原文服装时返回补写的一套，补写的名称、颜色、材质和配件句末标背景补。签名道具和不可改身体标记没有原文时为 []。\n2. 角色及服装字段严格遵守上述源结构；本提取步骤只返回资料，不生成ID、number、图片地址或额外字段；程序首次保存时为角色和服装各分配唯一ID，后续识别与成片原样引用该ID，不另设编号。\n3. 不附解释或Markdown代码围栏。\n4. signature_props、immutable_traits、costumes[].props 必须为字符串数组，每项一条；没有内容时返回 []。禁止将这些字段返回为字符串、对象或 null。其余人物和服装资料字段按结构返回字符串。原文没有而补写的外观句末标背景补，补写不要包含“未明确”。"
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
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","script":"string","characters":"array","opinion":"string","content":"object"},
      output: output0,
    },
    review: {
      input: {"language":"string","requirements":"string","script":"string","characters":"array","opinion":"string","content":"object"},
      output: output1,
    },
  },
};
