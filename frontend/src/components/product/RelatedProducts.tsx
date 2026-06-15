import { useProducts } from '../../hooks/useProducts'
import type { Product } from '../../types/api'
import { Container } from '../layout/Container'
import { ProductCard } from './ProductCard'
import { Label } from '../ui/Label'
import { Spinner } from '../ui/Spinner'

type RelatedProductsProps = {
  currentProduct: Product
  brandSlug?: string | null
  brandName?: string | null
  categorySlug?: string | null
}

export function RelatedProducts({
  currentProduct,
  brandSlug,
  brandName,
  categorySlug,
}: RelatedProductsProps) {
  const brandQuery = useProducts({
    brand: brandSlug ?? undefined,
    limit: 8,
  })

  const categoryQuery = useProducts({
    category: categorySlug ?? undefined,
    limit: 8,
  })

  const query = brandSlug ? brandQuery : categoryQuery
  const related =
    query.data?.products.filter((product) => product.id !== currentProduct.id).slice(0, 5) ?? []

  if (query.isLoading) {
    return (
      <section className="py-12 sm:py-16">
        <Container>
          <Spinner />
        </Container>
      </section>
    )
  }

  if (related.length === 0) return null

  return (
    <section className="border-t border-border py-12 sm:py-16 md:py-20">
      <Container>
        <Label className="mb-8 block text-center">You may also like</Label>

        <div className="flex gap-4 overflow-x-auto overscroll-x-contain pb-2 [-webkit-overflow-scrolling:touch] sm:gap-6">
          {related.map((product) => (
            <div key={product.id} className="w-44 shrink-0 self-stretch sm:w-52">
              <ProductCard
                product={product}
                brandName={brandName}
                variant="compact"
                className="h-full"
              />
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}
