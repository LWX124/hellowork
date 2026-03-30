# HelloWork — Plan 2: 完整 UI + 安全 + 端口预览

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1 终端核心的基础上，实现完整可用的 macOS 远程开发工具：机器管理 UI、多终端 Tab + 分屏、端口预览 + Chrome DevTools、密码 Keychain 加密存储、SSH Host Key 首次连接确认。

**Architecture:** 扩展 service 协议支持机器 CRUD 和主机指纹验证；新增两个 Zustand store（machines、workspace）管理 UI 状态；tunnel 状态作为本地 state 保留在 PreviewPane（单实例，无需全局共享）；App 使用 CSS Grid 三栏布局（Sidebar + 终端区 + 预览区）；Keychain 操作通过 Electron IPC 在 main 进程执行（native keytar 模块）。

**Tech Stack:** React 18、Zustand、xterm.js（已有）、keytar、Electron webview tag、CSS Grid + CSS 变量

---

## 文件结构（新增/修改）

```
src/
├── main/
│   ├── index.ts                          # 修改：新增 keychain IPC handlers
│   └── service-manager.ts                # 不变
│
├── preload/
│   └── index.ts                          # 修改：暴露 keychain API
│
├── service/
│   ├── index.ts                          # 修改：新增 machine CRUD + hostkey 消息处理
│   ├── types.ts                          # 修改：新增 machine/hostkey 消息类型
│   └── ssh/
│       └── connection-pool.ts            # 修改：新增 hostVerifier 支持 + known_hosts 读写
│
└── renderer/src/
    ├── App.tsx                           # 重写：三栏 Grid 布局
    ├── env.d.ts                          # 修改：新增 keychain API 类型
    ├── store/
    │   ├── service.ts                    # 不变
    │   ├── machines.ts                   # 新增：机器列表 + 连接状态
    │   └── workspace.ts                  # 新增：terminal tab 列表 + 分屏状态
    ├── components/
    │   ├── terminal/
    │   │   ├── TerminalPane.tsx          # 不变
    │   │   ├── useTerminalWs.ts          # 修改：session:created 时调用 setTabSessionId
    │   │   ├── TerminalTabs.tsx          # 新增：Tab 栏（+、关闭、切换）
    │   │   └── SplitTerminal.tsx         # 新增：分屏容器（水平/垂直拖拽）
    │   ├── sidebar/
    │   │   ├── Sidebar.tsx               # 新增：机器列表 + 添加按钮
    │   │   └── MachineItem.tsx           # 新增：单台机器行（状态点 + 连接/断开）
    │   ├── machines/
    │   │   └── MachineForm.tsx           # 新增：添加/编辑机器 Modal
    │   ├── preview/
    │   │   └── PreviewPane.tsx           # 新增：端口输入 + webview + DevTools 按钮
    │   └── common/
    │       ├── Modal.tsx                 # 新增：通用 Modal 包装
    │       └── Toast.tsx                 # 新增：错误/状态通知
```

---

## Task 1: 扩展消息类型和 service 协议

**Files:**
- Modify: `src/service/types.ts`
- Modify: `src/service/index.ts`

- [ ] **Step 1: 扩展 types.ts**

在现有 `ClientMessage` 和 `ServerMessage` 中追加机器管理和主机验证消息：

```typescript
// src/service/types.ts

export type ClientMessage =
  | { type: 'session:create'; machineId: string }
  | { type: 'session:close'; sessionId: string }
  | { type: 'terminal:input'; sessionId: string; data: string }
  | { type: 'terminal:resize'; sessionId: string; cols: number; rows: number }
  | { type: 'tunnel:open'; machineId: string; remotePort: number }
  | { type: 'tunnel:close'; tunnelId: string }
  // 机器管理
  | { type: 'machine:list' }
  | { type: 'machine:save'; machine: MachineConfig }
  | { type: 'machine:delete'; id: string }
  | { type: 'machine:connect'; machineId: string; password?: string }
  | { type: 'machine:disconnect'; machineId: string }
  // 主机指纹确认
  | { type: 'hostkey:approve'; machineId: string }
  | { type: 'hostkey:reject'; machineId: string }

export type ServerMessage =
  | { type: 'session:created'; sessionId: string }
  | { type: 'session:error'; sessionId: string; message: string }
  | { type: 'terminal:output'; sessionId: string; data: string }
  | { type: 'tunnel:opened'; tunnelId: string; localPort: number }
  | { type: 'tunnel:error'; tunnelId: string; message: string }
  | { type: 'connection:status'; machineId: string; status: 'connected' | 'disconnected' | 'connecting' | 'error'; message?: string }
  // 机器管理
  | { type: 'machine:list:result'; machines: MachineConfig[] }
  | { type: 'machine:saved'; machine: MachineConfig }
  | { type: 'machine:deleted'; id: string }
  // 主机指纹验证
  | { type: 'hostkey:verify'; machineId: string; host: string; fingerprint: string }

export interface MachineConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: {
    type: 'password' | 'key'
    keychainKey?: string
    keyPath?: string
  }
}
```

- [ ] **Step 2: 在 service/index.ts 中新增机器管理消息处理**

在现有 switch-case 末尾追加：

```typescript
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
        pool.connect(machine, (machineId, status, message) => {
          send(ws, { type: 'connection:status', machineId, status, message })
        }, msg.password,
        (machineId, host, fingerprint) => {
          send(ws, { type: 'hostkey:verify', machineId, host, fingerprint })
        })
        break
      }

      case 'machine:disconnect':
        pool.disconnect(msg.machineId)
        break

      case 'hostkey:approve':
        pool.approveHostKey(msg.machineId)
        break

      case 'hostkey:reject':
        pool.rejectHostKey(msg.machineId)
        break
```

- [ ] **Step 3: 提交**

```bash
git add src/service/types.ts src/service/index.ts
git commit -m "feat: extend service protocol with machine CRUD and hostkey verification"
```

---

## Task 2: ConnectionPool 扩展（Host Key + 密码认证）

