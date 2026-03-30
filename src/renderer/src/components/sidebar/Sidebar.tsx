// src/renderer/src/components/sidebar/Sidebar.tsx
import { memo, useState } from 'react'
import { useMachinesStore } from '../../store/machines'
import { MachineItem } from './MachineItem'
import { MachineForm } from '../machines/MachineForm'
import { MachineConfig } from '../../../../service/types'

interface Props {
  onCollapse: () => void
}

export const Sidebar = memo(function Sidebar({ onCollapse }: Props) {
  const { machines } = useMachinesStore()
  const [showForm, setShowForm] = useState(false)
  const [editingMachine, setEditingMachine] = useState<MachineConfig | undefined>()

  const openAdd = () => { setEditingMachine(undefined); setShowForm(true) }
  const openEdit = (m: MachineConfig) => { setEditingMachine(m); setShowForm(true) }

  return (
    <div style={{
      width: 220, background: '#252526', borderRight: '1px solid #1e1e1e',
      display: 'flex', flexDirection: 'column', height: '100%', flexShrink: 0
    }}>
      <div style={{
        padding: '8px 8px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={onCollapse}
            title="折叠"
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14, padding: '2px 4px', lineHeight: 1 }}
          >☰</button>
          <span style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>机器</span>
        </div>
        <button
          onClick={openAdd}
          title="添加机器"
          style={{ background: 'none', border: 'none', color: '#569cd6', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}
        >+</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px' }}>
        {machines.length === 0 ? (
          <div style={{ color: '#555', fontSize: 12, padding: '16px 12px', textAlign: 'center' }}>
            点击 + 添加机器
          </div>
        ) : (
          machines.map(m => (
            <MachineItem key={m.id} machine={m} onEdit={openEdit} />
          ))
        )}
      </div>

      {showForm && (
        <MachineForm
          machine={editingMachine}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
})
