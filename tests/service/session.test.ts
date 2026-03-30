// tests/service/session.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionManager } from '../../src/service/ssh/session'

const makeStream = () => ({
  write: vi.fn(),
  setWindow: vi.fn(),
  on: vi.fn().mockReturnThis(),
  destroy: vi.fn(),
  stderr: { on: vi.fn() },
})

const makeClient = (stream = makeStream()) => ({
  shell: vi.fn((opts, cb) => cb(null, stream)),
  _stream: stream,
})

describe('SessionManager', () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager()
  })

  it('creates a session and returns sessionId', async () => {
    const client = makeClient() as any
    const id = await manager.create(client, vi.fn())
    expect(id).toMatch(/^sess-/)
  })

  it('writes input to the correct session stream', async () => {
    const stream = makeStream()
    const client = makeClient(stream) as any
    const id = await manager.create(client, vi.fn())
    manager.write(id, 'ls\n')
    expect(stream.write).toHaveBeenCalledWith('ls\n')
  })

  it('resizes the terminal window', async () => {
    const stream = makeStream()
    const client = makeClient(stream) as any
    const id = await manager.create(client, vi.fn())
    manager.resize(id, 120, 40)
    expect(stream.setWindow).toHaveBeenCalledWith(40, 120, 0, 0)
  })

  it('closes the session', async () => {
    const stream = makeStream()
    const client = makeClient(stream) as any
    const id = await manager.create(client, vi.fn())
    manager.close(id)
    expect(stream.destroy).toHaveBeenCalled()
    expect(manager.has(id)).toBe(false)
  })
})