**Files:**
- Modify: `src/service/ssh/connection-pool.ts`
- Create: `tests/service/connection-pool-hostkey.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// tests/service/connection-pool-hostkey.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectionPool } from '../../src/service/ssh/connection-pool'

vi.mock('ssh2', () => {
  const mockClient = {
    on: vi.fn().mockReturnThis(),
    connect: vi.fn(),
    end: vi.fn(),
  }
  return { Client: vi.fn(function() { return mockClient }) }
})
vi.mock('fs')

describe('ConnectionPool host key', () => {
  let pool: ConnectionPool

  beforeEach(() => {
    pool = new ConnectionPool()
  })

  it('calls hostKeyCallback when connecting', () => {
    const onHostKey = vi.fn()
    pool.connect(
      { id: 'm1', name: 'T', host: '100.0.0.1', port: 22, username: 'u', auth: { type: 'key', keyPath: '~/.ssh/id_rsa' } },
      vi.fn(),
      undefined,
      onHostKey
    )
    // hostVerifier is set in connect config — verify it's wired
    expect(pool.getStatus('m1')).toBe('connecting')
  })

  it('approveHostKey resolves pending verification', () => {
    pool.connect(
      { id: 'm1', name: 'T', host: '100.0.0.1', port: 22, username: 'u', auth: { type: 'key', keyPath: '~/.ssh/id_rsa' } },
      vi.fn(), undefined, vi.fn()
    )
    // Should not throw
    pool.approveHostKey('m1')
    pool.rejectHostKey('m2') // unknown id — should not throw
  })
})
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run tests/service/connection-pool-hostkey.test.ts
```

- [ ] **Step 3: 更新 ConnectionPool**

将 `src/service/ssh/connection-pool.ts` 替换为完整实现，支持密码认证、hostVerifier 回调、approveHostKey/rejectHostKey：

```typescript
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
    const entry: PoolEntry = { client, status: 'connecting' }
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
        if (e) e.status = 'error'
        onStatus(machine.id, 'error', err.message)
      })
      .on('close', () => {
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
      entry.approveResolve(false)
      entry.approveResolve = undefined
    }
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
    for (const [id] of this.pool) this.disconnect(id)
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/service/
```

Expected: 全部通过（原有 15 个 + 新增 2 个 = 17 个）

- [ ] **Step 5: 提交**

```bash
git add src/service/ssh/connection-pool.ts tests/service/connection-pool-hostkey.test.ts
git commit -m "feat: ConnectionPool supports password auth, hostVerifier, known_hosts"
```

---

## Task 3: Keychain IPC（主进程 + Preload）

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: 在 main/index.ts 中注册 keychain IPC handlers**

在 `ipcMain.handle('service:getPort', ...)` 之后追加：

```typescript
import keytar from 'keytar'

const KEYCHAIN_SERVICE = 'hellowork'

ipcMain.handle('keychain:set', (_e, account: string, password: string) =>
  keytar.setPassword(KEYCHAIN_SERVICE, account, password)
)
ipcMain.handle('keychain:get', (_e, account: string) =>
  keytar.getPassword(KEYCHAIN_SERVICE, account)
)
ipcMain.handle('keychain:delete', (_e, account: string) =>
  keytar.deletePassword(KEYCHAIN_SERVICE, account)
)
```

- [ ] **Step 2: 更新 preload/index.ts**

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getServicePort: () => ipcRenderer.invoke('service:getPort'),
  keychain: {
    set: (account: string, password: string) => ipcRenderer.invoke('keychain:set', account, password),
    get: (account: string) => ipcRenderer.invoke('keychain:get', account) as Promise<string | null>,
    delete: (account: string) => ipcRenderer.invoke('keychain:delete', account),
  },
})
```

- [ ] **Step 3: 更新 env.d.ts**

```typescript
// src/renderer/src/env.d.ts
/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    getServicePort: () => Promise<number>
    keychain: {
      set: (account: string, password: string) => Promise<void>
      get: (account: string) => Promise<string | null>
      delete: (account: string) => Promise<void>
    }
  }
}
```

- [ ] **Step 4: 验证构建**

```bash
npm run build 2>&1 | tail -5
```

Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: add Keychain IPC handlers for password storage"
```

---

## Task 4: Renderer Machines Store

**Files:**
- Create: `src/renderer/src/store/machines.ts`

- [ ] **Step 1: 创建 machines store**

```typescript
// src/renderer/src/store/machines.ts
import { create } from 'zustand'
import { MachineConfig } from '../../../service/types'
import { useServiceStore } from './service'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface MachinesState {
  machines: MachineConfig[]
  statuses: Record<string, ConnectionStatus>
  pendingHostKey: { machineId: string; host: string; fingerprint: string } | null
  // 初始化时拉取列表
  init: () => void
  saveMachine: (machine: MachineConfig) => void
  deleteMachine: (id: string) => void
  connectMachine: (machineId: string, password?: string) => void
  disconnectMachine: (machineId: string) => void
  approveHostKey: () => void
  rejectHostKey: () => void
}

export const useMachinesStore = create<MachinesState>((set, get) => ({
  machines: [],
  statuses: {},
  pendingHostKey: null,

  init: () => {
    const { send, onMessage } = useServiceStore.getState()

    // 订阅来自 service 的机器相关消息，保存 unsub 防内存泄漏
    const unsub = onMessage((msg) => {
      switch (msg.type) {
        case 'machine:list:result':
          set({ machines: msg.machines })
          break
        case 'machine:saved': {
          const machines = get().machines
          const idx = machines.findIndex(m => m.id === msg.machine.id)
          if (idx >= 0) {
            set({ machines: machines.map((m, i) => i === idx ? msg.machine : m) })
          } else {
            set({ machines: [...machines, msg.machine] })
          }
          break
        }
        case 'machine:deleted':
          set({ machines: get().machines.filter(m => m.id !== msg.id) })
          break
        case 'connection:status':
          set({ statuses: { ...get().statuses, [msg.machineId]: msg.status as ConnectionStatus } })
          break
        case 'hostkey:verify':
          set({ pendingHostKey: { machineId: msg.machineId, host: msg.host, fingerprint: msg.fingerprint } })
          break
      }
    })

    send({ type: 'machine:list' })
    // 返回 unsub 供调用方清理（App.tsx useEffect 中调用）
    return unsub
  },

  saveMachine: (machine) => {
    useServiceStore.getState().send({ type: 'machine:save', machine })
  },

  deleteMachine: (id) => {
    useServiceStore.getState().send({ type: 'machine:delete', id })
  },

  connectMachine: (machineId, password) => {
    set({ statuses: { ...get().statuses, [machineId]: 'connecting' } })
    useServiceStore.getState().send({ type: 'machine:connect', machineId, password })
  },

  disconnectMachine: (machineId) => {
    useServiceStore.getState().send({ type: 'machine:disconnect', machineId })
  },

  approveHostKey: () => {
    const { pendingHostKey } = get()
    if (!pendingHostKey) return
    useServiceStore.getState().send({ type: 'hostkey:approve', machineId: pendingHostKey.machineId })
    set({ pendingHostKey: null })
  },

  rejectHostKey: () => {
    const { pendingHostKey } = get()
    if (!pendingHostKey) return
    useServiceStore.getState().send({ type: 'hostkey:reject', machineId: pendingHostKey.machineId })
    set({
      pendingHostKey: null,
      statuses: { ...get().statuses, [pendingHostKey.machineId]: 'disconnected' },
    })
  },
}))
```

