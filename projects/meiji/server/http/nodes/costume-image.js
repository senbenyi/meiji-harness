import { invalid } from '../../../shared/task_contract.js';
import { decodeImageData } from '../../media/decode-image-data.js';
import promptModel from '../../../shared/prompt-models/costume-image.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "图片",
  "structure": {
    "data": "Base64 文件内容",
    "mime": "MIME 类型"
  },
  "requirements": "一张图片。"
};

export default {
  promptModel,
  compose(input) {
    return {
      ...commonValues(input),
      人物资料: input.person,
      本套服装描述: input.costume,
      参考图片说明: input.referenceDescription,
    };
  },
  validateInput(input) {
    if (input.references.length > 1) invalid("输入.references", "定妆照最多使用一张参考图");
    for (const value of input.references) {
      if (typeof value !== "string") invalid("输入.references", "参考图需为 data URL 字符串");
      if (!decodeImageData(value).bytes.length) invalid("输入.references", "参考图不能为空");
    }
  },
  actions: {
    generate: {
      input: {"language":"string","requirements":"string","person":"string","costume":"string","referenceDescription":"string","aspectRatio":"string","references":"array"},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","person":"string","costume":"string","referenceDescription":"string","opinion":"string","aspectRatio":"string","references":"array"},
      output: output0,
    },
  },
};
