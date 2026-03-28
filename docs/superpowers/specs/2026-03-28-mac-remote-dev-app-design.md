# HelloWork — Mac 远程开发工具设计文档

**日期：** 2026-03-28
**状态：** 已批准
**技术栈：** Electron + React + TypeScript + Node.js

---

## 1. 项目概述

HelloWork 是一个 macOS 桌面应用，用于通过 Tailscale 网络远程连接家用电脑进行代码开发。核心功能：

- 管理多台远程机器的 SSH 连接
- 多终端（Tab + 分屏）操作远程 shell
- 映射远程端口到本地，在 app 内预览开发页面并使用 Chrome DevTools 调试

---

## 2. 整体架构

采用 **Electron 主进程 + 独立本地 Node.js 服务** 方案，三层职责分离：

```
┌─────────────────────────────────────────────┐
│              Electron App (macOS)            │
│                                             │
│  ┌─────────────────┐   ┌─────────────────┐  │
│  │  Renderer进程   │   │    Main进程      │  │
│  │  (React UI)     │◄──►  (IPC Bridge)   │  │
│  └─────────────────┘   └────────┬────────┘  │
└───────────────────────────────┼─────────────┘
                                │ spawn
                    ┌───────────▼───────────┐
                    │  本地 Node.js 服务     │
                    │  (localhost:随机端口)  │
                    │                       │
                    │  - SSH连接池管理       │
                    │  - 端口转发(tunnel)    │
                    │  - WebSocket 推流      │
                    └───────────┬───────────┘
                                │ SSH over Tailscale
                    ┌───────────▼───────────┐
                    │     远程电脑           │
                    │  (Tailscale 网络)      │
                    └───────────────────────┘
```

**各层职责：**

| 层 | 职责 |
|---|---|
| Renderer（React） | 纯 UI 渲染，不直接接触 SSH |
| Main 进程 | 启动/停止本地 Node 服务，管理 Electron 窗口、系统托盘 |
| 本地 Node 服务 | SSH 连接池、pty session、端口转发，通过 WebSocket 与 Renderer 通信 |

**选择此方案的原因：** SSH 是长连接且容易出现网络抖动，隔离在独立进程中可保证 UI 始终响应；多 SSH 连接并发时互不干扰。

---

## 3. 性能保障

### 3.1 终端渲染

**卡顿根源：** 终端大量输出（如 `cat` 大文件、`npm install` 日志）时，频繁 DOM 操作会导致掉帧。

- xterm.js 启用 **WebGL renderer**（GPU 加速），渲染完全绕过 DOM，帧率稳定
- 对高频输出启用 **批量写入**：Node 服务端收到 ssh2 数据后，累积 16ms（约 1 帧）再通过 WebSocket 发出，合并小包，减少渲染调用次数
- 终端历史上限 10,000 行，超出自动丢弃头部，防止内存无限增长

### 3.2 数据传输抖动

**抖动根源：** WebSocket 消息量忽大忽小，导致 UI 渲染节奏不稳定。

- 终端数据走 **二进制 WebSocket 帧**，跳过 JSON 序列化开销
- Node 服务与 Renderer 之间的 WebSocket 保持常驻，不因网络抖动重建（与 SSH 连接的 keepalive 解耦）
- 若 Node 服务与 Renderer 的 WebSocket 断开（app 内部），自动立即重连，不影响 SSH 会话

### 3.3 多终端并发

**卡顿根源：** 多个终端同时有大量输出时互相抢占主线程。

- 每个终端 session 使用**独立 WebSocket 连接**，服务端各自 pipe，互不阻塞
- React 侧：非活跃 Tab 的终端组件**暂停渲染**（`display:none` + 停止写入 xterm），切回时补全缓冲区内容
- 分屏时所有可见终端正常渲染，但写入频率做优先级调度（活跃光标终端优先）

### 3.4 端口预览

**卡顿根源：** webview 内页面 JS 密集运算可能拖累宿主 UI。

