import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.AUTH_PORT || 4174)
const SESSION_DURATION = 8 * 60 * 60 * 1000
const OTP_DURATION = 10 * 60 * 1000
const DATA_DIRECTORY = path.join(process.cwd(), '.redcourt-data')
const ACCOUNTS_PATH = path.join(DATA_DIRECTORY, 'accounts.json')
const sessions = new Map()
const pendingOtps = new Map()
const authAttempts = new Map()
const otpAttempts = new Map()

mkdirSync(DATA_DIRECTORY, { recursive: true })
if (!existsSync(ACCOUNTS_PATH)) writeFileSync(ACCOUNTS_PATH, '[]\n', { flag: 'wx' })

const readAccounts = () => JSON.parse(readFileSync(ACCOUNTS_PATH, 'utf8'))

const saveAccounts = (accounts) => {
  const temporaryPath = `${ACCOUNTS_PATH}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, ACCOUNTS_PATH)
}

const hashPassword = (password, salt = randomBytes(16).toString('hex')) => ({
  salt,
  hash: scryptSync(password, salt, 64).toString('hex'),
})

const publicAccount = ({ username, role }) => ({ username, role })

const bootstrapAdmin = () => {
  const username = process.env.ADMIN_USERNAME?.trim()
  const password = process.env.ADMIN_PASSWORD
  if (!username && !password) {
    const accounts = readAccounts()
    const players = accounts.filter((account) => account.role !== 'admin')
    if (players.length !== accounts.length) saveAccounts(players)
    return
  }
  if (!username || !password || password.length < 12) {
    throw new Error('Set both ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters).')
  }

  const normalizedUsername = username.toLowerCase()
  const accounts = readAccounts().filter((account) => (
    account.role !== 'admin' || account.username.toLowerCase() === normalizedUsername
  ))
  const existing = accounts.find((account) => account.username.toLowerCase() === normalizedUsername)
  const credentials = hashPassword(password)
  if (existing) {
    Object.assign(existing, credentials, { username, role: 'admin' })
  } else {
    accounts.push({ username, role: 'admin', ...credentials, contact: null })
  }
  saveAccounts(accounts)
}

bootstrapAdmin()

const sendJson = (response, status, body, headers = {}) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

const readBody = (request) => new Promise((resolve, reject) => {
  let body = ''
  request.on('data', (chunk) => {
    body += chunk
    if (body.length > 16_384) {
      reject(new Error('Request is too large.'))
      request.destroy()
    }
  })
  request.on('end', () => {
    try {
      resolve(JSON.parse(body || '{}'))
    } catch {
      reject(new Error('Invalid request.'))
    }
  })
  request.on('error', reject)
})

const requestIp = (request) => request.socket.remoteAddress || 'unknown'

const allowAttempt = (store, key, maxAttempts, interval) => {
  const now = Date.now()
  const attempts = (store.get(key) || []).filter((time) => now - time < interval)
  if (attempts.length >= maxAttempts) return false
  attempts.push(now)
  store.set(key, attempts)
  return true
}

const normalizeContact = (value) => value.trim().toLowerCase()
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const isPhone = (value) => /^\+?[\d\s()-]{7,20}$/.test(value)

const deliverOtp = async (contact, code) => {
  if (isEmail(contact)) {
    const { RESEND_API_KEY, RESEND_FROM } = process.env
    if (!RESEND_API_KEY || !RESEND_FROM) throw new Error('Email OTP delivery is not configured on the server.')
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [contact],
        subject: 'Your Red Court verification code',
        text: `Your Red Court verification code is ${code}. It expires in 10 minutes.`,
      }),
    })
    if (!result.ok) throw new Error('The email provider could not send the OTP.')
    return
  }

  if (isPhone(contact)) {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      throw new Error('SMS OTP delivery is not configured on the server.')
    }
    const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
    const body = new URLSearchParams({
      To: contact.replace(/[\s()-]/g, ''),
      From: TWILIO_FROM_NUMBER,
      Body: `Your Red Court verification code is ${code}. It expires in 10 minutes.`,
    })
    const result = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!result.ok) throw new Error('The SMS provider could not send the OTP.')
    return
  }

  throw new Error('Enter a valid email address or phone number.')
}

const readSession = (request) => {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('redcourt_session='))
  const token = cookie?.slice('redcourt_session='.length)
  const session = token ? sessions.get(token) : null
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token)
    return null
  }
  return { token, account: readAccounts().find((account) => account.username === session.username) }
}

const startSession = (response, account) => {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { username: account.username, expiresAt: Date.now() + SESSION_DURATION })
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader('Set-Cookie', `redcourt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION / 1000}${secure}`)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  const route = `${request.method} ${url.pathname}`

  try {
    if (route === 'GET /api/auth/session') {
      const session = readSession(request)
      if (!session?.account) return sendJson(response, 401, { error: 'Not signed in.' })
      return sendJson(response, 200, { user: publicAccount(session.account) })
    }

    if (route === 'POST /api/auth/otp') {
      const body = await readBody(request)
      const contact = normalizeContact(String(body.contact || ''))
      const rateKey = `${requestIp(request)}:${contact}`
      if (!allowAttempt(otpAttempts, rateKey, 3, 60 * 60 * 1000)) {
        return sendJson(response, 429, { error: 'Too many OTP requests. Try again later.' })
      }
      const code = String(randomInt(100000, 1000000))
      await deliverOtp(contact, code)
      pendingOtps.set(contact, { hash: createHash('sha256').update(code).digest('hex'), expiresAt: Date.now() + OTP_DURATION, attempts: 0 })
      return sendJson(response, 200, { message: 'OTP sent. It expires in 10 minutes.' })
    }

    if (route === 'POST /api/auth/register') {
      const body = await readBody(request)
      const username = String(body.username || '').trim()
      const password = String(body.password || '')
      const contact = normalizeContact(String(body.contact || ''))
      const otp = String(body.otp || '')
      if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
        return sendJson(response, 400, { error: 'Username must be 3-32 characters using letters, numbers, dots, dashes or underscores.' })
      }
      if (password.length < 10) return sendJson(response, 400, { error: 'Password must be at least 10 characters.' })

      const pending = pendingOtps.get(contact)
      const submittedHash = createHash('sha256').update(otp).digest('hex')
      const hashesMatch = pending && timingSafeEqual(Buffer.from(pending.hash, 'hex'), Buffer.from(submittedHash, 'hex'))
      if (!pending || pending.expiresAt <= Date.now() || !hashesMatch || !/^\d{6}$/.test(otp)) {
        if (pending) {
          pending.attempts += 1
          if (pending.attempts >= 5) pendingOtps.delete(contact)
        }
        return sendJson(response, 400, { error: 'The OTP is invalid or expired.' })
      }

      const accounts = readAccounts()
      if (accounts.some((account) => account.username.toLowerCase() === username.toLowerCase())) {
        return sendJson(response, 409, { error: 'That username is already in use.' })
      }
      if (accounts.some((account) => account.contact === contact)) {
        return sendJson(response, 409, { error: 'That email or phone number is already in use.' })
      }

      const credentials = hashPassword(password)
      const account = { username, role: 'player', contact, ...credentials }
      accounts.push(account)
      saveAccounts(accounts)
      pendingOtps.delete(contact)
      startSession(response, account)
      return sendJson(response, 201, { user: publicAccount(account) })
    }

    if (route === 'POST /api/auth/login') {
      const body = await readBody(request)
      const username = String(body.username || '').trim()
      const password = String(body.password || '')
      const requestedRole = body.role === 'admin' ? 'admin' : 'player'
      const ip = requestIp(request)
      if (!allowAttempt(authAttempts, ip, 10, 15 * 60 * 1000)) {
        return sendJson(response, 429, { error: 'Too many login attempts. Try again later.' })
      }

      const account = readAccounts().find((item) => item.username.toLowerCase() === username.toLowerCase())
      const credentials = account || { salt: '00'.repeat(16), hash: scryptSync('invalid-password', '00'.repeat(16), 64).toString('hex') }
      const candidate = scryptSync(password, credentials.salt, 64)
      const expected = Buffer.from(credentials.hash, 'hex')
      const passwordMatches = candidate.length === expected.length && timingSafeEqual(candidate, expected)
      if (!account || !passwordMatches || account.role !== requestedRole) {
        return sendJson(response, 401, { error: 'Username, password or account type is incorrect.' })
      }

      startSession(response, account)
      return sendJson(response, 200, { user: publicAccount(account) })
    }

    if (route === 'POST /api/auth/logout') {
      const session = readSession(request)
      if (session) sessions.delete(session.token)
      return sendJson(response, 200, { ok: true }, {
        'Set-Cookie': 'redcourt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
      })
    }

    return sendJson(response, 404, { error: 'Not found.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed.'
    const status = /not configured|provider could not send/i.test(message) ? 503 : 400
    return sendJson(response, status, { error: message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Red Court auth API listening on http://127.0.0.1:${PORT}`)
})