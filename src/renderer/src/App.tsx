// src/renderer/src/App.tsx
import { useEffect, useRef, useState } from 'react'
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
import { PasswordModal } from './components/common/PasswordModal'

export default function App() {
  const connectService = useServiceStore(s => s.connect)
  const serviceConnected = useServiceStore(s => s.connected)
  const initMachines = useMachinesStore(s => s.init)

  const {
    tabs, activeTabId, setActiveTab, closeTab,
    splitMode, splitTabs, activeSplitTabId, setActiveSplitTab, closeSplitTab, setSplitMode,
    previewVisible, togglePreview,
    sidebarOpen, setSidebarOpen,
  } = useWorkspaceStore()

  const hasConnectedMachines = tabs.length > 0 || splitTabs.length > 0

  const previewPanelRef = useRef<HTMLDivElement>(null)
  const previewWidthRef = useRef(520)
  const isDraggingPreview = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => { connectService() }, [])

  useEffect(() => {
    if (!serviceConnected) return
    const unsub = initMachines()
    return () => unsub?.()
  }, [serviceConnected])

  // Auto-collapse sidebar when preview opens
  useEffect(() => {
    if (previewVisible && sidebarOpen) setSidebarOpen(false)
  }, [previewVisible])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingPreview.current || !previewPanelRef.current) return
      const parent = previewPanelRef.current.parentElement!
      const rect = parent.getBoundingClientRect()
      const newWidth = Math.min(Math.max(rect.right - e.clientX, 300), rect.width - 300)
      previewWidthRef.current = newWidth
      previewPanelRef.current.style.width = `${newWidth}px`
    }
    const onMouseUp = () => {
      isDraggingPreview.current = false
      setIsDragging(false)
    }
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
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#555', fontSize: 13, gap: 8
          }}>
            <span style={{ fontSize: 32 }}>⌨️</span>
            <span>在左侧添加并连接机器，终端将在此显示</span>
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

      {/* 侧边栏折叠按钮（侧边栏隐藏时显示） */}
      {!sidebarOpen && (
        <div style={{ width: 32, background: '#252526', borderRight: '1px solid #1e1e1e', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8, flexShrink: 0 }}>
          <button
            onClick={() => setSidebarOpen(true)}
            title="展开机器列表"
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16, padding: '4px', lineHeight: 1 }}
          >☰</button>
        </div>
      )}

      {/* 侧边栏 */}
      {sidebarOpen && <Sidebar onCollapse={() => setSidebarOpen(false)} />}

      {/* 终端区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* 顶部工具栏 */}
        {hasConnectedMachines && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '0 8px', background: '#252526', height: 35, borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
            <button
              onClick={togglePreview}
              style={{ background: previewVisible ? '#0e639c' : 'none', border: '1px solid #3e3e3e', borderRadius: 4, color: '#ccc', cursor: 'pointer', fontSize: 12, padding: '3px 10px' }}
            >
              {previewVisible ? '▼ 端口预览' : '▶ 端口预览'}
            </button>
          </div>
        )}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {splitMode !== 'none' ? (
            <SplitTerminal primary={primaryPanel} secondary={secondaryPanel} />
          ) : (
            primaryPanel
          )}
        </div>
      </div>

      {/* 预览面板（右侧，仅在有连接且用户手动开启时显示） */}
      {hasConnectedMachines && previewVisible && (
        <>
          <div
            onMouseDown={(e) => {
              e.preventDefault()
              isDraggingPreview.current = true
              setIsDragging(true)
            }}
            style={{ width: 4, background: '#1e1e1e', cursor: 'col-resize', flexShrink: 0 }}
          />
          <div ref={previewPanelRef} style={{ width: previewWidthRef.current, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            {/* Overlay to capture mouse events during drag, preventing webview from swallowing them */}
            {isDragging && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 999, cursor: 'col-resize' }} />
            )}
            <PreviewPane />
          </div>
        </>
      )}

      <ToastContainer />
      <HostKeyModal />
      <PasswordModal />
    </div>
  )
}
