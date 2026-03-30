# Multi-Transport Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single SSH connection with a multi-transport layer (SSH → Mosh → ttyd) that auto-selects the best protocol, reconnects transparently, and decouples Preview from SSH tunnels.

**Architecture:** A `ConnectionManager` per machine wraps a pluggable `ITransport` interface. A state machine drives lifecycle (`idle → connecting → connected → reconnecting → failed`). The renderer is transport-unaware except for a badge showing the active transport.

**Tech Stack:** ssh2 (existing), mosh CLI (spawn), ttyd WebSocket, Zustand (existing), xterm.js (existing)

**Spec:** `docs/superpowers/specs/2026-03-30-multi-transport-connection-design.md`

---

## File Map

**New files:**
- `src/service/connection/ITransport.ts` — interface definitions
- `src/service/connection/SshTransport.ts` — wraps existing ConnectionPool + SessionManager
- `src/service/connection/MoshTransport.ts` — spawns mosh CLI
- `src/service/connection/TtydTransport.ts` — WebSocket ttyd client
- `src/service/connection/ConnectionManager.ts` — state machine + transport orchestration

**Modified files:**
- `src/service/types.ts` — add `reconnecting`, `failed`, `transport` field, new message types
- `src/renderer/src/store/machines.ts` — add `reconnecting`, `failed` to ConnectionStatus
- `src/service/ssh/connection-pool.ts` — tune SSH keepalive params
- `src/service/index.ts` — replace pool/sessions with ConnectionManager map
- `src/renderer/src/components/terminal/useTerminalWs.ts` — handle session:replaced
- `src/renderer/src/components/terminal/TerminalPane.tsx` — reconnecting/reconnected messages
- `src/renderer/src/components/sidebar/MachineItem.tsx` — transport badge, reconnecting state
- `src/renderer/src/components/preview/PreviewPane.tsx` — direct HTTP probe first

---

## Task 1: Types + SSH Parameter Tuning

**Files:**
- Modify: `src/service/types.ts`
- Modify: `src/renderer/src/store/machines.ts`
- Modify: `src/service/ssh/connection-pool.ts`

- [ ] **Step 1: Update `src/service/types.ts`**

  In the `connection:status` message type, change the status union from `'connected' | 'disconnected' | 'connecting' | 'error'` to include `'reconnecting' | 'failed'`. Add optional `transport` field. Add new message types:

  ```typescript
  // In the ServiceMessage union, update connection:status:
  | { type: 'connection:status'; machineId: string; status: 'connected' | 'disconnected' | 'connecting' | 'error' | 'reconnecting' | 'failed'; message?: string; transport?: 'ssh' | 'mosh' | 'ttyd' }

  // Add new message types to the union:
  | { type: 'session:replaced'; oldSessionId: string; newSessionId: string; machineId: string }
  | { type: 'preview:probe'; machineId: string; remotePort: number }
  | { type: 'preview:probe:result'; url: string; via: 'direct' | 'tunnel' }
  ```

- [ ] **Step 2: Update `src/renderer/src/store/machines.ts`**

  Change `ConnectionStatus` type (line ~11) to add `'reconnecting' | 'failed'`:
  ```typescript
  export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting' | 'failed'
  ```

  In the `connection:status` handler switch, add two new cases:
  ```typescript
  case 'reconnecting':
    return { ...s, machines: { ...s.machines, [machineId]: { ...machine, status: 'reconnecting' } } }
  case 'failed':
    toast.error(`连接失败: ${machineId}`)
    return { ...s, machines: { ...s.machines, [machineId]: { ...machine, status: 'failed' } } }
  ```

  Add `transport` field to machine state and handle it in `case 'connected'`:
  ```typescript
  // In MachineState interface, add:
  transport?: 'ssh' | 'mosh' | 'ttyd'

  // In case 'connected', also set transport:
  case 'connected':
    // existing logic...
    return { ...s, machines: { ...s.machines, [machineId]: { ...machine, status: 'connected', transport: msg.transport } } }
  ```

