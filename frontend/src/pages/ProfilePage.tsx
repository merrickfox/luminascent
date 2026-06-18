import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { PageSection } from '../components/layout/PageSection'
import { Eyebrow } from '../components/ui/Eyebrow'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { useMe, useUpdateProfile } from '../hooks/useMe'

export function ProfilePage() {
  const { user, loading } = useAuth()
  const { data: me, isLoading } = useMe()
  const updateProfile = useUpdateProfile()

  const [username, setUsername] = useState('')
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  // Seed the form once the profile loads.
  useEffect(() => {
    if (me) setUsername(me.username)
  }, [me])

  // Redirect anonymous visitors home once the session is resolved.
  if (!loading && !user) return <Navigate to="/" replace />

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus(null)
    try {
      await updateProfile.mutateAsync(username)
      setStatus({ kind: 'success', message: 'Profile updated.' })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Update failed' })
    }
  }

  return (
    <PageSection narrow>
      <Eyebrow>Account</Eyebrow>
      <h1 className="font-medium leading-tight">Your profile</h1>

      {isLoading || !me ? (
        <div className="mt-10">
          <Spinner />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-10 flex max-w-md flex-col gap-5">
          <Input label="Email" value={me.email} disabled readOnly />
          <Input
            name="username"
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={3}
            maxLength={30}
            required
          />

          {status && (
            <p className={status.kind === 'success' ? 'text-sm text-success' : 'text-sm text-error'}>
              {status.message}
            </p>
          )}

          <div>
            <Button
              type="submit"
              disabled={updateProfile.isPending || username === me.username}
            >
              {updateProfile.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      )}
    </PageSection>
  )
}
