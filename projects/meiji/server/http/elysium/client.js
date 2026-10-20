import { chatParameters } from './params.js';
import { sendChat } from '../chat-transport.js';

// 模块级单例；连接与请求资料按调用传入，不保存可变任务状态。
export const elysiumClient = Object.freeze({
  complete(options) { return sendChat(chatParameters(options), options); },
});
