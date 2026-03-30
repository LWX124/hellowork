import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { ITransport, IShell } from './ITransport'
import { SshTransport } from './SshTransport'
import { MoshTransport } from './MoshTransport'
import { MachineConfig } from '../types'

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000]
const MAX_FAILURES_PER_TRANSPORT = 2

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
    this.transports = [new SshTransport(), new MoshTransport()]
  }

  private setState(state: ConnectionState, transport?: 'ssh' | 'mosh' | 'ttyd'): void {
    this.state = state
    // transport field only set when status === 'connected' (spec §7)
    this.emit('status', { status: state, ...(state === 'connected' ? { transport } : {}) })
  }

  async connect(): Promise<void> {
    this.stopped = false
    this.setState('connecting')
    await this.tryTransports()
  }

  private async tryTransports(): Promise<void> {
    for (const transport of this.transports) {
      const available = await transport.isAvailable(this.machine)
      if (!available) {
        if (transport.name === 'mosh') this.emit('mosh:unavailable')
        continue
      }
      for (let attempt = 0; attempt < MAX_FAILURES_PER_TRANSPORT; attempt++) {
        try {
          await transport.connect(this.machine, this.lastDimensions)
          this.activeTransport = transport
          ;(transport as EventEmitter).once('transport:disconnected', () => this.onDisconnected())
          this.setState('connected', transport.name)
          return
        } catch {
          if (attempt < MAX_FAILURES_PER_TRANSPORT - 1) {
            await this.backoff(this.reconnectAttempts++)
          }
        }
      }
    }
    this.setState('failed')
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
            this.setState('connected', transport.name)
            this.emit('session:replaced', { oldSessionId, newSessionId, machineId: this.machine.id })
            this.emit('terminal:message', '\r\n\x1b[32m--- 已恢复 ---\x1b[0m\r\n')
            if (transport.name !== 'ssh') this.startBackgroundSshUpgrade()
            return
          } catch {
            await this.backoff(this.reconnectAttempts++)
          }
        }
      }
      await this.backoff(this.reconnectAttempts++)
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
        this.setState('connected', 'ssh')
        this.emit('session:replaced', { oldSessionId, newSessionId, machineId: this.machine.id })
        this.emit('terminal:message', '\r\n\x1b[33m--- 已切换至 SSH ---\x1b[0m\r\n')
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
