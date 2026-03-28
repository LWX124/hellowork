// src/service/types.ts

// 客户端 → 服务端
export type ClientMessage =
  | { type: 'session:create'; machineId: string }
  | { type: 'session:close'; sessionId: string }
  | { type: 'terminal:input'; sessionId: string; data: string }
  | { type: 'terminal:resize'; sessionId: string; cols: number; rows: number }
  | { type: 'tunnel:open'; machineId: string; remotePort: number }
  | { type: 'tunnel:close'; tunnelId: string }

// 服务端 → 客户端
export type ServerMessage =
  | { type: 'session:created'; sessionId: string }
  | { type: 'session:error'; sessionId: string; message: string }
  | { type: 'terminal:output'; sessionId: string; data: string }
  | { type: 'tunnel:opened'; tunnelId: string; localPort: number }
  | { type: 'tunnel:error'; tunnelId: string; message: string }
  | { type: 'connection:status'; machineId: string; status: 'connected' | 'disconnected' | 'error'; message?: string }

export interface MachineConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: {
    type: 'password' | 'key'
    keychainKey?: string  // reference key，不存明文密码
    keyPath?: string
  }
}
