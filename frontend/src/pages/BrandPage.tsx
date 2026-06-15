import { Link, useParams } from 'react-router-dom'
import { PageSection } from '../components/layout/PageSection'
import { ProductCard } from '../components/product/ProductCard'
import { EmptyState } from '../components/ui/EmptyState'
import { Eyebrow } from '../components/ui/Eyebrow'
import { Spinner } from '../components/ui/Spinner'
import { useBrand } from '../hooks/useBrands'
import { useCategoryMap, useCategories } from '../hooks/useCategories'
import { useProducts } from '../hooks/useProducts'

export function BrandPage() {
  const { slug } = useParams<{ slug: string }>()
  const { brand, isLoading: brandLoading, isError: brandError } = useBrand(slug)
  const productsQuery = useProducts({ brand: slug, sort: 'name', limit: 100 })
  const categoriesQuery = useCategories()
  const categoryMap = useCategoryMap(categoriesQuery.data)

  if (brandLoading) return <Spinner />

  if (brandError || !brand) {
    return (
      <PageSection>
        <EmptyState
          title="Brand not found"
          description="This house may not yet be in our collection."
        />
        <div className="mt-8 text-center">
          <Link to="/brands" className="text-sm text-text-secondary hover:text-text">
            Back to brands
          </Link>
        </div>
      </PageSection>
    )
  }

  return (
    <>
      <PageSection className="border-b border-border">
        <Eyebrow>House</Eyebrow>
        <h1 className="break-words font-medium">{brand.name}</h1>
        {brand.country ? (
          <p className="mt-4 text-text-secondary">{brand.country}</p>
        ) : null}
        {brand.website_url ? (
          <a
            href={brand.website_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block text-sm text-accent hover:text-text"
          >
            Visit website
          </a>
        ) : null}
      </PageSection>

      <PageSection>
        <h2 className="mb-8 font-display text-2xl sm:mb-10 sm:text-3xl">Collection</h2>

        {productsQuery.isLoading ? (
          <Spinner />
        ) : productsQuery.data?.products.length === 0 ? (
          <EmptyState
            title="No products yet"
            description="Products for this house will appear here as they are added."
          />
        ) : (
          <div className="grid grid-cols-2 items-stretch gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-6 xl:grid-cols-5">
            {productsQuery.data?.products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                categoryName={categoryMap.get(product.category_id)?.name}
                variant="compact"
              />
            ))}
          </div>
        )}
      </PageSection>
    </>
  )
}
