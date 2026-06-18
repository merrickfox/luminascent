import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Breadcrumb } from '../components/layout/Breadcrumb'
import { ReviewFormModal } from '../components/reviews/ReviewFormModal'
import { Container } from '../components/layout/Container'
import { PageSection } from '../components/layout/PageSection'
import { CommunityProfileCard } from '../components/product/v2/CommunityProfileCard'
import { CompositionCard } from '../components/product/v2/CompositionCard'
import { ProductHeroV2 } from '../components/product/v2/ProductHeroV2'
import { ReviewsSectionV2 } from '../components/product/v2/ReviewsSectionV2'
import { SeasonalityCard } from '../components/product/v2/SeasonalityCard'
import { SmellsSimilar } from '../components/product/v2/SmellsSimilar'
import { SpecsGrid } from '../components/product/v2/SpecsGrid'
import { EmptyState } from '../components/ui/EmptyState'
import { Spinner } from '../components/ui/Spinner'
import { useProduct } from '../hooks/useProduct'
import { useMyVotes, useVoteDimensions, useVoteMutations } from '../hooks/useVotes'
import { toProductV2View } from '../lib/productViewV2'

export function ProductPageV2() {
  const { slug } = useParams<{ slug: string }>()
  const { data, isLoading, isError } = useProduct(slug)

  const productId = data?.product.id
  const { user, openAuthModal } = useAuth()
  const { data: voteCatalog } = useVoteDimensions()
  const { data: myVotesList } = useMyVotes(productId)
  const { cast, remove, isPending } = useVoteMutations(slug, productId)

  const myVotes = useMemo(
    () => new Map((myVotesList ?? []).map((v) => [v.dimension_slug, v.option_slug])),
    [myVotesList],
  )

  const [reviewOpen, setReviewOpen] = useState(false)
  const onWriteReview = () => (user ? setReviewOpen(true) : openAuthModal())

  if (isLoading) return <Spinner />

  if (isError || !data) {
    return (
      <PageSection>
        <EmptyState
          title="Product not found"
          description="This item may not yet be in our collection."
        />
        <div className="mt-8 text-center">
          <Link to="/brands" className="text-sm text-text-secondary hover:text-text">
            Browse brands
          </Link>
        </div>
      </PageSection>
    )
  }

  const view = toProductV2View(data)
  const { product, category, brand } = data

  const breadcrumbItems = [
    { label: 'Home', to: '/' },
    { label: category.name, to: '#' },
    ...(brand ? [{ label: brand.name, to: `/brands/${brand.slug}` }] : []),
    { label: product.name },
  ]

  return (
    <main className="pb-24">
      <Container>
        <div className="flex items-center justify-between gap-4 py-6">
          <Breadcrumb items={breadcrumbItems} />
          <Link
            to={`/products/${product.slug}/v1`}
            className="shrink-0 whitespace-nowrap text-xs uppercase tracking-[0.08em] text-text-secondary hover:text-text"
          >
            Classic layout
          </Link>
        </div>
      </Container>

      {/* Hero */}
      <Container>
        <div className="border-b border-border pb-16">
          <ProductHeroV2 view={view} images={data.images} fallbackUrl={product.image_url} />
        </div>
      </Container>

      {/* Composition + community */}
      <Container className="pt-16">
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
          <CompositionCard pyramid={view.pyramid} accords={view.accords} />
          <div className="flex flex-col gap-8">
            <CommunityProfileCard
              votes={data.votes}
              dimensions={voteCatalog}
              myVotes={myVotes}
              isLoggedIn={Boolean(user)}
              disabled={isPending}
              onVote={(dimensionSlug, optionSlug) => cast.mutate({ dimensionSlug, optionSlug })}
              onRemove={(dimensionSlug) => remove.mutate(dimensionSlug)}
              onRequireLogin={openAuthModal}
            />
            <SeasonalityCard
              seasons={view.seasons}
              dayNight={view.dayNight}
              myVotes={myVotes}
              isLoggedIn={Boolean(user)}
              disabled={isPending}
              onVote={(dimensionSlug, optionSlug) => cast.mutate({ dimensionSlug, optionSlug })}
              onRemove={(dimensionSlug) => remove.mutate(dimensionSlug)}
              onRequireLogin={openAuthModal}
            />
          </div>
        </div>
      </Container>

      {/* Specs */}
      <Container className="pt-16">
        <SpecsGrid specs={view.specs} />
      </Container>

      {/* Smells similar */}
      <Container className="pt-16">
        <SmellsSimilar similar={view.similar} />
      </Container>

      {/* Reviews */}
      <Container className="pt-16">
        <ReviewsSectionV2
          rating={view.rating}
          ratingDist={view.ratingDist}
          reviews={view.reviews}
          onWriteReview={onWriteReview}
        />
      </Container>

      <ReviewFormModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        productId={product.id}
        productName={product.name}
      />
    </main>
  )
}
