import { spawn, ChildProcess } from 'child_process'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { EventEmitter } from 'events'
import { ITransport, IShell, TransportOpts } from './ITransport'
import { MachineConfig } from '../types'

const execFileAsync = promisify(execFile)

// Check Homebrew paths first — Electron subprocesses don't inherit shell PATH
const MOSH_PATHS = [
  '/opt/homebrew/bin/mosh',  // Apple Silicon
  '/usr/local/bin/mosh',     // Intel Mac
]

async function findMoshBinary(): Promise<string | null> {
  for (const p of MOSH_PATHS) {
    if (existsSync(p)) return p
  }
  // Fallback: try via launchctl getenv PATH (same pattern as getSshAuthSock)
  try {
    const { stdout } = await execFileAsync('launchctl', ['getenv', 'PATH'])
    const paths = stdout.trim().split(':')
    for (const dir of paths) {
      const candidate = `${dir}/mosh`
      if (existsSync(candidate)) return candidate
    }
  } catch { /* ignore */ }
  return null
}

export class MoshTransport extends EventEmitter implements ITransport {
  readonly name = 'mosh' as const
  private process: ChildProcess | null = null
  private binaryPath: string | null = null

  async isAvailable(_machine: MachineConfig): Promise<boolean> {
    this.binaryPath = await findMoshBinary()
    return this.binaryPath !== null
  }

  async connect(machine: MachineConfig, _opts: TransportOpts): Promise<void> {
    if (!this.binaryPath) throw new Error('mosh binary not found')
    const port = machine.port ?? 22
    const args = [`--ssh=ssh -p ${port}`, `${machine.username}@${machine.host}`]
    this.process = spawn(this.binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.process?.kill()
        reject(new Error('mosh connect timeout'))
      }, 30000)

      // Mosh outputs to stdout when connected
      this.process!.stdout!.once('data', () => {
        clearTimeout(timeout)
        // TODO: This connect heuristic (first stdout data) is imprecise —
        // mosh's UDP session may not be established yet at this point.
        resolve()
      })

      this.process!.once('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      this.process!.once('exit', (code) => {
        clearTimeout(timeout)
        if (code !== 0 && code !== null) {
          reject(new Error(`mosh exited with code ${code}`))
        }
      })
    }).then(() => {
      // After connect resolves, listen for process exit to emit transport:disconnected
      this.process?.once('exit', () => this.emit('transport:disconnected'))
    })
  }

  async createShell(onData: (data: string) => void): Promise<IShell> {
    if (!this.process) throw new Error('MoshTransport not connected')
    this.process.stdout!.on('data', (chunk: Buffer) => onData(chunk.toString()))
    return {
      write: (data) => { this.process?.stdin?.write(data) },
      resize: (_cols, _rows) => { /* mosh handles resize via SIGWINCH internally */ },
      close: () => { this.process?.kill() },
    }
  }

  disconnect(): void {
    this.process?.kill()
    this.process = null
  }
}
