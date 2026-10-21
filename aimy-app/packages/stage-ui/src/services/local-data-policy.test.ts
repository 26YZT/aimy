import { describe, expect, it } from 'vitest'

import { assertCloudReplicaAllowed, configureLocalOnly, isCloudReplicaEnabled } from './local-data-policy'

describe('local data policy', () => {
  it('retains host behavior until the desktop irreversibly disables replicas', () => {
    expect(isCloudReplicaEnabled()).toBe(true)
    expect(() => assertCloudReplicaAllowed()).not.toThrow()

    const pendingTransportAttempt = () => assertCloudReplicaAllowed()
    configureLocalOnly()

    expect(isCloudReplicaEnabled()).toBe(false)
    expect(pendingTransportAttempt).toThrow('Cloud replicas are disabled')
    configureLocalOnly()
    expect(() => assertCloudReplicaAllowed()).toThrow('Cloud replicas are disabled')
  })
})
