import { Search, ShoppingBag, User } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import { iconSm } from '../../lib/icons'
import { cn } from '../../lib/utils'
import { Container } from './Container'

const navItems = [
  { label: 'Discover', to: '#' },
  { label: 'Candles', to: '#' },
  { label: 'Brands', to: '/brands' },
  { label: 'Notes', to: '#' },
  { label: 'Journal', to: '#' },
] as const

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'text-xs font-medium uppercase tracking-[0.1em] text-text-secondary transition-colors duration-300 hover:text-text',
    isActive && 'text-text',
  )

function IconButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center text-text-secondary transition-colors duration-300 hover:text-text"
    >
      {children}
    </button>
  )
}

export function TopNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-bg/90 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between sm:h-20">
        <Link
          to="/"
          className="shrink-0 font-display text-xl font-medium tracking-tight text-text sm:text-2xl"
        >
          Luminascent
        </Link>

        <nav className="hidden items-center gap-6 md:flex lg:gap-8">
          {navItems.map((item) =>
            item.to === '#' ? (
              <a
                key={item.label}
                href="#"
                className="text-xs font-medium uppercase tracking-[0.1em] text-text-secondary transition-colors duration-300 hover:text-text"
              >
                {item.label}
              </a>
            ) : (
              <NavLink key={item.label} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="flex items-center gap-1 sm:gap-2">
          <IconButton label="Search">
            <Search {...iconSm} />
          </IconButton>
          <IconButton label="Account">
            <User {...iconSm} />
          </IconButton>
          <IconButton label="Shopping bag">
            <ShoppingBag {...iconSm} />
          </IconButton>
        </div>
      </Container>
    </header>
  )
}
