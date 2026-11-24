import type { IncomingMessage, ServerResponse } from 'node:http'
import { supabase, getAccounts } from './supabase.js'

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
) {
  const cookie = request.headers.cookie?.split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('redcourt_session='))

  const token = cookie?.slice('redcourt_session='.length)

  if (!token) {
    response.writeHead(401, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Not signed in.' }))
    return
  }

  try {
    const { data, error } = await supabase
      .from('app_sessions')
      .select('username, role, expires_at')
      .eq('token', token)
      .single()

    if (error || !data || new Date(data.expires_at).getTime() <= Date.now()) {
      response.writeHead(401, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'Not signed in.' }))
      return
    }

    const accounts = await getAccounts()
    const account = accounts.find((item: any) =>
      item.username === data.username && item.role === data.role
    )

    if (!account) {
      response.writeHead(401, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'Account not found.' }))
      return
    }

    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    })
    response.end(JSON.stringify({
      user: {
        username: account.username,
        role: account.role,
        name: account.name || '',
        birthdate: account.birthdate || '',
        phone: account.phone || '',
        email: account.email || ''
      }
    }))
  } catch (error) {
    console.error(error)
    response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Session service error.' }))
  }
}