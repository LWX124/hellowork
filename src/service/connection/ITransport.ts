import { EventEmitter } from 'events'
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
