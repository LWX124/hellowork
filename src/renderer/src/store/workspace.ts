// src/renderer/src/store/workspace.ts
import { create } from 'zustand'

export interface TerminalTab {
  id: string
  machineId: string
  title: string
  sessionId?: string
}

export type SplitMode = 'none' | 'horizontal' | 'vertical'

interface WorkspaceState {
  tabs: TerminalTab[]
  activeTabId: string | null
  splitMode: SplitMode
  splitTabs: TerminalTab[]
  activeSplitTabId: string | null
  splitRatio: number
  previewVisible: boolean
  previewHeight: number
  sidebarOpen: boolean

  addTab: (machineId: string, title: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  setTabSessionId: (tabId: string, sessionId: string) => void
  addSplitTab: (machineId: string, title: string) => void
  closeSplitTab: (tabId: string) => void
  setActiveSplitTab: (tabId: string) => void
  setSplitMode: (mode: SplitMode) => void
  togglePreview: () => void
  setSidebarOpen: (open: boolean) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  tabs: [],
  activeTabId: null,
  splitMode: 'none',
  splitTabs: [],
  activeSplitTabId: null,
  splitRatio: 0.5,
  previewVisible: false,
  previewHeight: 300,
  sidebarOpen: true,

  addTab: (machineId, title) => {
    set(s => {
      // If this machine already has a tab, just switch to it
      const existing = s.tabs.find(t => t.machineId === machineId)
      if (existing) return { activeTabId: existing.id, sidebarOpen: false }
      const id = crypto.randomUUID()
      return {
        tabs: [...s.tabs, { id, machineId, title }],
        activeTabId: id,
        sidebarOpen: false,
      }
    })
  },

  closeTab: (tabId) => {
    set(s => {
      const tabs = s.tabs.filter(t => t.id !== tabId)
      const activeTabId = s.activeTabId === tabId
        ? (tabs[tabs.length - 1]?.id ?? null)
        : s.activeTabId
      return {
        tabs,
        activeTabId,
        sidebarOpen: tabs.length === 0 ? true : s.sidebarOpen,  // 无终端时自动展开
        previewVisible: tabs.length === 0 ? false : s.previewVisible,
      }
    })
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setTabSessionId: (tabId, sessionId) => {
    set(s => ({
      tabs: s.tabs.map(t => t.id === tabId ? { ...t, sessionId } : t),
      splitTabs: s.splitTabs.map(t => t.id === tabId ? { ...t, sessionId } : t),
    }))
  },

  addSplitTab: (machineId, title) => {
    const id = crypto.randomUUID()
    set(s => ({ splitTabs: [...s.splitTabs, { id, machineId, title }], activeSplitTabId: id }))
  },

  closeSplitTab: (tabId) => {
    set(s => {
      const splitTabs = s.splitTabs.filter(t => t.id !== tabId)
      const activeSplitTabId = s.activeSplitTabId === tabId
        ? (splitTabs[splitTabs.length - 1]?.id ?? null)
        : s.activeSplitTabId
      return { splitTabs, activeSplitTabId, splitMode: splitTabs.length === 0 ? 'none' : s.splitMode }
    })
  },

  setActiveSplitTab: (tabId) => set({ activeSplitTabId: tabId }),
  setSplitMode: (mode) => set({ splitMode: mode }),
  togglePreview: () => set(s => ({ previewVisible: !s.previewVisible })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}))
