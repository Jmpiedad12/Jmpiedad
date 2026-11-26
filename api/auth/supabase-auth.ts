import { createClient } from '@supabase/supabase-js'

let authClient: ReturnType<typeof createClient> | undefined
let adminAuthClient: ReturnType<typeof createClient> | undefined

const configurationError = (message: string) => Object.assign(new Error(message), { status: 503 })

const getSupabaseUrl = () => {
  const url = process.env.SUPABASE_URL
  if (!url) throw configurationError('Supabase Auth is not configured. Set SUPABASE_URL.')
  return url
}

const getAuthClient = () => {
  if (authClient) return authClient
  const key = process.env.SUPABASE_ANON_KEY
  if (!key) throw configurationError('Supabase Auth is not configured. Set SUPABASE_ANON_KEY.')

  authClient = createClient(getSupabaseUrl(), key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  return authClient
}

const getAdminAuthClient = () => {
  if (adminAuthClient) return adminAuthClient
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw configurationError('Supabase Auth is not configured. Set SUPABASE_SERVICE_ROLE_KEY.')

  adminAuthClient = createClient(getSupabaseUrl(), key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  return adminAuthClient
}

export const sendSignupOtp = async (email: string, password: string) => {
  const { data, error } = await getAdminAuthClient().auth.admin.generateLink({
    type: 'signup',
    email,
    password,
  })
  if (error) throw error
  const token = data.properties.email_otp
  if (!token) throw configurationError('Supabase did not return an email verification code.')
  if (!/^\d{6}$/.test(token)) {
    throw configurationError('Supabase Auth must be configured to generate six-digit email OTPs (mailer_otp_length = 6).')
  }
  return token
}

export const verifySignupOtp = async (email: string, token: string) => {
  const { error } = await getAuthClient().auth.verifyOtp({
    email,
    token,
    type: 'signup',
  })
  if (error) throw error
}