- [ ] **Step 2: 提交**

```bash
git add src/renderer/src/store/machines.ts
git commit -m "feat: machines Zustand store with connection status and hostkey state"
```

---

## Task 5: Workspace Store（Tab + 分屏状态）

**Files:**
- Create: `src/renderer/src/store/workspace.ts`

- [ ] **Step 1: 创建 workspace store**

```typescript
// src/renderer/src/store/workspace.ts
import { create } from 'zustand'
import { randomUUID } from 'crypto'

export interface TerminalTab {
  id: string
  machineId: string
  title: string
  sessionId?: string   // 由 session:created 响应后填入，用于 session:close
}

export type SplitMode = 'none' | 'horizontal' | 'vertical'

interface WorkspaceState {
  // 主面板 tabs
  tabs: TerminalTab[]
  activeTabId: string | null
  // 分屏：分屏后有两个面板，各自有 tab 列表
  splitMode: SplitMode
  splitTabs: TerminalTab[]      // 第二个面板的 tabs
  activeSplitTabId: string | null
  splitRatio: number            // 0.5 = 各半，0.3 = 主30%，不走 React state 更新（用 ref）
  // 端口预览
  previewVisible: boolean
  previewHeight: number         // px，不走 React state 更新（用 ref）

  init: () => void              // 预留，目前为空；sessionId 由 useTerminalWs 写入
  addTab: (machineId: string, title: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  setTabSessionId: (tabId: string, sessionId: string) => void
  addSplitTab: (machineId: string, title: string) => void
  closeSplitTab: (tabId: string) => void
  setActiveSplitTab: (tabId: string) => void
  setSplitMode: (mode: SplitMode) => void
  togglePreview: () => void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  splitMode: 'none',
  splitTabs: [],
  activeSplitTabId: null,
  splitRatio: 0.5,
  previewVisible: false,
  previewHeight: 300,

  // init 不需要订阅 service 消息；sessionId 由 useTerminalWs 通过 setTabSessionId 写入
  init: () => {},

  addTab: (machineId, title) => {
    const id = randomUUID()
    const tab: TerminalTab = { id, machineId, title }
    set(s => ({ tabs: [...s.tabs, tab], activeTabId: id }))
  },

  closeTab: (tabId) => {
    // session:close 由 useTerminalWs cleanup（组件卸载时）发送，这里只移除 tab
    set(s => {
      const tabs = s.tabs.filter(t => t.id !== tabId)
      const activeTabId = s.activeTabId === tabId
        ? (tabs[tabs.length - 1]?.id ?? null)
        : s.activeTabId
      return { tabs, activeTabId }
    })
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setTabSessionId: (tabId, sessionId) => {
    set(s => ({
      tabs: s.tabs.map(t => t.id === tabId ? { ...t, sessionId } : t),
      splitTabs: s.splitTabs.map(t => t.id === tabId ? { ...t, sessionId } : t),
    }))
  },

  addSplitTab: (machineId, title) => {
    const id = randomUUID()
    set(s => ({ splitTabs: [...s.splitTabs, { id, machineId, title }], activeSplitTabId: id }))
  },

  closeSplitTab: (tabId) => {
    // session:close 由 useTerminalWs cleanup 发送
    set(s => {
      const splitTabs = s.splitTabs.filter(t => t.id !== tabId)
      const activeSplitTabId = s.activeSplitTabId === tabId
        ? (splitTabs[splitTabs.length - 1]?.id ?? null)
        : s.activeSplitTabId
      // 如果第二面板空了，退出分屏
      return { splitTabs, activeSplitTabId, splitMode: splitTabs.length === 0 ? 'none' : s.splitMode }
    })
  },

  setActiveSplitTab: (tabId) => set({ activeSplitTabId: tabId }),

  setSplitMode: (mode) => set({ splitMode: mode }),

  togglePreview: () => set(s => ({ previewVisible: !s.previewVisible })),
}))
```

- [ ] **Step 2: 提交**

```bash
git add src/renderer/src/store/workspace.ts
git commit -m "feat: workspace Zustand store for terminal tabs and split screen state"
```

---

## Task 6: 通用 Modal 和 Toast

**Files:**
- Create: `src/renderer/src/components/common/Modal.tsx`
- Create: `src/renderer/src/components/common/Toast.tsx`

- [ ] **Step 1: 创建 Modal**

```typescript
// src/renderer/src/components/common/Modal.tsx
import { ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ title, onClose, children, footer }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        background: '#252526', border: '1px solid #3e3e3e', borderRadius: 8,
        minWidth: 480, maxWidth: 560, padding: 0, overflow: 'hidden'
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 20px', borderBottom: '1px solid #3e3e3e'
        }}>
          <span style={{ color: '#ccc', fontWeight: 600, fontSize: 14 }}>{title}</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18, lineHeight: 1
          }}>×</button>
        </div>
        <div style={{ padding: '20px' }}>{children}</div>
        {footer && (
          <div style={{
            padding: '12px 20px', borderTop: '1px solid #3e3e3e',
            display: 'flex', justifyContent: 'flex-end', gap: 8
          }}>{footer}</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 Toast**

```typescript
// src/renderer/src/components/common/Toast.tsx
import { useEffect, useState } from 'react'

interface ToastMessage {
  id: string
  message: string
  type: 'error' | 'info' | 'success'
}

// 全局 toast store（轻量，无需 Zustand）
const listeners = new Set<(msgs: ToastMessage[]) => void>()
let messages: ToastMessage[] = []

export const toast = {
  error: (message: string) => addToast(message, 'error'),
  info: (message: string) => addToast(message, 'info'),
  success: (message: string) => addToast(message, 'success'),
}

function addToast(message: string, type: ToastMessage['type']) {
  const id = Math.random().toString(36).slice(2)
  messages = [...messages, { id, message, type }]
  listeners.forEach(fn => fn(messages))
  setTimeout(() => {
    messages = messages.filter(m => m.id !== id)
    listeners.forEach(fn => fn(messages))
  }, 4000)
}

