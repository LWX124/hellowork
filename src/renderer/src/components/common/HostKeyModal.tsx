// src/renderer/src/components/common/HostKeyModal.tsx
import { useMachinesStore } from '../../store/machines'
import { Modal } from './Modal'

export function HostKeyModal() {
  const { pendingHostKey, approveHostKey, rejectHostKey } = useMachinesStore()
  if (!pendingHostKey) return null

  return (
    <Modal
      title="新主机连接确认"
      onClose={rejectHostKey}
      footer={
        <>
          <button
            onClick={rejectHostKey}
            style={{ padding: '8px 20px', background: 'none', border: '1px solid #3e3e3e', borderRadius: 4, color: '#888', cursor: 'pointer', fontSize: 13 }}
          >
            拒绝
          </button>
          <button
            onClick={approveHostKey}
            style={{ padding: '8px 20px', background: '#0e639c', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            信任并连接
          </button>
        </>
      }
    >
      <div style={{ color: '#ccc', fontSize: 13, lineHeight: 1.8 }}>
        <p style={{ margin: '0 0 12px', color: '#e5c07b' }}>
          ⚠ 首次连接到此主机，请确认指纹是否可信
        </p>
        <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '12px 16px', fontFamily: 'monospace' }}>
          <div><span style={{ color: '#888' }}>主机：</span>{pendingHostKey.host}</div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: '#888' }}>指纹：</span>
            <span style={{ color: '#4ec9b0', wordBreak: 'break-all' }}>{pendingHostKey.fingerprint}</span>
          </div>
        </div>
        <p style={{ margin: '12px 0 0', color: '#666', fontSize: 12 }}>
          信任后指纹将保存到 ~/.hellowork/known_hosts，后续连接自动验证。
        </p>
      </div>
    </Modal>
  )
}
