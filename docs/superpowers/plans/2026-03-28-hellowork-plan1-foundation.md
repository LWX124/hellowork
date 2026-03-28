# HelloWork — Plan 1: 脚手架 + Node 服务 + 终端核心

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Electron + React 项目骨架，实现本地 Node.js 服务的 SSH 连接池、pty session 管理、端口转发和 WebSocket 通信，在 app 中渲染一个可用的 xterm.js 终端并连接到真实远程机器。

**Architecture:** Main 进程 spawn 本地 Node.js 服务子进程，服务暴露 WebSocket 接口；Renderer（React）通过 WebSocket 创建终端 session 并双向传输数据；xterm.js 使用 WebGL renderer 渲染。

**Tech Stack:** Electron 28+、React 18、TypeScript 5、electron-vite、ssh2、xterm.js + xterm-addon-webgl、ws、Vitest

---

## 文件结构

```
hellowork/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json, tsconfig.node.json, tsconfig.web.json
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   └── service-manager.ts
│   ├── preload/
│   │   └── index.ts
│   ├── service/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── ssh/
│   │   │   ├── connection-pool.ts
│   │   │   ├── session.ts
│   │   │   └── tunnel.ts
│   │   └── store/
│   │       └── machines.ts
│   └── renderer/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── store/service.ts
│       └── components/terminal/
│           ├── TerminalPane.tsx
│           └── useTerminalWs.ts
└── tests/service/
    ├── connection-pool.test.ts
    ├── session.test.ts
    └── tunnel.test.ts
```

---

## Task 1: 初始化项目 ✅ DONE

---

## Task 2: 定义 WebSocket 消息类型

**Files:** Create `src/service/types.ts`

- [ ] Create the types file with ClientMessage, ServerMessage, MachineConfig
- [ ] Commit: `git commit -m "feat: define WebSocket message types and MachineConfig"`

---

## Task 3: 机器配置持久化（machines store）

**Files:** Create `src/service/store/machines.ts`, `tests/service/machines.test.ts`

- [ ] Write failing test
- [ ] Run test to confirm FAIL
- [ ] Implement MachinesStore
- [ ] Run test to confirm PASS
- [ ] Commit

---

## Task 4: SSH 连接池

**Files:** Create `src/service/ssh/connection-pool.ts`, `tests/service/connection-pool.test.ts`

- [ ] Write failing test (mock ssh2)
- [ ] Run to confirm FAIL
- [ ] Implement ConnectionPool
- [ ] Run to confirm PASS
- [ ] Commit

---

## Task 5: PTY Session 管理

**Files:** Create `src/service/ssh/session.ts`, `tests/service/session.test.ts`

- [ ] Write failing test
- [ ] Run to confirm FAIL
- [ ] Implement SessionManager with 16ms batching
- [ ] Run to confirm PASS
- [ ] Commit

---

## Task 6: SSH 端口转发（Tunnel）

**Files:** Create `src/service/ssh/tunnel.ts`, `tests/service/tunnel.test.ts`

- [ ] Write failing test
- [ ] Run to confirm FAIL
- [ ] Implement TunnelManager
- [ ] Run to confirm PASS
- [ ] Commit

---

## Task 7: 本地 Node 服务 WebSocket 入口

**Files:** Create `src/service/index.ts`

- [ ] Implement service entry point integrating pool/sessions/tunnels
- [ ] Commit

---

## Task 8: Electron 主进程

**Files:** Modify `src/main/index.ts`, Create `src/main/service-manager.ts`, `src/preload/index.ts`

- [ ] Implement ServiceManager (spawn service subprocess)
- [ ] Modify main/index.ts
- [ ] Create preload/index.ts with contextBridge
- [ ] Verify service port returned via IPC
- [ ] Commit

---

## Task 9: Renderer WebSocket store

**Files:** Create `src/renderer/store/service.ts`

- [ ] Implement Zustand store with WebSocket auto-reconnect
- [ ] Update App.tsx to connect on mount
- [ ] Commit

---

## Task 10: xterm.js 终端组件

**Files:** Create `src/renderer/components/terminal/TerminalPane.tsx`, `useTerminalWs.ts`

- [ ] Implement useTerminalWs hook
- [ ] Implement TerminalPane with WebGL renderer
- [ ] Add machine config to ~/.hellowork/machines.json
- [ ] Update App.tsx to render terminal
- [ ] Verify terminal works end-to-end
- [ ] Commit

---

## Task 11: 全량测试验证

- [ ] Run all unit tests
- [ ] Manual e2e verification
- [ ] Final commit

---

## 完成标准

Plan 1 完成时，app 可以：
- 从 `~/.hellowork/machines.json` 读取机器配置
- SSH 连接到远程机器（Key 认证）
- 在 Electron 窗口中显示可交互的 xterm 终端（WebGL 渲染）
- 终端输入/输出正常，resize 正常，16ms 批量输出无卡顿
- 所有单元测试通过

## 延期到 Plan 2 的内容

| 功能 | 原因 |
|---|---|
| 完整 React UI（机器管理页、多 Tab、分屏） | 依赖 Plan 1 的 WebSocket 骨架 |
| 端口预览 + Chrome DevTools | 依赖稳定的 tunnel 实现 |
| macOS Keychain（keytar）密码存储 | 密码认证流程 |
| SSH Host Key 验证（known_hosts） | 安全强化层 |
| 资源限制（最大 session 数、空闲超时） | 稳定性优化层 |
| WebSocket 二进制帧（替换 JSON） | 性能优化，JSON 够用于验证阶段 |
