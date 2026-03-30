// src/renderer/src/components/sidebar/MachineItem.tsx
import { memo, useState } from 'react'
import { MachineConfig } from '../../../../service/types'
import { useMachinesStore, ConnectionStatus } from '../../store/machines'
import { useWorkspaceStore } from '../../store/workspace'
import { toast } from '../common/Toast'

interface Props {
  machine: MachineConfig
  onEdit: (machine: MachineConfig) => void
}

const statusColors: Record<ConnectionStatus, string> = {
  disconnected: '#555',
  connecting: '#e5c07b',
  connected: '#4ec9b0',
  error: '#ff6b6b',
  reconnecting: '#e5c07b',
  failed: '#ff4444',
}
const statusLabels: Record<ConnectionStatus, string> = {
  disconnected: '未连接',
  connecting: '连接中...',
  connected: '已连接',
  error: '错误',
  reconnecting: '重新连接中...',
  failed: '连接失败',
}

export const MachineItem = memo(function MachineItem({ machine, onEdit }: Props) {
  const { statuses, errorMessages, connectMachine, disconnectMachine, deleteMachine, transports, machines, moshUnavailable, moshHintDismissed, dismissMoshHint } = useMachinesStore()
  const { addTab, addSplitTab, splitMode } = useWorkspaceStore()
  const status = statuses[machine.id] ?? 'disconnected'
  const errorMsg = errorMessages[machine.id]
  const transport = transports[machine.id]
  const isFirstMachine = machines[0]?.id === machine.id
  const [showMenu, setShowMenu] = useState(false)

  const handleConnect = async () => {
    let password: string | undefined
    let passphrase: string | undefined
    if (machine.auth.type === 'password' && machine.auth.keychainKey) {
      password = await window.electronAPI.keychain.get(machine.auth.keychainKey) ?? undefined
      if (!password) {
        toast.error('Keychain 中未找到密码，请重新编辑机器')
        return
      }
    } else if (machine.auth.type === 'key' && machine.auth.passphraseKeychainKey) {
      passphrase = await window.electronAPI.keychain.get(machine.auth.passphraseKeychainKey) ?? undefined
    }
    connectMachine(machine.id, password, passphrase)
  }

  const handleOpenTerminal = () => {
    if (status !== 'connected') {
      toast.error('请先连接机器')
      return
    }
    addTab(machine.id, machine.name)
  }

  return (
    <>
      {moshUnavailable && !moshHintDismissed && isFirstMachine && (
        <div style={{
          background: '#2a2d2e', border: '1px solid #3e3e3e', borderRadius: 4,
          padding: '6px 10px', margin: '4px 0', fontSize: 11, color: '#888',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <span>安装 mosh 可提升弱网连接稳定性 (brew install mosh)</span>
          <button
            onClick={dismissMoshHint}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}
          >✕</button>
        </div>
      )}
      <div
        style={{
          padding: '10px 12px', cursor: 'pointer', borderRadius: 6,
          display: 'flex', alignItems: 'center', gap: 8,
          position: 'relative',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#2a2d2e')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: statusColors[status], flexShrink: 0
        }} />

        <div style={{ flex: 1, minWidth: 0 }} onDoubleClick={handleOpenTerminal}>
          <div style={{ color: '#ccc', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>
            {machine.name}
            {status === 'connected' && transport && (
              <span style={{
                fontSize: 9, color: '#888', background: '#2a2d2e',
                border: '1px solid #3e3e3e', borderRadius: 3,
                padding: '1px 4px', marginLeft: 4, textTransform: 'uppercase'
              }}>
                {transport}
              </span>
            )}
          </div>
          <div style={{ color: status === 'error' ? '#ff6b6b' : '#666', fontSize: 11 }} title={errorMsg}>
            {status === 'error' && errorMsg ? errorMsg.slice(0, 30) : statusLabels[status]}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {status === 'disconnected' || status === 'error' ? (
            <button
              title="连接"
              onClick={handleConnect}
              style={{ background: 'none', border: 'none', color: '#569cd6', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
            >▶</button>
          ) : status === 'connected' ? (
            <>
              <button
                title="打开终端"
                onClick={handleOpenTerminal}
                style={{ background: 'none', border: 'none', color: '#4ec9b0', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}
              >⊞</button>
              {splitMode !== 'none' && (
                <button
                  title="在分屏中打开"
                  onClick={() => addSplitTab(machine.id, machine.name)}
                  style={{ background: 'none', border: 'none', color: '#9cdcfe', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}
                >⊟</button>
              )}
              <button
                title="断开"
                onClick={() => disconnectMachine(machine.id)}
                style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
              >⏹</button>
            </>
          ) : status === 'reconnecting' ? (
            <>
              <span style={{ color: '#e5c07b', fontSize: 12, animation: 'spin 1s linear infinite' }}>↻</span>
              <span style={{ color: '#e5c07b', fontSize: 11 }}>重新连接中</span>
              <button
                title="停止重连"
                onClick={() => disconnectMachine(machine.id)}
                style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
              >⏹</button>
            </>
          ) : status === 'failed' ? (
            <button
              title="重新连接"
              onClick={handleConnect}
              style={{ background: 'none', border: 'none', color: '#569cd6', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
            >▶</button>
          ) : null}
          <button
            title="更多"
            onClick={() => setShowMenu(v => !v)}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16, padding: '2px 4px' }}
          >⋯</button>
        </div>

        {showMenu && (
          <div
            style={{
              position: 'absolute', right: 8, top: '100%', zIndex: 100,
              background: '#252526', border: '1px solid #3e3e3e', borderRadius: 6,
              padding: 4, minWidth: 120
            }}
            onMouseLeave={() => setShowMenu(false)}
          >
            {[
              { label: '编辑', action: () => { onEdit(machine); setShowMenu(false) } },
              { label: '删除', action: async () => {
              if (machine.auth.type === 'password' && machine.auth.keychainKey) {
                await window.electronAPI.keychain.delete(machine.auth.keychainKey).catch(() => {})
              }
              if (machine.auth.type === 'key' && machine.auth.passphraseKeychainKey) {
                await window.electronAPI.keychain.delete(machine.auth.passphraseKeychainKey).catch(() => {})
              }
              deleteMachine(machine.id)
              setShowMenu(false)
            } },
            ].map(item => (
              <div
                key={item.label}
                onClick={item.action}
                style={{ padding: '6px 12px', color: '#ccc', fontSize: 13, cursor: 'pointer', borderRadius: 4 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#2a2d2e')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {item.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
})
