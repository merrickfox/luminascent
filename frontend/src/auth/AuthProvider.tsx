import type { Session, User as SupabaseUser } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { AuthModal } from '../components/auth/AuthModal'
import { ensureMe } from '../lib/api'
import { supabase } from '../lib/supabase'

type AuthContextValue = {
  session: Session | null
  user: SupabaseUser | null
  /** True until the initial session has been resolved. */
  loading: boolean
  signUp: (input: { email: string; password: string; username: string }) => Promise<void>
  signIn: (input: { email: string; password: string }) => Promise<void>
  signOut: () => Promise<void>
  /** Open the shared login/signup modal (e.g. when a guest tries to vote). */
  openAuthModal: () => void
  closeAuthModal: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
      // Any auth change can change what `/me` returns.
      queryClient.invalidateQueries({ queryKey: ['me'] })
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      async signUp({ email, password, username }) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username } },
        })
        if (error) throw error
        // With email confirmation disabled, a session is returned immediately.
        if (data.session) {
          await ensureMe(username)
          queryClient.invalidateQueries({ queryKey: ['me'] })
        }
      },
      async signIn({ email, password }) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        // Guarantee the registry row exists (idempotent).
        await ensureMe()
        queryClient.invalidateQueries({ queryKey: ['me'] })
      },
      async signOut() {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
        queryClient.removeQueries({ queryKey: ['me'] })
      },
      openAuthModal: () => setAuthModalOpen(true),
      closeAuthModal: () => setAuthModalOpen(false),
    }),
    [session, loading, queryClient],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
