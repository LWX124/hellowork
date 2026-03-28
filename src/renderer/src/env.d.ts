/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    getServicePort: () => Promise<number>
  }
}
