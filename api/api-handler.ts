/// <reference types="node" />

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { getAccounts, saveAccounts, supabase } from './auth/supabase.js'
import { sendSignupOtp, verifySignupOtp } from './auth/supabase-auth.js'
import { sendEmailNotification } from './notifications/email.js'

const SESSION_DURATION = 8 * 60 * 60 * 1000
const ADMIN_LIMIT = 5
const HOURLY_RATES = { Pickleball: 400, Badminton: 350, 'Sepak Takraw': 400 }
const RACKET_RENTAL_PER_DAY = 100
const SHUTTLECOCK_PRICE = 140
const COURT_SPORTS: Record<number, string[]> = {
  1: ['Pickleball', 'Badminton', 'Sepak Takraw'],
  2: ['Pickleball', 'Badminton', 'Sepak Takraw'],
  3: ['Pickleball', 'Badminton', 'Sepak Takraw'],
  4: ['Badminton'],
  5: ['Badminton'],
  6: ['Badminton'],
  7: ['Badminton'],
  8: ['Badminton'],
  9: ['Badminton'],
}
const BOOKING_TIMES = new Set(Array.from({ length: 31 }, (_, index) => {
  const minutes = 8 * 60 + index * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}))

type BookingSlot = { courtId: number; time: string; durationMinutes?: number }
type Booking = {
  id: string
  user: string
  date: string
  slots: BookingSlot[]
  sport: string
  totalPrice?: number
  deposit: number
  racketRental: boolean
  racketRentalQuantity?: number
  shuttlecockQuantity: number
  status: string
  createdAt: string
  statusUpdatedAt?: string
  statusHistory: { status: string; at: string; message: string }[]
  refundIssued: boolean
  [key: string]: unknown
}
type Account = {
  username: string
  role: string
  salt?: string
  hash?: string
  name?: string
  birthdate?: string
  phone?: string
  email?: string
  contact?: string | null
  [key: string]: unknown
}
type Session = { token: string; account: Account }

const parseJson = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value

const readAccounts = async (): Promise<Account[]> => {
  const accounts = await getAccounts()
  if (!Array.isArray(accounts)) throw new Error('The stored account data is invalid.')
  return accounts as Account[]
}

const readBookings = async (): Promise<Booking[]> => {
  const { data, error } = await supabase
    .from('app_bookings')
    .select('record')
    .order('created_at', { ascending: false })
  if (error) throw error

  const bookings = (data || []).map((row) => parseJson(row.record) as Booking)
  const now = Date.now()
  for (const booking of bookings) {
    if (booking.status !== 'confirmed') continue
    const lastMinute = bookingSlots(booking).reduce((latest, slot) => (
      Math.max(latest, slotEndMinutes(slot.time, slot.durationMinutes))
    ), 0)
    if (!lastMinute) continue
    const endTime = Date.parse(`${booking.date}T00:00:00+08:00`) + lastMinute * 60_000
    if (!Number.isFinite(endTime) || endTime > now) continue
    const expectedStatus = booking.status
    booking.status = 'completed'
    booking.statusUpdatedAt = new Date(now).toISOString()
    booking.statusHistory = [...(booking.statusHistory || []), {
      status: 'completed',
      at: booking.statusUpdatedAt,
      message: 'Reservation completed after the scheduled court time.',
    }]
    if (!await persistBooking(booking, expectedStatus)) {
      const { data: latest, error: latestError } = await supabase
        .from('app_bookings')
        .select('record')
        .eq('id', booking.id)
        .maybeSingle()
      if (latestError) throw latestError
      if (latest) Object.assign(booking, parseJson(latest.record))
    }
  }
  return bookings
}

const readBlocks = async () => {
  const { data, error } = await supabase
    .from('app_schedule_blocks')
    .select('record')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map((row) => parseJson(row.record))
}

const bookingSlots = (booking: Partial<Booking> & { courtId?: number; times?: string[]; time?: string }): BookingSlot[] => (
  booking.slots ?? (
    booking.courtId == null
      ? []
      : (booking.times ?? (booking.time ? [booking.time] : [])).map((time) => ({ courtId: booking.courtId as number, time }))
  )
)

const slotStartMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const slotDurationMinutes = (slot: BookingSlot) => slot.durationMinutes ?? 60
const slotEndMinutes = (time: string, durationMinutes = 60) => slotStartMinutes(time) + durationMinutes
const formatBookingTimeRange = (time: string, durationMinutes = 60) => {
  const format = (minutes: number) => {
    const hour = Math.floor(minutes / 60) % 24
    const minute = minutes % 60
    return {
      clock: `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}`,
      period: hour < 12 ? 'AM' : 'PM',
    }
  }
  const start = format(slotStartMinutes(time))
  const end = format(slotEndMinutes(time, durationMinutes))
  return `${start.period === end.period ? start.clock : `${start.clock} ${start.period}`}–${end.clock} ${end.period}`
}
const slotsOverlap = (left: BookingSlot, right: BookingSlot) => (
  left.courtId === right.courtId &&
  slotStartMinutes(left.time) < slotEndMinutes(right.time, slotDurationMinutes(right)) &&
  slotStartMinutes(right.time) < slotEndMinutes(left.time, slotDurationMinutes(left))
)
const hasOverlappingSlots = (slots: BookingSlot[]) => slots.some((slot, index) => (
  slots.slice(index + 1).some((other) => slotsOverlap(slot, other))
))

const validBookingSlots = (slots: unknown, sport: string, allowEmpty = false): slots is BookingSlot[] => (
  Array.isArray(slots) && slots.length <= 36 && (allowEmpty || slots.length > 0) &&
  slots.every((slot) => (
    Number.isInteger(slot?.courtId) && COURT_SPORTS[slot.courtId]?.includes(sport) &&
    BOOKING_TIMES.has(slot.time) &&
    (slot.durationMinutes === undefined || (
      Number.isInteger(slot.durationMinutes) && slot.durationMinutes >= 60 &&
      slot.durationMinutes % 30 === 0 && slotEndMinutes(slot.time, slot.durationMinutes) <= 24 * 60
    ))
  )) && new Set(slots.map((slot) => `${slot.courtId}:${slot.time}`)).size === slots.length &&
  !hasOverlappingSlots(slots)
)

const validScheduleSlots = (slots: unknown): slots is BookingSlot[] => (
  Array.isArray(slots) && slots.length > 0 && slots.length <= 36 &&
  slots.every((slot) => Number.isInteger(slot?.courtId) && COURT_SPORTS[slot.courtId] && BOOKING_TIMES.has(slot.time) && slot.durationMinutes === undefined && slotEndMinutes(slot.time) <= 24 * 60) &&
  new Set(slots.map((slot) => `${slot.courtId}:${slot.time}`)).size === slots.length &&
  !hasOverlappingSlots(slots)
)

const validBookingDate = (date: string) => (
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
)

const manilaToday = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

const isFutureBooking = (date: string, slots: BookingSlot[]) => (
  date >= manilaToday() &&
  slots.every((slot) => Date.parse(`${date}T${slot.time}:00+08:00`) > Date.now())
)

const hashPassword = (password: string, salt = randomBytes(16).toString('hex')) => ({
  salt,
  hash: scryptSync(password, salt, 64).toString('hex'),
})

const publicAccount = (account: Account) => ({
  username: account.username,
  role: account.role,
  name: account.name || '',
  birthdate: account.birthdate || '',
  phone: account.phone || (account.contact && !account.contact.includes('@') ? account.contact : ''),
  email: account.email || (account.contact?.includes('@') ? account.contact : ''),
})

const bootstrapAccounts = async () => {
  const adminUsername = process.env.ADMIN_USERNAME?.trim()
  const adminPassword = process.env.ADMIN_PASSWORD
  const playerUsername = process.env.PLAYER_USERNAME?.trim()
  const playerPassword = process.env.PLAYER_PASSWORD
  if (!adminUsername && !adminPassword && !playerUsername && !playerPassword) return

  const accounts = await readAccounts()
  let changed = false
  if (adminUsername || adminPassword) {
    if (!adminUsername || !adminPassword || adminPassword.length < 12) {
      throw new Error('Set both ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters).')
    }
    const existing = accounts.find((account) => account.username.toLowerCase() === adminUsername.toLowerCase())
    if ((!existing || existing.role !== 'admin') && accounts.filter((account) => account.role === 'admin').length >= ADMIN_LIMIT) {
      throw new Error(`No more than ${ADMIN_LIMIT} admin accounts are allowed.`)
    }
    const credentials = hashPassword(adminPassword)
    if (existing) Object.assign(existing, credentials, { username: adminUsername, role: 'admin' })
    else accounts.push({ username: adminUsername, role: 'admin', ...credentials, contact: null })
    changed = true
  }
  if (playerUsername || playerPassword) {
    if (!playerUsername || !playerPassword || playerPassword.length < 10) {
      throw new Error('Set both PLAYER_USERNAME and PLAYER_PASSWORD (at least 10 characters).')
    }
    const existing = accounts.find((account) => (
      account.username.toLowerCase() === playerUsername.toLowerCase() && account.role === 'player'
    ))
    const credentials = hashPassword(playerPassword)
    if (existing) Object.assign(existing, credentials, { username: playerUsername, role: 'player' })
    else accounts.push({ username: playerUsername, role: 'player', ...credentials, contact: null })
    changed = true
  }
  if (changed) await saveAccounts(accounts)
}

