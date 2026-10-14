import { modelRoute } from '../../models/model-config.js'

// 会话推理由 Harness 执行，与制作文本读取同一设置 Model。
export async function syncChatModel({ settings, credentials }, routes) {
  const provider = 'meiji-gateway', ref = 'MEIJI_GATEWAY_API_KEY'
  const chat = modelRoute(routes, 'chat')
  const local = chat.model === 'qwen3.5:27b'
  await credentials.set(ref, chat.apiKey)
  await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', provider], value: {
    displayName: local ? 'Qwen3.5 27B' : '模型接口', baseURL: chat.baseUrl, apiKeyEnv: ref, api: 'openai-completions',
    reasoning: 'off',
    compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens', supportsReasoningEffort: local, requiresThinkingAsText: false, requiresReasoningContentOnAssistantMessages: false },
    models: [{ id: chat.model, name: chat.model, contextWindow: local ? 262144 : 65536, input: ['text'], ...(local ? { reasoningEfforts: { off: 'none', medium: 'medium' } } : {}) }],
  } }])
  await settings.update('agent-default-model', { provider, model: chat.model, reasoningEffort: 'off' })
}
