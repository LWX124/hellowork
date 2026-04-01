import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { ITransport, IShell } from './ITransport'
import { SshTransport } from './SshTransport'
import { MoshTransport } from './MoshTransport'
import { TtydTransport } from './TtydTransport'
import { MachineConfig } from '../types'

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000]
const MAX_FAILURES_PER_TRANSPORT = 2

function isAuthError(err: Error): boolean {
  const msg = err.message || ''
  return msg.includes('authentication') || msg.includes('All configured')
}

export class ConnectionManager extends EventEmitter {
  private state: ConnectionState = 'idle'
  protected transports: ITransport[]
  private activeTransport: ITransport | null = null
  private activeShell: IShell | null = null
  private currentSessionId: string | null = null
  private lastDimensions = { cols: 80, rows: 24 }
  private reconnectAttempts = 0
  private stopped = false
  private backgroundUpgradeTimer: ReturnType<typeof setInterval> | null = null

  constructor(protected machine: MachineConfig) {
    super()
    this.transports = [new SshTransport(), new MoshTransport(), new TtydTransport()]
  }

  private setState(state: ConnectionState, extra?: { transport?: 'ssh' | 'mosh' | 'ttyd'; message?: string }): void {
    this.state = state
    this.emit('status', { status: state, ...extra })
  }

  async connect(connectOpts?: { password?: string; passphrase?: string }): Promise<void> {
    this.stopped = false
    this.setState('connecting')
    await this.tryTransports(connectOpts)
  }

  private async tryTransports(connectOpts?: { password?: string; passphrase?: string }): Promise<void> {
    let lastError: Error | null = null
    for (const transport of this.transports) {
      const available = await transport.isAvailable(this.machine)
      if (!available) {
        if (transport.name === 'mosh') this.emit('mosh:unavailable')
        continue
      }
      for (let attempt = 0; attempt < MAX_FAILURES_PER_TRANSPORT; attempt++) {
        try {
          await transport.connect(this.machine, { ...this.lastDimensions, ...connectOpts })
          this.activeTransport = transport
          ;(transport as EventEmitter).once('transport:disconnected', () => this.onDisconnected())
          this.setState('connected', { transport: transport.name })
          return
        } catch (err: any) {
          lastError = err
          if (attempt < MAX_FAILURES_PER_TRANSPORT - 1) {
            await this.backoff(this.reconnectAttempts++)
          }
        }
      }
      // If SSH auth failed, stop immediately — don't try mosh/ttyd for auth issues
      if (transport.name === 'ssh' && lastError && isAuthError(lastError)) {
        break
      }
    }
    this.setState('failed', { message: lastError?.message })
  }

  async createShell(onData: (data: string) => void, sessionId: string): Promise<IShell> {
    if (!this.activeTransport) throw new Error('Not connected')
    this.currentSessionId = sessionId
    this.activeShell = await this.activeTransport.createShell(onData)
    return this.activeShell
  }

  setDimensions(cols: number, rows: number): void {
    this.lastDimensions = { cols, rows }
    this.activeShell?.resize(cols, rows)
  }

  private async onDisconnected(): Promise<void> {
    if (this.stopped) return
    const lastTransportName = this.activeTransport?.name ?? null
    this.activeShell = null
    this.activeTransport?.disconnect()
    this.activeTransport = null
    this.setState('reconnecting')
    this.emit('terminal:message', '\r\n\x1b[33m--- 重新连接中... ---\x1b[0m\r\n')
    await this.reconnectLoop(lastTransportName)
  }

  private async reconnectLoop(lastTransportName: string | null = null): Promise<void> {
    this.reconnectAttempts = 0
    // Try same transport first (network blip), then others
    const ordered = [
      ...this.transports.filter(t => t.name === lastTransportName),
      ...this.transports.filter(t => t.name !== lastTransportName),
    ]
    while (!this.stopped) {
      for (const transport of ordered) {
        const available = await transport.isAvailable(this.machine)
        if (!available) continue
        for (let attempt = 0; attempt < MAX_FAILURES_PER_TRANSPORT; attempt++) {
          try {
            await transport.connect(this.machine, this.lastDimensions)
            this.activeTransport = transport
            ;(transport as EventEmitter).once('transport:disconnected', () => this.onDisconnected())
            const oldSessionId = this.currentSessionId
            const newSessionId = randomUUID()
            this.currentSessionId = newSessionId
            this.setState('connected', { transport: transport.name })
            this.emit('session:replaced', { oldSessionId, newSessionId, machineId: this.machine.id })
            this.emit('terminal:message', '\r\n\x1b[32m--- 已恢复 ---\x1b[0m\r\n')
            if (transport.name === 'ssh') {
              const sshClient = (this.activeTransport as SshTransport).getClient()
              if (sshClient) this.emit('tunnel:reconnected', { machineId: this.machine.id, client: sshClient })
            }
            if (transport.name !== 'ssh') this.startBackgroundSshUpgrade()
            return
          } catch { /* try next attempt */ }
        }
      }
      await this.backoff(this.reconnectAttempts)
      this.reconnectAttempts++
      if (this.reconnectAttempts > 10) {
        this.setState('failed')
        return
      }
    }
  }

  private startBackgroundSshUpgrade(): void {
    if (this.backgroundUpgradeTimer) return
    const sshTransport = this.transports.find(t => t.name === 'ssh') as SshTransport | undefined
    if (!sshTransport) return
    this.backgroundUpgradeTimer = setInterval(async () => {
      if (this.stopped || this.activeTransport?.name === 'ssh') {
        clearInterval(this.backgroundUpgradeTimer!)
        this.backgroundUpgradeTimer = null
        return
      }
      try {
        await sshTransport.connect(this.machine, this.lastDimensions)
        const oldSessionId = this.currentSessionId
        const newSessionId = randomUUID()
        this.currentSessionId = newSessionId
        this.activeTransport?.disconnect()
        this.activeTransport = sshTransport
        ;(sshTransport as EventEmitter).once('transport:disconnected', () => this.onDisconnected())
        this.setState('connected', { transport: 'ssh' })
        this.emit('session:replaced', { oldSessionId, newSessionId, machineId: this.machine.id })
        this.emit('terminal:message', '\r\n\x1b[33m--- 已切换至 SSH ---\x1b[0m\r\n')
        const sshClient = sshTransport.getClient()
        if (sshClient) this.emit('tunnel:reconnected', { machineId: this.machine.id, client: sshClient })
        clearInterval(this.backgroundUpgradeTimer!)
        this.backgroundUpgradeTimer = null
      } catch { /* silent */ }
    }, 60000)
  }

  private backoff(attempt: number): Promise<void> {
    const ms = BACKOFF_STEPS[Math.min(attempt, BACKOFF_STEPS.length - 1)]
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  disconnect(): void {
    this.stopped = true
    if (this.backgroundUpgradeTimer) {
      clearInterval(this.backgroundUpgradeTimer)
      this.backgroundUpgradeTimer = null
    }
    this.activeShell?.close()
    this.activeTransport?.disconnect()
    this.activeShell = null
    this.activeTransport = null
    this.state = 'idle'
  }

  getState(): ConnectionState { return this.state }
  getActiveTransportName(): string | null { return this.activeTransport?.name ?? null }
  getActiveSshClient(): import('ssh2').Client | null {
    if (this.activeTransport?.name === 'ssh') {
      return (this.activeTransport as SshTransport).getClient()
    }
    return null
  }
  getCurrentSessionId(): string | null { return this.currentSessionId }
}
