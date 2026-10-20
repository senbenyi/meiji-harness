export const mainAgentProvider = 'drama-server'

/** 模型调用由Harness会话执行；供应商路由与制作模型使用同一服务地址。 */
export async function configureMainAgent({ settings, credentials }, config) {
  const reference = 'DRAMA_MODEL_API_KEY'
  await credentials.set(reference, config.apiKey || 'ollama')
  await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', mainAgentProvider], value: {
    displayName: 'Drama 主 Agent', baseURL: config.baseUrl, apiKeyEnv: reference, api: 'openai-completions',
    compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens', supportsReasoningEffort: false },
    models: [{ id: config.session.model, name: 'GPT', contextWindow: 65536, input: ['text'] }],
  } }])
  await settings.update('agent-default-model', { provider: mainAgentProvider, model: config.session.model })
}