- [ ] **Step 3: Tune SSH keepalive in `src/service/ssh/connection-pool.ts`**

  Change the three SSH connection parameters:
  ```typescript
  readyTimeout: 30000,      // was 15000
  keepaliveInterval: 10000, // was 30000
  keepaliveCountMax: 5,     // was 2
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add src/service/types.ts src/renderer/src/store/machines.ts src/service/ssh/connection-pool.ts
  git commit -m "feat: add reconnecting/failed status types and tune SSH keepalive params"
  ```

---

## Task 2: ITransport Interface + SshTransport

**Files:**
- Create: `src/service/connection/ITransport.ts`
- Create: `src/service/connection/SshTransport.ts`

- [ ] **Step 1: Create `src/service/connection/ITransport.ts`**

  ```typescript
  import { MachineConfig } from '../types'

  export interface TransportOpts {
    cols?: number
    rows?: number
  }

  export interface IShell {
    write(data: string): void
    resize(cols: number, rows: number): void
    close(): void
  }

  export interface ITransport extends EventEmitter {
    readonly name: 'ssh' | 'mosh' | 'ttyd'
    connect(machine: MachineConfig, opts: TransportOpts): Promise<void>
    createShell(onData: (data: string) => void): Promise<IShell>
    disconnect(): void
    isAvailable(machine: MachineConfig): Promise<boolean>
    // Emits 'transport:disconnected' when the underlying connection drops
  }
  ```

- [ ] **Step 2: Create `src/service/connection/SshTransport.ts`**

  Wrap existing `ConnectionPool` and `SessionManager`. The transport emits `'transport:disconnected'` when the SSH connection closes:

  ```typescript
  import { EventEmitter } from 'events'
  import { ITransport, IShell, TransportOpts } from './ITransport'
  import { MachineConfig } from '../types'
  import { ConnectionPool } from '../ssh/connection-pool'
  import { SessionManager } from '../ssh/session'

  export class SshTransport extends EventEmitter implements ITransport {
    readonly name = 'ssh' as const
    private pool: ConnectionPool | null = null
    private sessionManager: SessionManager | null = null

    async isAvailable(_machine: MachineConfig): Promise<boolean> {
      return true // SSH is always attempted first
    }

    async connect(machine: MachineConfig, _opts: TransportOpts): Promise<void> {
      this.pool = new ConnectionPool(machine)
      await this.pool.connect()
      this.pool.on('close', () => this.emit('transport:disconnected'))
      this.pool.on('error', () => this.emit('transport:disconnected'))
    }

    async createShell(onData: (data: string) => void): Promise<IShell> {
      if (!this.pool) throw new Error('SshTransport not connected')
      this.sessionManager = new SessionManager(this.pool)
      const session = await this.sessionManager.createSession({ onData })
      return {
        write: (data) => session.write(data),
        resize: (cols, rows) => session.resize(cols, rows),
        close: () => session.close(),
      }
    }

    disconnect(): void {
      this.sessionManager?.closeAll()
      this.pool?.disconnect()
      this.pool = null
      this.sessionManager = null
    }

    getPool(): ConnectionPool | null {
      return this.pool
    }
  }
  ```

  Note: Adapt the `ConnectionPool` and `SessionManager` API calls to match the actual existing API in `src/service/ssh/connection-pool.ts` and `src/service/ssh/session.ts`. The key change from current behavior: on `close` event, emit `'transport:disconnected'` instead of directly setting error status.

- [ ] **Step 3: Commit**

  ```bash
  git add src/service/connection/
  git commit -m "feat: add ITransport interface and SshTransport wrapper"
  ```

---

## Task 3: ConnectionManager (SSH only)

**Files:**
- Create: `src/service/connection/ConnectionManager.ts`
- Modify: `src/service/index.ts`

