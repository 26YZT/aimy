import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const cliPath = fileURLToPath(new URL('./index.ts', import.meta.url))
const tsxLoader = pathToFileURL(require.resolve('tsx')).href
const providerModule = pathToFileURL(require.resolve('@proj-airi/provider-inference')).href
const fakeCredential = 'AUDIT_FAKE_CREDENTIAL'
const providerDetail = 'private-provider-debug'
const safeProviderMessage = '模型服务暂时不可用，请检查模型配置与网络连接后重试。'

function runCli(preload: string, env: NodeJS.ProcessEnv = {}, input = 'hello\n', fixture?: { envFileContents: string, packageCwd?: boolean, defaultWorkspaceEnv?: boolean }) {
  // The isolated cwd and explicit environment prevent dotenv from reading the user's credentials.
  const directory = mkdtempSync(join(tmpdir(), 'aimy-cli-errors-'))
  const preloadPath = join(directory, 'provider-boundary.mjs')
  const envFilePath = join(directory, '.env')
  const packageDirectory = join(directory, 'packages', 'text-chat-cli')
  let entryPath = cliPath
  writeFileSync(preloadPath, preload)
  if (fixture) {
    writeFileSync(envFilePath, fixture.envFileContents)
    if (fixture.packageCwd)
      mkdirSync(packageDirectory, { recursive: true })
    if (fixture.defaultWorkspaceEnv) {
      // Exercise the identical source under an isolated workspace root, so the
      // default-path regression cannot inspect the user's real root .env.
      cpSync(fileURLToPath(new URL('.', import.meta.url)), join(packageDirectory, 'src'), { recursive: true })
      cpSync(fileURLToPath(new URL('../package.json', import.meta.url)), join(packageDirectory, 'package.json'))
      symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(packageDirectory, 'node_modules'), 'dir')
      entryPath = realpathSync(join(packageDirectory, 'src', 'index.ts'))
    }
  }
  try {
    return spawnSync(process.execPath, ['--import', tsxLoader, '--import', preloadPath, entryPath], {
      cwd: fixture?.packageCwd ? packageDirectory : directory,
      env: {
        AIMY_API_KEY: fakeCredential,
        AIMY_MODEL: 'test-model',
        AIMY_BASE_URL: 'https://provider.test/v1',
        AIMY_ENV_FILE: fixture?.defaultWorkspaceEnv ? undefined : fixture ? envFilePath : join(directory, 'no-local-config.env'),
        ...env,
      },
      input,
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    })
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('CLI error boundary', () => {
  // Regression for the stage-A audit, using the actual CLI and SDK in a fresh process.
  it.each(['chat-completions', 'responses'])('keeps %s provider stream failures out of CLI output', (api) => {
    const result = runCli(`
      globalThis.fetch = async () => {
        process.stdout.write('TEST_FETCH_FAILURE\\n');
        throw new Error('${fakeCredential} ${providerDetail}');
      };
    `, { AIMY_API: api })

    const output = result.stdout + result.stderr
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(output).toContain('TEST_FETCH_FAILURE')
    expect(result.stderr).toContain(`aimy chat failed: ${safeProviderMessage}`)
    expect(output).not.toContain(fakeCredential)
    expect(output).not.toContain(providerDetail)
    expect(result.stderr).not.toMatch(/\n\s+at /)
  })

  it.each(['throw', 'reject'])('keeps provider initialization %s failures private', (failure) => {
    const result = runCli(`
      import { getDefinedProvider } from '${providerModule}';
      globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
      const definition = getDefinedProvider('openai-compatible');
      if (!definition) throw new Error('Test provider unavailable');
      definition.createProvider = () => {
        process.stdout.write('TEST_PROVIDER_INITIALIZATION_FAILURE\\n');
        ${failure === 'throw' ? 'throw' : 'return Promise.reject('} new Error('${fakeCredential} ${providerDetail}')${failure === 'throw' ? ';' : ');'}
      };
    `)

    const output = result.stdout + result.stderr
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(output).toContain('TEST_PROVIDER_INITIALIZATION_FAILURE')
    expect(result.stderr).toContain(`aimy chat failed: ${safeProviderMessage}`)
    expect(output).not.toContain(fakeCredential)
    expect(output).not.toContain(providerDetail)
    expect(result.stderr).not.toMatch(/\n\s+at /)
  })

  it('keeps actionable local configuration errors without echoing values', () => {
    const result = runCli('globalThis.fetch = async () => { throw new Error("Unexpected network request"); };', { AIMY_MODEL: '' })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Missing AIMY_MODEL.')
    expect(result.stderr).not.toContain(fakeCredential)
  })

  it('keeps actionable empty-input errors', () => {
    const result = runCli('globalThis.fetch = async () => { throw new Error("Unexpected network request"); };', {}, ' \n')
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Message cannot be empty.')
    expect(result.stderr).not.toContain(fakeCredential)
  })
})

function successfulProviderPreload(expectedKey: string, expectedModel: string) {
  return `
    globalThis.fetch = async (_url, init) => {
      const headers = new Headers(init.headers);
      const body = JSON.parse(init.body);
      if (headers.get('authorization') !== 'Bearer ${expectedKey}' || body.model !== '${expectedModel}')
        throw new Error('Test configuration mismatch');
      process.stdout.write('TEST_CONFIGURATION_VALIDATED\\n');
      const chunks = [
        { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: '${expectedModel}', choices: [{ index: 0, delta: { role: 'assistant', content: 'fixture ok' }, finish_reason: null }] },
        { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: '${expectedModel}', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ];
      const stream = chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\\n\\n').join('') + 'data: [DONE]\\n\\n';
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  `
}

describe('CLI configuration file boundary', () => {
  const fixtureConfig = [
    'AIMY_API_KEY=FILE_FAKE_CREDENTIAL',
    'AIMY_MODEL=file-model',
    'AIMY_BASE_URL=https://provider.test/v1',
    'AIMY_API=chat-completions',
  ].join('\n')

  // Regression for pnpm chat: filtered package scripts run from the package cwd.
  it('loads an explicitly selected env file while running from a package directory', () => {
    const result = runCli(successfulProviderPreload('FILE_FAKE_CREDENTIAL', 'file-model'), {
      AIMY_API_KEY: undefined,
      AIMY_MODEL: undefined,
      AIMY_BASE_URL: undefined,
    }, 'hello\n', { envFileContents: fixtureConfig, packageCwd: true })

    const output = result.stdout + result.stderr
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('TEST_CONFIGURATION_VALIDATED')
    expect(result.stdout).toContain('fixture ok')
    expect(output).not.toContain('FILE_FAKE_CREDENTIAL')
    expect(result.stderr).toBe('')
  })

  it('keeps environment variables ahead of values in the selected env file', () => {
    const result = runCli(successfulProviderPreload('ENV_FAKE_CREDENTIAL', 'environment-model'), {
      AIMY_API_KEY: 'ENV_FAKE_CREDENTIAL',
      AIMY_MODEL: 'environment-model',
    }, 'hello\n', { envFileContents: fixtureConfig, packageCwd: true })

    const output = result.stdout + result.stderr
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('TEST_CONFIGURATION_VALIDATED')
    expect(output).not.toContain('FILE_FAKE_CREDENTIAL')
    expect(output).not.toContain('ENV_FAKE_CREDENTIAL')
    expect(result.stderr).toBe('')
  })

  it('loads the workspace-root env file by default from the package directory', () => {
    const result = runCli(successfulProviderPreload('FILE_FAKE_CREDENTIAL', 'file-model'), {
      AIMY_API_KEY: undefined,
      AIMY_MODEL: undefined,
      AIMY_BASE_URL: undefined,
    }, 'hello\n', { envFileContents: fixtureConfig, packageCwd: true, defaultWorkspaceEnv: true })

    const output = result.stdout + result.stderr
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('TEST_CONFIGURATION_VALIDATED')
    expect(result.stdout).toContain('fixture ok')
    expect(output).not.toContain('FILE_FAKE_CREDENTIAL')
    expect(result.stderr).toBe('')
  })
})
