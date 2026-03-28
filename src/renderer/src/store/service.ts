// src/renderer/store/service.ts
import { create } from 'zustand'

interface ServiceState {
  port: number | null
  ws: WebSocket | null
  connected: boolean
  connect: () => Promise<void>
  send: (msg: object) => void
  onMessage: (handler: (msg: any) => void) => () => void
}

export const useServiceStore = create<ServiceState>((set, get) => ({
  port: null,
  ws: null,
  connected: false,

  connect: async () => {
    const port = await (window as any).electronAPI.getServicePort()
    if (!port) return

    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.onopen = () => set({ connected: true, ws, port })
    ws.onclose = () => {
      set({ connected: false, ws: null })
      setTimeout(() => get().connect(), 1000)
    }
    ws.onerror = (err) => console.error('[ws] error', err)
  },

  send: (msg) => {
    const { ws } = get()
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  },

  onMessage: (handler) => {
    const { ws } = get()
    if (!ws) return () => {}
    const listener = (e: MessageEvent) => {
      try { handler(JSON.parse(e.data)) } catch {}
    }
    ws.addEventListener('message', listener)
    return () => ws.removeEventListener('message', listener)
  },
}))
