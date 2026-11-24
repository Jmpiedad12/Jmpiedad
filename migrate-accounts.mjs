import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const { data, error } = await supabase
  .from('app_data')
  .select('value')
  .eq('key', 'accounts')
  .single()

if (error) throw error

const accounts = typeof data.value === 'string'
  ? JSON.parse(data.value)
  : data.value

console.log('Accounts found in Supabase:', accounts.length)