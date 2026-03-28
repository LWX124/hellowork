// src/service/index.ts
import { WebSocketServer, WebSocket } from 'ws'
import * as http from 'http'
import { ConnectionPool } from './ssh/connection-pool'
import { SessionManager } from './ssh/session'
import { TunnelManager } from './ssh/tunnel'
import { MachinesStore } from './store/machines'
import { ClientMessage, ServerMessage } from './types'
import { homedir } from 'os'
import { join } from 'path'

const store = new MachinesStore(join(homedir(), '.hellowork', 'machines.json'))
const pool = new ConnectionPool()
const sessions = new SessionManager()
const tunnels = new TunnelManager()

const server = http.createServer()
const wss = new WebSocketServer({ server })

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

wss.on('connection', (ws) => {
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
          send(ws, { type: 'session:error', sessionId: '', message: 'Machine not found' })
          return
        }
        if (pool.getStatus(msg.machineId) !== 'connected') {
          pool.connect(machine, (machineId, status, message) => {
            send(ws, { type: 'connection:status', machineId, status, message })
          })
          let waited = 0
          while (pool.getStatus(msg.machineId) !== 'connected' && waited < 15000) {
            await new Promise(r => setTimeout(r, 200))
            waited += 200
          }
        }
        const client = pool.getClient(msg.machineId)
        if (!client) {
          send(ws, { type: 'session:error', sessionId: '', message: 'Connection failed' })
          return
        }
        try {
          const sessionId = await sessions.create(client, (sid, data) => {
            send(ws, { type: 'terminal:output', sessionId: sid, data })
          })
          send(ws, { type: 'session:created', sessionId, requestId: msg.requestId })
        } catch (err: any) {
          send(ws, { type: 'session:error', sessionId: '', message: err.message })
        }
        break
      }

      case 'session:close':
        sessions.close(msg.sessionId)
        break

      case 'terminal:input':
        sessions.write(msg.sessionId, msg.data)
        break

      case 'terminal:resize':
        sessions.resize(msg.sessionId, msg.cols, msg.rows)
        break

      case 'tunnel:open': {
        const client = pool.getClient(msg.machineId)
        if (!client) {
          send(ws, { type: 'tunnel:error', tunnelId: '', message: 'Not connected' })
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
        pool.disconnect(msg.id)
        send(ws, { type: 'machine:deleted', id: msg.id })
        break

      case 'machine:connect': {
        const machine = store.getById(msg.machineId)
        if (!machine) {
          send(ws, { type: 'connection:status', machineId: msg.machineId, status: 'error', message: 'Machine not found' })
          return
        }
        if (pool.getStatus(msg.machineId) === 'connected' || pool.getStatus(msg.machineId) === 'connecting') {
          send(ws, { type: 'connection:status', machineId: msg.machineId, status: pool.getStatus(msg.machineId) as any })
          return
        }
        ;(pool.connect as any)(machine, (machineId: string, status: any, message?: string) => {
          send(ws, { type: 'connection:status', machineId, status, message })
        }, msg.password,
        (machineId: string, host: string, fingerprint: string) => {
          send(ws, { type: 'hostkey:verify', machineId, host, fingerprint })
        })
        break
      }

      case 'machine:disconnect':
        pool.disconnect(msg.machineId)
        break

      case 'hostkey:approve':
        ;(pool as any).approveHostKey(msg.machineId)
        break

      case 'hostkey:reject':
        ;(pool as any).rejectHostKey(msg.machineId)
        break
    }
  })
})

server.listen(0, '127.0.0.1', () => {
  const addr = server.address() as any
  process.stdout.write(`PORT:${addr.port}\n`)
})

process.on('SIGTERM', () => {
  sessions.closeAll()
  tunnels.closeAll()
  pool.disconnectAll()
  server.close(() => process.exit(0))
})