export function ToastContainer() {
  const [msgs, setMsgs] = useState<ToastMessage[]>([])

  useEffect(() => {
    const fn = (m: ToastMessage[]) => setMsgs([...m])
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])

  const colors = { error: '#ff6b6b', info: '#569cd6', success: '#4ec9b0' }

  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 2000, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {msgs.map(m => (
        <div key={m.id} style={{
          background: '#252526', border: `1px solid ${colors[m.type]}`,
          borderRadius: 6, padding: '10px 16px', color: colors[m.type],
          fontSize: 13, fontFamily: 'system-ui', maxWidth: 360,
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
        }}>
          {m.message}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/common/
git commit -m "feat: add Modal and Toast common components"
```

---

## Task 7: MachineForm Modal（添加/编辑机器）

**Files:**
- Create: `src/renderer/src/components/machines/MachineForm.tsx`

- [ ] **Step 1: 创建 MachineForm**

```typescript
// src/renderer/src/components/machines/MachineForm.tsx
import { useState } from 'react'
import { Modal } from '../common/Modal'
import { useMachinesStore } from '../../store/machines'
import { MachineConfig } from '../../../../service/types'
import { toast } from '../common/Toast'

interface Props {
  machine?: MachineConfig        // 编辑时传入，新增时为 undefined
  onClose: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: '#1e1e1e',
  border: '1px solid #3e3e3e', borderRadius: 4, color: '#ccc',
  fontSize: 13, outline: 'none', boxSizing: 'border-box'
}
const labelStyle: React.CSSProperties = {
  display: 'block', color: '#888', fontSize: 12, marginBottom: 4
}
const fieldStyle: React.CSSProperties = { marginBottom: 14 }
const btnPrimary: React.CSSProperties = {
  padding: '8px 20px', background: '#0e639c', border: 'none',
  borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 13
}
const btnSecondary: React.CSSProperties = {
  padding: '8px 20px', background: 'none', border: '1px solid #3e3e3e',
  borderRadius: 4, color: '#888', cursor: 'pointer', fontSize: 13
}

export function MachineForm({ machine, onClose }: Props) {
  const { saveMachine } = useMachinesStore()
  const [name, setName] = useState(machine?.name ?? '')
  const [host, setHost] = useState(machine?.host ?? '')
  const [port, setPort] = useState(String(machine?.port ?? 22))
  const [username, setUsername] = useState(machine?.username ?? '')
  const [authType, setAuthType] = useState<'key' | 'password'>(machine?.auth.type ?? 'key')
  const [keyPath, setKeyPath] = useState(machine?.auth.keyPath ?? '~/.ssh/id_rsa')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim() || !host.trim() || !username.trim()) {
      toast.error('请填写名称、主机地址和用户名')
      return
    }
    setSaving(true)
    const id = machine?.id ?? crypto.randomUUID()

    // 密码通过 Keychain 存储
    if (authType === 'password' && password) {
      await window.electronAPI.keychain.set(id, password)
    }

    const config: MachineConfig = {
      id,
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port) || 22,
      username: username.trim(),
      auth: authType === 'key'
        ? { type: 'key', keyPath: keyPath.trim() }
        : { type: 'password', keychainKey: id }
    }

    saveMachine(config)
    setSaving(false)
    toast.success(`${name} 已保存`)
    onClose()
  }

  return (
    <Modal
      title={machine ? '编辑机器' : '添加机器'}
      onClose={onClose}
      footer={
        <>
          <button style={btnSecondary} onClick={onClose}>取消</button>
          <button style={btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </>
      }
    >
      <div style={fieldStyle}>
        <label style={labelStyle}>显示名称</label>
        <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="家用 Mac Pro" />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Tailscale IP / Hostname</label>
        <input style={inputStyle} value={host} onChange={e => setHost(e.target.value)} placeholder="100.x.x.x" />
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>用户名</label>
          <input style={inputStyle} value={username} onChange={e => setUsername(e.target.value)} placeholder="your-username" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>SSH 端口</label>
          <input style={inputStyle} value={port} onChange={e => setPort(e.target.value)} placeholder="22" />
        </div>
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>认证方式</label>
        <div style={{ display: 'flex', gap: 12 }}>
          {(['key', 'password'] as const).map(t => (
            <label key={t} style={{ color: '#ccc', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" value={t} checked={authType === t} onChange={() => setAuthType(t)} />
              {t === 'key' ? 'SSH Key' : '密码'}
            </label>
          ))}
        </div>
      </div>
      {authType === 'key' ? (
        <div style={fieldStyle}>
          <label style={labelStyle}>私钥路径</label>
          <input style={inputStyle} value={keyPath} onChange={e => setKeyPath(e.target.value)} placeholder="~/.ssh/id_rsa" />
        </div>
      ) : (
        <div style={fieldStyle}>
          <label style={labelStyle}>密码（将加密存储到 macOS Keychain）</label>
          <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="输入密码" />
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add src/renderer/src/components/machines/MachineForm.tsx
git commit -m "feat: add MachineForm modal with Keychain password storage"
```

---

## Task 8: Sidebar 组件

**Files:**
- Create: `src/renderer/src/components/sidebar/MachineItem.tsx`
- Create: `src/renderer/src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: 创建 MachineItem**

```typescript
// src/renderer/src/components/sidebar/MachineItem.tsx
import { memo, useState } from 'react'
import { MachineConfig } from '../../../../service/types'
import { useMachinesStore, ConnectionStatus } from '../../store/machines'
import { useWorkspaceStore } from '../../store/workspace'
import { toast } from '../common/Toast'

interface Props {
  machine: MachineConfig
  onEdit: (machine: MachineConfig) => void
}

const statusColors: Record<ConnectionStatus, string> = {
  disconnected: '#555', connecting: '#e5c07b', connected: '#4ec9b0', error: '#ff6b6b'
}
const statusLabels: Record<ConnectionStatus, string> = {
  disconnected: '未连接', connecting: '连接中...', connected: '已连接', error: '错误'
}

export const MachineItem = memo(function MachineItem({ machine, onEdit }: Props) {
  const { statuses, connectMachine, disconnectMachine, deleteMachine } = useMachinesStore()
  const { addTab } = useWorkspaceStore()
  const status = statuses[machine.id] ?? 'disconnected'
  const [showMenu, setShowMenu] = useState(false)

  const handleConnect = async () => {
    let password: string | undefined
    if (machine.auth.type === 'password' && machine.auth.keychainKey) {
      password = await window.electronAPI.keychain.get(machine.auth.keychainKey) ?? undefined
      if (!password) {
        toast.error('Keychain 中未找到密码，请重新编辑机器')
        return
      }
    }
    connectMachine(machine.id, password)
  }

  const handleOpenTerminal = () => {
    if (status !== 'connected') {
      toast.error('请先连接机器')
      return
    }
    addTab(machine.id, machine.name)
  }

  return (
    <div
      style={{
        padding: '10px 12px', cursor: 'pointer', borderRadius: 6,
        display: 'flex', alignItems: 'center', gap: 8,
        position: 'relative',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#2a2d2e')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* 状态点 */}
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: statusColors[status], flexShrink: 0
      }} />

      {/* 名称 + 状态 */}
      <div style={{ flex: 1, minWidth: 0 }} onDoubleClick={handleOpenTerminal}>
        <div style={{ color: '#ccc', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {machine.name}
        </div>
        <div style={{ color: '#666', fontSize: 11 }}>{statusLabels[status]}</div>
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {status === 'disconnected' || status === 'error' ? (
          <button
            title="连接"
            onClick={handleConnect}
            style={{ background: 'none', border: 'none', color: '#569cd6', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
          >▶</button>
        ) : status === 'connected' ? (
          <>
            <button
              title="打开终端"
              onClick={handleOpenTerminal}
              style={{ background: 'none', border: 'none', color: '#4ec9b0', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}
            >⊞</button>
            <button
              title="断开"
              onClick={() => disconnectMachine(machine.id)}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
            >⏹</button>
          </>
        ) : null}
        <button
          title="更多"
          onClick={() => setShowMenu(v => !v)}
          style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16, padding: '2px 4px' }}
        >⋯</button>
      </div>

      {/* 下拉菜单 */}
      {showMenu && (
        <div
          style={{
            position: 'absolute', right: 8, top: '100%', zIndex: 100,
            background: '#252526', border: '1px solid #3e3e3e', borderRadius: 6,
            padding: 4, minWidth: 120
          }}
          onMouseLeave={() => setShowMenu(false)}
        >
          {[
            { label: '编辑', action: () => { onEdit(machine); setShowMenu(false) } },
            { label: '删除', action: () => { deleteMachine(machine.id); setShowMenu(false) } },
          ].map(item => (
            <div
              key={item.label}
              onClick={item.action}
              style={{ padding: '6px 12px', color: '#ccc', fontSize: 13, cursor: 'pointer', borderRadius: 4 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#2a2d2e')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
```

- [ ] **Step 2: 创建 Sidebar**

```typescript
// src/renderer/src/components/sidebar/Sidebar.tsx
import { memo, useState } from 'react'
import { useMachinesStore } from '../../store/machines'
import { MachineItem } from './MachineItem'
import { MachineForm } from '../machines/MachineForm'
import { MachineConfig } from '../../../../service/types'

export const Sidebar = memo(function Sidebar() {
  const { machines } = useMachinesStore()
  const [showForm, setShowForm] = useState(false)
  const [editingMachine, setEditingMachine] = useState<MachineConfig | undefined>()

  const openAdd = () => { setEditingMachine(undefined); setShowForm(true) }
  const openEdit = (m: MachineConfig) => { setEditingMachine(m); setShowForm(true) }

  return (
    <div style={{
      width: 220, background: '#252526', borderRight: '1px solid #1e1e1e',
      display: 'flex', flexDirection: 'column', height: '100%', flexShrink: 0
    }}>
      {/* 标题栏 */}
      <div style={{
        padding: '12px 12px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <span style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>机器</span>
        <button
          onClick={openAdd}
          title="添加机器"
          style={{ background: 'none', border: 'none', color: '#569cd6', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}
        >+</button>
      </div>

      {/* 机器列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px' }}>
        {machines.length === 0 ? (
          <div style={{ color: '#555', fontSize: 12, padding: '16px 12px', textAlign: 'center' }}>
            点击 + 添加机器
          </div>
        ) : (
          machines.map(m => (
            <MachineItem key={m.id} machine={m} onEdit={openEdit} />
          ))
        )}
      </div>

      {/* 添加/编辑 Modal */}
      {showForm && (
        <MachineForm
          machine={editingMachine}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
})
```

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/sidebar/
git commit -m "feat: sidebar with machine list, connect/disconnect, add/edit/delete"
```

---

## Task 9: TerminalTabs、SplitTerminal 和 TerminalPane/useTerminalWs 扩展

**Files:**
- Create: `src/renderer/src/components/terminal/TerminalTabs.tsx`
- Create: `src/renderer/src/components/terminal/SplitTerminal.tsx`
- Modify: `src/renderer/src/components/terminal/TerminalPane.tsx` — 新增 `tabId` prop
- Modify: `src/renderer/src/components/terminal/useTerminalWs.ts` — 收到 `session:created` 时调用 `setTabSessionId`

> **注意：** `tabId` 用于在 `session:created` 时回填 `TerminalTab.sessionId`，使 `closeTab()` 能正确发送 `session:close`。

- [ ] **Step 1: 创建 TerminalTabs**

```typescript
// src/renderer/src/components/terminal/TerminalTabs.tsx
import { memo } from 'react'
import { TerminalTab } from '../../store/workspace'

interface Props {
  tabs: TerminalTab[]
  activeTabId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onSplit?: () => void
  showSplitButton?: boolean
}

export const TerminalTabs = memo(function TerminalTabs({ tabs, activeTabId, onSelect, onClose, onSplit, showSplitButton }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', background: '#252526',
      borderBottom: '1px solid #1e1e1e', height: 35, overflowX: 'auto', flexShrink: 0
    }}>
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 12px', height: '100%', cursor: 'pointer',
            borderRight: '1px solid #1e1e1e', flexShrink: 0,
            background: tab.id === activeTabId ? '#1e1e1e' : 'transparent',
            borderTop: tab.id === activeTabId ? '1px solid #569cd6' : '1px solid transparent',
          }}
        >
          <span style={{ color: '#ccc', fontSize: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tab.title}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onClose(tab.id) }}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}
          >×</button>
        </div>
      ))}

      {/* 分屏按钮（仅主面板显示） */}
      {showSplitButton && onSplit && tabs.length > 0 && (
        <button
          onClick={onSplit}
          title="水平分屏"
          style={{ marginLeft: 'auto', marginRight: 8, background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14 }}
        >⊞</button>
      )}
    </div>
  )
})
```

- [ ] **Step 2: 创建 SplitTerminal（拖拽分隔线）**

```typescript
// src/renderer/src/components/terminal/SplitTerminal.tsx
import { useRef, useEffect, ReactNode } from 'react'
import { useWorkspaceStore } from '../../store/workspace'

