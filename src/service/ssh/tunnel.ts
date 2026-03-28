// src/service/ssh/tunnel.ts
import * as net from 'net'
import { Client } from 'ssh2'
import { randomUUID } from 'crypto'

interface TunnelEntry {
  machineId: string
  remotePort: number
  localPort: number
  server: net.Server
}

export class TunnelManager {
  private tunnels = new Map<string, TunnelEntry>()

  open(client: Client, machineId: string, remotePort: number): Promise<{ tunnelId: string; localPort: number }> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((localSocket) => {
        client.forwardOut('127.0.0.1', 0, '127.0.0.1', remotePort, (err, stream) => {
          if (err) {
            localSocket.destroy()
            return
          }
          localSocket.pipe(stream).pipe(localSocket)
          localSocket.on('close', () => stream.destroy())
          stream.on('close', () => localSocket.destroy())
        })
      })

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo
        const tunnelId = `tunnel-${randomUUID()}`
        this.tunnels.set(tunnelId, { machineId, remotePort, localPort: addr.port, server })
        resolve({ tunnelId, localPort: addr.port })
      })

      server.on('error', reject)
    })
  }

  close(tunnelId: string): void {
    const entry = this.tunnels.get(tunnelId)
    if (!entry) return
    entry.server.close()
    this.tunnels.delete(tunnelId)
  }

  getAll(): Array<{ tunnelId: string; machineId: string; remotePort: number; localPort: number }> {
    return Array.from(this.tunnels.entries()).map(([tunnelId, e]) => ({
      tunnelId, machineId: e.machineId, remotePort: e.remotePort, localPort: e.localPort
    }))
  }

  closeAll(): void {
    for (const [id] of this.tunnels) this.close(id)
  }

  _injectForTest(entry: Omit<TunnelEntry, 'tunnelId'> & { server: any }): string {
    const tunnelId = `tunnel-${randomUUID()}`
    this.tunnels.set(tunnelId, entry as TunnelEntry)
    return tunnelId
  }
}
