// src/service/ssh/connection-pool.ts
import { Client, ConnectConfig } from 'ssh2'
import { MachineConfig } from '../types'
import { readFileSync, existsSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { execSync } from 'child_process'

function getSshAuthSock(): string | undefined {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK
  try {
    const sock = execSync('launchctl getenv SSH_AUTH_SOCK', { timeout: 1000 }).toString().trim()
    if (sock) return sock
  } catch {}
  return undefined
}

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
  return 'SHA256:' + createHash('sha256').update(key).digest('base64')
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
    passphrase?: string,
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
      readyTimeout: 30000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 5,
      debug: (msg: string) => process.stderr.write(`[ssh2] ${msg}\n`),
    }

    // 认证
    if (machine.auth.type === 'key' && machine.auth.keyPath) {
      const keyPath = machine.auth.keyPath.replace('~', homedir())
      try {
        config.privateKey = readFileSync(keyPath)
        if (passphrase) config.passphrase = passphrase
      } catch {
        onStatus(machine.id, 'error', `Cannot read key: ${keyPath}`)
        this.pool.delete(machine.id)
        return
      }
      const agentSock = getSshAuthSock()
      process.stderr.write(`[pool] SSH_AUTH_SOCK=${agentSock ?? 'none'}\n`)
      if (agentSock) config.agent = agentSock
    }
    // password overrides / supplements key auth (used when key auth fails)
    if (password) {
      config.password = password
    } else if (machine.auth.type === 'password' && machine.auth.keychainKey) {
      // password-only machine but no password provided — will fail
    }
    if (!config.privateKey && !config.password) {
      // No key path configured, try ssh-agent only
      const agentSock = getSshAuthSock()
      process.stderr.write(`[pool] SSH_AUTH_SOCK=${agentSock ?? 'none'}\n`)
      if (agentSock) config.agent = agentSock
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
        process.stderr.write(`[pool] ${machine.id} ready\n`)
        onStatus(machine.id, 'connected')
      })
      .on('error', (err) => {
        const e = this.pool.get(machine.id)
        process.stderr.write(`[pool] ${machine.id} error: ${err.message} (entry exists: ${!!e})\n`)
        if (!e) return   // already cleaned up (e.g., by rejectHostKey)
        e.status = 'error'
        onStatus(machine.id, 'error', err.message)
      })
      .on('close', () => {
        const e = this.pool.get(machine.id)
        process.stderr.write(`[pool] ${machine.id} close (entry status: ${e?.status ?? 'none'})\n`)
        if (!e) return  // already cleaned up
        this.pool.delete(machine.id)
        if (e.status !== 'error') {
          onStatus(machine.id, 'disconnected')
        }
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