- [ ] **Step 1: Create `src/service/connection/ConnectionManager.ts`**

  State machine with SSH-only transport for now. Mosh and ttyd will be added in Tasks 4 and 5:

  ```typescript
  import { EventEmitter } from 'events'
  import { ITransport, IShell, TransportOpts } from './ITransport'
  import { SshTransport } from './SshTransport'
  import { MachineConfig } from '../types'

  type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

  const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000]
  const MAX_FAILURES_PER_TRANSPORT = 2

  export class ConnectionManager extends EventEmitter {
    private state: ConnectionState = 'idle'
    private transports: ITransport[]
    private activeTransport: ITransport | null = null
    private activeShell: IShell | null = null
    private currentSessionId: string | null = null
    private lastDimensions = { cols: 80, rows: 24 }
    private reconnectAttempts = 0
    private stopped = false

    constructor(private machine: MachineConfig) {
      super()
      this.transports = [new SshTransport()]
    }

    addTransport(transport: ITransport): void {
      this.transports.push(transport)
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
        if (!available) continue

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
      const lastTransportName = this.activeTransport?.name ?? null  // capture before nulling
      this.activeShell = null
      this.activeTransport?.disconnect()
      this.activeTransport = null
      this.setState('reconnecting')
      this.emit('terminal:message', '\r\n\x1b[33m--- 重新连接中... ---\x1b[0m\r\n')
      await this.reconnectLoop(lastTransportName)
    }

    private async reconnectLoop(lastTransportName: string | null = null): Promise<void> {
      this.reconnectAttempts = 0
      // Try same transport first (network blip), then others (spec §4)
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
              const newSessionId = crypto.randomUUID()
              this.currentSessionId = newSessionId
              this.setState('connected', transport.name)
              this.emit('session:replaced', { oldSessionId, newSessionId, machineId: this.machine.id })
              this.emit('terminal:message', '\r\n\x1b[32m--- 已恢复 ---\x1b[0m\r\n')
              // If reconnected via non-SSH transport, start background SSH upgrade (spec §3)
              if (transport.name !== 'ssh') this.startBackgroundSshUpgrade()
              return
            } catch {
              await this.backoff(this.reconnectAttempts++)
            }
          }
        }
        // All transports exhausted in this round, wait before retrying
        await this.backoff(this.reconnectAttempts++)
        if (this.reconnectAttempts > 10) {
          this.setState('failed')
          return
        }
      }
    }

    private backgroundUpgradeTimer: ReturnType<typeof setInterval> | null = null

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
          const newSessionId = crypto.randomUUID()
          this.currentSessionId = newSessionId
          // Close old transport after new SSH session is confirmed
          this.activeTransport?.disconnect()
          this.activeTransport = sshTransport
          ;(sshTransport as EventEmitter).once('transport:disconnected', () => this.onDisconnected())
          this.setState('connected', 'ssh')
          this.emit('session:replaced', { oldSessionId, newSessionId, machineId: this.machine.id })
          this.emit('terminal:message', '\r\n\x1b[33m--- 已切换至 SSH ---\x1b[0m\r\n')
          clearInterval(this.backgroundUpgradeTimer!)
          this.backgroundUpgradeTimer = null
        } catch { /* silent, retry next interval */ }
      }, 60000)
    }

    private backoff(attempt: number): Promise<void> {
      const ms = BACKOFF_STEPS[Math.min(attempt, BACKOFF_STEPS.length - 1)]
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    disconnect(): void {
      this.stopped = true
      this.activeShell?.close()
      this.activeTransport?.disconnect()
      this.activeShell = null
      this.activeTransport = null
      this.state = 'idle'
    }

    getState(): ConnectionState { return this.state }
    getActiveTransportName(): string | null { return this.activeTransport?.name ?? null }
  }
  ```

