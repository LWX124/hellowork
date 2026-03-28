// src/service/store/machines.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { MachineConfig } from '../types'

export class MachinesStore {
  private filePath: string
  private machines: MachineConfig[] = []

  constructor(filePath: string) {
    this.filePath = filePath
    this.load()
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      this.machines = JSON.parse(readFileSync(this.filePath, 'utf-8'))
    } catch {
      this.machines = []
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.machines, null, 2))
  }

  getAll(): MachineConfig[] {
    return [...this.machines]
  }

  getById(id: string): MachineConfig | undefined {
    return this.machines.find(m => m.id === id)
  }

  save(machine: MachineConfig): void {
    const idx = this.machines.findIndex(m => m.id === machine.id)
    if (idx >= 0) {
      this.machines[idx] = machine
    } else {
      this.machines.push(machine)
    }
    this.persist()
  }

  delete(id: string): void {
    this.machines = this.machines.filter(m => m.id !== id)
    this.persist()
  }
}
