// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getServicePort: () => ipcRenderer.invoke('service:getPort'),
  keychain: {
    set: (account: string, password: string) => ipcRenderer.invoke('keychain:set', account, password),
    get: (account: string) => ipcRenderer.invoke('keychain:get', account) as Promise<string | null>,
    delete: (account: string) => ipcRenderer.invoke('keychain:delete', account),
  },
})
