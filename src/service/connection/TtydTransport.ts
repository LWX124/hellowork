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
      return true // any response (including 4xx/5xx) means server is reachable
    } catch {
      return false
    }
  }

  async connect(machine: MachineConfig, _opts: TransportOpts): Promise<void> {
    // Attempt to start ttyd via short-lived SSH if not already running
    await this.tryStartTtyd(machine)

    const url = `ws://${machine.host}:${TTYD_PORT}/ws`
    this.ws = new WebSocket(url)

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws?.close()
        reject(new Error('ttyd connect timeout'))
      }, 10000)

      this.ws!.once('open', () => {
        clearTimeout(timeout)
        resolve()
      })
      this.ws!.once('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    }).then(() => {
      this.ws!.once('close', () => this.emit('transport:disconnected'))
    })
  }

  private async tryStartTtyd(machine: MachineConfig): Promise<void> {
    // Best-effort: start ttyd via short-lived SSH if SSH can connect
    // If SSH is unavailable, ttyd must already be running
    try {
      const { Client } = await import('ssh2')
      const client = new Client()
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { client.end(); resolve() }, 8000)
        client.on('ready', () => {
          client.exec("pgrep ttyd || nohup ttyd -p 7681 -W bash &>/dev/null &", (err, stream) => {
            if (!err) {
              stream.on('close', () => { clearTimeout(timeout); client.end(); resolve() })
            } else {
              clearTimeout(timeout)
              client.end()
              resolve()
            }
          })
        })
        client.on('error', () => { clearTimeout(timeout); resolve() })
        client.connect({
          host: machine.host,
          port: machine.port ?? 22,
          username: machine.username,
          readyTimeout: 5000,
        })
      })
    } catch { /* ignore */ }
  }

  async createShell(onData: (data: string) => void): Promise<IShell> {
    if (!this.ws) throw new Error('TtydTransport not connected')
    // ttyd WebSocket protocol: '0' prefix = input, '1' prefix = output data
    this.ws.on('message', (raw: Buffer | string) => {
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
