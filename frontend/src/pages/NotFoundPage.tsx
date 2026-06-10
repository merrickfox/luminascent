import { PageSection } from '../components/layout/PageSection'
import { ButtonLink } from '../components/ui/Button'

export function NotFoundPage() {
  return (
    <PageSection className="text-center">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">404</p>
      <h1 className="mt-4 font-medium">Page not found</h1>
      <p className="mx-auto mt-4 max-w-md text-text-secondary">
        The page you are looking for does not exist, or may have been moved.
      </p>
      <div className="mt-10">
        <ButtonLink to="/">Return home</ButtonLink>
      </div>
    </PageSection>
  )
}
