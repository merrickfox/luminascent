import { Link } from 'react-router-dom'
import type { Brand } from '../../types/api'
import { Card } from '../ui/Card'
import { Label } from '../ui/Label'

type BrandCardProps = {
  brand: Brand
}

export function BrandCard({ brand }: BrandCardProps) {
  return (
    <Link to={`/brands/${brand.slug}`} className="group block">
      <Card className="p-6 transition-colors duration-300 group-hover:border-accent/40">
        <h3 className="font-display text-2xl text-text transition-colors duration-300 group-hover:text-accent">
          {brand.name}
        </h3>
        {brand.country ? (
          <Label className="mt-3 block normal-case tracking-normal">{brand.country}</Label>
        ) : null}
      </Card>
    </Link>
  )
}
