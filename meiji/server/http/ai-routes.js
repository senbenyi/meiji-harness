import { parseSections } from '../prompts/parse-sections.js';
import { decodeImageData } from '../media/decode-image-data.js';
import { nodeRoutes } from './nodes/index.js';
import { invalid, assertRecord } from '../../shared/task_contract.js';
import { validateShape } from './validate-shape.js';
import { parseJsonValue } from '../prompts/parse-json.js';
import { renderPrompt } from '../prompts/render.js';
import { textProvider } from '../prompts/providers.js';
import { modelRoute } from '../../models/model-config.js';
import { elysiumClient } from './elysium/client.js';
import { llmServerClient } from './llm-server/client.js';
import { withGatewayTrace } from '../gateway/gateway-trace.js';
import { generateGatewayImage, submitGatewayVideo, retrieveGatewayVideo } from '../gateway/model-gateway.js';

export { nodeRoutes };
const clients = { codex: llmServerClient, elysium: elysiumClient, 'llm-server': llmServerClient };

export function nodeAction(node, action) {
  const route = Object.hasOwn(nodeRoutes, node) && nodeRoutes[node];
  const contract = route && Object.hasOwn(route.actions, action) && route.actions[action];
  if (!contract) throw Object.assign(new Error('AI 节点或动作不存在'), { status: 404 });
  return { route, contract };
}

export function validateInput(input, schema) {
  assertRecord(input, '输入');
  for (const key of Object.keys(input)) if (!Object.hasOwn(schema, key)) invalid(`输入.${key}`, '未定义参数');
  for (const [key, types] of Object.entries(schema)) {
    const value = input[key], type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (![types].flat().includes(type) || (type === 'number' && !Number.isFinite(value))) invalid(`输入.${key}`, `需为 ${[types].flat().join(' / ')}`);
  }
}

export function composeNodePrompt(node, action, input, model) {
  const { route, contract } = nodeAction(node, action);
  validateInput(input, contract.input);
  route.validateInput?.(input, action);
  if (route.render) return route.render(input, action, contract.output);
  const provider = ['图片', '视频'].includes(contract.output.type) ? 'elysium' : textProvider(model);
  return renderPrompt(route.promptModel, action, route.compose(input), contract.output, provider);
}

export function validateNodeResult(node, action, value, input) {
  const { route, contract } = nodeAction(node, action);
  if (['JSON', '图片', '视频'].includes(contract.output.type)) validateShape(value, contract.output.structure);
  else if (typeof value !== 'string' || !value.trim()) invalid('响应', '需为非空文本');
  if (contract.output.sections) parseSections(value, contract.output.sections);
  if (action === 'review' && (value.是否通过 ? value.原因 !== '' : !value.原因.trim())) invalid('响应.原因', '通过时应为空，不通过时需说明原因');
  route.validateResult?.(value, input, action);
  return value;
}

// HTTP 路由和任务 Handler 共用此执行入口；每次读取一次配置，整次请求固定同一个模型。
export function createAiRoutes({ readConfig, gateway = {} }) {
  return async (node, action, input, context = {}) => {
    const { route, contract } = nodeAction(node, action);
    validateInput(input, contract.input);
    route.validateInput?.(input, action);
    if (route.render) route.render(input, action, contract.output);
    const kind = contract.output.type === '图片' ? 'image' : contract.output.type === '视频' ? 'video' : 'text';
    const connection = modelRoute(await readConfig(), kind);
    const prompt = composeNodePrompt(node, action, input, connection.model);
    prompt.node = node;
    prompt.action = action;
    prompt.model = connection.model;
    prompt.input = structuredClone(input);
    prompt.transfers = [];
    const { signal, record = async () => {} } = context;
    signal?.throwIfAborted();
    await record({ prompt });
    return withGatewayTrace(async (transfer, options) => {
      const index = prompt.transfers.indexOf(transfer);
      if (options?.drop) { if (index >= 0) prompt.transfers.splice(index, 1); }
      else if (index < 0) prompt.transfers.push(transfer);
      await record({ prompt });
    }, async () => {
      const options = { ...context, ...connection, signal, trace: prompt, record };
      let result;
      if (kind === 'text') {
        const complete = gateway.chat || clients[textProvider(connection.model)].complete;
        result = await complete({ ...options, messages: prompt.messages });
        signal?.throwIfAborted();
        if (contract.output.type === 'JSON' && typeof result === 'string') result = parseJsonValue(result);
        try { validateNodeResult(node, action, result, input); }
        catch (error) {
          if (contract.output.type === 'JSON' && action !== 'review' && error.code === 'INVALID_CONTRACT')
            Object.assign(error, { candidate: structuredClone(result), prompt });
          throw error;
        }
      } else {
        let bytes;
        if (kind === 'image') {
          const generate = gateway.image || (['krea2 turbo V2.5', 'gpt-image'].includes(connection.model) ? llmServerClient.generateImage : generateGatewayImage);
          bytes = await generate({ ...options, prompt: prompt.body, aspectRatio: input.aspectRatio, references: input.references.map(value => decodeImageData(value)) });
        } else if (connection.model === 'MiniMax-H3' && !gateway.submitVideo) {
          const generated = await (gateway.video || llmServerClient.generateVideo)({ ...options, ...prompt.request });
          prompt.parameters = { remote_id: generated.taskId };
          await record({ result: { remote_id: generated.taskId }, prompt });
          bytes = generated.bytes;
        } else {
          const remote = await (gateway.submitVideo || submitGatewayVideo)({ ...options, ...prompt.request });
          prompt.parameters = { remote_id: remote.id };
          await record({ result: { remote_id: remote.id }, prompt });
          bytes = await (gateway.retrieveVideo || retrieveGatewayVideo)({ ...options, promptId: remote.id });
        }
        signal?.throwIfAborted();
        if (!Buffer.isBuffer(bytes) || !bytes.length) invalid('响应', '需为非空媒体文件');
        const mime = kind === 'video' ? 'video/mp4' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes.subarray(0, 4).toString() === 'RIFF' ? 'image/webp' : 'image/png';
        result = { data: bytes.toString('base64'), mime };
        validateNodeResult(node, action, result, input);
      }
      return { result, prompt };
    });
  };
}
