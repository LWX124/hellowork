// src/renderer/src/App.tsx
import { useEffect } from 'react'
import { useServiceStore } from './store/service'

export default function App() {
  const connect = useServiceStore(s => s.connect)

  useEffect(() => { connect() }, [])

  return <div style={{ color: 'white', padding: 20 }}>HelloWork — connecting...</div>
}
