// src/renderer/src/components/common/Toast.tsx
import { useEffect, useState } from 'react'

interface ToastMessage {
  id: string
  message: string
  type: 'error' | 'info' | 'success'
}

const listeners = new Set<(msgs: ToastMessage[]) => void>()
let messages: ToastMessage[] = []

export const toast = {
  error: (message: string) => addToast(message, 'error'),
  info: (message: string) => addToast(message, 'info'),
  success: (message: string) => addToast(message, 'success'),
}

function addToast(message: string, type: ToastMessage['type']) {
  const id = Math.random().toString(36).slice(2)
  messages = [...messages, { id, message, type }]
  listeners.forEach(fn => fn(messages))
  setTimeout(() => {
    messages = messages.filter(m => m.id !== id)
    listeners.forEach(fn => fn(messages))
  }, 4000)
}

export function ToastContainer() {
  const [msgs, setMsgs] = useState<ToastMessage[]>([])

  useEffect(() => {
    const fn = (m: ToastMessage[]) => setMsgs([...m])
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])

  const colors = { error: '#ff6b6b', info: '#569cd6', success: '#4ec9b0' }

  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 2000, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {msgs.map(m => (
        <div key={m.id} style={{
          background: '#252526', border: `1px solid ${colors[m.type]}`,
          borderRadius: 6, padding: '10px 16px', color: colors[m.type],
          fontSize: 13, fontFamily: 'system-ui', maxWidth: 360,
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
        }}>
          {m.message}
        </div>
      ))}
    </div>
  )
}
