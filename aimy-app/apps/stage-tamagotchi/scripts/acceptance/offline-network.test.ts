import { createServer, get } from 'node:http'
import { connect } from 'node:net'

import { expect, it } from 'vitest'

import { installOfflineNodeNetworkGuard } from './offline-network'

it('permits the fixture but rejects other Node destinations before connection or DNS', async () => {
  const server = createServer((_request, response) => response.end('fixture'))
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('TEST_SERVER_NOT_BOUND')
  const guard = installOfflineNodeNetworkGuard([address.port])
  try {
    expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe('fixture')
    const nativeHttp = await new Promise<string>((accept, reject) => {
      get(`http://127.0.0.1:${address.port}/`, (response) => {
        let body = ''
        response.on('data', (chunk) => {
          body += chunk.toString()
        })
        response.on('end', () => accept(body))
      }).on('error', reject)
    })
    expect(nativeHttp).toBe('fixture')
    expect(() => connect({ port: address.port, host: 'example.invalid' })).toThrow('OFFLINE_NODE_NETWORK_DENIED')
    expect(() => connect({ port: 443, host: '127.0.0.1' })).toThrow('OFFLINE_NODE_NETWORK_DENIED')
    expect(guard.summary().blockedConnections).toBe(2)
  }
  finally {
    guard.restore()
    server.closeAllConnections()
    await new Promise<void>(accept => server.close(() => accept()))
  }
})
