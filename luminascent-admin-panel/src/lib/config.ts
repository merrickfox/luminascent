export type Environment = {
  id: string
  label: string
  host: string
}

export const ENVIRONMENTS: Environment[] = [
  { id: 'local', label: 'Local', host: 'http://localhost:8023' },
  { id: 'dev', label: 'Dev', host: 'https://luminascent-backend-dev.example.com' },
  { id: 'prod', label: 'Prod', host: 'https://luminascent-backend.example.com' },
]

export const DEFAULT_ENV_ID = 'local'

export const ADMIN_API_KEY = 'dev-admin-key'

export const ENV_STORAGE_KEY = 'luminascent-admin-env'

// The local scraper server (scraper/server/server.js) is the bridge backend for the
// Scraper section: it holds the on-disk capture artifacts and runs the pipeline. It is
// local-only, so this is a fixed host rather than an env-switchable backend.
export const SCRAPER_HOST = 'http://localhost:8777'
