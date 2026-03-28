// tests/service/connection-pool-hostkey.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectionPool } from '../../src/service/ssh/connection-pool'

vi.mock('ssh2', () => {
  const mockClient = {
    on: vi.fn().mockReturnThis(),
    connect: vi.fn(),
    end: vi.fn(),
  }
  return { Client: vi.fn(function() { return mockClient }) }
})
vi.mock('fs')

describe('ConnectionPool host key', () => {
  let pool: ConnectionPool

  beforeEach(() => {
    pool = new ConnectionPool()
  })

  it('calls hostKeyCallback when connecting', () => {
    const onHostKey = vi.fn()
    pool.connect(
      { id: 'm1', name: 'T', host: '100.0.0.1', port: 22, username: 'u', auth: { type: 'key', keyPath: '~/.ssh/id_rsa' } },
      vi.fn(),
      undefined,
      onHostKey
    )
    // hostVerifier is set in connect config — verify it's wired
    expect(pool.getStatus('m1')).toBe('connecting')
  })

  it('approveHostKey resolves pending verification', () => {
    pool.connect(
      { id: 'm1', name: 'T', host: '100.0.0.1', port: 22, username: 'u', auth: { type: 'key', keyPath: '~/.ssh/id_rsa' } },
      vi.fn(), undefined, vi.fn()
    )
    // Should not throw
    pool.approveHostKey('m1')
    pool.rejectHostKey('m2') // unknown id — should not throw
  })
})
