import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { useMe } from '../../hooks/useMe'

export function AccountMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signOut } = useAuth()
  const { data: me } = useMe()
  const ref = useRef<HTMLDivElement>(null)

  // Close when clicking outside the menu.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-[var(--radius-card)] border border-border bg-bg shadow-xl"
    >
      <div className="border-b border-border/80 px-4 py-3">
        <p className="truncate text-sm font-medium text-text">{me?.username ?? 'Account'}</p>
        <p className="truncate text-xs text-text-secondary">{me?.email ?? user?.email}</p>
      </div>
      <nav className="flex flex-col py-1 text-sm">
        <Link
          to="/profile"
          onClick={onClose}
          className="px-4 py-2 text-text transition-colors hover:bg-surface"
        >
          Profile
        </Link>
        <button
          type="button"
          onClick={() => {
            onClose()
            void signOut()
          }}
          className="px-4 py-2 text-left text-text transition-colors hover:bg-surface"
        >
          Sign out
        </button>
      </nav>
    </div>
  )
}
