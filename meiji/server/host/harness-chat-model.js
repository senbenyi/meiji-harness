import { modelRoute } from '../../models/model-config.js'

// 会话推理由 Harness 执行，与制作文本使用同一本机 Ollama 服务。
export async function syncChatModel({ settings, credentials }, routes) {
  const provider = 'meiji-gateway', ref = 'MEIJI_GATEWAY_API_KEY'
  const chat = modelRoute(routes, 'chat')
  await credentials.set(ref, chat.apiKey)
  await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', provider], value: {
    displayName: '本地千问 3.5', baseURL: chat.baseUrl, apiKeyEnv: ref, api: 'openai-completions',
    reasoning: 'off',
    compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens', supportsReasoningEffort: true, requiresThinkingAsText: false, requiresReasoningContentOnAssistantMessages: false },
    models: [{ id: chat.model, name: chat.model, contextWindow: 32768, input: ['text'], reasoningEfforts: { off: 'none', medium: 'medium' } }],
  } }])
  await settings.update('agent-default-model', { provider, model: chat.model, reasoningEffort: 'off' })
}