interface Props {
  primary: ReactNode
  secondary: ReactNode
}

export function SplitTerminal({ primary, secondary }: Props) {
  const { splitMode } = useWorkspaceStore()
  const dividerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const ratioRef = useRef(0.5)
  const isDragging = useRef(false)

  const isHorizontal = splitMode === 'horizontal'

  useEffect(() => {
    const divider = dividerRef.current
    const container = containerRef.current
    if (!divider || !container) return

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const rect = container.getBoundingClientRect()
      const ratio = isHorizontal
        ? (e.clientY - rect.top) / rect.height
        : (e.clientX - rect.left) / rect.width
      const clamped = Math.min(Math.max(ratio, 0.2), 0.8)
      ratioRef.current = clamped

      // 直接操作 DOM，不触发 React re-render
      const children = container.children
      if (isHorizontal) {
        ;(children[0] as HTMLElement).style.height = `${clamped * 100}%`
        ;(children[2] as HTMLElement).style.height = `${(1 - clamped) * 100}%`
      } else {
        ;(children[0] as HTMLElement).style.width = `${clamped * 100}%`
        ;(children[2] as HTMLElement).style.width = `${(1 - clamped) * 100}%`
      }
    }

    const onMouseUp = () => { isDragging.current = false }

    divider.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      divider.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isHorizontal])

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex', flexDirection: isHorizontal ? 'column' : 'row',
        width: '100%', height: '100%', overflow: 'hidden'
      }}
    >
      <div style={isHorizontal ? { height: '50%', overflow: 'hidden' } : { width: '50%', overflow: 'hidden' }}>
        {primary}
      </div>

      {/* 分隔线 */}
      <div
        ref={dividerRef}
        style={{
          background: '#1e1e1e',
          cursor: isHorizontal ? 'row-resize' : 'col-resize',
          flexShrink: 0,
          [isHorizontal ? 'height' : 'width']: 4,
        }}
      />

      <div style={isHorizontal ? { height: '50%', overflow: 'hidden' } : { width: '50%', overflow: 'hidden' }}>
        {secondary}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/terminal/TerminalTabs.tsx src/renderer/src/components/terminal/SplitTerminal.tsx
