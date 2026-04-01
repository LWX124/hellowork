// src/service/index.ts
import { WebSocketServer, WebSocket } from 'ws'
import * as http from 'http'
import { ConnectionManager } from './connection/ConnectionManager'
import { IShell } from './connection/ITransport'
import { TunnelManager } from './ssh/tunnel'
import { MachinesStore } from './store/machines'
import { ClientMessage, ServerMessage } from './types'
import { homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const store = new MachinesStore(join(homedir(), '.hellowork', 'machines.json'))
const tunnels = new TunnelManager()

const server = http.createServer()
const wss = new WebSocketServer({ server })

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

wss.on('connection', (ws) => {
  // One ConnectionManager per machine, scoped to this connection
  const managers = new Map<string, ConnectionManager>()
  // sessionId → IShell (for terminal:input and terminal:resize)
  const shellMap = new Map<string, IShell>()
  // sessionId → machineId (for resize routing)
  const sessionMachineMap = new Map<string, string>()

  function getOrCreateManager(machineId: string): ConnectionManager | null {
    const machine = store.getById(machineId)
    if (!machine) return null

    let manager = managers.get(machineId)
    if (!manager) {
      manager = new ConnectionManager(machine)
      managers.set(machineId, manager)

      manager.on('status', (statusMsg: { status: string; transport?: string; message?: string }) => {
        send(ws, {
          type: 'connection:status',
          machineId,
          status: statusMsg.status as any,
          transport: statusMsg.transport as any,
          message: statusMsg.message,
        })
      })

      manager.on('session:replaced', async (msg: { oldSessionId: string; newSessionId: string; machineId: string }) => {
        // Remove the old (dead) shell — the transport disconnected so it's unusable
        shellMap.delete(msg.oldSessionId)
        sessionMachineMap.delete(msg.oldSessionId)
        // Create a fresh shell on the new transport connection
        try {
          const newShell = await manager.createShell((data) => {
            send(ws, { type: 'terminal:output', sessionId: msg.newSessionId, data })
          }, msg.newSessionId)
          shellMap.set(msg.newSessionId, newShell)
          sessionMachineMap.set(msg.newSessionId, msg.machineId)
        } catch { /* shell creation failed; client will see session:replaced and can retry */ }
        send(ws, { type: 'session:replaced', ...msg })
      })

      manager.on('terminal:message', (data: string) => {
        // Send to the current session
        const sessionId = manager!.getCurrentSessionId()
        if (sessionId) {
          send(ws, { type: 'terminal:output', sessionId, data })
        }
      })

      manager.on('mosh:unavailable', () => {
        send(ws, { type: 'mosh:unavailable' })
      })

      manager.on('tunnel:reconnected', async ({ machineId, client }: { machineId: string; client: import('ssh2').Client }) => {
        // Re-establish all open tunnels for this machine
        const openTunnels = tunnels.getAll().filter(t => t.machineId === machineId)
        for (const t of openTunnels) {
          try {
            tunnels.close(t.tunnelId)
            const { tunnelId, localPort } = await tunnels.open(client, machineId, t.remotePort)
            send(ws, { type: 'tunnel:opened', tunnelId, localPort })
          } catch {
            send(ws, { type: 'tunnel:error', tunnelId: t.tunnelId, message: 'Tunnel re-establishment failed' })
          }
        }
      })
    }

    return manager
  }

  ws.on('close', () => {
    for (const [, m] of managers) m.disconnect()
  })

  ws.on('message', async (raw) => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    switch (msg.type) {
      case 'session:create': {
        const machine = store.getById(msg.machineId)
        if (!machine) {
          send(ws, { type: 'session:error', sessionId: '', requestId: msg.requestId, message: 'Machine not found' })
          return
        }

        const manager = getOrCreateManager(msg.machineId)!
        if (manager.getState() !== 'connected') {
          await manager.connect()
          // Wait for connected state
          let waited = 0
          while (manager.getState() !== 'connected' && manager.getState() !== 'failed' && waited < 30000) {
            await new Promise(r => setTimeout(r, 200))
            waited += 200
          }
        }

        if (manager.getState() !== 'connected') {
          send(ws, { type: 'session:error', sessionId: '', requestId: msg.requestId, message: 'Connection failed' })
          return
        }

        const sessionId = `sess-${randomUUID()}`
        try {
          const shell = await manager.createShell((data) => {
            send(ws, { type: 'terminal:output', sessionId, data })
          }, sessionId)
          shellMap.set(sessionId, shell)
          sessionMachineMap.set(sessionId, msg.machineId)
          send(ws, { type: 'session:created', sessionId, requestId: msg.requestId })
        } catch (err: any) {
          send(ws, { type: 'session:error', sessionId: '', requestId: msg.requestId, message: err.message })
        }
        break
      }

      case 'session:close': {
        const shell = shellMap.get(msg.sessionId)
        shell?.close()
        shellMap.delete(msg.sessionId)
        sessionMachineMap.delete(msg.sessionId)
        break
      }

      case 'terminal:input': {
        shellMap.get(msg.sessionId)?.write(msg.data)
        break
      }

      case 'terminal:resize': {
        shellMap.get(msg.sessionId)?.resize(msg.cols, msg.rows)
        const machineId = sessionMachineMap.get(msg.sessionId)
        if (machineId) managers.get(machineId)?.setDimensions(msg.cols, msg.rows)
        break
      }

      case 'tunnel:open': {
        const manager = managers.get(msg.machineId)
        const client = manager?.getActiveSshClient()
        if (!client) {
          send(ws, { type: 'tunnel:error', tunnelId: '', message: 'Not connected via SSH' })
          return
        }
        try {
          const { tunnelId, localPort } = await tunnels.open(client, msg.machineId, msg.remotePort)
          send(ws, { type: 'tunnel:opened', tunnelId, localPort })
        } catch (err: any) {
          send(ws, { type: 'tunnel:error', tunnelId: '', message: err.message })
        }
        break
      }

      case 'tunnel:close':
        tunnels.close(msg.tunnelId)
        break

      case 'machine:list':
        send(ws, { type: 'machine:list:result', machines: store.getAll() })
        break

      case 'machine:save':
        store.save(msg.machine)
        send(ws, { type: 'machine:saved', machine: msg.machine })
        break

      case 'machine:delete':
        store.delete(msg.id)
        managers.get(msg.id)?.disconnect()
        managers.delete(msg.id)
        send(ws, { type: 'machine:deleted', id: msg.id })
        break

      case 'machine:connect': {
        const machine = store.getById(msg.machineId)
        if (!machine) {
          send(ws, { type: 'connection:status', machineId: msg.machineId, status: 'error', message: 'Machine not found' })
          return
        }
        const manager = getOrCreateManager(msg.machineId)!
        if (manager.getState() === 'connected' || manager.getState() === 'connecting') {
          send(ws, { type: 'connection:status', machineId: msg.machineId, status: manager.getState() as any })
          return
        }
        const { password, passphrase } = msg
        manager.connect({ password, passphrase }).catch(() => {})
        break
      }

      case 'machine:disconnect': {
        const manager = managers.get(msg.machineId)
        if (manager) {
          manager.disconnect()
          send(ws, { type: 'connection:status', machineId: msg.machineId, status: 'disconnected' })
        }
        break
      }

      // Host key handling is now done inside SshTransport (auto-approve for known hosts)
      // These messages are kept for backward compatibility but are no-ops
      case 'hostkey:approve':
      case 'hostkey:reject':
        break

      case 'preview:probe': {
        const machine = store.getById(msg.machineId)
        if (!machine) {
          send(ws, { type: 'preview:probe:result', url: null, via: 'tunnel' })
          return
        }
        try {
          const controller = new AbortController()
          setTimeout(() => controller.abort(), 3000)
          await fetch(`http://${machine.host}:${msg.remotePort}/`, { signal: controller.signal })
          // Any response means server is reachable
          send(ws, { type: 'preview:probe:result', url: `http://${machine.host}:${msg.remotePort}`, via: 'direct' })
        } catch {
          // Fallback: open SSH tunnel
          const manager = managers.get(msg.machineId)
          const client = manager?.getActiveSshClient()
          if (!client) {
            send(ws, { type: 'preview:probe:result', url: null, via: 'tunnel' })
            return
          }
          try {
            const { tunnelId, localPort } = await tunnels.open(client, msg.machineId, msg.remotePort)
            send(ws, { type: 'preview:probe:result', url: `http://localhost:${localPort}`, via: 'tunnel', tunnelId })
          } catch (err: any) {
            send(ws, { type: 'preview:probe:result', url: null, via: 'tunnel' })
          }
        }
        break
      }
    }
  })
})

server.listen(0, '127.0.0.1', () => {
  const addr = server.address() as any
  process.stdout.write(`PORT:${addr.port}\n`)
})

process.on('SIGTERM', () => {
  tunnels.closeAll()
  server.close(() => process.exit(0))
})
