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
