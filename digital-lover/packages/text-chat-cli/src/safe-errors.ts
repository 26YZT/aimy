const localErrorMessages = {
  missingApiKey: 'Missing AIMY_API_KEY. Put it in the local .env file.',
  missingModel: 'Missing AIMY_MODEL. Put the model name in the local .env file.',
  invalidApi: 'AIMY_API must be responses or chat-completions.',
  emptyMessage: 'Message cannot be empty.',
} as const

/** Only deterministic local validation can produce these actionable errors. */
export class LocalChatError extends Error {
  constructor(readonly code: keyof typeof localErrorMessages) {
    super(localErrorMessages[code])
    this.name = 'LocalChatError'
  }
}

/** Provider/SDK failures are untrusted; never interpolate their messages or stacks. */
export function getChatFailureMessage(error: unknown): string {
  if (error instanceof LocalChatError)
    return localErrorMessages[error.code]
  return '模型服务暂时不可用，请检查模型配置与网络连接后重试。'
}