git commit -m "feat: TerminalTabs with close/split buttons and SplitTerminal with drag divider"
```

- [ ] **Step 4: 修改 useTerminalWs — 接收 tabId，session:created 时回填 setTabSessionId**

```typescript
// src/renderer/src/components/terminal/useTerminalWs.ts
import { useEffect, useRef, useState } from 'react'
import { useServiceStore } from '../../store/service'
import { useWorkspaceStore } from '../../store/workspace'

export function useTerminalWs(machineId: string, tabId: string) {
  const send = useServiceStore(s => s.send)
  const onMessage = useServiceStore(s => s.onMessage)
  const connected = useServiceStore(s => s.connected)
  const setTabSessionId = useWorkspaceStore(s => s.setTabSessionId)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!connected || !machineId) return

    send({ type: 'session:create', machineId })

    const unsub = onMessage((msg) => {
      if (msg.type === 'session:created' && !sessionIdRef.current) {
        sessionIdRef.current = msg.sessionId
        setSessionId(msg.sessionId)
        setTabSessionId(tabId, msg.sessionId)   // 回填到 workspace store
      }
      if (msg.type === 'session:error') {
        setError(msg.message)
      }
    })

    return () => {
      unsub()
      if (sessionIdRef.current) {
        send({ type: 'session:close', sessionId: sessionIdRef.current })
        sessionIdRef.current = null
        setSessionId(null)
      }
    }
  }, [connected, machineId])

  const writeInput = (data: string) => {
    if (sessionIdRef.current) send({ type: 'terminal:input', sessionId: sessionIdRef.current, data })
  }

  const resize = (cols: number, rows: number) => {
    if (sessionIdRef.current) send({ type: 'terminal:resize', sessionId: sessionIdRef.current, cols, rows })
  }

  return { sessionId, error, writeInput, resize }
}
```

- [ ] **Step 5: 修改 TerminalPane — 新增 tabId prop，传给 useTerminalWs**

```typescript
// src/renderer/src/components/terminal/TerminalPane.tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import { FitAddon } from '@xterm/addon-fit'
import { useServiceStore } from '../../store/service'
import { useTerminalWs } from './useTerminalWs'
import '@xterm/xterm/css/xterm.css'

interface Props {
  tabId: string       // 新增：用于 session lifecycle 追踪
  machineId: string
  isActive: boolean
}

export function TerminalPane({ tabId, machineId, isActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const pendingRef = useRef<string[]>([])
  const { sessionId, error, writeInput, resize } = useTerminalWs(machineId, tabId)
  const onMessage = useServiceStore(s => s.onMessage)

  useEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    })
    const webgl = new WebglAddon()
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(webgl)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    term.onData((data) => writeInput(data))

    const ro = new ResizeObserver(() => {
      if (fitRef.current && termRef.current) {
        fitRef.current.fit()
        resize(termRef.current.cols, termRef.current.rows)
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      webgl.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!sessionId) return
    const unsub = onMessage((msg) => {
      if (msg.type === 'terminal:output' && msg.sessionId === sessionId) {
        if (isActive && termRef.current) {
          termRef.current.write(msg.data)
        } else {
          pendingRef.current.push(msg.data)
        }
      }
    })
    return unsub
  }, [sessionId, isActive, onMessage])

  useEffect(() => {
    if (isActive && termRef.current && pendingRef.current.length > 0) {
      const pending = pendingRef.current.splice(0)
      for (const chunk of pending) {
        termRef.current.write(chunk)
      }
    }
  }, [isActive])

  if (error) {
    return (
      <div style={{ color: '#ff6b6b', padding: 16, fontFamily: 'monospace' }}>
        连接错误：{error}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: isActive ? 'block' : 'none',
        backgroundColor: '#1e1e1e',
      }}
    />
  )
}
```

> **注意：** `session:close` 仍由 `useTerminalWs` cleanup 发送（组件卸载时）。`closeTab()` 只负责从 store 移除 tab，不重复发 `session:close`，避免双发。

- [ ] **Step 6: 提交 TerminalPane + useTerminalWs 修改**

```bash
git add src/renderer/src/components/terminal/TerminalPane.tsx src/renderer/src/components/terminal/useTerminalWs.ts
git commit -m "feat: wire tabId through TerminalPane/useTerminalWs to track sessionId in workspace store"
```

---

## Task 10: PreviewPane（端口预览 + DevTools）

**Files:**
- Create: `src/renderer/src/components/preview/PreviewPane.tsx`

> **注意：** Electron webview tag 必须在 BrowserWindow webPreferences 中设置 `webviewTag: true`（Plan 1 Task 8 已配置）

- [ ] **Step 1: 创建 PreviewPane**

```typescript
// src/renderer/src/components/preview/PreviewPane.tsx
import { useRef, useState, useEffect } from 'react'
import { useServiceStore } from '../../store/service'
import { toast } from '../common/Toast'