let bootstrapPromise: Promise<void> | null = null
const ensureBootstrapped = async () => {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapAccounts().catch((error) => {
      bootstrapPromise = null
      throw error
    })
  }
  await bootstrapPromise
}

const sendJson = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

const readBody = async (request: IncomingMessage): Promise<Record<string, any>> => {
  let body = ''
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    if (body.length > 16_384) throw Object.assign(new Error('Request is too large.'), { status: 413 })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body || '{}')
  } catch {
    throw Object.assign(new Error('Invalid request.'), { status: 400 })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('Invalid request.'), { status: 400 })
  }
  return parsed as Record<string, any>
}

const requestIp = (request: IncomingMessage) => {
  const forwarded = request.headers['x-forwarded-for']
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  const realIp = request.headers['x-real-ip']
  return (Array.isArray(realIp) ? realIp[0] : realIp) || forwardedIp?.trim() || request.socket.remoteAddress || 'unknown'
}

const allowAttempt = async (request: IncomingMessage, key: string, maxAttempts: number, interval: number) => {
  const rateKey = createHash('sha256').update(`${requestIp(request)}:${key}`).digest('hex')
  const { data, error } = await supabase.rpc('allow_app_rate_limit', {
    p_rate_key: rateKey,
    p_limit: maxAttempts,
    p_window_seconds: Math.ceil(interval / 1000),
  })
  if (error) throw error
  return data === true
}

const normalizeContact = (value: string) => value.trim().toLowerCase()
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const isPhone = (value: string) => /^\+?[\d\s()-]{7,20}$/.test(value)

