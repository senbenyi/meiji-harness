// 会话推理由 Harness 执行，与制作任务使用同一网关配置；密钥只写凭据服务。
export async function syncChatModel({ settings, credentials }, routes) {
  const provider = 'meiji-gateway', ref = 'MEIJI_GATEWAY_API_KEY'
  await credentials.set(ref, routes.apiKey)
  await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', provider], value: {
    displayName: '短剧统一网关', baseURL: routes.baseUrl, apiKeyEnv: ref, api: 'openai-completions',
    compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    models: [{ id: routes.chat.model, name: routes.chat.model, contextWindow: 65536, maxTokens: 4096, input: ['text'] }],
  } }])
  await settings.update('agent-default-model', { provider, model: routes.chat.model })
}
