// src/renderer/src/components/preview/PreviewPane.tsx
import { useRef, useState, useEffect } from 'react'
import { useServiceStore } from '../../store/service'
import { useMachinesStore } from '../../store/machines'
import { toast } from '../common/Toast'

export function PreviewPane() {
  const [portInput, setPortInput] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [probeError, setProbeError] = useState(false)
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null)
  const [tunnelId, setTunnelId] = useState<string | null>(null)
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const { send, onMessage } = useServiceStore()
  const machines = useMachinesStore(s => s.machines)

  useEffect(() => {
    const unsub = onMessage((msg) => {
      if (msg.type === 'preview:probe:result') {
        if (msg.url) {
          setPreviewUrl(msg.url)
          setProbeError(false)
          setTunnelId(msg.via === 'tunnel' && msg.tunnelId ? msg.tunnelId : null)
        } else {
          setProbeError(true)
          setPreviewUrl(null)
          setTunnelId(null)
        }
      }
      if (msg.type === 'tunnel:error') {
        toast.error(`端口转发失败：${msg.message}`)
        setProbeError(true)
        setPreviewUrl(null)
        setTunnelId(null)
      }
    })
    return unsub
  }, [onMessage])

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
    setProbeError(false)
    send({ type: 'preview:probe', machineId: activeMachineId, remotePort: port })
  }

  const handleClose = () => {
    if (tunnelId) {
      send({ type: 'tunnel:close', tunnelId })
    }
    setPreviewUrl(null)
    setTunnelId(null)
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
          {machines.map(m => (
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
        {previewUrl && (
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
        {previewUrl ? (
          <webview
            ref={webviewRef as any}
            src={previewUrl}
            style={{ width: '100%', height: '100%' }}
          />
        ) : probeError ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#888', fontSize: 13, gap: 12
          }}>
            <span>无法访问预览地址</span>
            <button
              style={{ ...btnStyle }}
              onClick={() => { setProbeError(false); handleOpen() }}
            >重新打开</button>
          </div>
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
