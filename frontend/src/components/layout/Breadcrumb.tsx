import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'

type BreadcrumbItem = {
  label: string
  to?: string
}

type BreadcrumbProps = {
  items: BreadcrumbItem[]
  className?: string
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('text-sm text-text-secondary', className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1

          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? <span className="text-text-secondary/50">/</span> : null}
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  className="truncate transition-colors duration-300 hover:text-text"
                >
                  {item.label}
                </Link>
              ) : (
                <span className={cn('truncate', isLast && 'text-text')}>{item.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
