import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  width = 560
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose(): void
  children: ReactNode
  width?: number
}) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal" style={{ width }} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>
        {children}
      </section>
    </div>
  )
}
