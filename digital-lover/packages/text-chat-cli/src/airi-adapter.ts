import { streamFrom } from '@proj-airi/core-agent'
import { getDefinedProvider } from '@proj-airi/provider-inference'
import type { GenerationProvider } from '@proj-airi/provider-inference'
import type { ChatConfig } from './config'

export async function createAiriProvider(config: ChatConfig): Promise<GenerationProvider> {
  const definition = getDefinedProvider(config.baseUrl ? 'openai-compatible' : 'openai')
  if (!definition) throw new Error('AIRI provider definition is unavailable.')
  const provider = await definition.createProvider({ apiKey: config.apiKey, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), ...(config.api ? { api: config.api } : {}) } as never)
  if (!('generation' in provider) || typeof provider.generation !== 'function') throw new Error('AIRI provider does not expose generation capability.')
  return provider
}

export { streamFrom }