- `<webview>` 运行在**独立 Chromium 渲染进程**，与终端 UI 进程完全隔离
- SSH tunnel 在本地 Node 服务中维护，webview 直连 `localhost:本地端口`，延迟等同本地请求
- DevTools 窗口独立弹出，不与终端共享渲染帧

### 3.5 React UI

- Zustand store 按 machineId/sessionId 细粒度切片，状态变更只触发相关组件重渲染
- Sidebar 机器列表、Tab 栏用 `React.memo`，连接状态轮询不触发终端重渲染
- 所有拖动调整（分屏比例、预览区高度）使用 `pointer` 事件 + `requestAnimationFrame`，不走 React 状态更新

---

## 4. 核心模块划分

```
src/
├── main/                      # Electron 主进程
│   ├── index.ts               # 入口，窗口创建
│   ├── service-manager.ts     # 启动/停止本地 Node 服务
│   └── tray.ts                # 系统托盘
│
├── service/                   # 本地 Node.js 服务（独立进程）
│   ├── index.ts               # HTTP + WebSocket 服务入口
│   ├── types.ts               # 共享消息类型定义
│   ├── ssh/
│   │   ├── connection-pool.ts # SSH 连接池，管理多台远程机器
│   │   ├── session.ts         # 单个终端 session（pty）
│   │   └── tunnel.ts          # 端口转发管理
│   └── store/
│       └── machines.ts        # 远程机器配置持久化（JSON）
│
└── renderer/                  # React UI
    ├── app.tsx
    ├── pages/
    │   ├── machines/          # 连接管理（机器列表、新增、编辑）
    │   ├── workspace/         # 主工作区（终端 + 预览）
    │   └── settings/          # 全局设置
    └── components/
        ├── terminal/          # xterm.js 封装，支持 Tab + 分屏
        ├── preview/           # webview 封装，端口预览 + DevTools
        └── sidebar/           # 机器列表、session 列表
```

**核心数据流：**
```
用户输入 → xterm.js → WebSocket → Node服务 → ssh2(pty) → 远程shell
远程输出 → ssh2(stream) → WebSocket → xterm.js → 屏幕渲染
```

---

## 5. UI 布局

```
┌─────────────────────────────────────────────────────────┐
│  ● ● ●   HelloWork                              [_][□][×]│
├──────────┬──────────────────────────────────────────────┤
│          │  [Terminal 1] [Terminal 2] [+]    [⊞分屏]    │
│  机器列表 ├──────────────────────────────────────────────┤
│          │                                              │
│  ● 家用  │                                              │
│    Mac   │           终端内容区域                        │
│    Pro   │           (xterm.js / WebGL)                 │
│          │                                              │
│  ● 家用  │                                              │
│    PC    ├──────────────────────────────────────────────┤
│          │  端口预览  [:3000]  [打开DevTools]  [刷新]    │
│  [+ 添加]├──────────────────────────────────────────────┤
│          │                                              │
│          │        webview (Chromium)                    │
│          │        http://localhost:xxxx                 │
│          │                                              │
└──────────┴──────────────────────────────────────────────┘
```

**布局说明：**
- **左侧 Sidebar**：远程机器列表，显示连接状态（在线/离线/连接中），点击切换目标
- **上方终端区**：Tab 切换 + 分屏按钮，支持水平/垂直分割
- **下方预览区**：输入端口号展示页面，可拖动调整高度比例，可折叠
- **DevTools**：点击按钮打开 Chrome 调试面板（CDP）

---

## 6. 连接管理 & 数据持久化

### 机器配置结构

```typescript
interface Machine {
  id: string
  name: string           // 显示名称，如"家用 Mac Pro"
  host: string           // Tailscale IP 或 hostname
  port: number           // SSH 端口，默认 22
  username: string
  auth: {
    type: 'password' | 'key'
    password?: string    // 加密存储于 macOS Keychain
    keyPath?: string     // SSH 私钥路径（引用，不复制内容）
  }
}
```

