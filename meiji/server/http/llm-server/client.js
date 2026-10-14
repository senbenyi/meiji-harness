import { chatParameters } from './params.js';
import { sendChat } from '../chat-transport.js';

export const llmServerClient = Object.freeze({
  complete(options) { return sendChat(chatParameters(options), options); },
});
