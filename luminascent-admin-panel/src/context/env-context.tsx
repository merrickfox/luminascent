import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_ENV_ID,
  ENV_STORAGE_KEY,
  ENVIRONMENTS,
  type Environment,
} from '@/lib/config'
import { setApiHost } from '@/lib/api'

type EnvContextValue = {
  environment: Environment
  environments: Environment[]
  setEnvironmentId: (id: string) => void
}

const EnvContext = createContext<EnvContextValue | null>(null)

function getInitialEnvId() {
  if (typeof window === 'undefined') return DEFAULT_ENV_ID
  return localStorage.getItem(ENV_STORAGE_KEY) ?? DEFAULT_ENV_ID
}

export function EnvProvider({ children }: { children: ReactNode }) {
  const [envId, setEnvId] = useState(getInitialEnvId)

  const environment = useMemo(
    () => ENVIRONMENTS.find((env) => env.id === envId) ?? ENVIRONMENTS[0],
    [envId],
  )

  useEffect(() => {
    setApiHost(environment.host)
    localStorage.setItem(ENV_STORAGE_KEY, environment.id)
  }, [environment])

  const value = useMemo(
    () => ({
      environment,
      environments: ENVIRONMENTS,
      setEnvironmentId: setEnvId,
    }),
    [environment],
  )

  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>
}

export function useEnv() {
  const context = useContext(EnvContext)
  if (!context) {
    throw new Error('useEnv must be used within EnvProvider')
  }
  return context
}
