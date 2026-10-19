import { videoRequest } from '../video-request.js';

const output0 = {
  "type": "视频",
  "structure": {
    "server_address": "服务端视频地址",
    "remote_id": "远端任务 ID"
  },
  "requirements": "生成步骤只返回服务端地址。下载到本地由后续程序步骤完成，不在本响应里附文件。"
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
