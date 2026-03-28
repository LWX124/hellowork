// src/renderer/src/components/terminal/useTerminalWs.ts
import { useEffect, useRef, useState } from 'react'
import { useServiceStore } from '../../store/service'

export function useTerminalWs(machineId: string) {
  const send = useServiceStore(s => s.send)
  const onMessage = useServiceStore(s => s.onMessage)
  const connected = useServiceStore(s => s.connected)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!connected || !machineId) return

    send({ type: 'session:create', machineId })

    const unsub = onMessage((msg) => {
      if (msg.type === 'session:created' && !sessionIdRef.current) {
        sessionIdRef.current = msg.sessionId
        setSessionId(msg.sessionId)
      }
      if (msg.type === 'session:error') {
        setError(msg.message)
      }
    })

    return () => {
      unsub()
      if (sessionIdRef.current) {
        send({ type: 'session:close', sessionId: sessionIdRef.current })
        sessionIdRef.current = null
        setSessionId(null)
      }
    }
  }, [connected, machineId])

  const writeInput = (data: string) => {
    if (sessionIdRef.current) send({ type: 'terminal:input', sessionId: sessionIdRef.current, data })
  }

  const resize = (cols: number, rows: number) => {
    if (sessionIdRef.current) send({ type: 'terminal:resize', sessionId: sessionIdRef.current, cols, rows })
  }

  return { sessionId, error, writeInput, resize }
}
