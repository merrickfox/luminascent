import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { getMe, updateMe } from '../lib/api'

/** The current user's registry profile. Only runs when signed in. */
export function useMe() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => (await getMe()).user,
    enabled: Boolean(session),
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (username: string) => (await updateMe(username)).user,
    onSuccess: (user) => {
      queryClient.setQueryData(['me'], user)
    },
  })
}
