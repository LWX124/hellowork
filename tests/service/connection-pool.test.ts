// tests/service/connection-pool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectionPool } from '../../src/service/ssh/connection-pool'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    readFileSync: vi.fn((path: string, ...args: unknown[]) => {
      if (typeof path === 'string' && path.includes('.ssh')) return Buffer.from('mock-key')
      return (actual.readFileSync as Function)(path, ...args)
    }),
  }
})

vi.mock('ssh2', () => {
  const mockClient = {
    on: vi.fn().mockReturnThis(),
    connect: vi.fn(),
    end: vi.fn(),
  }
  const MockClient = vi.fn(function () {
    return mockClient
  }) as any
  MockClient.prototype = mockClient
  return { Client: MockClient }
})

describe('ConnectionPool', () => {
  let pool: ConnectionPool

  beforeEach(() => {
    pool = new ConnectionPool()
  })

  it('starts with no connections', () => {
    expect(pool.getStatus('machine-1')).toBe('disconnected')
  })

  it('tracks connection state as connecting', () => {
    pool.connect({
      id: 'machine-1', name: 'Test', host: '100.0.0.1', port: 22,
      username: 'user', auth: { type: 'key', keyPath: '~/.ssh/id_rsa' }
    }, vi.fn())
    expect(pool.getStatus('machine-1')).toBe('connecting')
  })

  it('disconnects and removes from pool', () => {
    pool.connect({
      id: 'machine-1', name: 'Test', host: '100.0.0.1', port: 22,
      username: 'user', auth: { type: 'key', keyPath: '~/.ssh/id_rsa' }
    }, vi.fn())
    pool.disconnect('machine-1')
    expect(pool.getStatus('machine-1')).toBe('disconnected')
  })

  it('returns undefined client for unknown machine', () => {
    expect(pool.getClient('unknown')).toBeUndefined()
  })
})
