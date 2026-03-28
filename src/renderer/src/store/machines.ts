// src/renderer/src/store/machines.ts
import { create } from 'zustand'
import { MachineConfig } from '../../../service/types'
import { useServiceStore } from './service'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface MachinesState {
  machines: MachineConfig[]
  statuses: Record<string, ConnectionStatus>
  pendingHostKey: { machineId: string; host: string; fingerprint: string } | null
  init: () => (() => void)
  saveMachine: (machine: MachineConfig) => void
  deleteMachine: (id: string) => void
  connectMachine: (machineId: string, password?: string) => void
  disconnectMachine: (machineId: string) => void
  approveHostKey: () => void
  rejectHostKey: () => void
}

export const useMachinesStore = create<MachinesState>((set, get) => ({
  machines: [],
  statuses: {},
  pendingHostKey: null,

  init: () => {
    const { send, onMessage } = useServiceStore.getState()

    const unsub = onMessage((msg) => {
      switch (msg.type) {
        case 'machine:list:result':
          set({ machines: msg.machines })
          break
        case 'machine:saved': {
          const machines = get().machines
          const idx = machines.findIndex(m => m.id === msg.machine.id)
          if (idx >= 0) {
            set({ machines: machines.map((m, i) => i === idx ? msg.machine : m) })
          } else {
            set({ machines: [...machines, msg.machine] })
          }
          break
        }
        case 'machine:deleted':
          set({ machines: get().machines.filter(m => m.id !== msg.id) })
          break
        case 'connection:status':
          set({ statuses: { ...get().statuses, [msg.machineId]: msg.status as ConnectionStatus } })
          break
        case 'hostkey:verify':
          set({ pendingHostKey: { machineId: msg.machineId, host: msg.host, fingerprint: msg.fingerprint } })
          break
      }
    })

    send({ type: 'machine:list' })
    return unsub
  },

  saveMachine: (machine) => {
    useServiceStore.getState().send({ type: 'machine:save', machine })
  },

  deleteMachine: (id) => {
    useServiceStore.getState().send({ type: 'machine:delete', id })
  },

  connectMachine: (machineId, password) => {
    set({ statuses: { ...get().statuses, [machineId]: 'connecting' } })
    useServiceStore.getState().send({ type: 'machine:connect', machineId, password })
  },

  disconnectMachine: (machineId) => {
    useServiceStore.getState().send({ type: 'machine:disconnect', machineId })
  },

  approveHostKey: () => {
    const { pendingHostKey } = get()
    if (!pendingHostKey) return
    useServiceStore.getState().send({ type: 'hostkey:approve', machineId: pendingHostKey.machineId })
    set({ pendingHostKey: null })
  },

  rejectHostKey: () => {
    const { pendingHostKey } = get()
    if (!pendingHostKey) return
    useServiceStore.getState().send({ type: 'hostkey:reject', machineId: pendingHostKey.machineId })
    set({
      pendingHostKey: null,
      statuses: { ...get().statuses, [pendingHostKey.machineId]: 'disconnected' },
    })
  },
}))
