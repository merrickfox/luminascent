import { Link } from 'react-router-dom'
import { BrandCard } from '../components/brand/BrandCard'
import { Container } from '../components/layout/Container'
import { PageSection } from '../components/layout/PageSection'
import { ProductCard } from '../components/product/ProductCard'
import { ButtonLink } from '../components/ui/Button'
import { Eyebrow } from '../components/ui/Eyebrow'
import { Reveal } from '../components/ui/Reveal'
import { Spinner } from '../components/ui/Spinner'
import { useBrandMap, useBrands } from '../hooks/useBrands'
import { useCategoryMap, useCategories } from '../hooks/useCategories'
import { useProducts } from '../hooks/useProducts'

export function HomePage() {
  const brandsQuery = useBrands()
  const productsQuery = useProducts({ sort: 'newest', limit: 6 })
  const categoriesQuery = useCategories()

  const brandMap = useBrandMap(brandsQuery.data)
  const categoryMap = useCategoryMap(categoriesQuery.data)

  const featuredBrands = brandsQuery.data
    ? [...brandsQuery.data].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6)
    : []

  return (
    <>
      <section className="border-b border-border py-16 sm:py-20 md:py-32">
        <Container size="hero" className="text-center">
          <Reveal>
            <Eyebrow>Editorial. Cultured. Understated.</Eyebrow>
            <h1 className="animate-reveal text-4xl font-medium leading-[1.08] sm:text-5xl md:text-6xl lg:text-7xl">
              The art of scent, considered.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base text-text-secondary sm:mt-8 sm:text-lg">
              A curated guide to candles, perfumes, and the houses that define them.
              Discover with intention — not impulse.
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row sm:items-center sm:gap-4">
              <ButtonLink to="/brands" className="w-full sm:w-auto">
                Explore houses
              </ButtonLink>
              <ButtonLink to="/about" variant="secondary" className="w-full sm:w-auto">
                Our story
              </ButtonLink>
            </div>
          </Reveal>
        </Container>
      </section>

      <PageSection>
        <Reveal>
          <div className="mb-12 flex items-end justify-between gap-6">
            <div>
              <Eyebrow>Houses</Eyebrow>
              <h2 className="font-medium">Curated makers</h2>
            </div>
            <Link
              to="/brands"
              className="hidden text-sm text-text-secondary hover:text-text md:block"
            >
              View all
            </Link>
          </div>
        </Reveal>

        {brandsQuery.isLoading ? (
          <Spinner />
        ) : (
          <div className="grid items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredBrands.map((brand, index) => (
              <Reveal key={brand.id} delay={index * 80}>
                <BrandCard brand={brand} />
              </Reveal>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection className="border-t border-border bg-surface/50">
        <Reveal>
          <div className="mb-12">
            <Eyebrow>Recently added</Eyebrow>
            <h2 className="font-medium">New to the collection</h2>
          </div>
        </Reveal>

        {productsQuery.isLoading || categoriesQuery.isLoading ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-1 items-stretch gap-6 sm:grid-cols-2 sm:gap-8 lg:grid-cols-3">
            {productsQuery.data?.products.map((product, index) => (
              <Reveal key={product.id} delay={index * 80}>
                <ProductCard
                  product={product}
                  brandName={
                    product.brand_id ? brandMap.get(product.brand_id)?.name : null
                  }
                  categoryName={categoryMap.get(product.category_id)?.name}
                />
              </Reveal>
            ))}
          </div>
        )}
      </PageSection>
    </>
  )
}
