// src/service/ssh/session.ts
import { Client, ClientChannel } from 'ssh2'
import { randomUUID } from 'crypto'

type DataCallback = (sessionId: string, data: string) => void

interface SessionEntry {
  stream: ClientChannel
  machineId: string
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>()

  create(client: Client, machineId: string, onData: DataCallback): Promise<string> {
    return new Promise((resolve, reject) => {
      const sessionId = `sess-${randomUUID()}`
      client.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
        if (err) return reject(err)

        // 批量缓冲：积累 16ms 后一次性发送，减少 WebSocket 消息频率
        let buffer = ''
        let flushTimer: ReturnType<typeof setTimeout> | null = null
        const flush = () => {
          if (buffer) {
            onData(sessionId, buffer)
            buffer = ''
          }
          flushTimer = null
        }

        stream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8')
          if (!flushTimer) flushTimer = setTimeout(flush, 16)
        })

        stream.stderr.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8')
          if (!flushTimer) flushTimer = setTimeout(flush, 16)
        })

        stream.on('close', () => {
          if (flushTimer) clearTimeout(flushTimer)
          flush()
          this.sessions.delete(sessionId)
        })

        this.sessions.set(sessionId, { stream, machineId })
        resolve(sessionId)
      })
    })
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.stream.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.stream.setWindow(rows, cols, 0, 0)
  }

  close(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.stream.destroy()
    this.sessions.delete(sessionId)
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  closeAll(): void {
    for (const [id] of this.sessions) this.close(id)
  }

  closeForMachine(machineId: string): void {
    for (const [id, entry] of this.sessions) {
      if (entry.machineId === machineId) this.close(id)
    }
  }
}
