// src/renderer/src/components/terminal/SplitTerminal.tsx
import { useRef, useEffect, ReactNode } from 'react'
import { useWorkspaceStore } from '../../store/workspace'

interface Props {
  primary: ReactNode
  secondary: ReactNode
}

export function SplitTerminal({ primary, secondary }: Props) {
  const { splitMode } = useWorkspaceStore()
  const dividerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const ratioRef = useRef(0.5)
  const isDragging = useRef(false)

  const isHorizontal = splitMode === 'horizontal'

  useEffect(() => {
    const divider = dividerRef.current
    const container = containerRef.current
    if (!divider || !container) return

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const rect = container.getBoundingClientRect()
      const ratio = isHorizontal
        ? (e.clientY - rect.top) / rect.height
        : (e.clientX - rect.left) / rect.width
      const clamped = Math.min(Math.max(ratio, 0.2), 0.8)
      ratioRef.current = clamped

      const children = container.children
      if (isHorizontal) {
        ;(children[0] as HTMLElement).style.height = `${clamped * 100}%`
        ;(children[2] as HTMLElement).style.height = `${(1 - clamped) * 100}%`
      } else {
        ;(children[0] as HTMLElement).style.width = `${clamped * 100}%`
        ;(children[2] as HTMLElement).style.width = `${(1 - clamped) * 100}%`
      }
    }

    const onMouseUp = () => { isDragging.current = false }

    divider.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      divider.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isHorizontal])

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex', flexDirection: isHorizontal ? 'column' : 'row',
        width: '100%', height: '100%', overflow: 'hidden'
      }}
    >
      <div style={isHorizontal ? { height: '50%', overflow: 'hidden' } : { width: '50%', overflow: 'hidden' }}>
        {primary}
      </div>

      <div
        ref={dividerRef}
        style={{
          background: '#1e1e1e',
          cursor: isHorizontal ? 'row-resize' : 'col-resize',
          flexShrink: 0,
          [isHorizontal ? 'height' : 'width']: 4,
        }}
      />

      <div style={isHorizontal ? { height: '50%', overflow: 'hidden' } : { width: '50%', overflow: 'hidden' }}>
        {secondary}
      </div>
    </div>
  )
}
