import { PageSection } from '../components/layout/PageSection'
import { ButtonLink } from '../components/ui/Button'
import { Eyebrow } from '../components/ui/Eyebrow'
import { Reveal } from '../components/ui/Reveal'

export function AboutPage() {
  return (
    <>
      <PageSection className="border-b border-border">
        <Reveal>
          <Eyebrow>About</Eyebrow>
          <h1 className="max-w-3xl font-medium leading-tight">
            A quiet guide to the world of scent.
          </h1>
        </Reveal>
      </PageSection>

      <PageSection narrow>
        <Reveal>
          <div className="space-y-8 text-lg text-text-secondary">
            <p>
              Luminascent is a curated database and discovery platform for candles,
              perfumes, and scent objects. We believe the best fragrances deserve the
              same considered attention as fine wine, art, or design.
            </p>
            <p>
              Our approach is editorial, not algorithmic. Every house, every product,
              every note is presented with the restraint of a private members club —
              inviting, never insistent.
            </p>
            <p className="font-display text-xl italic text-text sm:text-2xl">
              &ldquo;Wealth whispering, not wealth signalling.&rdquo;
            </p>
            <p>
              Whether you are building a collection, researching a gift, or simply
              exploring what exists beyond the familiar, Luminascent is here to
              inform — not influence.
            </p>
          </div>

          <div className="mt-12">
            <ButtonLink to="/brands">Explore brands</ButtonLink>
          </div>
        </Reveal>
      </PageSection>
    </>
  )
}
