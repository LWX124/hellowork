// src/renderer/src/store/machines.ts
import { create } from 'zustand'
import { MachineConfig } from '../../../service/types'
import { useServiceStore } from './service'
import { useWorkspaceStore } from './workspace'
import { toast } from '../components/common/Toast'

// Track machines where we already tried the saved Keychain password (avoid infinite retry loop)
const triedKeychainPassword = new Set<string>()

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting' | 'failed'

interface MachinesState {
  machines: MachineConfig[]
  statuses: Record<string, ConnectionStatus>
  errorMessages: Record<string, string>
  transports: Record<string, 'ssh' | 'mosh' | 'ttyd'>
  pendingHostKey: { machineId: string; host: string; fingerprint: string } | null
  pendingPassword: { machineId: string; machineName: string } | null
  init: () => (() => void)
  saveMachine: (machine: MachineConfig) => void
  deleteMachine: (id: string) => void
  connectMachine: (machineId: string, password?: string, passphrase?: string) => void
  disconnectMachine: (machineId: string) => void
  approveHostKey: () => void
  rejectHostKey: () => void
  submitPassword: (password: string) => Promise<void>
  cancelPassword: () => void
}

export const useMachinesStore = create<MachinesState>((set, get) => ({
  machines: [],
  statuses: {},
  errorMessages: {},
  transports: {},
  pendingHostKey: null,
  pendingPassword: null,

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
        case 'connection:status': {
          const prev = get().statuses[msg.machineId]
          const newStatuses = { ...get().statuses, [msg.machineId]: msg.status as ConnectionStatus }
          const newErrors = { ...get().errorMessages }
          const newTransports = { ...get().transports }

          if (msg.status === 'reconnecting') {
            set({ statuses: newStatuses })
            break
          }

          if (msg.status === 'failed') {
            toast.error(`连接失败: ${msg.machineId}`)
            set({ statuses: newStatuses })
            break
          }

          if (msg.status === 'error') {
            const isAuthFailure = msg.message?.includes('authentication') || msg.message?.includes('All configured')
            if (isAuthFailure) {
              const machine = get().machines.find(m => m.id === msg.machineId)
              if (machine) {
                const keychainKey = `${msg.machineId}_fallback_password`
                if (!triedKeychainPassword.has(msg.machineId)) {
                  // First failure — try saved Keychain password silently, don't update status yet
                  window.electronAPI.keychain.get(keychainKey).then((saved) => {
                    if (saved) {
                      triedKeychainPassword.add(msg.machineId)
                      get().connectMachine(msg.machineId, saved)
                    } else {
                      // No saved password — show prompt and update status
                      set({
                        statuses: { ...get().statuses, [msg.machineId]: 'error' as ConnectionStatus },
                        pendingPassword: { machineId: msg.machineId, machineName: machine.name }
                      })
                    }
                  })
                } else {
                  // Keychain password also failed — clear it and prompt user
                  triedKeychainPassword.delete(msg.machineId)
                  window.electronAPI.keychain.delete(keychainKey).catch(() => {})
                  set({
                    statuses: { ...get().statuses, [msg.machineId]: 'error' as ConnectionStatus },
                    pendingPassword: { machineId: msg.machineId, machineName: machine.name }
                  })
                }
                break
              }
            }
            newErrors[msg.machineId] = msg.message ?? 'Connection failed'
            toast.error(`连接失败: ${msg.message ?? 'Connection failed'}`)
          } else {
            delete newErrors[msg.machineId]
          }

          if (msg.status === 'connected' && msg.transport) {
            newTransports[msg.machineId] = msg.transport
          }

          set({ statuses: newStatuses, errorMessages: newErrors, transports: newTransports })

          if (msg.status === 'connected' && prev !== 'connected') {
            triedKeychainPassword.delete(msg.machineId)
            const machine = get().machines.find(m => m.id === msg.machineId)
            if (machine) useWorkspaceStore.getState().addTab(machine.id, machine.name)
          }
          break
        }
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

  connectMachine: (machineId, password, passphrase) => {
    set({ statuses: { ...get().statuses, [machineId]: 'connecting' } })
    useServiceStore.getState().send({ type: 'machine:connect', machineId, password, passphrase })
  },

  disconnectMachine: (machineId) => {
    useServiceStore.getState().send({ type: 'machine:disconnect', machineId })
  },

  submitPassword: async (password) => {
    const { pendingPassword } = get()
    if (!pendingPassword) return
    // Save to Keychain for future connections
    const keychainKey = `${pendingPassword.machineId}_fallback_password`
    await window.electronAPI.keychain.set(keychainKey, password).catch(() => {})
    set({ pendingPassword: null })
    get().connectMachine(pendingPassword.machineId, password)
  },

  cancelPassword: () => {
    const { pendingPassword } = get()
    if (!pendingPassword) return
    set({
      pendingPassword: null,
      statuses: { ...get().statuses, [pendingPassword.machineId]: 'disconnected' },
    })
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
