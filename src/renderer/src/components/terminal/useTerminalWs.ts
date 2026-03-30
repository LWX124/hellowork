// src/renderer/src/components/terminal/useTerminalWs.ts
import { useEffect, useRef, useState } from 'react'
import { useServiceStore } from '../../store/service'
import { useWorkspaceStore } from '../../store/workspace'

export function useTerminalWs(machineId: string, tabId: string) {
  const send = useServiceStore(s => s.send)
  const onMessage = useServiceStore(s => s.onMessage)
  const connected = useServiceStore(s => s.connected)
  const setTabSessionId = useWorkspaceStore(s => s.setTabSessionId)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [disconnected, setDisconnected] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  const requestIdRef = useRef<string>(crypto.randomUUID())

  useEffect(() => {
    if (!connected || !machineId) return

    const requestId = requestIdRef.current
    send({ type: 'session:create', machineId, requestId })

    const unsub = onMessage((msg) => {
      if (msg.type === 'session:created' && msg.requestId === requestId && !sessionIdRef.current) {
        sessionIdRef.current = msg.sessionId
        setSessionId(msg.sessionId)
        setTabSessionId(tabId, msg.sessionId)
      }
      if (msg.type === 'session:error' && msg.requestId === requestId) {
        setError(msg.message)
      }
      if (msg.type === 'connection:status' && msg.machineId === machineId) {
        if (msg.status === 'reconnecting') {
          // do NOT set disconnected = true
          // yellow message is written by ConnectionManager via terminal:output
        } else if (msg.status === 'disconnected' || msg.status === 'error' || msg.status === 'failed') {
          setDisconnected(true)
        }
      }
      if (msg.type === 'session:replaced' && msg.machineId === machineId) {
        sessionIdRef.current = msg.newSessionId
        setSessionId(msg.newSessionId)
        setTabSessionId(tabId, msg.newSessionId)
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

  return { sessionId, error, disconnected, writeInput, resize }
}
