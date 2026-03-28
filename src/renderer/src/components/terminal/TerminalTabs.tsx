// src/renderer/src/components/terminal/TerminalTabs.tsx
import { memo } from 'react'
import { TerminalTab } from '../../store/workspace'

interface Props {
  tabs: TerminalTab[]
  activeTabId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onSplit?: () => void
  showSplitButton?: boolean
}

export const TerminalTabs = memo(function TerminalTabs({ tabs, activeTabId, onSelect, onClose, onSplit, showSplitButton }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', background: '#252526',
      borderBottom: '1px solid #1e1e1e', height: 35, overflowX: 'auto', flexShrink: 0
    }}>
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 12px', height: '100%', cursor: 'pointer',
            borderRight: '1px solid #1e1e1e', flexShrink: 0,
            background: tab.id === activeTabId ? '#1e1e1e' : 'transparent',
            borderTop: tab.id === activeTabId ? '1px solid #569cd6' : '1px solid transparent',
          }}
        >
          <span style={{ color: '#ccc', fontSize: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tab.title}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onClose(tab.id) }}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}
          >×</button>
        </div>
      ))}

      {showSplitButton && onSplit && tabs.length > 0 && (
        <button
          onClick={onSplit}
          title="水平分屏"
          style={{ marginLeft: 'auto', marginRight: 8, background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14 }}
        >⊞</button>
      )}
    </div>
  )
})
