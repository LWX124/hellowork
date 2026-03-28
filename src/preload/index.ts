// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getServicePort: () => ipcRenderer.invoke('service:getPort'),
})
