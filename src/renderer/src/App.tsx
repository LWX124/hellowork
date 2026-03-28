// src/renderer/src/App.tsx
import { useEffect } from 'react'
import { useServiceStore } from './store/service'
import { TerminalPane } from './components/terminal/TerminalPane'

export default function App() {
  const connect = useServiceStore(s => s.connect)
  useEffect(() => { connect() }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1e1e1e' }}>
      <TerminalPane machineId="home-mac" isActive={true} />
    </div>
  )
}
