
import { DatabaseSync } from 'node:sqlite'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  throw new Error('Supabase environment variables are missing.')
}

const supabase = createClient(url, key)

const localDb = new DatabaseSync('.redcourt-data/redcourt.sqlite')

const row = localDb
  .prepare('SELECT value FROM app_data WHERE key = ?')
  .get('accounts')

if (!row) {
  throw new Error('Local accounts were not found.')
}

const accounts = JSON.parse(row.value)

if (!Array.isArray(accounts) || accounts.length !== 4) {
  throw new Error('Expected exactly 4 existing accounts. Migration stopped.')
}

const { data: existing, error: checkError } = await supabase
  .from('app_data')
  .select('key')
  .eq('key', 'accounts')

if (checkError) throw checkError

if (existing.length > 0) {
  throw new Error('Accounts already exist in Supabase. Nothing was changed.')
}

const { error } = await supabase
  .from('app_data')
  .insert({
    key: 'accounts',
    value: JSON.stringify(accounts)
  })

if (error) throw error

const { data: verification, error: verifyError } = await supabase
  .from('app_data')
  .select('value')
  .eq('key', 'accounts')
  .single()

if (verifyError) throw verifyError

const migratedAccounts = JSON.parse(verification.value)

console.log('Account migration successful!')
console.log('Accounts transferred:', migratedAccounts.length)

localDb.close()