### 安全性
- 密码不存明文 JSON，写入 **macOS Keychain**，JSON 只存 reference key
- SSH Key 只存路径引用，私钥内容不离开文件系统

### 连接生命周期

```
选择机器 → 建立SSH连接 → 连接池注册
    ↓
打开终端 → 复用连接创建新 pty session
    ↓
开启端口预览 → 在已有连接上建立 SSH tunnel
    ↓
关闭所有 session → 连接池自动释放 SSH 连接
```

**多机器并发：** 连接池支持同时维护多台机器的 SSH 连接，切换机器时无需重连，已有 session 保持运行。

---

## 7. SSH 连接韧性

**断线处理：**
- SSH 连接维持 keepalive（每 30s 发送一次），检测网络中断
- 连接断开时，UI 立即显示"已断开"状态，终端 session 保留历史输出
- 提供"重新连接"按钮，手动触发重连；不自动重连（避免循环卡死）
- 重连成功后，pty session 需要用户手动重启（SSH 特性限制）

**超时策略：**
- 连接建立超时：15s
- keepalive 无响应超时：60s 后标记连接断开

**错误反馈：**
| 错误场景 | UI 表现 |
|---|---|
| 连接超时 | 侧边栏机器变红 + Toast 提示 |
| 认证失败 | 弹窗提示"密码/Key 错误" |
| 远程机器离线 | 侧边栏显示灰色离线状态 |
| 端口 tunnel 建立失败 | 预览区显示错误信息 |

---

## 8. 安全补充

**SSH 主机验证（Host Key）：**
- 首次连接时，弹窗展示主机指纹，用户确认后写入 `~/.hellowork/known_hosts`
- 后续连接自动比对，指纹不匹配时拒绝连接并警告

**Tailscale 前提：**
- app 本身不管理 Tailscale，要求用户已在 macOS 上安装并登录 Tailscale
- 机器地址填写 Tailscale IP（如 `100.x.x.x`）或 MagicDNS hostname

**SSH Key 口令（Passphrase）：**
- 若私钥有口令保护，首次使用时弹窗输入，解密后存入 Keychain 供复用

---

## 9. 本地服务通信协议

**服务启动：** Main 进程 spawn 子进程运行 `service/index.js`，随机分配端口，通过 stdout 返回端口号后 Renderer 建立 WebSocket。

**WebSocket 消息格式（JSON）：**

```typescript
// 客户端 → 服务端
{ type: 'terminal:input', sessionId: string, data: string }
{ type: 'terminal:resize', sessionId: string, cols: number, rows: number }
{ type: 'session:create', machineId: string }
{ type: 'session:close', sessionId: string }
{ type: 'tunnel:open', machineId: string, remotePort: number }
{ type: 'tunnel:close', tunnelId: string }

// 服务端 → 客户端
{ type: 'terminal:output', sessionId: string, data: string }
{ type: 'session:created', sessionId: string }
{ type: 'session:error', sessionId: string, message: string }
{ type: 'tunnel:opened', tunnelId: string, localPort: number }
{ type: 'tunnel:error', tunnelId: string, message: string }
{ type: 'connection:status', machineId: string, status: 'connected'|'disconnected'|'error', message?: string }
```

---

## 10. 资源限制

- 单台机器最多 10 个并发终端 session
- 全局最多 5 个并发 SSH tunnel
- 空闲连接（无活跃 session）30 分钟后自动释放
- 终端历史输出最多保留 10,000 行（超出滚动丢弃）

---

## 11. 关键依赖

| 用途 | 库 |
|---|---|
| SSH 连接 | `ssh2` |
| 终端渲染 | `xterm.js` + `xterm-addon-webgl` |
| 状态管理 | `zustand` |
| UI 框架 | `React` + `TypeScript` |
| 构建工具 | `electron-vite` |
| 打包 | `electron-builder` |
| Keychain 访问 | `keytar` |

---

## 12. 不在本期范围内

- 远程 Agent 安装（方案 C）
- 自动端口扫描
- 多用户/团队共享
- 文件管理器（SFTP）
