import { createHandlerRegistry } from '../../server/handlers/handler-registry.js';
import { createVideoPromptHandler } from '../../server/handlers/video-prompt-handler.js';
import { createAiRoutes, composeNodePrompt } from '../../server/http/ai-routes.js';
import { createTextHandler } from '../../server/handlers/text-handler.js';
import { createMediaHandler } from '../../server/handlers/media-handler.js';
import { taskNodeInput } from '../../server/handlers/node-inputs.js';

export const config = { baseUrl: 'http://elysium.test/v1', apiKey: 'test-only', textBaseUrl: 'http://qwen.test/v1', text: { model: 'qwen3.5:27b' }, image: { model: 'elysium-image' }, video: { model: 'elysium-video' } };
export const testAi = gateway => createAiRoutes({ readConfig: async () => config, gateway });
export const createTestTextHandler = ({ chat }) => createTextHandler({ ai: testAi({ chat }) });
export const createTestMediaHandler = ({ media, gateway }) => createHandlerRegistry({ media: createMediaHandler({ media, ai: testAi(gateway) }), videoPrompt: createVideoPromptHandler({ media }) });
export function renderTaskPrompt(snapshot, task, draft, action, step = {}) {
  return composeNodePrompt(task.business_type, action, taskNodeInput(snapshot, task, draft, action, step), config.text.model);
}
export function sampleInput(schema) {
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => {
    if ([value].flat().includes('undefined')) return [key, undefined];
    if (key === 'previous' && schema.bindings) return [key, null];
    if (key === 'type') return [key, '文生'];
    if (key === 'aspectRatio') return [key, '16:9'];
    if (key === 'textPrompt') return [key, { integrated_multimodal_description: 'A scene.', overall_soundscape: 'Wind.', non_diegetic_music: 'None.' }];
    if (key === 'content' && schema.shot && !schema.duration && !schema.storyboard) return [key, { on_screen_characters: [] }];
    const type = [value].flat()[0];
    return [key, type === 'array' ? [] : type === 'object' ? {} : type === 'number' ? 10 : `资料-${key}-{{保持原文}}`];
  }));
}
