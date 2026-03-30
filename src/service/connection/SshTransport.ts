import { EventEmitter } from 'events'
import { Client, ConnectConfig } from 'ssh2'
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { execSync } from 'child_process'
import { ITransport, IShell, TransportOpts } from './ITransport'
import { MachineConfig } from '../types'

const KNOWN_HOSTS = join(homedir(), '.hellowork', 'known_hosts')

function getSshAuthSock(): string | undefined {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK
  try {
    const sock = execSync('launchctl getenv SSH_AUTH_SOCK', { timeout: 1000 }).toString().trim()
    if (sock) return sock
  } catch {}
  return undefined
}

function getFingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64')
}

function isKnownHost(host: string, fingerprint: string): boolean {
  if (!existsSync(KNOWN_HOSTS)) return false
  const lines = readFileSync(KNOWN_HOSTS, 'utf-8').split('\n')
  return lines.some(line => line === `${host} ${fingerprint}`)
}

function saveKnownHost(host: string, fingerprint: string): void {
  mkdirSync(join(homedir(), '.hellowork'), { recursive: true })
  appendFileSync(KNOWN_HOSTS, `${host} ${fingerprint}\n`)
}

export class SshTransport extends EventEmitter implements ITransport {
  readonly name = 'ssh' as const
  private client: Client | null = null
  private stream: import('ssh2').ClientChannel | null = null

  async isAvailable(_machine: MachineConfig): Promise<boolean> {
    return true // SSH is always attempted first
  }

  async connect(machine: MachineConfig, _opts: TransportOpts): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = new Client()
      this.client = client

      const config: ConnectConfig = {
        host: machine.host,
        port: machine.port,
        username: machine.username,
        readyTimeout: 30000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 5,
      }

      // Auth setup
      if (machine.auth.type === 'key' && machine.auth.keyPath) {
        const keyPath = machine.auth.keyPath.replace('~', homedir())
        try {
          config.privateKey = readFileSync(keyPath)
        } catch {
          return reject(new Error(`Cannot read key: ${keyPath}`))
        }
        const agentSock = getSshAuthSock()
        if (agentSock) config.agent = agentSock
      } else {
        const agentSock = getSshAuthSock()
        if (agentSock) config.agent = agentSock
      }

      // Host key verification
      config.hostVerifier = (keyOrHash: Buffer | string, callback: (valid: boolean) => void) => {
        const keyBuf = Buffer.isBuffer(keyOrHash) ? keyOrHash : Buffer.from(keyOrHash as string, 'hex')
        const fingerprint = getFingerprint(keyBuf)
        if (isKnownHost(machine.host, fingerprint)) {
          callback(true)
        } else {
          // Auto-approve for now (ConnectionManager handles host key prompts separately)
          // In a full implementation, emit 'hostkey:verify' and wait
          saveKnownHost(machine.host, fingerprint)
          callback(true)
        }
      }

      client
        .on('ready', () => resolve())
        .on('error', (err) => {
          this.client = null
          reject(err)
        })
        .on('close', () => {
          this.client = null
          this.stream = null
          this.emit('transport:disconnected')
        })

      client.connect(config)
    })
  }

  async createShell(onData: (data: string) => void): Promise<IShell> {
    if (!this.client) throw new Error('SshTransport not connected')
    const client = this.client

    return new Promise((resolve, reject) => {
      client.shell(
        { term: 'xterm-256color', cols: 80, rows: 24, modes: { VERASE: 127 } },
        (err, stream) => {
          if (err) return reject(err)
          this.stream = stream

          let buffer = ''
          let flushTimer: ReturnType<typeof setTimeout> | null = null
          const flush = () => {
            if (buffer) { onData(buffer); buffer = '' }
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
            this.stream = null
          })

          // Source profile files like the existing SessionManager does
          const initCmd = [
            '[ -f /etc/profile ] && source /etc/profile 2>/dev/null',
            '[ -f ~/.bash_profile ] && source ~/.bash_profile 2>/dev/null',
            '[ -f ~/.zprofile ] && source ~/.zprofile 2>/dev/null',
            '[ -f ~/.zshrc ] && source ~/.zshrc 2>/dev/null',
            '[ -f ~/.bashrc ] && source ~/.bashrc 2>/dev/null',
            '[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" 2>/dev/null',
            '[ -s "$HOME/.nvm/bash_completion" ] && source "$HOME/.nvm/bash_completion" 2>/dev/null',
            'exec $SHELL',
          ].join('; ')
          stream.write(initCmd + '\n')

          resolve({
            write: (data) => stream.write(data),
            resize: (cols, rows) => stream.setWindow(rows, cols, 0, 0),
            close: () => stream.destroy(),
          })
        }
      )
    })
  }

  disconnect(): void {
    this.stream?.destroy()
    this.client?.end()
    this.stream = null
    this.client = null
  }

  getClient(): Client | null {
    return this.client
  }
}
