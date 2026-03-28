// src/renderer/src/components/machines/MachineForm.tsx
import { useState } from 'react'
import { Modal } from '../common/Modal'
import { useMachinesStore } from '../../store/machines'
import { MachineConfig } from '../../../../service/types'
import { toast } from '../common/Toast'

interface Props {
  machine?: MachineConfig
  onClose: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: '#1e1e1e',
  border: '1px solid #3e3e3e', borderRadius: 4, color: '#ccc',
  fontSize: 13, outline: 'none', boxSizing: 'border-box'
}
const labelStyle: React.CSSProperties = {
  display: 'block', color: '#888', fontSize: 12, marginBottom: 4
}
const fieldStyle: React.CSSProperties = { marginBottom: 14 }
const btnPrimary: React.CSSProperties = {
  padding: '8px 20px', background: '#0e639c', border: 'none',
  borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 13
}
const btnSecondary: React.CSSProperties = {
  padding: '8px 20px', background: 'none', border: '1px solid #3e3e3e',
  borderRadius: 4, color: '#888', cursor: 'pointer', fontSize: 13
}

export function MachineForm({ machine, onClose }: Props) {
  const { saveMachine } = useMachinesStore()
  const [name, setName] = useState(machine?.name ?? '')
  const [host, setHost] = useState(machine?.host ?? '')
  const [port, setPort] = useState(String(machine?.port ?? 22))
  const [username, setUsername] = useState(machine?.username ?? '')
  const [authType, setAuthType] = useState<'key' | 'password'>(machine?.auth.type ?? 'key')
  const [keyPath, setKeyPath] = useState(machine?.auth.keyPath ?? '~/.ssh/id_rsa')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim() || !host.trim() || !username.trim()) {
      toast.error('请填写名称、主机地址和用户名')
      return
    }
    setSaving(true)
    const id = machine?.id ?? crypto.randomUUID()

    if (authType === 'password' && password) {
      await window.electronAPI.keychain.set(id, password)
    }

    const config: MachineConfig = {
      id,
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port) || 22,
      username: username.trim(),
      auth: authType === 'key'
        ? { type: 'key', keyPath: keyPath.trim() }
        : { type: 'password', keychainKey: id }
    }

    saveMachine(config)
    setSaving(false)
    toast.success(`${name} 已保存`)
    onClose()
  }

  return (
    <Modal
      title={machine ? '编辑机器' : '添加机器'}
      onClose={onClose}
      footer={
        <>
          <button style={btnSecondary} onClick={onClose}>取消</button>
          <button style={btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </>
      }
    >
      <div style={fieldStyle}>
        <label style={labelStyle}>显示名称</label>
        <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="家用 Mac Pro" />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Tailscale IP / Hostname</label>
        <input style={inputStyle} value={host} onChange={e => setHost(e.target.value)} placeholder="100.x.x.x" />
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>用户名</label>
          <input style={inputStyle} value={username} onChange={e => setUsername(e.target.value)} placeholder="your-username" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>SSH 端口</label>
          <input style={inputStyle} value={port} onChange={e => setPort(e.target.value)} placeholder="22" />
        </div>
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>认证方式</label>
        <div style={{ display: 'flex', gap: 12 }}>
          {(['key', 'password'] as const).map(t => (
            <label key={t} style={{ color: '#ccc', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" value={t} checked={authType === t} onChange={() => setAuthType(t)} />
              {t === 'key' ? 'SSH Key' : '密码'}
            </label>
          ))}
        </div>
      </div>
      {authType === 'key' ? (
        <div style={fieldStyle}>
          <label style={labelStyle}>私钥路径</label>
          <input style={inputStyle} value={keyPath} onChange={e => setKeyPath(e.target.value)} placeholder="~/.ssh/id_rsa" />
        </div>
      ) : (
        <div style={fieldStyle}>
          <label style={labelStyle}>密码（将加密存储到 macOS Keychain）</label>
          <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="输入密码" />
        </div>
      )}
    </Modal>
  )
}
