// src/service/ssh/connection-pool.ts
import { Client, ConnectConfig } from 'ssh2'
import { MachineConfig } from '../types'
import { readFileSync } from 'fs'
import { homedir } from 'os'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface PoolEntry {
  client: Client
  status: ConnectionStatus
}

export type StatusCallback = (machineId: string, status: ConnectionStatus, message?: string) => void

export class ConnectionPool {
  private pool = new Map<string, PoolEntry>()

  connect(machine: MachineConfig, onStatus: StatusCallback): void {
    const existing = this.pool.get(machine.id)
    if (existing && (existing.status === 'connected' || existing.status === 'connecting')) return

    const client = new Client()
    this.pool.set(machine.id, { client, status: 'connecting' })
    onStatus(machine.id, 'connecting')

    client
      .on('ready', () => {
        const entry = this.pool.get(machine.id)
        if (entry) entry.status = 'connected'
        onStatus(machine.id, 'connected')
      })
      .on('error', (err) => {
        const entry = this.pool.get(machine.id)
        if (entry) entry.status = 'error'
        onStatus(machine.id, 'error', err.message)
      })
      .on('close', () => {
        this.pool.delete(machine.id)
        onStatus(machine.id, 'disconnected')
      })

    const config: ConnectConfig = {
      host: machine.host,
      port: machine.port,
      username: machine.username,
      readyTimeout: 15000,
      keepaliveInterval: 30000,
      keepaliveCountMax: 2,
    }

    if (machine.auth.type === 'key' && machine.auth.keyPath) {
      const keyPath = machine.auth.keyPath.replace('~', homedir())
      try {
        config.privateKey = readFileSync(keyPath)
      } catch {
        onStatus(machine.id, 'error', `Cannot read key file: ${keyPath}`)
        this.pool.delete(machine.id)
        return
      }
    }

    client.connect(config)
  }

  disconnect(machineId: string): void {
    const entry = this.pool.get(machineId)
    if (!entry) return
    entry.client.end()
    this.pool.delete(machineId)
  }

  getClient(machineId: string): Client | undefined {
    const entry = this.pool.get(machineId)
    return entry?.status === 'connected' ? entry.client : undefined
  }

  getStatus(machineId: string): ConnectionStatus {
    return this.pool.get(machineId)?.status ?? 'disconnected'
  }

  disconnectAll(): void {
    for (const [id] of this.pool) {
      this.disconnect(id)
    }
  }
}
