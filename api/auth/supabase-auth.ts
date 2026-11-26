import { createClient } from '@supabase/supabase-js'

let authClient: ReturnType<typeof createClient> | undefined

const getAuthClient = () => {
  if (authClient) return authClient

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase Auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.')
  }

  authClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  return authClient
}

export const sendSignupOtp = async (email: string, password: string) => {
  const { data, error } = await getAuthClient().auth.signUp({ email, password })
  if (error) throw error
  if (data.user?.identities?.length === 0) {
    throw new Error('Unable to send a verification code. Check the email address or sign in.')
  }
}

export const verifySignupOtp = async (email: string, token: string) => {
  const { error } = await getAuthClient().auth.verifyOtp({
    email,
    token,
    type: 'signup',
  })
  if (error) throw error
}
