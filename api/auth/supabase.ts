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
    .single()

  if (error) throw error

  return typeof data.value === 'string'
    ? JSON.parse(data.value)
    : data.value
}