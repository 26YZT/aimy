import { createContext } from '@moeru/eventa'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { computerUseReadImage, computerUseRun } from '../../../../shared/eventa/computer-use'
import { setupComputerUse } from './index'

const boundary = vi.hoisted(() => ({
  handlers: new Map<string, (input: unknown) => unknown>(),
  binaryPath: vi.fn(() => '/synthetic/auv'),
  run: vi.fn(async () => ({ exitCode: 0, stdout: 'synthetic', stderr: '' })),
  readImage: vi.fn(async () => 'data:image/png;base64,synthetic'),
  dispose: vi.fn(),
}))

vi.mock('@auv-js/cli/binary', () => ({ binaryPath: boundary.binaryPath }))
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/synthetic/profile' } }))
vi.mock('../../../libs/bootkit/lifecycle', () => ({ onAppBeforeQuit: vi.fn() }))
vi.mock('./runtime', () => ({
  createComputerUseRuntime: vi.fn(() => ({ run: boundary.run, readImage: boundary.readImage, dispose: boundary.dispose })),
}))
vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...actual,
    defineInvokeHandler: vi.fn((_context: unknown, event: { sendEvent: { id: string } }, handler: (input: unknown) => unknown) => {
      boundary.handlers.set(event.sendEvent.id, handler)
      return () => boundary.handlers.delete(event.sendEvent.id)
    }),
  }
})

describe('first increment computer automation boundary', () => {
  beforeEach(() => {
    boundary.handlers.clear()
    vi.clearAllMocks()
    setupComputerUse(createContext())
  })

  it.each([
    [computerUseRun.sendEvent.id, { argv: ['invoke', '--help'] }],
    [computerUseReadImage.sendEvent.id, { path: '/synthetic/image.png' }],
  ])('rejects %s before resolving a binary or reading an artifact', async (event, input) => {
    const handler = boundary.handlers.get(event)
    expect(handler).toBeDefined()
    await expect(Promise.resolve().then(() => handler!(input))).rejects.toThrow('Computer automation is not available in this Aimy release.')
    expect(boundary.binaryPath).not.toHaveBeenCalled()
    expect(boundary.run).not.toHaveBeenCalled()
    expect(boundary.readImage).not.toHaveBeenCalled()
  })
})