export function PreviewPane() {
  const [portInput, setPortInput] = useState('')
  const [tunnelId, setTunnelId] = useState<string | null>(null)
  const [localPort, setLocalPort] = useState<number | null>(null)
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null)
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const { send, onMessage } = useServiceStore()
  const [machineOptions, setMachineOptions] = useState<Array<{id: string, name: string}>>([])

  // 获取已连接机器列表
  useEffect(() => {
    const unsub = onMessage((msg) => {
      if (msg.type === 'machine:list:result') {
        setMachineOptions(msg.machines.map((m: any) => ({ id: m.id, name: m.name })))
      }
      if (msg.type === 'tunnel:opened') {
        setTunnelId(msg.tunnelId)
        setLocalPort(msg.localPort)
      }
      if (msg.type === 'tunnel:error') {
        toast.error(`端口转发失败：${msg.message}`)
      }
    })
    send({ type: 'machine:list' })
    return unsub
  }, [onMessage, send])

  const handleOpen = () => {
    const port = parseInt(portInput)
    if (!port || port < 1 || port > 65535) {
      toast.error('请输入有效端口（1-65535）')
      return
    }
    if (!activeMachineId) {
      toast.error('请选择机器')
      return
    }
    // 关闭旧 tunnel
    if (tunnelId) send({ type: 'tunnel:close', tunnelId })
    send({ type: 'tunnel:open', machineId: activeMachineId, remotePort: port })
  }

  const handleClose = () => {
    if (tunnelId) send({ type: 'tunnel:close', tunnelId })
    setTunnelId(null)
    setLocalPort(null)
  }

  const handleOpenDevTools = () => {
    (webviewRef.current as any)?.openDevTools()
  }

  const handleRefresh = () => {
    (webviewRef.current as any)?.reload()
  }

  const selectStyle: React.CSSProperties = {
    background: '#1e1e1e', border: '1px solid #3e3e3e', borderRadius: 4,
    color: '#ccc', fontSize: 12, padding: '4px 8px', outline: 'none'
  }
  const inputStyle: React.CSSProperties = {
    ...selectStyle, width: 80
  }
  const btnStyle: React.CSSProperties = {
    background: '#0e639c', border: 'none', borderRadius: 4,
    color: '#fff', fontSize: 12, padding: '4px 12px', cursor: 'pointer'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e' }}>
      {/* 工具栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        background: '#252526', borderBottom: '1px solid #1e1e1e', flexShrink: 0
      }}>
        <select
          style={selectStyle}
          value={activeMachineId ?? ''}
          onChange={e => setActiveMachineId(e.target.value || null)}
        >
          <option value="">选择机器</option>
          {machineOptions.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <span style={{ color: '#888', fontSize: 12 }}>:</span>
        <input
          style={inputStyle}
          value={portInput}
          onChange={e => setPortInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleOpen()}
          placeholder="3000"
        />
        <button style={btnStyle} onClick={handleOpen}>预览</button>
        {localPort && (
          <>
            <button
              style={{ ...btnStyle, background: 'none', border: '1px solid #3e3e3e', color: '#ccc' }}
              onClick={handleRefresh}
            >刷新</button>
            <button
              style={{ ...btnStyle, background: 'none', border: '1px solid #3e3e3e', color: '#ccc' }}
              onClick={handleOpenDevTools}
            >DevTools</button>
            <button
              style={{ ...btnStyle, background: 'none', border: '1px solid #3e3e3e', color: '#888' }}
              onClick={handleClose}
            >关闭</button>
          </>
        )}
      </div>

      {/* webview */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {localPort ? (
          <webview
            ref={webviewRef as any}
            src={`http://localhost:${localPort}`}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#555', fontSize: 13
          }}>
            选择机器和端口后点击预览
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 在 tsconfig.web.json 中确保 webview JSX 类型可用**

检查 `tsconfig.web.json`，如果 `compilerOptions.types` 不包含 `electron`，在 `src/renderer/src/env.d.ts` 中追加：

```typescript
// 已有内容下面追加
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
      src?: string
      ref?: React.Ref<any>
      style?: React.CSSProperties
    }, HTMLElement>
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/preview/PreviewPane.tsx src/renderer/src/env.d.ts
git commit -m "feat: PreviewPane with webview port forwarding and DevTools"
```

---

## Task 11: Host Key 验证 Modal

**Files:**
- Create: `src/renderer/src/components/common/HostKeyModal.tsx`

- [ ] **Step 1: 创建 HostKeyModal**

```typescript
// src/renderer/src/components/common/HostKeyModal.tsx
import { useMachinesStore } from '../../store/machines'
import { Modal } from './Modal'

export function HostKeyModal() {
  const { pendingHostKey, approveHostKey, rejectHostKey } = useMachinesStore()
  if (!pendingHostKey) return null

  return (
    <Modal
      title="新主机连接确认"
      onClose={rejectHostKey}
      footer={
        <>
          <button
            onClick={rejectHostKey}
            style={{ padding: '8px 20px', background: 'none', border: '1px solid #3e3e3e', borderRadius: 4, color: '#888', cursor: 'pointer', fontSize: 13 }}
          >
            拒绝
          </button>
          <button
            onClick={approveHostKey}
            style={{ padding: '8px 20px', background: '#0e639c', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            信任并连接
          </button>
        </>
      }
    >
      <div style={{ color: '#ccc', fontSize: 13, lineHeight: 1.8 }}>
        <p style={{ margin: '0 0 12px', color: '#e5c07b' }}>
          ⚠ 首次连接到此主机，请确认指纹是否可信
        </p>
        <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '12px 16px', fontFamily: 'monospace' }}>
          <div><span style={{ color: '#888' }}>主机：</span>{pendingHostKey.host}</div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: '#888' }}>指纹：</span>
            <span style={{ color: '#4ec9b0', wordBreak: 'break-all' }}>{pendingHostKey.fingerprint}</span>
          </div>
        </div>
        <p style={{ margin: '12px 0 0', color: '#666', fontSize: 12 }}>
          信任后指纹将保存到 ~/.hellowork/known_hosts，后续连接自动验证。
        </p>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add src/renderer/src/components/common/HostKeyModal.tsx
git commit -m "feat: HostKeyModal for SSH host fingerprint verification"
```

---

## Task 12: 整合 App.tsx 三栏布局

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 用三栏布局重写 App.tsx**

```typescript
// src/renderer/src/App.tsx
import { useEffect, useRef } from 'react'
import { useServiceStore } from './store/service'
import { useMachinesStore } from './store/machines'
import { useWorkspaceStore } from './store/workspace'
import { Sidebar } from './components/sidebar/Sidebar'
import { TerminalPane } from './components/terminal/TerminalPane'
import { TerminalTabs } from './components/terminal/TerminalTabs'
import { SplitTerminal } from './components/terminal/SplitTerminal'
import { PreviewPane } from './components/preview/PreviewPane'
import { ToastContainer } from './components/common/Toast'
import { HostKeyModal } from './components/common/HostKeyModal'

export default function App() {
  const connectService = useServiceStore(s => s.connect)
  const serviceConnected = useServiceStore(s => s.connected)
  const initMachines = useMachinesStore(s => s.init)

  const {
    tabs, activeTabId, setActiveTab, closeTab, addTab,
    splitMode, splitTabs, activeSplitTabId, setActiveSplitTab, closeSplitTab, setSplitMode,
    previewVisible, togglePreview
  } = useWorkspaceStore()

  const previewPanelRef = useRef<HTMLDivElement>(null)
  const previewHeightRef = useRef(300)
  const isDraggingPreview = useRef(false)

  // 1. 连接本地 Node 服务
  useEffect(() => { connectService() }, [])

  // 2. 服务连接后初始化机器列表，保存 unsub 防内存泄漏
  useEffect(() => {
    if (!serviceConnected) return
    const unsub = initMachines()
    return () => unsub?.()
  }, [serviceConnected])

  // 预览区拖拽调整高度（直接操作 DOM）
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingPreview.current || !previewPanelRef.current) return
      const parent = previewPanelRef.current.parentElement!
      const rect = parent.getBoundingClientRect()
      const newHeight = Math.min(Math.max(rect.bottom - e.clientY, 150), rect.height - 200)
      previewHeightRef.current = newHeight
      previewPanelRef.current.style.height = `${newHeight}px`
    }
    const onMouseUp = () => { isDraggingPreview.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [])

  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeSplitTab = splitTabs.find(t => t.id === activeSplitTabId)

  // 终端区（主面板）
  const primaryPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TerminalTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTab}
        onClose={closeTab}
        showSplitButton
        onSplit={() => setSplitMode(splitMode === 'none' ? 'vertical' : 'none')}
      />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {tabs.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555', fontSize: 13 }}>
            在左侧选择机器，双击或点击 ⊞ 打开终端
          </div>
        ) : (
          tabs.map(tab => (
            <div key={tab.id} style={{ position: 'absolute', inset: 0, display: tab.id === activeTabId ? 'block' : 'none' }}>
              <TerminalPane tabId={tab.id} machineId={tab.machineId} isActive={tab.id === activeTabId} />
            </div>
          ))
        )}
      </div>
    </div>
  )

  // 分屏第二面板
  const secondaryPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TerminalTabs
        tabs={splitTabs}
        activeTabId={activeSplitTabId}
        onSelect={setActiveSplitTab}
        onClose={closeSplitTab}
      />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {splitTabs.map(tab => (
          <div key={tab.id} style={{ position: 'absolute', inset: 0, display: tab.id === activeSplitTabId ? 'block' : 'none' }}>
            <TerminalPane tabId={tab.id} machineId={tab.machineId} isActive={tab.id === activeSplitTabId} />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#1e1e1e', fontFamily: 'system-ui, sans-serif' }}>
      {/* 左侧 Sidebar */}
      <Sidebar />

      {/* 主工作区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 顶部栏（端口预览切换按钮） */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '0 8px', background: '#252526', height: 35, borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
          <button
            onClick={togglePreview}
            style={{ background: previewVisible ? '#0e639c' : 'none', border: '1px solid #3e3e3e', borderRadius: 4, color: '#ccc', cursor: 'pointer', fontSize: 12, padding: '3px 10px' }}
          >
            {previewVisible ? '▼ 端口预览' : '▶ 端口预览'}
          </button>
        </div>

        {/* 终端区 */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {splitMode !== 'none' ? (
            <SplitTerminal primary={primaryPanel} secondary={secondaryPanel} />
          ) : (
            primaryPanel
          )}
        </div>

        {/* 端口预览区（可折叠） */}
        {previewVisible && (
          <>
            {/* 拖拽分隔线 */}
            <div
              onMouseDown={() => { isDraggingPreview.current = true }}
              style={{ height: 4, background: '#1e1e1e', cursor: 'row-resize', flexShrink: 0 }}
            />
            <div ref={previewPanelRef} style={{ height: previewHeightRef.current, flexShrink: 0 }}>
              <PreviewPane />
            </div>
          </>
        )}
      </div>

      {/* 全局 UI */}
      <ToastContainer />
      <HostKeyModal />
    </div>
  )
}
```

- [ ] **Step 2: 验证构建**

```bash
npm run build 2>&1 | tail -10
```

Expected: 构建成功，无 TypeScript 错误。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: three-column layout with sidebar, terminal tabs, split screen, port preview"
```

---

## Task 13: 最终验证

- [ ] **Step 1: 运行所有单元测试**

```bash
npx vitest run
```

Expected: 所有测试通过

- [ ] **Step 2: 构建验证**

```bash
npm run build
```

Expected: 成功

- [ ] **Step 3: 手动验证清单**

启动 app：`npm run dev`

| 功能 | 验证步骤 |
|---|---|
| 添加机器 | 点击 Sidebar "+"，填写 Tailscale IP、用户名、SSH Key 路径，保存 |
| 连接机器 | 点击机器右侧 "▶"，状态点变绿 |
| Host Key 验证 | 首次连接弹出指纹确认弹窗，点击"信任并连接" |
| 打开终端 | 双击机器或点击 "⊞"，Tab 出现，终端可输入 |
| 多 Tab | 多次点击 "⊞"，切换 Tab，非活跃 Tab 不渲染 |
| 分屏 | 点击终端区右上角 "⊞"，出现分割线，可拖拽调整 |
| 端口预览 | 点击"▶ 端口预览"，选择机器和端口，点"预览"，webview 显示页面 |
| DevTools | 预览页面后点"DevTools"，弹出 Chrome DevTools |
| 密码认证 | 编辑机器选择"密码"，输入密码保存，连接时自动从 Keychain 取 |

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat: Plan 2 complete — full UI with machine management, tabs, split, port preview"
```

---

## 完成标准

Plan 2 完成后，app 具备完整可用性：
- 用户可通过 UI 添加/编辑/删除远程机器（无需手动编辑 JSON）
- 点击连接，首次连接弹出 Host Key 指纹确认
- 多终端 Tab，可分屏，非活跃 Tab 不渲染
- 端口预览用 webview 渲染远程服务，支持 Chrome DevTools
- 密码通过 macOS Keychain 加密存储
