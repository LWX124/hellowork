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
