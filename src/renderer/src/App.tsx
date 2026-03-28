// src/renderer/src/App.tsx
import { useEffect, useRef } from 'react'
import { useServiceStore } from './store/service'
import { useMachinesStore } from './store/machines'
import { useWorkspaceStore } from './store/workspace'
import { Sidebar } from './components/sidebar/Sidebar'
import { TerminalPane } from './components/terminal/TerminalPane'
import { TerminalTabs } from './components/terminal/TerminalTabs'
import { SplitTerminal } from './components/terminal/SplitTerminal'
import { PreviewPane } from './components/preview/PreviewPane'
import { ToastContainer } from './components/common/Toast'
import { HostKeyModal } from './components/common/HostKeyModal'

export default function App() {
  const connectService = useServiceStore(s => s.connect)
  const serviceConnected = useServiceStore(s => s.connected)
  const initMachines = useMachinesStore(s => s.init)

  const {
    tabs, activeTabId, setActiveTab, closeTab,
    splitMode, splitTabs, activeSplitTabId, setActiveSplitTab, closeSplitTab, setSplitMode,
    previewVisible, togglePreview
  } = useWorkspaceStore()

  const previewPanelRef = useRef<HTMLDivElement>(null)
  const previewHeightRef = useRef(300)
  const isDraggingPreview = useRef(false)

  useEffect(() => { connectService() }, [])

  useEffect(() => {
    if (!serviceConnected) return
    const unsub = initMachines()
    return () => unsub?.()
  }, [serviceConnected])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingPreview.current || !previewPanelRef.current) return
      const parent = previewPanelRef.current.parentElement!
      const rect = parent.getBoundingClientRect()
      const newHeight = Math.min(Math.max(rect.bottom - e.clientY, 150), rect.height - 200)
      previewHeightRef.current = newHeight
      previewPanelRef.current.style.height = `${newHeight}px`
    }
    const onMouseUp = () => { isDraggingPreview.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [])

  const primaryPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TerminalTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTab}
        onClose={closeTab}
        showSplitButton
        onSplit={() => setSplitMode(splitMode === 'none' ? 'vertical' : 'none')}
      />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {tabs.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555', fontSize: 13 }}>
            在左侧选择机器，双击或点击 ⊞ 打开终端
          </div>
        ) : (
          tabs.map(tab => (
            <div key={tab.id} style={{ position: 'absolute', inset: 0, display: tab.id === activeTabId ? 'block' : 'none' }}>
              <TerminalPane tabId={tab.id} machineId={tab.machineId} isActive={tab.id === activeTabId} />
            </div>
          ))
        )}
      </div>
    </div>
  )

  const secondaryPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TerminalTabs
        tabs={splitTabs}
        activeTabId={activeSplitTabId}
        onSelect={setActiveSplitTab}
        onClose={closeSplitTab}
      />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {splitTabs.map(tab => (
          <div key={tab.id} style={{ position: 'absolute', inset: 0, display: tab.id === activeSplitTabId ? 'block' : 'none' }}>
            <TerminalPane tabId={tab.id} machineId={tab.machineId} isActive={tab.id === activeSplitTabId} />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#1e1e1e', fontFamily: 'system-ui, sans-serif' }}>
      <Sidebar />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '0 8px', background: '#252526', height: 35, borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
          <button
            onClick={togglePreview}
            style={{ background: previewVisible ? '#0e639c' : 'none', border: '1px solid #3e3e3e', borderRadius: 4, color: '#ccc', cursor: 'pointer', fontSize: 12, padding: '3px 10px' }}
          >
            {previewVisible ? '▼ 端口预览' : '▶ 端口预览'}
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'hidden' }}>
          {splitMode !== 'none' ? (
            <SplitTerminal primary={primaryPanel} secondary={secondaryPanel} />
          ) : (
            primaryPanel
          )}
        </div>

        {previewVisible && (
          <>
            <div
              onMouseDown={() => { isDraggingPreview.current = true }}
              style={{ height: 4, background: '#1e1e1e', cursor: 'row-resize', flexShrink: 0 }}
            />
            <div ref={previewPanelRef} style={{ height: previewHeightRef.current, flexShrink: 0 }}>
              <PreviewPane />
            </div>
          </>
        )}
      </div>

      <ToastContainer />
      <HostKeyModal />
    </div>
  )
}
