import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { supabase, getAccounts } from './supabase.js'

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
) {
  if (request.method !== 'POST') {
    response.writeHead(405).end()
    return
  }

  try {
    let body = ''
    for await (const chunk of request) body += chunk

    const { username, password, role } = JSON.parse(body || '{}')
    const requestedRole = role === 'admin' ? 'admin' : 'player'

    const accounts = await getAccounts()
    const account = accounts.find((item: any) =>
      item.username.toLowerCase() === String(username || '').trim().toLowerCase()
      && item.role === requestedRole
    )

    const salt = account?.salt || '00'.repeat(16)
    const hash = account?.hash || scryptSync('invalid-password', salt, 64).toString('hex')
    const candidate = scryptSync(String(password || ''), salt, 64)
    const expected = Buffer.from(hash, 'hex')

    const valid = candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)

    if (!account || !valid) {
      response.writeHead(401, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        error: 'Username, password or account type is incorrect.'
      }))
      return
    }

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000)

    const { error } = await supabase.from('app_sessions').insert({
      token,
      username: account.username,
      role: account.role,
      expires_at: expiresAt.toISOString()
    })

    if (error) throw error

    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''

    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Set-Cookie': `redcourt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`
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
    response.end(JSON.stringify({ error: 'Login service error.' }))
  }
}