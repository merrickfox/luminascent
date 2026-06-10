import { Link, NavLink } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { Container } from './Container'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'text-sm tracking-wide text-text-secondary transition-colors duration-300 hover:text-text',
    isActive && 'text-text',
  )

export function TopNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-bg/90 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between sm:h-20">
        <Link
          to="/"
          className="font-display text-xl font-medium tracking-tight text-text sm:text-2xl md:text-3xl"
        >
          Luminascent
        </Link>

        <nav className="flex items-center gap-5 sm:gap-8">
          <NavLink to="/brands" className={navLinkClass}>
            Brands
          </NavLink>
          <NavLink to="/about" className={navLinkClass}>
            About
          </NavLink>
        </nav>
      </Container>
    </header>
  )
}
