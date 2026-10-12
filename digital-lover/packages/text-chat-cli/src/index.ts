#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { streamFrom } from '@proj-airi/core-agent'
import { loadChatConfig } from './config'
import { createAiriProvider } from './airi-adapter'
import { streamChatTurn } from './chat-session'
import { getChatFailureMessage } from './safe-errors'

export { loadChatConfig, streamChatTurn, createAiriProvider }

async function main() {
  loadDotenv({
    path: process.env.AIMY_ENV_FILE?.trim() || fileURLToPath(new URL('../../../.env', import.meta.url)),
    override: false,
  })
  const config = loadChatConfig()
  const provider = await createAiriProvider(config)
  const readline = createInterface({ input: stdin, output: stdout })
  try {
    const input = await readline.question('你：')
    process.stdout.write('aimy：')
    await streamChatTurn({
      model: config.model,
      provider,
      userText: input,
      streamFrom,
      onTextDelta: text => { process.stdout.write(text) },
    })
    process.stdout.write('\n')
  } finally {
    readline.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`)
  void main().catch(error => {
    console.error(`aimy chat failed: ${getChatFailureMessage(error)}`)
    process.exitCode = 1
  })
