// tests/service/tunnel.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TunnelManager } from '../../src/service/ssh/tunnel'

describe('TunnelManager', () => {
  let manager: TunnelManager

  beforeEach(() => {
    manager = new TunnelManager()
  })

  it('starts with no tunnels', () => {
    expect(manager.getAll()).toEqual([])
  })

  it('closes a tunnel by id', () => {
    const tunnelId = manager._injectForTest({
      machineId: 'machine-1',
      remotePort: 3000,
      localPort: 13000,
      server: { close: vi.fn() } as any,
    })
    manager.close(tunnelId)
    expect(manager.getAll()).toHaveLength(0)
  })

  it('returns tunnel info from getAll', () => {
    manager._injectForTest({
      machineId: 'machine-1',
      remotePort: 3000,
      localPort: 13000,
      server: { close: vi.fn() } as any,
    })
    const all = manager.getAll()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ machineId: 'machine-1', remotePort: 3000, localPort: 13000 })
  })
})
