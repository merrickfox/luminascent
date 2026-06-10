import { Link } from 'react-router-dom'
import { Container } from './Container'

export function Footer() {
  return (
    <footer className="border-t border-border py-12 sm:py-16">
      <Container className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-display text-2xl text-text">Luminascent</p>
          <p className="mt-3 max-w-sm text-sm text-text-secondary">
            A curated guide to scent — candles, perfumes, and the houses that define them.
          </p>
        </div>

        <div className="flex gap-8 text-sm text-text-secondary">
          <Link to="/brands" className="hover:text-text">
            Brands
          </Link>
          <Link to="/about" className="hover:text-text">
            About
          </Link>
        </div>
      </Container>
    </footer>
  )
}
