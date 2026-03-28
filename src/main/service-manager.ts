// src/main/service-manager.ts
import { ChildProcess, fork } from 'child_process'
import { join } from 'path'
import { app } from 'electron'

export class ServiceManager {
  private proc: ChildProcess | null = null
  private _port: number | null = null

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const isDev = !app.isPackaged
      const servicePath = isDev
        ? join(__dirname, '../../src/service/index.ts')
        : join(process.resourcesPath, 'service/index.js')

      const execArgv = isDev ? ['--import', 'tsx/esm'] : []

      this.proc = fork(servicePath, [], {
        execArgv,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env },
      })

      this.proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        const match = text.match(/PORT:(\d+)/)
        if (match && !this._port) {
          this._port = parseInt(match[1])
          resolve(this._port)
        }
      })

      this.proc.stderr?.on('data', (chunk: Buffer) => {
        console.error('[service]', chunk.toString())
      })

      this.proc.on('error', reject)
      this.proc.on('exit', (code) => {
        if (code !== 0 && !this._port) reject(new Error(`Service exited with code ${code}`))
      })

      setTimeout(() => {
        if (!this._port) reject(new Error('Service start timeout'))
      }, 10000)
    })
  }

  get port(): number | null {
    return this._port
  }

  stop(): void {
    this.proc?.kill('SIGTERM')
    this.proc = null
    this._port = null
  }
}
