# Multi-Transport Connection Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single SSH connection with a multi-transport connection layer that automatically selects the best protocol (SSH → Mosh → ttyd), reconnects transparently on failure, and decouples the Preview pane from SSH tunnels.

**Architecture:** A `ConnectionManager` per machine wraps a pluggable transport layer behind a unified interface. A state machine drives connection lifecycle. The renderer is unaware of which transport is active.

**Tech Stack:** ssh2 (existing), mosh CLI (spawn), ttyd WebSocket protocol, Zustand (existing), xterm.js (existing)

---

## 1. Connection State Machine

Each machine has one `ConnectionManager` instance with the following states:

```
idle → connecting → connected → reconnecting → connected (loop)
                              ↘ failed (all transports exhausted)
```

State transitions:
- `idle → connecting`: user clicks connect
- `connecting → connected`: transport handshake succeeds
- `connecting → failed`: all transports tried, all failed
- `connected → reconnecting`: keepalive timeout OR transport close event
- `reconnecting → connected`: reconnect attempt succeeds (user sees no interruption)
- `reconnecting → failed`: retry count exceeds limit across all transports

The renderer only sees: `connecting | connected | reconnecting | failed | disconnected`.
`reconnecting` is NOT shown as `error` — it shows a spinner with "重新连接中...".

---

## 2. Transport Layer (Pluggable)

All transports implement a common `ITransport` interface:

```typescript
interface ITransport {
  readonly name: 'ssh' | 'mosh' | 'ttyd'
  connect(machine: MachineConfig, opts: TransportOpts): Promise<void>
  createShell(onData: (data: string) => void): Promise<IShell>
  disconnect(): void
  isAvailable(machine: MachineConfig): Promise<boolean>  // pre-flight check
}

interface IShell {
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}
```

### 2.1 SshTransport (primary)

Wraps existing `ConnectionPool` + `SessionManager`. Changes from current:
- `readyTimeout`: 15000 → 30000
- `keepaliveInterval`: 30000 → 10000
- `keepaliveCountMax`: 2 → 5
- On `close` event: emit `transport:disconnected` instead of directly setting error status

`isAvailable`: always true (SSH is always attempted first).

### 2.2 MoshTransport (secondary)

Spawns `mosh` CLI as a child process. Mosh handles its own UDP connection and session persistence.

- `isAvailable`: checks `which mosh` on local machine. If not found, logs warning and skips.
- Connection: `mosh --ssh="ssh -p <port>" <user>@<host>`
- Shell I/O: pipe child process stdin/stdout to `IShell` interface
- Mosh automatically starts `mosh-server` on the remote — no manual remote setup needed beyond having mosh installed
- Remote requirement: `mosh` installed (`brew install mosh` on macOS)
- Local requirement: `mosh` installed (`brew install mosh`)

App startup check: if `mosh` not found locally, show one-time notification in sidebar: "安装 mosh 可提升弱网连接稳定性 (brew install mosh)"

### 2.3 TtydTransport (fallback)

Connects to a ttyd WebSocket server running on the remote machine.

- `isAvailable`: attempts HTTP GET to `http://<host>:7681/` with 3s timeout
- Protocol: ttyd JSON WebSocket protocol (input/output/resize message types)
- Remote setup: ttyd must be running. ConnectionManager can auto-start it via SSH before switching: `ssh <host> 'nohup ttyd -p 7681 -W bash &>/dev/null &'`
- Does NOT use webview — connects via WebSocket in the service process, feeds data to existing xterm.js pipeline

---

## 3. Transport Selection & Fallback

`ConnectionManager.connect()` tries transports in order:

```
1. SshTransport
2. MoshTransport  (skip if mosh not installed locally)
3. TtydTransport  (auto-start ttyd on remote via SSH if SSH partially works)
```

Retry logic per transport:
- Max 2 consecutive failures before moving to next transport
- Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (cap)
- After all transports fail: status = `failed`, stop retrying

Background upgrade: once connected via a lower-priority transport, retry SSH every 60s silently. If SSH succeeds, seamlessly switch back (create new session, close old one).

---

## 4. Auto-Reconnect

On `transport:disconnected` event:
1. Set machine status to `reconnecting`
2. Try same transport first (network blip)
3. If fails twice, try next transport in priority order
4. On success: emit `connection:status connected`, auto-create new session
5. Terminal writes: `\r\n\x1b[33m--- 重新连接中... ---\x1b[0m\r\n` on disconnect, `\r\n\x1b[32m--- 已恢复 ---\x1b[0m\r\n` on reconnect

Session recovery: `ConnectionManager` stores last `{cols, rows}` and re-runs `session:create` automatically after reconnect. The renderer's `useTerminalWs` hook handles the new `sessionId` transparently.

---

## 5. Preview Independent Link

**Current:** Preview opens SSH tunnel → `http://127.0.0.1:<localPort>`
**New:** Preview uses `http://<machine.host>:<remotePort>` directly (Tailscale IP is routable)

Fallback: if direct HTTP fails (non-Tailscale network), fall back to SSH tunnel as before.

Changes:
- `PreviewPane` / tunnel open logic: try direct URL first, fall back to tunnel
- `TunnelManager` kept as-is for fallback
- No SSH dependency for the happy path

---

## 6. UI Changes

### MachineItem (sidebar)
- Status badge shows transport name when connected: `SSH` / `Mosh` / `ttyd`
- `reconnecting` state: spinner + "重新连接中" text, NOT red error color
- One-time mosh install hint if mosh unavailable

### TerminalPane
- On `reconnecting`: write yellow "重新连接中..." message to terminal
- On `reconnected`: write green "已恢复" message
- No other UI changes — xterm.js session continues seamlessly

---

## 7. MachineConfig Changes

No schema changes needed. Transport selection is automatic based on availability.

Optional future addition: `preferredTransport?: 'ssh' | 'mosh' | 'ttyd'` per machine — not in scope for this implementation.

---

## 8. File Structure

```
src/service/
  connection/
    ConnectionManager.ts     — state machine, transport orchestration, reconnect loop
    ITransport.ts            — interface definitions
    SshTransport.ts          — wraps existing ConnectionPool + SessionManager
    MoshTransport.ts         — spawn mosh CLI
    TtydTransport.ts         — WebSocket ttyd client
  ssh/
    connection-pool.ts       — unchanged (used by SshTransport)
    session.ts               — unchanged (used by SshTransport)
    tunnel.ts                — unchanged (used as fallback for preview)
  index.ts                   — replace pool/sessions with ConnectionManager instances
  types.ts                   — add reconnecting to connection status type

src/renderer/src/
  store/machines.ts          — handle reconnecting status
  components/sidebar/MachineItem.tsx  — transport badge, reconnecting state
  components/terminal/TerminalPane.tsx — reconnecting/reconnected messages
  components/preview/PreviewPane.tsx  — direct HTTP first, tunnel fallback
```

---

## 9. Out of Scope

- Tailscale API integration / netcheck diagnostics panel
- Per-machine transport preference UI
- Session recording / audit logs
- Android / iPhone client support
