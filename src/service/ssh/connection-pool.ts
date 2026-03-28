// src/service/ssh/connection-pool.ts
import { Client, ConnectConfig } from 'ssh2'
import { MachineConfig } from '../types'
import { readFileSync, existsSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface PoolEntry {
  client: Client
  status: ConnectionStatus
  onStatus: StatusCallback
  approveResolve?: (approved: boolean) => void
}

export type StatusCallback = (machineId: string, status: ConnectionStatus, message?: string) => void
export type HostKeyCallback = (machineId: string, host: string, fingerprint: string) => void

const KNOWN_HOSTS = join(homedir(), '.hellowork', 'known_hosts')

function getFingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('base64')
}

function isKnownHost(host: string, fingerprint: string): boolean {
  if (!existsSync(KNOWN_HOSTS)) return false
  const lines = readFileSync(KNOWN_HOSTS, 'utf-8').split('\n')
  return lines.some(line => line === `${host} ${fingerprint}`)
}

function saveKnownHost(host: string, fingerprint: string): void {
  const { mkdirSync } = require('fs')
  mkdirSync(join(homedir(), '.hellowork'), { recursive: true })
  appendFileSync(KNOWN_HOSTS, `${host} ${fingerprint}\n`)
}

export class ConnectionPool {
  private pool = new Map<string, PoolEntry>()

  connect(
    machine: MachineConfig,
    onStatus: StatusCallback,
    password?: string,
    onHostKey?: HostKeyCallback
  ): void {
    const existing = this.pool.get(machine.id)
    if (existing && (existing.status === 'connected' || existing.status === 'connecting')) return

    const client = new Client()
    const entry: PoolEntry = { client, status: 'connecting', onStatus }
    this.pool.set(machine.id, entry)
    onStatus(machine.id, 'connecting')

    const config: ConnectConfig = {
      host: machine.host,
      port: machine.port,
      username: machine.username,
      readyTimeout: 15000,
      keepaliveInterval: 30000,
      keepaliveCountMax: 2,
    }

    // 认证
    if (machine.auth.type === 'key' && machine.auth.keyPath) {
      const keyPath = machine.auth.keyPath.replace('~', homedir())
      try {
        config.privateKey = readFileSync(keyPath)
      } catch {
        onStatus(machine.id, 'error', `Cannot read key: ${keyPath}`)
        this.pool.delete(machine.id)
        return
      }
    } else if (machine.auth.type === 'password' && password) {
      config.password = password
    }

    // Host Key 验证
    config.hostVerifier = (keyOrHash: Buffer | string, callback: (valid: boolean) => void) => {
      const keyBuf = Buffer.isBuffer(keyOrHash) ? keyOrHash : Buffer.from(keyOrHash as string, 'hex')
      const fingerprint = getFingerprint(keyBuf)

      if (isKnownHost(machine.host, fingerprint)) {
        callback(true)
        return
      }

      // 未知主机：挂起等待用户确认
      entry.approveResolve = (approved: boolean) => {
        if (approved) saveKnownHost(machine.host, fingerprint)
        callback(approved)
      }

      if (onHostKey) {
        onHostKey(machine.id, machine.host, fingerprint)
      } else {
        // 无回调则自动拒绝（安全默认）
        callback(false)
      }
    }

    client
      .on('ready', () => {
        const e = this.pool.get(machine.id)
        if (e) e.status = 'connected'
        onStatus(machine.id, 'connected')
      })
      .on('error', (err) => {
        const e = this.pool.get(machine.id)
        if (!e) return   // already cleaned up (e.g., by rejectHostKey)
        e.status = 'error'
        onStatus(machine.id, 'error', err.message)
      })
      .on('close', () => {
        if (!this.pool.has(machine.id)) return  // already cleaned up
        this.pool.delete(machine.id)
        onStatus(machine.id, 'disconnected')
      })

    client.connect(config)
  }

  approveHostKey(machineId: string): void {
    const entry = this.pool.get(machineId)
    if (entry?.approveResolve) {
      entry.approveResolve(true)
      entry.approveResolve = undefined
    }
  }

  rejectHostKey(machineId: string): void {
    const entry = this.pool.get(machineId)
    if (entry?.approveResolve) {
      const cb = entry.approveResolve
      entry.approveResolve = undefined
      // Mark as disconnected before ssh2 fires its error event
      entry.status = 'disconnected'
      this.pool.delete(machineId)
      entry.onStatus(machineId, 'disconnected')
      cb(false)   // triggers ssh2 to abort, but pool entry is already removed
    }
  }

  disconnect(machineId: string): void {
    const entry = this.pool.get(machineId)
    if (!entry) return
    entry.client.end()
    // Don't delete here — let the 'close' event handler delete and notify
  }

  getClient(machineId: string): Client | undefined {
    const entry = this.pool.get(machineId)
    return entry?.status === 'connected' ? entry.client : undefined
  }

  getStatus(machineId: string): ConnectionStatus {
    return this.pool.get(machineId)?.status ?? 'disconnected'
  }

  disconnectAll(): void {
    for (const [id] of this.pool) this.disconnect(id)
  }
}
