import type { GenerationProvider } from '@proj-airi/provider-inference'
import type { Conversation, StreamEvent } from '@proj-airi/core-agent'
import { nanoid } from 'nanoid'

import { LocalChatError } from './safe-errors'

export type StreamFromLike = (args: {
  model: string
  chatProvider: GenerationProvider
  conversation: Conversation
  options?: {
    abortSignal?: AbortSignal
    supportsTools?: boolean
    onStreamEvent?: (event: StreamEvent) => void | Promise<void>
  }
}) => Promise<void>

export async function streamChatTurn(args: {
  model: string
  provider: GenerationProvider
  userText: string
  streamFrom: StreamFromLike
  signal?: AbortSignal
  onTextDelta?: (text: string) => void | Promise<void>
}): Promise<string> {
  const text = args.userText.trim()
  if (!text)
    throw new LocalChatError('emptyMessage')
  let answer = ''
  const conversation: Conversation = {
    turns: [{ type: 'user', id: nanoid(), content: [{ type: 'text', text }] }],
  }
  await args.streamFrom({
    model: args.model,
    chatProvider: args.provider,
    conversation,
    options: {
      abortSignal: args.signal,
      supportsTools: false,
      onStreamEvent: async (event) => {
        if (event.type === 'text-delta') {
          answer += event.text
          await args.onTextDelta?.(event.text)
        }
        if (event.type === 'error')
          throw event.error
      },
    },
  })
  return answer
}
