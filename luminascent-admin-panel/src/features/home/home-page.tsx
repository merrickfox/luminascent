import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useEnv } from '@/context/env-context'

const quickLinks = [
  { title: 'Products', href: '/products', description: 'Browse and create catalog products.' },
  { title: 'Brands', href: '/brands', description: 'Manage fragrance and candle brands.' },
  { title: 'Categories', href: '/categories', description: 'Product types like candle and perfume.' },
  { title: 'Notes', href: '/notes', description: 'Scent notes for product pyramids.' },
  { title: 'Accords', href: '/accords', description: 'Main accords such as woody and vanilla.' },
]

export function HomePage() {
  const { environment } = useEnv()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Connected to ${environment.label} at ${environment.host}`}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {quickLinks.map((link) => (
          <Link key={link.href} to={link.href}>
            <Card className="h-full transition-colors hover:bg-accent/40">
              <CardHeader>
                <CardTitle>{link.title}</CardTitle>
                <CardDescription>{link.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
