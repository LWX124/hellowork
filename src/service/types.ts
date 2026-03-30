// src/service/types.ts

export type ClientMessage =
  | { type: 'session:create'; machineId: string; requestId: string }
  | { type: 'session:close'; sessionId: string }
  | { type: 'terminal:input'; sessionId: string; data: string }
  | { type: 'terminal:resize'; sessionId: string; cols: number; rows: number }
  | { type: 'tunnel:open'; machineId: string; remotePort: number }
  | { type: 'tunnel:close'; tunnelId: string }
  // 机器管理
  | { type: 'machine:list' }
  | { type: 'machine:save'; machine: MachineConfig }
  | { type: 'machine:delete'; id: string }
  | { type: 'machine:connect'; machineId: string; password?: string; passphrase?: string }
  | { type: 'machine:disconnect'; machineId: string }
  // 主机指纹确认
  | { type: 'hostkey:approve'; machineId: string }
  | { type: 'hostkey:reject'; machineId: string }

export type ServerMessage =
  | { type: 'session:created'; sessionId: string; requestId: string }
  | { type: 'session:error'; sessionId: string; requestId: string; message: string }
  | { type: 'terminal:output'; sessionId: string; data: string }
  | { type: 'tunnel:opened'; tunnelId: string; localPort: number }
  | { type: 'tunnel:error'; tunnelId: string; message: string }
  | { type: 'connection:status'; machineId: string; status: 'connected' | 'disconnected' | 'connecting' | 'error' | 'reconnecting' | 'failed'; message?: string; transport?: 'ssh' | 'mosh' | 'ttyd' }
  // 机器管理
  | { type: 'machine:list:result'; machines: MachineConfig[] }
  | { type: 'machine:saved'; machine: MachineConfig }
  | { type: 'machine:deleted'; id: string }
  // 主机指纹验证
  | { type: 'hostkey:verify'; machineId: string; host: string; fingerprint: string }
  | { type: 'session:replaced'; oldSessionId: string; newSessionId: string; machineId: string }
  | { type: 'mosh:unavailable' }
  | { type: 'preview:probe:result'; url: string; via: 'direct' | 'tunnel' }

export interface MachineConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: {
    type: 'password' | 'key'
    keychainKey?: string       // for password auth
    keyPath?: string           // for key auth
    passphraseKeychainKey?: string  // for key auth with passphrase
  }
}
