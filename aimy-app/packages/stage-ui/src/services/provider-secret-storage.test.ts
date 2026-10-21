import type { ProviderSecretStorage } from './provider-secret-storage'

import { describe, expect, it, vi } from 'vitest'

import { configureProviderSecretStorage, getProviderSecretStorage } from './provider-secret-storage'

describe('provider secret platform boundary', () => {
  it('fails closed before host setup and delegates without retaining secret values', async () => {
    const input = { providerId: 'synthetic-provider', secrets: { apiKey: 'synthetic-key' } }
    await expect(getProviderSecretStorage().write(input)).rejects.toMatchObject({ code: 'unavailable' })

    const reference = { secretRef: 'synthetic-reference', revision: 1 }
    const platform: ProviderSecretStorage = {
      write: vi.fn(async () => reference),
      read: vi.fn(async () => ({ apiKey: 'synthetic-key' })),
      remove: vi.fn(async () => undefined),
    }
    configureProviderSecretStorage(platform)
    expect(getProviderSecretStorage()).toBe(platform)
    await expect(getProviderSecretStorage().write(input)).resolves.toEqual(reference)
    expect(platform.write).toHaveBeenCalledWith(input)
    expect(() => configureProviderSecretStorage(platform)).not.toThrow()
    expect(() => configureProviderSecretStorage({ ...platform })).toThrow('already configured')
  })
})