- [ ] **Step 2: Wire ConnectionManager into `src/service/index.ts`**

  Replace the existing `ConnectionPool` / `SessionManager` instantiation with a `Map<string, ConnectionManager>`. For each machine, create a `ConnectionManager` and forward its `status` events to the renderer via IPC.

  Key changes:
  - `connect` handler: `managers.get(machineId) ?? new ConnectionManager(machine)`, call `.connect()`
  - `disconnect` handler: `managers.get(machineId)?.disconnect()`
  - `session:create` handler: call `manager.createShell(onData, sessionId)` instead of `sessionManager.createSession()`
  - `session:resize` handler: call `manager.setDimensions(cols, rows)`
  - Forward `manager.on('status', ...)` → `win.webContents.send('service:message', { type: 'connection:status', machineId, ...status })`
  - Forward `manager.on('session:replaced', ...)` → `win.webContents.send('service:message', { type: 'session:replaced', ... })`
  - Forward `manager.on('terminal:message', ...)` → `win.webContents.send('service:message', { type: 'session:data', sessionId, data })`

  Read `src/service/index.ts` carefully before making changes to preserve all existing handlers not related to connection/session.

- [ ] **Step 3: Commit**

  ```bash
  git add src/service/connection/ConnectionManager.ts src/service/index.ts
  git commit -m "feat: add ConnectionManager state machine and wire into service index"
  ```

---

## Task 4: MoshTransport

**Files:**
- Create: `src/service/connection/MoshTransport.ts`
- Modify: `src/service/connection/ConnectionManager.ts` (add MoshTransport to transport list)

- [ ] **Step 1: Create `src/service/connection/MoshTransport.ts`**

  ```typescript
  import { spawn, ChildProcess } from 'child_process'
  import { execFile } from 'child_process'
  import { promisify } from 'util'
  import { EventEmitter } from 'events'
  import { ITransport, IShell, TransportOpts } from './ITransport'
  import { MachineConfig } from '../types'

  const execFileAsync = promisify(execFile)

  const MOSH_PATHS = [
    '/opt/homebrew/bin/mosh',  // Apple Silicon
    '/usr/local/bin/mosh',     // Intel Mac
  ]

  async function findMoshBinary(): Promise<string | null> {
    const { existsSync } = await import('fs')
    for (const p of MOSH_PATHS) {
      if (existsSync(p)) return p
    }
    // Fallback: try via launchctl getenv PATH (same pattern as getSshAuthSock)
    try {
      const { stdout } = await execFileAsync('launchctl', ['getenv', 'PATH'])
      const paths = stdout.trim().split(':')
      for (const dir of paths) {
        const candidate = `${dir}/mosh`
        if (existsSync(candidate)) return candidate
      }
    } catch { /* ignore */ }
    return null
  }

  export class MoshTransport extends EventEmitter implements ITransport {
    readonly name = 'mosh' as const
    private process: ChildProcess | null = null
    private binaryPath: string | null = null

    async isAvailable(_machine: MachineConfig): Promise<boolean> {
      this.binaryPath = await findMoshBinary()
      return this.binaryPath !== null
    }

    async connect(machine: MachineConfig, _opts: TransportOpts): Promise<void> {
      if (!this.binaryPath) throw new Error('mosh binary not found')
      const port = machine.port ?? 22
      const args = [`--ssh=ssh -p ${port}`, `${machine.username}@${machine.host}`]
      this.process = spawn(this.binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('mosh connect timeout')), 30000)
        this.process!.stdout!.once('data', () => { clearTimeout(timeout); resolve() })
        this.process!.once('error', (err) => { clearTimeout(timeout); reject(err) })
        this.process!.once('exit', (code) => {
          if (code !== 0) { clearTimeout(timeout); reject(new Error(`mosh exited with code ${code}`)) }
        })
      })
      this.process.once('exit', () => this.emit('transport:disconnected'))
    }

    async createShell(onData: (data: string) => void): Promise<IShell> {
      if (!this.process) throw new Error('MoshTransport not connected')
      this.process.stdout!.on('data', (chunk: Buffer) => onData(chunk.toString()))
      return {
        write: (data) => this.process?.stdin?.write(data),
        resize: (_cols, _rows) => { /* mosh handles resize via SIGWINCH internally */ },
        close: () => this.process?.kill(),
      }
    }

    disconnect(): void {
      this.process?.kill()
      this.process = null
    }
  }
  ```

