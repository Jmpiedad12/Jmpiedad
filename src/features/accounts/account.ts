export const defaultAuth = {
  name: '',
  username: '',
  password: '',
  phone: '',
  email: '',
  otp: '',
}
export type AuthForm = typeof defaultAuth
export type AuthMode = 'login' | 'signup'
export type AccountRole = 'player' | 'admin'

export type AccountProfile = {
  name: string
  birthdate: string
  phone: string
  email: string
}

export type SignedInUser = AccountProfile & { username: string; role: 'player' | 'admin' }

export const emptyAccountProfile: AccountProfile = { name: '', birthdate: '', phone: '', email: '' }

export const profileFromAccount = (account: Partial<AccountProfile>): AccountProfile => ({
  name: account.name || '',
  birthdate: account.birthdate || '',
  phone: account.phone || '',
  email: account.email || '',
})
