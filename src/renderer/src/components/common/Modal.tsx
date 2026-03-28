// src/renderer/src/components/common/Modal.tsx
import { ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ title, onClose, children, footer }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        background: '#252526', border: '1px solid #3e3e3e', borderRadius: 8,
        minWidth: 480, maxWidth: 560, padding: 0, overflow: 'hidden'
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 20px', borderBottom: '1px solid #3e3e3e'
        }}>
          <span style={{ color: '#ccc', fontWeight: 600, fontSize: 14 }}>{title}</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18, lineHeight: 1
          }}>×</button>
        </div>
        <div style={{ padding: '20px' }}>{children}</div>
        {footer && (
          <div style={{
            padding: '12px 20px', borderTop: '1px solid #3e3e3e',
            display: 'flex', justifyContent: 'flex-end', gap: 8
          }}>{footer}</div>
        )}
      </div>
    </div>
  )
}
