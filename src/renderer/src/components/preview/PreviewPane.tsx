// src/renderer/src/components/preview/PreviewPane.tsx
import { useRef, useState, useEffect } from 'react'
import { useServiceStore } from '../../store/service'
import { toast } from '../common/Toast'

export function PreviewPane() {
  const [portInput, setPortInput] = useState('')
  const [tunnelId, setTunnelId] = useState<string | null>(null)
  const [localPort, setLocalPort] = useState<number | null>(null)
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null)
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const { send, onMessage } = useServiceStore()
  const [machineOptions, setMachineOptions] = useState<Array<{id: string, name: string}>>([])

  useEffect(() => {
    const unsub = onMessage((msg) => {
      if (msg.type === 'machine:list:result') {
        setMachineOptions(msg.machines.map((m: any) => ({ id: m.id, name: m.name })))
      }
      if (msg.type === 'tunnel:opened') {
        setTunnelId(msg.tunnelId)
        setLocalPort(msg.localPort)
      }
      if (msg.type === 'tunnel:error') {
        toast.error(`端口转发失败：${msg.message}`)
      }
    })
    send({ type: 'machine:list' })
    return unsub
  }, [onMessage, send])

  const handleOpen = () => {
    const port = parseInt(portInput)
    if (!port || port < 1 || port > 65535) {
      toast.error('请输入有效端口（1-65535）')
      return
    }
    if (!activeMachineId) {
      toast.error('请选择机器')
      return
    }
    if (tunnelId) send({ type: 'tunnel:close', tunnelId })
    send({ type: 'tunnel:open', machineId: activeMachineId, remotePort: port })
  }

  const handleClose = () => {
    if (tunnelId) send({ type: 'tunnel:close', tunnelId })
    setTunnelId(null)
    setLocalPort(null)
  }

  const handleOpenDevTools = () => {
    (webviewRef.current as any)?.openDevTools()
  }

  const handleRefresh = () => {
    (webviewRef.current as any)?.reload()
  }

  const selectStyle: React.CSSProperties = {
    background: '#1e1e1e', border: '1px solid #3e3e3e', borderRadius: 4,
    color: '#ccc', fontSize: 12, padding: '4px 8px', outline: 'none'
  }
  const inputStyle: React.CSSProperties = {
    ...selectStyle, width: 80
  }
  const btnStyle: React.CSSProperties = {
    background: '#0e639c', border: 'none', borderRadius: 4,
    color: '#fff', fontSize: 12, padding: '4px 12px', cursor: 'pointer'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        background: '#252526', borderBottom: '1px solid #1e1e1e', flexShrink: 0
      }}>
        <select
          style={selectStyle}
          value={activeMachineId ?? ''}
          onChange={e => setActiveMachineId(e.target.value || null)}
        >
          <option value="">选择机器</option>
          {machineOptions.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <span style={{ color: '#888', fontSize: 12 }}>:</span>
        <input
          style={inputStyle}
          value={portInput}
          onChange={e => setPortInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleOpen()}
          placeholder="3000"
        />
        <button style={btnStyle} onClick={handleOpen}>预览</button>
        {localPort && (
          <>
            <button
              style={{ ...btnStyle, background: 'none', border: '1px solid #3e3e3e', color: '#ccc' }}
              onClick={handleRefresh}
            >刷新</button>
            <button
              style={{ ...btnStyle, background: 'none', border: '1px solid #3e3e3e', color: '#ccc' }}
              onClick={handleOpenDevTools}
            >DevTools</button>
            <button
              style={{ ...btnStyle, background: 'none', border: '1px solid #3e3e3e', color: '#888' }}
              onClick={handleClose}
            >关闭</button>
          </>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {localPort ? (
          <webview
            ref={webviewRef as any}
            src={`http://localhost:${localPort}`}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#555', fontSize: 13
          }}>
            选择机器和端口后点击预览
          </div>
        )}
      </div>
    </div>
  )
}
