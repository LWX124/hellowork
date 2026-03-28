// src/renderer/src/env.d.ts
/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    getServicePort: () => Promise<number>
    keychain: {
      set: (account: string, password: string) => Promise<void>
      get: (account: string) => Promise<string | null>
      delete: (account: string) => Promise<void>
    }
  }
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
      src?: string
      ref?: React.Ref<any>
      style?: React.CSSProperties
    }, HTMLElement>
  }
}
