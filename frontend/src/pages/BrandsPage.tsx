import { useMemo, useState } from 'react'
import { BrandCard } from '../components/brand/BrandCard'
import { AlphaFilter } from '../components/brand/AlphaFilter'
import { PageSection } from '../components/layout/PageSection'
import { EmptyState } from '../components/ui/EmptyState'
import { Eyebrow } from '../components/ui/Eyebrow'
import { Spinner } from '../components/ui/Spinner'
import { useBrands } from '../hooks/useBrands'
import { groupByFirstLetter } from '../lib/utils'
import type { Brand } from '../types/api'

export function BrandsPage() {
  const { data: brands, isLoading, isError } = useBrands()
  const [activeLetter, setActiveLetter] = useState<string | null>(null)

  const grouped = useMemo(() => {
    if (!brands) return new Map<string, Brand[]>()
    const filtered = activeLetter
      ? brands.filter((brand) => brand.name.charAt(0).toUpperCase() === activeLetter)
      : brands
    return groupByFirstLetter(filtered)
  }, [brands, activeLetter])

  const availableLetters = useMemo(() => {
    if (!brands) return new Set<string>()
    return new Set(
      brands.map((brand) => {
        const letter = brand.name.charAt(0).toUpperCase()
        return /[A-Z]/.test(letter) ? letter : '#'
      }),
    )
  }, [brands])

  if (isLoading) return <Spinner />
  if (isError) {
    return (
      <PageSection>
        <EmptyState
          title="Unable to load brands"
          description="Please check that the API is running and try again."
        />
      </PageSection>
    )
  }

  return (
    <>
      <PageSection className="pb-8">
        <Eyebrow>Directory</Eyebrow>
        <h1 className="font-medium">Brands</h1>
        <p className="mt-4 max-w-2xl text-text-secondary">
          Houses and makers across candles, perfumes, and scent objects — curated with care.
        </p>
      </PageSection>

      <AlphaFilter
        activeLetter={activeLetter}
        availableLetters={availableLetters}
        onSelect={setActiveLetter}
      />

      <PageSection className="pt-8">
        {grouped.size === 0 ? (
          <EmptyState
            title="No brands found"
            description="Try selecting a different letter or check back soon."
          />
        ) : (
          <div className="space-y-16">
            {[...grouped.entries()].map(([letter, letterBrands]) => (
              <section key={letter} id={`letter-${letter}`}>
                <h2 className="mb-5 font-display text-3xl text-accent sm:mb-6 sm:text-4xl">
                  {letter}
                </h2>
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {letterBrands.map((brand) => (
                    <BrandCard key={brand.id} brand={brand} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </PageSection>
    </>
  )
}
