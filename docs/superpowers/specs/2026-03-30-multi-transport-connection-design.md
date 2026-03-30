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

The renderer sees: `connecting | connected | reconnecting | failed | disconnected`.
`reconnecting` is NOT shown as `error` — it shows a spinner with "重新连接中...".

**Type changes required (both files must be updated together):**
- `src/service/types.ts` line 26: add `'reconnecting' | 'failed'` to the `connection:status` status union
- `src/renderer/src/store/machines.ts` line 11: add `'reconnecting' | 'failed'` to `ConnectionStatus` type
- `machines.ts` `connection:status` handler: add explicit `case 'reconnecting':` branch that only sets status — no Keychain logic, no toast, no error clearing
- `machines.ts` `connection:status` handler: add explicit `case 'failed':` branch that sets status and shows toast

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

- `isAvailable`: checks for mosh binary at known Homebrew paths before falling back to `which`. On macOS, Electron subprocesses do not inherit the user's shell PATH. Check in order: `/opt/homebrew/bin/mosh` (Apple Silicon), `/usr/local/bin/mosh` (Intel), then `which mosh` via `launchctl getenv PATH` (same pattern as existing `getSshAuthSock()`). If not found, log warning and skip.
- Connection: `mosh --ssh="ssh -p <port>" <user>@<host>` using the resolved binary path
- Shell I/O: pipe child process stdin/stdout to `IShell` interface
- Mosh automatically starts `mosh-server` on the remote — no manual remote setup needed beyond having mosh installed
- Remote requirement: `mosh` installed (`brew install mosh` on macOS)
- Local requirement: `mosh` installed (`brew install mosh`)

App startup check: if `mosh` not found locally, show one-time notification in sidebar: "安装 mosh 可提升弱网连接稳定性 (brew install mosh)"

### 2.3 TtydTransport (fallback)

Connects to a ttyd WebSocket server running on the remote machine.

- `isAvailable`: attempts HTTP GET to `http://<host>:7681/` with 3s timeout. Returns true only on 2xx response.
- Remote setup: ttyd must be running. `TtydTransport.connect()` first attempts to start it via a short-lived SSH connection (separate from the main transport): `ssh <host> 'pgrep ttyd || nohup ttyd -p 7681 -W bash &>/dev/null &'`. This SSH connection is only used for the start command and is closed immediately. If SSH is completely unavailable, ttyd start is skipped and `isAvailable` check determines whether to proceed.
- Note: the "SSH partially works" scenario from earlier drafts is removed. ttyd auto-start via SSH only applies when SSH can establish a connection long enough to run a single command, even if it cannot sustain a PTY session. If SSH cannot connect at all, ttyd must already be running on the remote.
- Protocol: ttyd JSON WebSocket protocol (input/output/resize message types)
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
4. On success: emit `connection:status connected`, auto-create new session via `session:replaced` message
5. Terminal writes: `\r\n\x1b[33m--- 重新连接中... ---\x1b[0m\r\n` on disconnect, `\r\n\x1b[32m--- 已恢复 ---\x1b[0m\r\n` on reconnect

**Session recovery protocol:**

When `ConnectionManager` reconnects and creates a new session, it emits a new message type:

```typescript
{ type: 'session:replaced'; oldSessionId: string; newSessionId: string; machineId: string }
```

`useTerminalWs` handles `session:replaced`:
- Does NOT set `disconnected = true` when `connection:status reconnecting` arrives (only set on `disconnected` or `error`)
- On `session:replaced` where `machineId` matches: update `sessionIdRef.current` to `newSessionId`, call `setSessionId(newSessionId)`, call `setTabSessionId(tabId, newSessionId)`
- The old session is already closed server-side; no `session:close` needed from renderer

`ConnectionManager` stores last `{cols, rows}` from resize events and passes them to the new session on creation.

**Background transport upgrade:**
Once connected via Mosh or ttyd, retry SSH every 60s. On SSH success, emit `session:replaced` with the new SSH session ID. The terminal shows a brief `\r\n\x1b[33m--- 已切换至 SSH ---\x1b[0m\r\n` message. The old transport session is closed after the new one is confirmed.

---

## 5. Preview Independent Link

**Current:** Preview opens SSH tunnel → `http://127.0.0.1:<localPort>`
**New:** Preview uses `http://<machine.host>:<remotePort>` directly (Tailscale IP is routable)

**Detection mechanism:**
1. When user clicks "预览", `PreviewPane` sends a new IPC message `preview:probe` to the service with `{ machineId, remotePort }`
2. Service does a `fetch('http://<host>:<port>/', { signal: AbortSignal.timeout(3000) })`
3. On any response (including 4xx/5xx — server is reachable): return `{ type: 'preview:probe:result', url: 'http://<host>:<port>' }`
4. On network error / timeout: fall back to `tunnel:open` as before, return `{ type: 'preview:probe:result', url: 'http://localhost:<localPort>' }`
5. `PreviewPane` loads the URL from the probe result

Fallback: if direct HTTP fails (ECONNREFUSED, timeout, network error), fall back to SSH tunnel as before. `TunnelManager` kept as-is.

**New message types:**
```typescript
{ type: 'preview:probe'; machineId: string; remotePort: number }
{ type: 'preview:probe:result'; url: string; via: 'direct' | 'tunnel' }
```

---

## 6. UI Changes

### MachineItem (sidebar)
- `statusColors` and `statusLabels` maps must include `reconnecting` (yellow, "重新连接中...") and `failed` (red, "连接失败")
- `reconnecting` state: spinner + "重新连接中" text, NOT red error color; show disconnect button so user can force-stop the reconnect loop
- `connected` state: show transport badge (SSH / Mosh / ttyd) — service emits active transport name in `connection:status connected` message via new optional field `transport?: 'ssh' | 'mosh' | 'ttyd'`
- One-time mosh install hint if mosh unavailable (shown once per app session, dismissible)

### TerminalPane
- On `reconnecting` status: write yellow "重新连接中..." message to terminal; do NOT set `disconnected = true`
- On `session:replaced`: update sessionId ref, write green "已恢复" message, continue xterm.js session
- On `disconnected` or `error` (final): set `disconnected = true`, write red "连接已断开" as before
- No other UI changes — xterm.js session continues seamlessly

---

## 7. MachineConfig Changes

No schema changes needed. Transport selection is automatic based on availability.

`connection:status` message gains an optional field:
```typescript
{ type: 'connection:status'; machineId: string; status: ...; message?: string; transport?: 'ssh' | 'mosh' | 'ttyd' }
```

New message types added to `types.ts`:
```typescript
// Session recovery after reconnect
{ type: 'session:replaced'; oldSessionId: string; newSessionId: string; machineId: string }
// Preview direct-access probe
{ type: 'preview:probe'; machineId: string; remotePort: number }
{ type: 'preview:probe:result'; url: string; via: 'direct' | 'tunnel' }
```

Open tunnels during reconnect: when `ConnectionManager` reconnects, it emits a `tunnel:reconnected` event internally. `TunnelManager` re-establishes any tunnels that were open on the previous SSH client using the new client. If re-establishment fails, the tunnel is closed and `tunnel:error` is emitted to the renderer so `PreviewPane` can show an error and prompt the user to re-open.

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
