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

      client.shell(
        { term: 'xterm-256color', cols: 80, rows: 24, modes: { VERASE: 127 } },
        (err, stream) => {
          if (err) return reject(err)

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

          // Source all profile files then start an interactive login shell.
          // Explicitly load nvm/homebrew since they may skip init in non-interactive shells.
          const initCmd = [
            '[ -f /etc/profile ] && source /etc/profile 2>/dev/null',
            '[ -f ~/.bash_profile ] && source ~/.bash_profile 2>/dev/null',
            '[ -f ~/.zprofile ] && source ~/.zprofile 2>/dev/null',
            '[ -f ~/.zshrc ] && source ~/.zshrc 2>/dev/null',
            '[ -f ~/.bashrc ] && source ~/.bashrc 2>/dev/null',
            // Explicitly init nvm if present
            '[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" 2>/dev/null',
            '[ -s "$HOME/.nvm/bash_completion" ] && source "$HOME/.nvm/bash_completion" 2>/dev/null',
            'exec $SHELL',
          ].join('; ')
          stream.write(initCmd + '\n')
        }
      )
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
