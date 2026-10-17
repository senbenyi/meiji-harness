import { videoRequest } from '../video-request.js';

const output0 = {
  "type": "视频",
  "structure": {
    "data": "Base64 文件内容",
    "mime": "MIME 类型"
  },
  "requirements": "只输出本镜视频，不附文字说明。"
};

export default {
  // 视频不经文本模型，规则仅供面板“规则”视图展示；唯一定义处。
  rules: {
    generate: '使用已审核的分镜提示词三个段落原文生成本镜视频。文生直接提交；首尾帧以前镜尾帧为首帧；多模态使用本镜角色与服装参考图。按本镜时长与项目画幅提交，不再调用文本模型改写提示词。',
    revise: '按本次修改意见修订视频请求，保留已审核三段原文及对应类型的参考素材。',
  },
  render(input, action, output) {
    const request = videoRequest(input, action);
    return { system: '', user: request.prompt, body: request.prompt, output: structuredClone(output), request };
  },
  actions: {
    generate: {
      input: {"type": "string", "textPrompt": ["object", "string"], "duration": "number", "aspectRatio": "string", "firstFrame": ["string", "undefined"], "lastFrame": ["string", "undefined"], "referenceImages": ["array", "undefined"], "referenceBindings": ["array", "undefined"], "packedPrompt": ["string", "undefined"]},
      output: output0,
    },
    regenerate: {
      input: {"type": "string", "textPrompt": ["object", "string"], "duration": "number", "aspectRatio": "string", "firstFrame": ["string", "undefined"], "lastFrame": ["string", "undefined"], "referenceImages": ["array", "undefined"], "referenceBindings": ["array", "undefined"], "packedPrompt": ["string", "undefined"], "opinion": "string"},
      output: output0,
    },
  },
};
