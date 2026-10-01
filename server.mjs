import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.AUTH_PORT || 4174)
const SESSION_DURATION = 8 * 60 * 60 * 1000
const OTP_DURATION = 10 * 60 * 1000
const ADMIN_LIMIT = 5
const DATA_DIRECTORY = path.join(process.cwd(), '.redcourt-data')
const ACCOUNTS_PATH = path.join(DATA_DIRECTORY, 'accounts.json')
const BOOKINGS_PATH = path.join(DATA_DIRECTORY, 'bookings.json')
const HOURLY_RATES = { Pickleball: 200, Badminton: 175 }
const RACKET_RENTAL_PER_DAY = 100
const SHUTTLECOCK_PRICE = 140
const COURT_SPORTS = {
  1: ['Pickleball', 'Badminton'],
  2: ['Pickleball', 'Badminton'],
  3: ['Pickleball', 'Badminton'],
  4: ['Badminton'],
  5: ['Badminton'],
  6: ['Badminton'],
  7: ['Badminton'],
  8: ['Badminton'],
  9: ['Badminton'],
}
const BOOKING_TIMES = new Set(Array.from({ length: 14 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`))
const sessions = new Map()
const pendingOtps = new Map()
const authAttempts = new Map()
const otpAttempts = new Map()

mkdirSync(DATA_DIRECTORY, { recursive: true })
if (!existsSync(ACCOUNTS_PATH)) writeFileSync(ACCOUNTS_PATH, '[]\n', { flag: 'wx' })
if (!existsSync(BOOKINGS_PATH)) writeFileSync(BOOKINGS_PATH, '[]\n', { flag: 'wx' })

const readAccounts = () => JSON.parse(readFileSync(ACCOUNTS_PATH, 'utf8'))
const readBookings = () => JSON.parse(readFileSync(BOOKINGS_PATH, 'utf8'))

const saveAccounts = (accounts) => {
  const temporaryPath = `${ACCOUNTS_PATH}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, ACCOUNTS_PATH)
}

const saveBookings = (bookings) => {
  const temporaryPath = `${BOOKINGS_PATH}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(bookings, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, BOOKINGS_PATH)
}

const bookingSlots = (booking) => booking.slots ?? (
  booking.courtId == null
    ? []
    : (booking.times ?? (booking.time ? [booking.time] : [])).map((time) => ({ courtId: booking.courtId, time }))
)

const validBookingSlots = (slots, sport, allowEmpty = false) => (
  Array.isArray(slots) && slots.length <= 36 && (allowEmpty || slots.length > 0) &&
  slots.every((slot) => (
    Number.isInteger(slot?.courtId) && COURT_SPORTS[slot.courtId]?.includes(sport) &&
    BOOKING_TIMES.has(slot.time)
  )) && new Set(slots.map((slot) => `${slot.courtId}:${slot.time}`)).size === slots.length
)

const hasBookingConflict = (bookings, date, slots, ignoreId = null) => bookings.some((booking) => (
  booking.id !== ignoreId && booking.date === date && ['pending', 'confirmed'].includes(booking.status) &&
  bookingSlots(booking).some((existingSlot) => slots.some((slot) => (
    slot.courtId === existingSlot.courtId && slot.time === existingSlot.time
  )))
))

const validBookingDate = (date) => (
  /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
)

const hashPassword = (password, salt = randomBytes(16).toString('hex')) => ({
  salt,
  hash: scryptSync(password, salt, 64).toString('hex'),
})

const publicAccount = (account) => ({
  username: account.username,
  role: account.role,
  name: account.name || '',
  birthdate: account.birthdate || '',
  phone: account.phone || (account.contact && !account.contact.includes('@') ? account.contact : ''),
  email: account.email || (account.contact?.includes('@') ? account.contact : ''),
})

const bootstrapAdmin = () => {
  const username = process.env.ADMIN_USERNAME?.trim()
  const password = process.env.ADMIN_PASSWORD
  if (!username && !password) return
  if (!username || !password || password.length < 12) {
    throw new Error('Set both ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters).')
  }

  const normalizedUsername = username.toLowerCase()
  const accounts = readAccounts()
  const existing = accounts.find((account) => account.username.toLowerCase() === normalizedUsername)
  const adminCount = accounts.filter((account) => account.role === 'admin').length
  if ((!existing || existing.role !== 'admin') && adminCount >= ADMIN_LIMIT) {
    throw new Error(`No more than ${ADMIN_LIMIT} admin accounts are allowed.`)
  }
  const credentials = hashPassword(password)
  if (existing) {
    Object.assign(existing, credentials, { username, role: 'admin' })
  } else {
    accounts.push({ username, role: 'admin', ...credentials, contact: null })
  }
  saveAccounts(accounts)
}

const bootstrapPlayer = () => {
  const username = process.env.PLAYER_USERNAME?.trim()
  const password = process.env.PLAYER_PASSWORD
  if (!username && !password) return
  if (!username || !password || password.length < 10) {
    throw new Error('Set both PLAYER_USERNAME and PLAYER_PASSWORD (at least 10 characters).')
  }

  const normalizedUsername = username.toLowerCase()
  const accounts = readAccounts()
  const existing = accounts.find((account) => (
    account.username.toLowerCase() === normalizedUsername && account.role === 'player'
  ))
  const credentials = hashPassword(password)
  if (existing) {
    Object.assign(existing, credentials, { username, role: 'player' })
  } else {
    accounts.push({ username, role: 'player', ...credentials, contact: null })
  }
  saveAccounts(accounts)
}

bootstrapAdmin()
bootstrapPlayer()

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

const deliverSms = async (contact, message) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error('SMS delivery is not configured on the server.')
  }
  const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
  const body = new URLSearchParams({
    To: contact.replace(/[\s()-]/g, ''),
    From: TWILIO_FROM_NUMBER,
    Body: message,
  })
  const result = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!result.ok) throw new Error('The SMS provider could not send the message.')
}

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
    await deliverSms(contact, `Your Red Court verification code is ${code}. It expires in 10 minutes.`)
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
  return {
    token,
    account: readAccounts().find((account) => (
      account.username === session.username && account.role === session.role
    )),
  }
}

const startSession = (response, account) => {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { username: account.username, role: account.role, expiresAt: Date.now() + SESSION_DURATION })
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader('Set-Cookie', `redcourt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION / 1000}${secure}`)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  const route = `${request.method} ${url.pathname}`

  try {
    if (route === 'GET /api/bookings') {
      const session = readSession(request)
      if (!session?.account) return sendJson(response, 401, { error: 'Sign in to view reservations.' })
      const bookings = readBookings()
      return sendJson(response, 200, {
        bookings: session.account.role === 'admin'
          ? bookings
          : bookings.map((booking) => booking.user === session.account.username ? booking : { ...booking, user: '' }),
      })
    }

    if (route === 'POST /api/bookings') {
      const session = readSession(request)
      if (!session?.account) return sendJson(response, 401, { error: 'Your session expired. Please sign in again as a player.' })
      if (session.account.role !== 'player') return sendJson(response, 403, { error: 'A player account is required to reserve court times.' })
      const account = session.account
      if (![account.name, account.birthdate, account.phone || account.contact, account.email].every((value) => value?.trim())) {
        return sendJson(response, 400, { error: 'Complete your personal information before booking a court.' })
      }

      const body = await readBody(request)
      const date = String(body.date || '')
      const sport = String(body.sport || '')
      const slots = Array.isArray(body.slots) ? body.slots : []
      const racketRental = body.racketRental === true
      const shuttlecockQuantity = Number(body.shuttlecockQuantity || 0)
      const equipmentOnly = slots.length === 0 && (racketRental || shuttlecockQuantity > 0)
      if (!validBookingDate(date) || !Object.hasOwn(HOURLY_RATES, sport) || !validBookingSlots(slots, sport, true)) {
        return sendJson(response, 400, { error: 'Reservation date, sport, or time slots are invalid.' })
      }
      if (!Number.isInteger(shuttlecockQuantity) || shuttlecockQuantity < 0 || shuttlecockQuantity > 100) {
        return sendJson(response, 400, { error: 'Shuttlecock quantity must be between 0 and 100.' })
      }
      if ((racketRental || shuttlecockQuantity > 0) && sport !== 'Badminton') {
        return sendJson(response, 400, { error: 'Racket rental and shuttlecocks are only available for Badminton.' })
      }
      if (slots.length === 0 && !equipmentOnly) {
        return sendJson(response, 400, { error: 'Select a court time or a badminton add-on.' })
      }

      const bookings = readBookings()
      if (hasBookingConflict(bookings, date, slots)) {
        return sendJson(response, 409, { error: 'One or more selected court times were just reserved. Refresh availability and choose another slot.' })
      }

      const booking = {
        id: randomBytes(12).toString('hex'),
        user: account.username,
        date,
        slots,
        sport,
        deposit: HOURLY_RATES[sport] * slots.length
          + (racketRental ? RACKET_RENTAL_PER_DAY : 0)
          + shuttlecockQuantity * SHUTTLECOCK_PRICE,
        racketRental,
        shuttlecockQuantity,
        status: 'pending',
        refundIssued: false,
      }
      bookings.unshift(booking)
      saveBookings(bookings)
      return sendJson(response, 201, { booking })
    }

    if (route === 'POST /api/bookings/import-legacy') {
      const session = readSession(request)
      if (session?.account?.role !== 'admin') return sendJson(response, 403, { error: 'Admin access required.' })
      const body = await readBody(request)
      const legacyBookings = Array.isArray(body.bookings) ? body.bookings.slice(0, 1000) : []
      const accounts = readAccounts().filter((account) => account.role === 'player')
      const bookings = readBookings()
      const existingIds = new Set(bookings.map((booking) => booking.id))
      let imported = 0
      let skippedConflicts = 0

      for (const legacy of legacyBookings) {
        if (!legacy || typeof legacy !== 'object' || typeof legacy.id !== 'string' || existingIds.has(legacy.id)) continue
        const account = accounts.find((item) => item.username.toLowerCase() === String(legacy.user || '').toLowerCase())
        const date = String(legacy.date || '')
        const sport = String(legacy.sport || '')
        const slots = bookingSlots(legacy)
        const racketRental = legacy.racketRental === true
        const shuttlecockQuantity = Number(legacy.shuttlecockQuantity || 0)
        const status = ['pending', 'confirmed', 'cancelled', 'rejected'].includes(legacy.status) ? legacy.status : null
        if (!account || !validBookingDate(date) || !Object.hasOwn(HOURLY_RATES, sport) || !status ||
          !validBookingSlots(slots, sport, true) || !Number.isInteger(shuttlecockQuantity) || shuttlecockQuantity < 0 || shuttlecockQuantity > 100 ||
          (slots.length === 0 && !racketRental && shuttlecockQuantity === 0)) continue
        if (['pending', 'confirmed'].includes(status) && hasBookingConflict(bookings, date, slots)) {
          skippedConflicts += 1
          continue
        }
        bookings.push({
          id: legacy.id,
          user: account.username,
          date,
          slots,
          sport,
          deposit: Number.isFinite(Number(legacy.deposit)) ? Number(legacy.deposit) : 0,
          racketRental,
          shuttlecockQuantity,
          status,
          refundIssued: legacy.refundIssued === true,
        })
        existingIds.add(legacy.id)
        imported += 1
      }

      if (imported > 0) saveBookings(bookings)
      return sendJson(response, 200, { imported, skippedConflicts })
    }

    const bookingAction = request.method === 'POST'
      ? url.pathname.match(/^\/api\/bookings\/([^/]+)\/(confirm|reject|cancel)$/)
      : null
    if (bookingAction) {
      const session = readSession(request)
      if (!session?.account) return sendJson(response, 401, { error: 'Sign in to update a reservation.' })
      const bookingId = decodeURIComponent(bookingAction[1])
      const action = bookingAction[2]
      const bookings = readBookings()
      const index = bookings.findIndex((booking) => booking.id === bookingId)
      if (index === -1) return sendJson(response, 404, { error: 'Reservation not found.' })
      const booking = bookings[index]

      if (action === 'cancel') {
        if (session.account.role !== 'player' || booking.user !== session.account.username) {
          return sendJson(response, 403, { error: 'You can only cancel your own reservation.' })
        }
        if (!['pending', 'confirmed'].includes(booking.status)) {
          return sendJson(response, 409, { error: 'This reservation can no longer be cancelled.' })
        }
        booking.status = 'cancelled'
        booking.refundIssued = false
      } else {
        if (session.account.role !== 'admin') return sendJson(response, 403, { error: 'Admin access required.' })
        if (action === 'confirm' && booking.status !== 'pending') {
          return sendJson(response, 409, { error: 'Only pending reservations can be confirmed.' })
        }
        if (action === 'reject' && !['pending', 'confirmed'].includes(booking.status)) {
          return sendJson(response, 409, { error: 'This reservation can no longer be rejected.' })
        }
        booking.status = action === 'confirm' ? 'confirmed' : 'rejected'
        booking.refundIssued = action === 'reject'
      }

      saveBookings(bookings)
      return sendJson(response, 200, { booking })
    }

    if (route === 'GET /api/auth/session') {
      const session = readSession(request)
      if (!session?.account) return sendJson(response, 401, { error: 'Not signed in.' })
      return sendJson(response, 200, { user: publicAccount(session.account) })
    }

    if (route === 'PUT /api/account/profile') {
      const session = readSession(request)
      if (!session?.account) return sendJson(response, 401, { error: 'Sign in to manage your account.' })

      const body = await readBody(request)
      const name = String(body.name || '').trim()
      const birthdate = String(body.birthdate || '').trim()
      const phone = normalizeContact(String(body.phone || ''))
      const email = normalizeContact(String(body.email || ''))
      const today = new Date().toISOString().slice(0, 10)
      if (name.length < 2 || name.length > 100) {
        return sendJson(response, 400, { error: 'Name must be between 2 and 100 characters.' })
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || Number.isNaN(Date.parse(`${birthdate}T00:00:00Z`)) || birthdate > today) {
        return sendJson(response, 400, { error: 'Enter a valid birthdate that is not in the future.' })
      }
      if (!isPhone(phone)) return sendJson(response, 400, { error: 'Enter a valid contact number.' })
      if (!isEmail(email)) return sendJson(response, 400, { error: 'Enter a valid email address.' })

      const accounts = readAccounts()
      const accountIndex = accounts.findIndex((account) => (
        account.username === session.account.username && account.role === session.account.role
      ))
      if (accountIndex === -1) return sendJson(response, 401, { error: 'Account not found.' })
      const duplicateContact = accounts.some((account, index) => (
        index !== accountIndex && (account.phone === phone || account.email === email || account.contact === phone || account.contact === email)
      ))
      if (duplicateContact) return sendJson(response, 409, { error: 'That phone number or email is already in use.' })

      Object.assign(accounts[accountIndex], { name, birthdate, phone, email })
      saveAccounts(accounts)
      return sendJson(response, 200, { user: publicAccount(accounts[accountIndex]) })
    }

    if (route === 'POST /api/admin/reservations/confirmed') {
      const session = readSession(request)
      if (session?.account?.role !== 'admin') return sendJson(response, 403, { error: 'Admin access required.' })

      const body = await readBody(request)
      const username = String(body.username || '').trim()
      const date = String(body.date || '').trim()
      const slots = Array.isArray(body.slots) ? body.slots : []
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
      const validSlots = slots.length > 0 && slots.length <= 36 && slots.every((slot) => (
        Number.isInteger(slot.courtId) && slot.courtId >= 1 && slot.courtId <= 9 &&
        /^(?:0[89]|1\d|2[01]):00$/.test(String(slot.time))
      ))
      if (!username || !validDate || !validSlots) {
        return sendJson(response, 400, { error: 'Reservation confirmation details are invalid.' })
      }

      const account = readAccounts().find((item) => (
        item.username.toLowerCase() === username.toLowerCase() && item.role === 'player'
      ))
      if (!account) return sendJson(response, 404, { error: 'Player account not found.' })
      const phone = account.phone || (isPhone(account.contact || '') ? account.contact : '')
      if (!isPhone(phone || '')) return sendJson(response, 400, { error: 'This user has no valid contact number on their account.' })

      const day = new Intl.DateTimeFormat('en-PH', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${date}T00:00:00Z`))
      const courtTimes = [...new Set(slots.map((slot) => slot.courtId))].map((courtId) => {
        const times = slots.filter((slot) => slot.courtId === courtId).map((slot) => slot.time).join(', ')
        return `Court ${courtId} at ${times}`
      }).join('; ')
      const name = account.name?.trim() || account.username
      await deliverSms(phone, `Hi ${name}, your Red Court reservation is confirmed for ${day}: ${courtTimes}.`)
      return sendJson(response, 200, { ok: true, phoneLastFour: phone.replace(/\D/g, '').slice(-4) })
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

      const role = body.role === 'admin' ? 'admin-pending' : 'player'
      if (role === 'admin-pending' && accounts.filter((account) => account.role === 'admin').length >= ADMIN_LIMIT) {
        return sendJson(response, 409, { error: `The limit of ${ADMIN_LIMIT} admin accounts has been reached.` })
      }

      const credentials = hashPassword(password)
      const account = { username, role, contact, ...credentials }
      accounts.push(account)
      saveAccounts(accounts)
      pendingOtps.delete(contact)
      if (role === 'admin-pending') {
        return sendJson(response, 202, { pendingApproval: true, message: 'Your admin account request was sent for approval.' })
      }
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

      const account = readAccounts().find((item) => (
        item.username.toLowerCase() === username.toLowerCase() && item.role === requestedRole
      ))
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

    if (route === 'GET /api/admin/requests') {
      const session = readSession(request)
      if (session?.account?.role !== 'admin') return sendJson(response, 403, { error: 'Admin access required.' })
      const accounts = readAccounts()
      return sendJson(response, 200, {
        requests: accounts
          .filter((account) => account.role === 'admin-pending')
          .map(({ username, contact }) => ({ username, contact })),
        activeAdminCount: accounts.filter((account) => account.role === 'admin').length,
        adminLimit: ADMIN_LIMIT,
      })
    }

    const adminRequestAction = request.method === 'POST'
      ? url.pathname.match(/^\/api\/admin\/requests\/([^/]+)\/(approve|reject)$/)
      : null
    if (adminRequestAction) {
      const session = readSession(request)
      if (session?.account?.role !== 'admin') return sendJson(response, 403, { error: 'Admin access required.' })

      const username = decodeURIComponent(adminRequestAction[1])
      const action = adminRequestAction[2]
      const accounts = readAccounts()
      const requestIndex = accounts.findIndex((account) => (
        account.role === 'admin-pending' && account.username.toLowerCase() === username.toLowerCase()
      ))
      if (requestIndex === -1) return sendJson(response, 404, { error: 'Admin request not found.' })

      if (action === 'approve') {
        const activeAdminCount = accounts.filter((account) => account.role === 'admin').length
        if (activeAdminCount >= ADMIN_LIMIT) {
          return sendJson(response, 409, { error: `The limit of ${ADMIN_LIMIT} admin accounts has been reached.` })
        }
        accounts[requestIndex].role = 'admin'
      } else {
        accounts.splice(requestIndex, 1)
      }

      saveAccounts(accounts)
      return sendJson(response, 200, {
        ok: true,
        activeAdminCount: accounts.filter((account) => account.role === 'admin').length,
      })
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