const deliverSms = async (contact: string, message: string) => {
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

const notifyBookingStatus = async (booking: Booking, account: Account) => {
  const approved = booking.status === 'confirmed'
  const statusText = approved ? 'approved' : 'rejected'
  const day = new Intl.DateTimeFormat('en-PH', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${booking.date}T00:00:00Z`))
  const courtTimes = bookingSlots(booking).map((slot) => `Court ${slot.courtId} ${formatBookingTimeRange(slot.time, slot.durationMinutes)}`).join(', ')
  const fullName = String(account.name || '').trim() || account.username
  const phone = account.phone || (isPhone(account.contact || '') ? account.contact : '')
  const email = account.email || (account.contact?.includes('@') ? account.contact : '')
  const addOns = [
    (booking.racketRentalQuantity ?? (booking.racketRental ? 1 : 0)) > 0
      ? `Rental rackets: ${booking.racketRentalQuantity ?? 1}`
      : null,
    booking.shuttlecockQuantity > 0 ? `Shuttlecocks: ${booking.shuttlecockQuantity}` : null,
  ].filter(Boolean).join(', ') || 'None'
  const details = [
    `Full name: ${fullName}`,
    `Phone: ${phone || 'Not provided'}`,
    `Email: ${email || 'Not provided'}`,
    `Date: ${day}`,
    `Court and time: ${courtTimes || 'No court booking'}`,
    `Add-ons: ${addOns}`,
  ].join('\n')
  const message = approved
    ? `Hi ${fullName}, your Red Court reservation was approved.\n\nReservation details:\n${details}`
    : `Hi ${fullName}, your Red Court reservation for ${day}${courtTimes ? ` (${courtTimes})` : ''} was rejected. Any payment will be handled according to the refund policy.`

  if (email) {
    try {
      await sendEmailNotification(email, `Red Court reservation ${statusText}`, message)
    } catch (error) {
      console.error(`Reservation email notification failed for booking ${booking.id}:`, error)
    }
  }
  if (phone && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
    try {
      await deliverSms(phone, message)
    } catch (error) {
      console.error(`Reservation SMS notification failed for booking ${booking.id}:`, error)
    }
  }
}

const readSession = async (request: IncomingMessage): Promise<Session | null> => {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('redcourt_session='))
  const token = cookie?.slice('redcourt_session='.length)
  if (!token) return null

  const { data, error } = await supabase
    .from('app_sessions')
    .select('username, role, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (error) throw error
  if (!data || new Date(data.expires_at).getTime() <= Date.now()) {
    if (data) {
      const { error: deleteError } = await supabase.from('app_sessions').delete().eq('token', token)
      if (deleteError) throw deleteError
    }
    return null
  }

  const account = (await readAccounts()).find((item) => item.username === data.username && item.role === data.role)
  return account ? { token, account } : null
}

const startSession = async (response: ServerResponse, account: Account) => {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DURATION)
  const { error } = await supabase.from('app_sessions').insert({
    token,
    username: account.username,
    role: account.role,
    expires_at: expiresAt.toISOString(),
  })
  if (error) throw error

  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader('Set-Cookie', `redcourt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION / 1000}${secure}`)
}

const persistBooking = async (booking: Booking, expectedStatus: string) => {
  const { data, error } = await supabase.rpc('update_app_booking', {
    p_record: booking,
    p_expected_status: expectedStatus,
  })
  if (error) throw error
  return data === true
}

const saveNewBooking = async (booking: Booking) => {
  const { error } = await supabase.rpc('create_app_booking', { p_record: booking })
  if (error) throw error
}

const isSlotConflict = (error: { code?: string; message?: string }) => (
  error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '')
)

const errorStatus = (error: unknown) => {
  const candidate = error as { status?: number; code?: string; message?: string }
  if (candidate.status) return candidate.status
  if (candidate.code === '40001') return 409
  if (['PGRST202', 'PGRST205', '42P01', '42703', '42883'].includes(candidate.code || '')) return 503
  if (candidate.code === '23505' || /duplicate key|unique constraint/i.test(candidate.message || '')) return 409
  if (/not configured|provider could not send/i.test(candidate.message || '')) return 503
  return 500
}

const isMissingSupabaseSchema = (error: unknown) => (
  ['PGRST202', 'PGRST205', '42P01', '42703', '42883'].includes((error as { code?: string }).code || '')
)

const handler = async (request: IncomingMessage, response: ServerResponse) => {
  try {
    await ensureBootstrapped()
    const url = new URL(request.url || '/', 'http://localhost')
    const rewrittenPath = url.searchParams.get('__route')
    const pathname = (rewrittenPath ? `/api/${rewrittenPath.replace(/^\/+/, '')}` : url.pathname)
      .replace(/\/+$/, '') || '/'
    const route = `${request.method} ${pathname}`

    if (route === 'GET /api/health') {
      return sendJson(response, 200, { status: 'API working' })
    }

    if (route === 'GET /api/blocks') {
      const session = await readSession(request)
      if (!session) return sendJson(response, 401, { error: 'Sign in to view the court schedule.' })
      return sendJson(response, 200, { blocks: await readBlocks() })
    }

    if (route === 'POST /api/admin/blocks') {
      const session = await readSession(request)
      if (session?.account.role !== 'admin') return sendJson(response, 403, { error: 'Admin access required.' })
      const body = await readBody(request)
      const date = String(body.date || '')
      const slots = body.slots
      const reason = String(body.reason || '').trim()
      if (!validBookingDate(date) || !validScheduleSlots(slots) || reason.length < 3 || reason.length > 120) {
        return sendJson(response, 400, { error: 'Enter a valid date, at least one court time, and a reason of 3-120 characters.' })
      }

      const block = {
        id: randomBytes(12).toString('hex'),
        date,
        slots,
        reason,
        createdAt: new Date().toISOString(),
        createdBy: session.account.username,
      }
      const { error } = await supabase.rpc('create_app_schedule_block', { p_record: block })
      if (error) {
        if (isSlotConflict(error)) return sendJson(response, 409, { error: 'A selected court time is already reserved or blocked.' })
        throw error
      }
      return sendJson(response, 201, { block })
    }

    const blockAction = request.method === 'DELETE'
      ? pathname.match(/^\/api\/admin\/blocks\/([^/]+)$/)
      : null
    if (blockAction) {
      const session = await readSession(request)
      if (session?.account.role !== 'admin') return sendJson(response, 403, { error: 'Admin access required.' })
      const { data, error } = await supabase.rpc('delete_app_schedule_block', { p_id: decodeURIComponent(blockAction[1]) })
      if (error) throw error
      if (data !== true) return sendJson(response, 404, { error: 'Schedule block not found.' })
      return sendJson(response, 200, { ok: true })
    }

    if (route === 'GET /api/bookings') {
      const session = await readSession(request)
      if (!session) return sendJson(response, 401, { error: 'Sign in to view reservations.' })
      const bookings = await readBookings()
      return sendJson(response, 200, {
        bookings: session.account.role === 'admin'
          ? bookings
          : bookings.map((booking) => booking.user === session.account.username ? booking : { ...booking, user: '' }),
      })
    }

    if (route === 'POST /api/bookings') {
      const session = await readSession(request)
      if (!session) return sendJson(response, 401, { error: 'Your session expired. Please sign in again as a player.' })
      if (session.account.role !== 'player') return sendJson(response, 403, { error: 'A player account is required to reserve court times.' })
      const account = session.account
      if (![account.name, account.birthdate, account.phone || account.contact, account.email].every((value) => String(value || '').trim())) {
        return sendJson(response, 400, { error: 'Complete your personal information before booking a court.' })
      }

      const body = await readBody(request)
      const date = String(body.date || '')
      const sport = String(body.sport || '')
      const slots = body.slots
      const racketRentalQuantity = Number(body.racketRentalQuantity ?? (body.racketRental === true ? 1 : 0))
      const shuttlecockQuantity = Number(body.shuttlecockQuantity || 0)
      const equipmentOnly = Array.isArray(slots) && slots.length === 0 && (racketRentalQuantity > 0 || shuttlecockQuantity > 0)
      if (!validBookingDate(date) || !Object.prototype.hasOwnProperty.call(HOURLY_RATES, sport) || !validBookingSlots(slots, sport, true)) {
        return sendJson(response, 400, { error: 'Reservation date, sport, or time slots are invalid.' })
      }
      if (!isFutureBooking(date, slots)) {
        return sendJson(response, 400, { error: 'Choose a future date and time for your reservation.' })
      }
      if (!Number.isInteger(shuttlecockQuantity) || shuttlecockQuantity < 0 || shuttlecockQuantity > 100) {
        return sendJson(response, 400, { error: 'Shuttlecock quantity must be between 0 and 100.' })
      }
      if (!Number.isInteger(racketRentalQuantity) || racketRentalQuantity < 0 || racketRentalQuantity > 100) {
        return sendJson(response, 400, { error: 'Racket rental quantity must be between 0 and 100.' })
      }
      if ((racketRentalQuantity > 0 || shuttlecockQuantity > 0) && sport !== 'Badminton') {
        return sendJson(response, 400, { error: 'Racket rental and shuttlecocks are only available for Badminton.' })
      }
      if (slots.length === 0 && !equipmentOnly) {
        return sendJson(response, 400, { error: 'Select a court time or a badminton add-on.' })
      }

      const courtHours = slots.reduce((total, slot) => total + slotDurationMinutes(slot) / 60, 0)
      const courtTotal = HOURLY_RATES[sport as keyof typeof HOURLY_RATES] * courtHours
      const equipmentTotal = racketRentalQuantity * RACKET_RENTAL_PER_DAY
        + shuttlecockQuantity * SHUTTLECOCK_PRICE
      const totalPrice = courtTotal + equipmentTotal
      const createdAt = new Date().toISOString()
      const booking: Booking = {
        id: randomBytes(12).toString('hex'),
        user: account.username,
        date,
        slots,
        sport,
        totalPrice,
        deposit: courtTotal / 2 + equipmentTotal,
        racketRental: racketRentalQuantity > 0,
        racketRentalQuantity,
        shuttlecockQuantity,
        status: 'pending',
        createdAt,
        statusUpdatedAt: createdAt,
        statusHistory: [{
          status: 'pending',
          at: createdAt,
          message: 'Reservation request submitted and awaiting administrator review.',
        }],
        refundIssued: false,
      }
      try {
        await saveNewBooking(booking)
      } catch (error) {
        if (isSlotConflict(error as { code?: string; message?: string })) {
          return sendJson(response, 409, { error: 'One or more selected court times were just reserved or blocked. Refresh availability and choose another slot.' })
        }
        throw error
      }
      return sendJson(response, 201, { booking })
    }

    if (route === 'POST /api/bookings/import-legacy') {
      const session = await readSession(request)
      if (session?.account.role !== 'admin') return sendJson(response, 403, { error: 'Admin access required.' })
      const body = await readBody(request)
      const legacyBookings = Array.isArray(body.bookings) ? body.bookings.slice(0, 1000) : []
      const accounts = (await readAccounts()).filter((account) => account.role === 'player')
      const existingIds = new Set((await readBookings()).map((booking) => booking.id))
      let imported = 0
      let skippedConflicts = 0

      for (const legacy of legacyBookings) {
        if (!legacy || typeof legacy !== 'object' || typeof legacy.id !== 'string' || existingIds.has(legacy.id)) continue
        const account = accounts.find((item) => item.username.toLowerCase() === String(legacy.user || '').toLowerCase())
        const date = String(legacy.date || '')
        const sport = String(legacy.sport || '')
        const slots = bookingSlots(legacy)
        const racketRentalQuantity = Number(legacy.racketRentalQuantity ?? (legacy.racketRental === true ? 1 : 0))
        const shuttlecockQuantity = Number(legacy.shuttlecockQuantity || 0)
        const status = ['pending', 'confirmed', 'cancelled', 'rejected', 'completed'].includes(legacy.status) ? legacy.status : null
        if (!account || !validBookingDate(date) || !Object.prototype.hasOwnProperty.call(HOURLY_RATES, sport) || !status ||
          !validBookingSlots(slots, sport, true) || !Number.isInteger(racketRentalQuantity) || racketRentalQuantity < 0 || racketRentalQuantity > 100 ||
          !Number.isInteger(shuttlecockQuantity) || shuttlecockQuantity < 0 || shuttlecockQuantity > 100 ||
          (slots.length === 0 && racketRentalQuantity === 0 && shuttlecockQuantity === 0)) continue

        const createdAt = legacy.createdAt || new Date().toISOString()
        const booking: Booking = {
          id: legacy.id,
          user: account.username,
          date,
          slots,
          sport,
          deposit: Number.isFinite(Number(legacy.deposit)) ? Number(legacy.deposit) : 0,
          totalPrice: Number.isFinite(Number(legacy.totalPrice)) ? Number(legacy.totalPrice) : undefined,
          racketRental: racketRentalQuantity > 0,
          racketRentalQuantity,
          shuttlecockQuantity,
          status,
          createdAt,
          statusUpdatedAt: legacy.statusUpdatedAt || createdAt,
          statusHistory: Array.isArray(legacy.statusHistory) ? legacy.statusHistory : [{
            status,
            at: createdAt,
            message: 'Reservation status recorded',
          }],
          refundIssued: legacy.refundIssued === true,
        }
        try {
          await saveNewBooking(booking)
          existingIds.add(booking.id)
          imported += 1
        } catch (error) {
          if (isSlotConflict(error as { code?: string; message?: string })) {
            skippedConflicts += 1
            continue
          }
          throw error
        }
      }
      return sendJson(response, 200, { imported, skippedConflicts })
    }

    const bookingAction = request.method === 'POST'
      ? pathname.match(/^\/api\/bookings\/([^/]+)\/(confirm|reject|cancel)$/)
      : null
    if (bookingAction) {
      const session = await readSession(request)
      if (!session) return sendJson(response, 401, { error: 'Sign in to update a reservation.' })
      const bookingId = decodeURIComponent(bookingAction[1])
      const action = bookingAction[2]
      const { data, error } = await supabase.from('app_bookings').select('record').eq('id', bookingId).maybeSingle()
      if (error) throw error
      if (!data) return sendJson(response, 404, { error: 'Reservation not found.' })
      const booking = parseJson(data.record) as Booking
      const expectedStatus = booking.status
      const now = new Date().toISOString()

      if (action === 'cancel') {
        if (session.account.role !== 'player' || booking.user !== session.account.username) {
          return sendJson(response, 403, { error: 'You can only cancel your own reservation.' })
        }
        if (!['pending', 'confirmed'].includes(booking.status)) {
          return sendJson(response, 409, { error: 'This reservation can no longer be cancelled.' })
        }
        booking.status = 'cancelled'
        booking.refundIssued = false
        booking.statusUpdatedAt = now
        booking.statusHistory.push({
          status: 'cancelled',
          at: now,
          message: 'Reservation cancelled by the player.',
        })
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
        booking.statusUpdatedAt = now
        booking.statusHistory.push({
          status: booking.status,
          at: now,
          message: action === 'confirm'
            ? 'Reservation approved by the administrator.'
            : 'Reservation rejected by the administrator.',
        })
      }

      if (!await persistBooking(booking, expectedStatus)) {
        return sendJson(response, 409, { error: 'This reservation changed while you were updating it. Refresh and try again.' })
      }
      if (action !== 'cancel') {
        const account = (await readAccounts()).find((item) => item.username.toLowerCase() === booking.user.toLowerCase())
        if (account) await notifyBookingStatus(booking, account)
      }
      return sendJson(response, 200, { booking })
    }

    if (route === 'GET /api/auth/session') {
      const session = await readSession(request)
      if (!session) return sendJson(response, 401, { error: 'Not signed in.' })
      return sendJson(response, 200, { user: publicAccount(session.account) })
    }

    if (route === 'PUT /api/account/profile') {
      const session = await readSession(request)
      if (!session) return sendJson(response, 401, { error: 'Sign in to manage your account.' })

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

      const accounts = await readAccounts()
      const accountIndex = accounts.findIndex((account) => (
        account.username === session.account.username && account.role === session.account.role
      ))
      if (accountIndex === -1) return sendJson(response, 401, { error: 'Account not found.' })
      const duplicateContact = accounts.some((account, index) => (
        index !== accountIndex && (account.phone === phone || account.email === email || account.contact === phone || account.contact === email)
      ))
      if (duplicateContact) return sendJson(response, 409, { error: 'That phone number or email is already in use.' })

      Object.assign(accounts[accountIndex], { name, birthdate, phone, email })
      await saveAccounts(accounts)
      return sendJson(response, 200, { user: publicAccount(accounts[accountIndex]) })
    }

    if (route === 'POST /api/auth/otp') {
      const body = await readBody(request)
      const email = normalizeContact(String(body.email || ''))
      const password = String(body.password || '')
      if (!isEmail(email)) return sendJson(response, 400, { error: 'Enter a valid email address.' })
      if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return sendJson(response, 400, { error: 'Password must be at least 10 characters and contain at least 1 letter and 1 number.' })
      }
      if (!await allowAttempt(request, email, 3, 60 * 60 * 1000)) {
        return sendJson(response, 429, { error: 'Too many OTP requests. Try again later.' })
      }

      const otp = await sendSignupOtp(email, password)
      await sendEmailNotification(
        email,
        'Your Red Court verification code',
        `Your Red Court verification code is ${otp}.`,
      )
      return sendJson(response, 200, { message: 'Verification code sent. Check your email.' })
    }

    if (route === 'POST /api/auth/register') {
      const body = await readBody(request)
      const name = String(body.name || '').trim()
      const username = String(body.username || '').trim()
      const password = String(body.password || '')
      const phone = normalizeContact(String(body.phone || ''))
      const email = normalizeContact(String(body.email || ''))
      const otp = String(body.otp || '')
      if (name.length < 2 || name.length > 100) {
        return sendJson(response, 400, { error: 'Name must be between 2 and 100 characters.' })
      }
      if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
        return sendJson(response, 400, { error: 'Username must be 3-32 characters using letters, numbers, dots, dashes or underscores.' })
      }
      if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return sendJson(response, 400, { error: 'Password must be at least 10 characters and contain at least 1 letter and 1 number.' })
      }
      if (!/^\d{11}$/.test(phone)) return sendJson(response, 400, { error: 'Contact number must contain exactly 11 digits.' })
      if (!isEmail(email)) return sendJson(response, 400, { error: 'Enter a valid email address.' })

      const accounts = await readAccounts()
      if (accounts.some((account) => account.username.toLowerCase() === username.toLowerCase())) {
        return sendJson(response, 409, { error: 'That username is already in use.' })
      }
      if (accounts.some((account) => (
        account.phone === phone || account.email === email || account.contact === phone || account.contact === email
      ))) {
        return sendJson(response, 409, { error: 'That email address or contact number is already in use.' })
      }

      const role = body.role === 'admin' ? 'admin-pending' : 'player'
      if (role === 'admin-pending' && accounts.filter((account) => account.role === 'admin').length >= ADMIN_LIMIT) {
        return sendJson(response, 409, { error: `The limit of ${ADMIN_LIMIT} admin accounts has been reached.` })
      }

      if (!/^\d{6}$/.test(otp)) return sendJson(response, 400, { error: 'The OTP is invalid or expired.' })
      await verifySignupOtp(email, otp)

      const credentials = hashPassword(password)
      const account: Account = { username, role, name, phone, email, contact: phone, ...credentials }
      accounts.push(account)
      await saveAccounts(accounts)
      if (role === 'admin-pending') {
        return sendJson(response, 202, { pendingApproval: true, message: 'Your admin account request was sent for approval.' })
      }
      await startSession(response, account)
      return sendJson(response, 201, { user: publicAccount(account) })
    }

    if (route === 'POST /api/auth/login') {
      const body = await readBody(request)
      const username = String(body.username || '').trim()
      const password = String(body.password || '')
      const requestedRole = body.role === 'admin' ? 'admin' : 'player'
      if (!await allowAttempt(request, 'login', 10, 15 * 60 * 1000)) {
        return sendJson(response, 429, { error: 'Too many login attempts. Try again later.' })
      }

      const account = (await readAccounts()).find((item) => (
        item.username.toLowerCase() === username.toLowerCase() && item.role === requestedRole
      ))
      const credentials = account || {
        salt: '00'.repeat(16),
        hash: scryptSync('invalid-password', '00'.repeat(16), 64).toString('hex'),
      }
      const candidate = scryptSync(password, credentials.salt || '', 64)
      const expected = Buffer.from(credentials.hash || '', 'hex')
      const passwordMatches = candidate.length === expected.length && timingSafeEqual(candidate, expected)
      if (!account || !passwordMatches) {
        return sendJson(response, 401, { error: 'Username, password or account type is incorrect.' })
      }

      await startSession(response, account)
      return sendJson(response, 200, { user: publicAccount(account) })
    }

    if (route === 'GET /api/admin/requests') {
      const session = await readSession(request)
      if (session?.account.role !== 'admin') return sendJson(response, 403, { error: 'Admin access required.' })
      const accounts = await readAccounts()
      return sendJson(response, 200, {
        requests: accounts
          .filter((account) => account.role === 'admin-pending')
          .map(({ username, contact }) => ({ username, contact })),
        activeAdminCount: accounts.filter((account) => account.role === 'admin').length,
        adminLimit: ADMIN_LIMIT,
      })
    }

    const adminRequestAction = request.method === 'POST'
      ? pathname.match(/^\/api\/admin\/requests\/([^/]+)\/(approve|reject)$/)
      : null
    if (adminRequestAction) {
      const session = await readSession(request)
      if (session?.account.role !== 'admin') return sendJson(response, 403, { error: 'Admin access required.' })

      const username = decodeURIComponent(adminRequestAction[1])
      const action = adminRequestAction[2]
      const accounts = await readAccounts()
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

      await saveAccounts(accounts)
      return sendJson(response, 200, {
        ok: true,
        activeAdminCount: accounts.filter((account) => account.role === 'admin').length,
      })
    }

    if (route === 'POST /api/auth/logout') {
      const session = await readSession(request)
      if (session) {
        const { error } = await supabase.from('app_sessions').delete().eq('token', session.token)
        if (error) throw error
      }
      return sendJson(response, 200, { ok: true }, {
        'Set-Cookie': 'redcourt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
      })
    }

    return sendJson(response, 404, { error: 'Not found.' })
  } catch (error) {
    const status = errorStatus(error)
    if (status >= 500) console.error('API request failed:', error)
    const message = error instanceof Error ? error.message : 'Request failed.'
    return sendJson(response, status, {
      error: isMissingSupabaseSchema(error)
        ? 'Supabase setup is incomplete. Apply the serverless reservations migration, then retry.'
        : status === 500 ? 'The server could not complete the request.' : message,
    })
  }
}

export { handler }
export default handler
