import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EnvProvider } from '@/context/env-context'
import { Toaster } from '@/components/ui/sonner'
import App from '@/App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <EnvProvider>
        <BrowserRouter>
          <App />
          <Toaster />
        </BrowserRouter>
      </EnvProvider>
    </QueryClientProvider>
  </StrictMode>,
)