- [ ] **Step 2: Register MoshTransport in ConnectionManager**

  In `ConnectionManager.ts`, import `MoshTransport` and add it to the transport list after `SshTransport`:

  ```typescript
  import { MoshTransport } from './MoshTransport'

  // In constructor, after creating SshTransport:
  this.transports = [new SshTransport(), new MoshTransport()]
  ```

  Also add the one-time mosh install hint: in `connect()`, if `MoshTransport.isAvailable()` returns false, emit `'mosh:unavailable'` once. The service index will forward this as a notification.

- [ ] **Step 3: Commit**

  ```bash
  git add src/service/connection/MoshTransport.ts src/service/connection/ConnectionManager.ts
  git commit -m "feat: add MoshTransport with Homebrew path detection"
  ```

---

## Task 5: TtydTransport + Tunnel Reconnect

**Files:**
- Create: `src/service/connection/TtydTransport.ts`
- Modify: `src/service/connection/ConnectionManager.ts` (add TtydTransport, tunnel reconnect)
- Modify: `src/service/index.ts` (handle preview:probe)

- [ ] **Step 1: Create `src/service/connection/TtydTransport.ts`**

  ```typescript
  import { EventEmitter } from 'events'
  import WebSocket from 'ws'
  import { ITransport, IShell, TransportOpts } from './ITransport'
  import { MachineConfig } from '../types'

  const TTYD_PORT = 7681

  export class TtydTransport extends EventEmitter implements ITransport {
    readonly name = 'ttyd' as const
    private ws: WebSocket | null = null

    async isAvailable(machine: MachineConfig): Promise<boolean> {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 3000)
        await fetch(`http://${machine.host}:${TTYD_PORT}/`, { signal: controller.signal })
        clearTimeout(timeout)
        return true // any response (including 4xx/5xx) means server is reachable (spec §5)
      } catch {
        return false
      }
    }

    async connect(machine: MachineConfig, _opts: TransportOpts): Promise<void> {
      // Attempt to start ttyd via short-lived SSH if not already running
      await this.tryStartTtyd(machine)

      const url = `ws://${machine.host}:${TTYD_PORT}/ws`
      this.ws = new WebSocket(url)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('ttyd connect timeout')), 10000)
        this.ws!.once('open', () => { clearTimeout(timeout); resolve() })
        this.ws!.once('error', (err) => { clearTimeout(timeout); reject(err) })
      })
      this.ws.once('close', () => this.emit('transport:disconnected'))
    }

    private async tryStartTtyd(machine: MachineConfig): Promise<void> {
      // Use a short-lived SSH connection to start ttyd if not running
      // This is best-effort; if SSH is unavailable, ttyd must already be running
      try {
        const { Client } = await import('ssh2')
        const client = new Client()
        await new Promise<void>((resolve) => {
          client.on('ready', () => {
            client.exec("pgrep ttyd || nohup ttyd -p 7681 -W bash &>/dev/null &", (err, stream) => {
              if (!err) stream.on('close', () => client.end())
              else client.end()
              resolve()
            })
          })
          client.on('error', () => resolve()) // ignore SSH errors here
          client.connect({
            host: machine.host,
            port: machine.port ?? 22,
            username: machine.username,
            privateKey: machine.privateKey,
            readyTimeout: 5000,
          })
        })
      } catch { /* ignore */ }
    }

    async createShell(onData: (data: string) => void): Promise<IShell> {
      if (!this.ws) throw new Error('TtydTransport not connected')
      // ttyd WebSocket protocol: output messages have type '1' (data), input type '0'
      this.ws.on('message', (raw: Buffer) => {
        const msg = raw.toString()
        if (msg[0] === '1') onData(msg.slice(1))
      })
      return {
        write: (data) => this.ws?.send('0' + data),
        resize: (cols, rows) => this.ws?.send('1' + JSON.stringify({ columns: cols, rows })),
        close: () => this.ws?.close(),
      }
    }

    disconnect(): void {
      this.ws?.close()
      this.ws = null
    }
  }
  ```

- [ ] **Step 2: Register TtydTransport in ConnectionManager**

  ```typescript
  import { TtydTransport } from './TtydTransport'

  // In constructor:
  this.transports = [new SshTransport(), new MoshTransport(), new TtydTransport()]
  ```

- [ ] **Step 3: Wire tunnel reconnect and tunnel:error in `src/service/index.ts`**

  In `ConnectionManager.ts`, after emitting `session:replaced`, also emit `'tunnel:reconnected'` (internal EventEmitter event, not IPC — do not add to `types.ts`). In `src/service/index.ts`:
  - Listen for `manager.on('tunnel:reconnected')` and call `TunnelManager.reestablishTunnels(newSshClient)` for any open tunnels on that machine.
  - If re-establishment fails, emit `tunnel:error` to the renderer: `win.webContents.send('service:message', { type: 'tunnel:error', machineId })` so `PreviewPane` can show an error and prompt the user to re-open the tunnel.

- [ ] **Step 4: Add preview:probe handler in `src/service/index.ts`**

  ```typescript
  ipcMain.handle('preview:probe', async (_e, msg) => {
    const { machineId, remotePort } = msg
    const machine = getMachine(machineId)
    try {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 3000)
      await fetch(`http://${machine.host}:${remotePort}/`, { signal: controller.signal })
      // Any response (including 4xx/5xx) means server is reachable (spec §5)
      return { type: 'preview:probe:result', url: `http://${machine.host}:${remotePort}`, via: 'direct' }
    } catch { /* network error or timeout — fall through to tunnel */ }
    // Fallback: open SSH tunnel as before
    const localPort = await openTunnel(machineId, remotePort)
    return { type: 'preview:probe:result', url: `http://localhost:${localPort}`, via: 'tunnel' }
  })
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/service/connection/TtydTransport.ts src/service/connection/ConnectionManager.ts src/service/index.ts
  git commit -m "feat: add TtydTransport, tunnel reconnect, and preview:probe handler"
  ```

---

## Task 6: useTerminalWs + TerminalPane Session Recovery

**Files:**
- Modify: `src/renderer/src/components/terminal/useTerminalWs.ts`
- Modify: `src/renderer/src/components/terminal/TerminalPane.tsx`

- [ ] **Step 1: Update `useTerminalWs.ts` to handle reconnecting and session:replaced**

  Key changes:
  - On `connection:status` with `status === 'reconnecting'`: do NOT set `disconnected = true`. Write yellow message to terminal instead.
  - On `connection:status` with `status === 'failed'` or `status === 'disconnected'` or `status === 'error'`: set `disconnected = true` as before.
  - Add handler for `session:replaced` message: when `machineId` matches, update `sessionIdRef.current` to `newSessionId`, call `setSessionId(newSessionId)`, call `setTabSessionId(tabId, newSessionId)`.

  ```typescript
  // In the message handler switch/if chain, add:
  if (msg.type === 'connection:status' && msg.machineId === machineId) {
    if (msg.status === 'reconnecting') {
      // do NOT set disconnected = true
      // yellow message is written by ConnectionManager via terminal:message → session:data
    } else if (msg.status === 'disconnected' || msg.status === 'error' || msg.status === 'failed') {
      setDisconnected(true)
    }
    // 'connected' and 'connecting' handled as before
  }

  if (msg.type === 'session:replaced' && msg.machineId === machineId) {
    sessionIdRef.current = msg.newSessionId
    setSessionId(msg.newSessionId)
    setTabSessionId(tabId, msg.newSessionId)
    // green "已恢复" message is written by ConnectionManager via terminal:message → session:data
  }
  ```

- [ ] **Step 2: Update `TerminalPane.tsx` to write reconnect messages**

  The yellow/green messages are already written by `useTerminalWs` above. Verify `TerminalPane.tsx` does not need additional changes — it should continue to show the `disconnected` overlay only when `disconnected === true`.

  If `TerminalPane.tsx` currently writes its own disconnect messages, remove the duplicate and rely on `useTerminalWs` for all status messages.

- [ ] **Step 3: Commit**

  ```bash
  git add src/renderer/src/components/terminal/useTerminalWs.ts src/renderer/src/components/terminal/TerminalPane.tsx
  git commit -m "feat: handle reconnecting status and session:replaced in terminal"
  ```

---

## Task 7: UI Updates + Preview Direct HTTP

**Files:**
- Modify: `src/renderer/src/components/sidebar/MachineItem.tsx`
- Modify: `src/renderer/src/components/preview/PreviewPane.tsx`
- Modify: `src/renderer/src/store/machines.ts` (transport state already added in Task 1)

- [ ] **Step 1: Update `MachineItem.tsx` status colors and labels**

  Add `reconnecting` and `failed` to `statusColors` and `statusLabels`:

  ```typescript
  const statusColors = {
    connected: 'text-green-500',
    connecting: 'text-yellow-500',
    disconnected: 'text-gray-400',
    error: 'text-red-500',
    reconnecting: 'text-yellow-400',
    failed: 'text-red-600',
  }

  const statusLabels = {
    connected: '已连接',
    connecting: '连接中...',
    disconnected: '未连接',
    error: '连接错误',
    reconnecting: '重新连接中...',
    failed: '连接失败',
  }
  ```

- [ ] **Step 2: Add spinner for reconnecting state and transport badge for connected state**

  In the machine item render:
  - When `status === 'reconnecting'`: show a spinner icon + "重新连接中" text + a disconnect button (so user can force-stop the reconnect loop)
  - When `status === 'connected'` and `transport` is set: show a small badge (e.g., `SSH`, `Mosh`, `ttyd`) next to the status indicator

  Read the current `MachineItem.tsx` to understand the existing JSX structure before making changes.

- [ ] **Step 3: Add one-time mosh install hint**

  In `src/renderer/src/store/machines.ts`, add a `moshHintDismissed` boolean to state (default `false`). In `MachineItem.tsx` (or a shared notification area in the sidebar), listen for a `mosh:unavailable` message from the service and show a dismissible banner: "安装 mosh 可提升弱网连接稳定性 (brew install mosh)". Show only once per app session — set `moshHintDismissed = true` on dismiss or after first display.

  In `src/service/index.ts`, forward `manager.on('mosh:unavailable')` → `win.webContents.send('service:message', { type: 'mosh:unavailable' })` (add `mosh:unavailable` to `types.ts`).

- [ ] **Step 4: Update `PreviewPane.tsx` to probe direct HTTP first**

  Replace the current "always open SSH tunnel" logic with:

  ```typescript
  // When user clicks preview / opens preview pane:
  const result = await window.electron.ipcRenderer.invoke('preview:probe', {
    machineId,
    remotePort,
  })
  // result is { type: 'preview:probe:result', url: string, via: 'direct' | 'tunnel' }
  setPreviewUrl(result.url)
  ```

  Also handle `tunnel:error` message: if received while preview is open, show an error overlay with a "重新打开" button that re-triggers the probe.

  Read `PreviewPane.tsx` to understand the current tunnel-open flow and adapt accordingly.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/src/components/sidebar/MachineItem.tsx src/renderer/src/components/preview/PreviewPane.tsx src/renderer/src/store/machines.ts src/service/types.ts
  git commit -m "feat: transport badge, reconnecting UI, mosh hint, and direct HTTP preview probe"
  ```

---

## Final Verification

- [ ] Build the app: `npm run build` (or the project's build command) — no TypeScript errors
- [ ] Manual test: connect to a machine, verify SSH connects and terminal works
- [ ] Manual test: disconnect network briefly, verify "重新连接中..." appears and "已恢复" appears on reconnect
- [ ] Manual test: if mosh is not installed, verify one-time hint appears in sidebar
- [ ] Manual test: if mosh is installed, verify Mosh fallback works when SSH fails
- [ ] Manual test: open Preview, verify it uses direct HTTP when Tailscale is connected
- [ ] Manual test: verify transport badge shows `SSH` / `Mosh` / `ttyd` in sidebar when connected
- [ ] Manual test: when connected via Mosh, wait 60s and verify background SSH upgrade switches back to SSH
