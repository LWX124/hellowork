// src/renderer/src/components/common/PasswordModal.tsx
import { useState } from 'react'
import { Modal } from './Modal'
import { useMachinesStore } from '../../store/machines'

export function PasswordModal() {
  const { pendingPassword, submitPassword, cancelPassword } = useMachinesStore()
  const [password, setPassword] = useState('')

  if (!pendingPassword) return null

  const handleSubmit = () => {
    if (!password) return
    submitPassword(password)
    setPassword('')
  }

  return (
    <Modal
      title="需要密码"
      onClose={cancelPassword}
      footer={
        <>
          <button
            onClick={cancelPassword}
            style={{ padding: '8px 20px', background: 'none', border: '1px solid #3e3e3e', borderRadius: 4, color: '#888', cursor: 'pointer', fontSize: 13 }}
          >取消</button>
          <button
            onClick={handleSubmit}
            style={{ padding: '8px 20px', background: '#0e639c', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 13 }}
          >连接</button>
        </>
      }
    >
      <div style={{ color: '#ccc', fontSize: 13 }}>
        <p style={{ margin: '0 0 16px', color: '#888' }}>
          SSH Key 认证失败，请输入 <span style={{ color: '#ccc' }}>{pendingPassword.machineName}</span> 的登录密码
        </p>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="SSH 密码"
          style={{
            width: '100%', padding: '8px 10px', background: '#1e1e1e',
            border: '1px solid #3e3e3e', borderRadius: 4, color: '#ccc',
            fontSize: 13, outline: 'none', boxSizing: 'border-box'
          }}
        />
      </div>
    </Modal>
  )
}
