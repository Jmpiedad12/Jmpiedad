import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  throw new Error('Supabase environment variables are missing.')
}

export const supabase = createClient(url, key)

export const getAccounts = async () => {
  const { data, error } = await supabase
    .from('app_data')
    .select('value')
    .eq('key', 'accounts')
    .maybeSingle()

  if (error) throw error

  if (!data) return []

  return typeof data.value === 'string'
    ? JSON.parse(data.value)
    : data.value
}

export const saveAccounts = async (accounts: unknown) => {
  const { error } = await supabase
    .from('app_data')
    .upsert({ key: 'accounts', value: JSON.stringify(accounts) }, { onConflict: 'key' })

  if (error) throw error
}