import { LocalChatError } from './safe-errors'

export type ChatConfig = {
  apiKey: string
  model: string
  baseUrl?: string
  api?: 'responses' | 'chat-completions'
}

export function loadChatConfig(env: NodeJS.ProcessEnv = process.env): ChatConfig {
  const apiKey = env.AIMY_API_KEY?.trim()
  const model = env.AIMY_MODEL?.trim()
  if (!apiKey) throw new LocalChatError('missingApiKey')
  if (!model) throw new LocalChatError('missingModel')
  const rawApi = env.AIMY_API?.trim()
  if (rawApi && rawApi !== 'responses' && rawApi !== 'chat-completions') throw new LocalChatError('invalidApi')
  const api = rawApi as ChatConfig['api'] | undefined
  return { apiKey, model, ...(env.AIMY_BASE_URL?.trim() ? { baseUrl: env.AIMY_BASE_URL.trim() } : {}), ...(api ? { api } : {}) }
}
