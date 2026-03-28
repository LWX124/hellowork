// src/renderer/src/components/terminal/TerminalPane.tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import { FitAddon } from '@xterm/addon-fit'
import { useServiceStore } from '../../store/service'
import { useTerminalWs } from './useTerminalWs'
import '@xterm/xterm/css/xterm.css'

interface Props {
  machineId: string
  isActive: boolean
}

export function TerminalPane({ machineId, isActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const pendingRef = useRef<string[]>([])
  const { sessionId, error, writeInput, resize } = useTerminalWs(machineId)
  const onMessage = useServiceStore(s => s.onMessage)

  useEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    })
    const webgl = new WebglAddon()
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(webgl)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    term.onData((data) => writeInput(data))

    const ro = new ResizeObserver(() => {
      if (fitRef.current && termRef.current) {
        fitRef.current.fit()
        resize(termRef.current.cols, termRef.current.rows)
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      webgl.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!sessionId) return
    const unsub = onMessage((msg) => {
      if (msg.type === 'terminal:output' && msg.sessionId === sessionId) {
        if (isActive && termRef.current) {
          termRef.current.write(msg.data)
        } else {
          // Buffer output while inactive
          pendingRef.current.push(msg.data)
        }
      }
    })
    return unsub
  }, [sessionId, isActive, onMessage])

  // Flush pending output when becoming active
  useEffect(() => {
    if (isActive && termRef.current && pendingRef.current.length > 0) {
      const pending = pendingRef.current.splice(0)
      for (const chunk of pending) {
        termRef.current.write(chunk)
      }
    }
  }, [isActive])

  if (error) {
    return (
      <div style={{ color: '#ff6b6b', padding: 16, fontFamily: 'monospace' }}>
        连接错误：{error}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: isActive ? 'block' : 'none',
        backgroundColor: '#1e1e1e',
      }}
    />
  )
}
