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
