import { useEffect, useState } from 'preact/hooks'
import './app.css'

const COURTS = [
  { id: 1, name: 'Court 1', sports: ['Pickleball', 'Badminton'] },
  { id: 2, name: 'Court 2', sports: ['Pickleball', 'Badminton'] },
  { id: 3, name: 'Court 3', sports: ['Pickleball', 'Badminton'] },
  { id: 4, name: 'Court 4', sports: ['Badminton'] },
  { id: 5, name: 'Court 5', sports: ['Badminton'] },
  { id: 6, name: 'Court 6', sports: ['Badminton'] },
  { id: 7, name: 'Court 7', sports: ['Badminton'] },
  { id: 8, name: 'Court 8', sports: ['Badminton'] },
  { id: 9, name: 'Court 9', sports: ['Badminton'] },
]

const HOURLY_RATES = { Pickleball: 200, Badminton: 175 }
const RACKET_RENTAL_PER_DAY = 100
const SHUTTLECOCK_PRICE = 140
const SPORTS = ['Pickleball', 'Badminton']

const HOURS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00',
  '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00',
]

const formatInputDate = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

const addDays = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return formatInputDate(date)
}

type BookingSlot = { courtId: number; time: string }

type Booking = {
  id: string
  user: string
  date: string
  courtId?: number | null
  time?: string
  times?: string[]
  slots?: BookingSlot[]
  sport: string
  deposit: number
  racketRental?: boolean
  shuttlecockQuantity?: number
  status: string
  refundIssued: boolean
}

const bookingTimes = (booking: Booking) => booking.times ?? (booking.time ? [booking.time] : [])
const bookingSlots = (booking: Booking): BookingSlot[] => booking.slots ?? (
  booking.courtId == null ? [] : bookingTimes(booking).map((time) => ({ courtId: booking.courtId as number, time }))
)
const slotSummary = (slots: BookingSlot[]) => [...new Set(slots.map((slot) => slot.courtId))]
  .map((courtId) => `${COURTS.find((court) => court.id === courtId)?.name}: ${slots.filter((slot) => slot.courtId === courtId).map((slot) => slot.time).join(', ')}`)
  .join(' · ')
const courtSummary = (slots: BookingSlot[]) => [...new Set(slots.map((slot) => slot.courtId))]
  .map((courtId) => COURTS.find((court) => court.id === courtId)?.name)
  .filter(Boolean)
  .join(', ')
const bookingAddOns = (booking: Booking) => [
  booking.racketRental ? `Racket rental (PHP ${RACKET_RENTAL_PER_DAY}/day)` : null,
  booking.shuttlecockQuantity ? `Shuttlecock ×${booking.shuttlecockQuantity} (PHP ${SHUTTLECOCK_PRICE} each)` : null,
].filter(Boolean).join(' · ')

const defaultAuth = {
  username: '',
  password: '',
  contact: '',
  otp: '',
}

type AccountProfile = {
  name: string
  birthdate: string
  phone: string
  email: string
}

const emptyAccountProfile: AccountProfile = { name: '', birthdate: '', phone: '', email: '' }
const profileFromAccount = (account: Partial<AccountProfile>): AccountProfile => ({
  name: account.name || '',
  birthdate: account.birthdate || '',
  phone: account.phone || '',
  email: account.email || '',
})

export function App() {
  const [currentUser, setCurrentUser] = useState<{ username: string; role: 'player' | 'admin' } | null>(null)
  const [accountProfile, setAccountProfile] = useState(emptyAccountProfile)
  const [isManagingAccount, setIsManagingAccount] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authRole, setAuthRole] = useState<'player' | 'admin'>('player')
  const [registrationRole, setRegistrationRole] = useState<'player' | 'admin'>('player')
  const [authForm, setAuthForm] = useState(defaultAuth)
  const [showPassword, setShowPassword] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [otpMessage, setOtpMessage] = useState('')
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [adminRequests, setAdminRequests] = useState<{ username: string; contact: string }[]>([])
  const [adminCount, setAdminCount] = useState(0)
  const [adminLimit, setAdminLimit] = useState(5)
  const [adminRequestError, setAdminRequestError] = useState('')
  const [bookings, setBookings] = useState<Booking[]>(() => {
    try {
      const savedBookings = window.localStorage.getItem('redcourt-bookings')
      const parsedBookings = savedBookings ? JSON.parse(savedBookings) : []
      return Array.isArray(parsedBookings) ? parsedBookings as Booking[] : []
    } catch {
      return []
    }
  })
  const [selectedDate, setSelectedDate] = useState(addDays(0))
  const [selectedSport, setSelectedSport] = useState('Pickleball')
  const [preferredTime, setPreferredTime] = useState('18:00')
  const [selectedSlots, setSelectedSlots] = useState<BookingSlot[]>([])
  const [racketRental, setRacketRental] = useState(false)
  const [shuttlecockQuantity, setShuttlecockQuantity] = useState(0)
  const [draftReservation, setDraftReservation] = useState<null | {
    slots: BookingSlot[]
    date: string
    sport: string
    deposit: number
    racketRental: boolean
    shuttlecockQuantity: number
  }>(null)

  useEffect(() => {
    let active = true
    fetch('/api/auth/session')
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => {
        if (active && result?.user) {
          setCurrentUser(result.user)
          setAccountProfile(profileFromAccount(result.user))
        }
      })
      .catch(() => undefined)

    return () => { active = false }
  }, [])

  useEffect(() => {
    if (currentUser?.role !== 'admin') {
      setAdminRequests([])
      return
    }

    let active = true
    fetch('/api/admin/requests')
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not load admin requests.')
        return result
      })
      .then((result) => {
        if (!active) return
        setAdminRequests(result.requests)
        setAdminCount(result.activeAdminCount)
        setAdminLimit(result.adminLimit)
        setAdminRequestError('')
      })
      .catch((error) => {
        if (active) setAdminRequestError(error instanceof Error ? error.message : 'Could not load admin requests.')
      })

    return () => { active = false }
  }, [currentUser])

  useEffect(() => {
    window.localStorage.setItem('redcourt-bookings', JSON.stringify(bookings))
  }, [bookings])

  const hourlyRate = HOURLY_RATES[selectedSport as keyof typeof HOURLY_RATES]
  const racketRentalTotal = selectedSport === 'Badminton' && racketRental ? RACKET_RENTAL_PER_DAY : 0
  const shuttlecockTotal = selectedSport === 'Badminton' ? shuttlecockQuantity * SHUTTLECOCK_PRICE : 0
  const totalPayment = hourlyRate * selectedSlots.length + racketRentalTotal + shuttlecockTotal
  const canReviewOrder = selectedSlots.length > 0 || (selectedSport === 'Badminton' && (racketRental || shuttlecockQuantity > 0))

  const isSlotTaken = (courtId: number, date: string, time: string) =>
    bookings.some((booking) => (
      bookingSlots(booking).some((slot) => slot.courtId === courtId && slot.time === time) &&
      booking.date === date &&
      booking.status !== 'cancelled' &&
      booking.status !== 'rejected'
    ))

  const availableCourts = COURTS.filter((court) => court.sports.includes(selectedSport))
  const preferredTimeCourts = availableCourts.filter((court) => !isSlotTaken(court.id, selectedDate, preferredTime))

  const generateOtp = async () => {
    setOtpSent(false)
    setOtpMessage('Sending OTP...')
    try {
      const response = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: authForm.contact }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not send OTP.')
      setOtpSent(true)
      setOtpMessage(result.message)
    } catch (error) {
      setOtpMessage(error instanceof Error ? error.message : 'Could not send OTP.')
    }
  }

  const changeAuthMode = (mode: 'login' | 'signup') => {
    setAuthMode(mode)
    if (mode === 'signup') setAuthRole('player')
    setRegistrationRole('player')
    setAuthForm(defaultAuth)
    setShowPassword(false)
    setOtpSent(false)
    setOtpMessage('')
    setAuthError('')
    setAuthNotice('')
  }

  const toggleAuthRole = () => {
    const nextRole = authRole === 'player' ? 'admin' : 'player'
    changeAuthMode('login')
    setAuthRole(nextRole)
  }

  const handleAuthSubmit = async (event: Event) => {
    event.preventDefault()

    if (!authForm.username.trim() || !authForm.password.trim()) {
      window.alert('Please enter your username and password.')
      return
    }

    if (authMode === 'signup' && (!authForm.contact.trim() || !authForm.otp.trim())) {
      setAuthError('Enter your email or phone number and the OTP sent to it.')
      return
    }

    setAuthError('')
    setAuthNotice('')
    try {
      const endpoint = authMode === 'signup' ? 'register' : 'login'
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: authForm.username,
          password: authForm.password,
          ...(authMode === 'signup'
            ? { contact: authForm.contact, otp: authForm.otp, role: registrationRole }
            : { role: authRole }),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Authentication failed.')
      if (result.pendingApproval) {
        setAuthForm(defaultAuth)
        setOtpSent(false)
        setOtpMessage('')
        setAuthNotice(result.message)
        return
      }
      setCurrentUser(result.user)
      setAccountProfile(profileFromAccount(result.user))
      setAuthForm(defaultAuth)
      setOtpSent(false)
      setOtpMessage('')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed.')
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    setCurrentUser(null)
    setIsManagingAccount(false)
  }

  const handleProfileSave = async (event: Event) => {
    event.preventDefault()
    setProfileError('')
    setProfileMessage('')
    try {
      const response = await fetch('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountProfile),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save account details.')
      setAccountProfile(profileFromAccount(result.user))
      setProfileMessage('Account details saved.')
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not save account details.')
    }
  }

  const handleBookingReview = () => {
    if (!currentUser || currentUser.role !== 'player') {
      window.alert('Log in as a player to reserve a court.')
      return
    }
    const slots = [...selectedSlots].sort((left, right) => (
      left.courtId - right.courtId || HOURS.indexOf(left.time) - HOURS.indexOf(right.time)
    ))
    const bookingRacketRental = selectedSport === 'Badminton' && racketRental
    const bookingShuttlecockQuantity = selectedSport === 'Badminton' ? shuttlecockQuantity : 0
    const equipmentOnly = slots.length === 0 && (bookingRacketRental || bookingShuttlecockQuantity > 0)

    if (slots.length === 0 && !equipmentOnly) {
      window.alert('Select an available time or a badminton add-on.')
      return
    }
    if (slots.some((slot) => isSlotTaken(slot.courtId, selectedDate, slot.time))) {
      window.alert('One or more selected time slots are already booked. Please update your selection.')
      return
    }

    const deposit = HOURLY_RATES[selectedSport as keyof typeof HOURLY_RATES] * slots.length
      + (bookingRacketRental ? RACKET_RENTAL_PER_DAY : 0)
      + bookingShuttlecockQuantity * SHUTTLECOCK_PRICE

    setDraftReservation({
      slots,
      date: selectedDate,
      sport: selectedSport,
      deposit,
      racketRental: bookingRacketRental,
      shuttlecockQuantity: bookingShuttlecockQuantity,
    })
  }

  const confirmDeposit = () => {
    if (!draftReservation || !currentUser) return

    if (draftReservation.slots.some((slot) => isSlotTaken(slot.courtId, draftReservation.date, slot.time))) {
      setDraftReservation(null)
      setSelectedSlots([])
      window.alert('One or more selected time slots were just booked. Please choose another time.')
      return
    }

    const newReservation = {
      id: `bk-${Date.now()}`,
      user: currentUser.username,
      date: draftReservation.date,
      slots: draftReservation.slots,
      sport: draftReservation.sport,
      deposit: draftReservation.deposit,
      racketRental: draftReservation.racketRental,
      shuttlecockQuantity: draftReservation.shuttlecockQuantity,
      status: 'pending',
      refundIssued: false,
    }

    setBookings((previous) => [newReservation, ...previous])
    setSelectedSlots([])
    setRacketRental(false)
    setShuttlecockQuantity(0)
    setDraftReservation(null)
    window.alert('Your downpayment has been recorded. Your reservation is pending admin approval.')
  }

  const cancelUserBooking = (bookingId: string) => {
    setBookings((previous) => previous.map((booking) =>
      booking.id === bookingId ? { ...booking, status: 'cancelled', refundIssued: false } : booking,
    ))
  }

  const sendReservationConfirmation = async (booking: Booking) => {
    const slots = bookingSlots(booking)
    if (slots.length === 0) return

    try {
      const response = await fetch('/api/admin/reservations/confirmed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: booking.user, date: booking.date, slots }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'SMS delivery failed.')
      window.alert(`Reservation confirmed. SMS sent to the number ending in ${result.phoneLastFour}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SMS delivery failed.'
      window.alert(`Reservation status saved, but the SMS was not sent: ${message}`)
    }
  }

  const handleAdminAction = (bookingId: string, action: 'confirm' | 'reject') => {
    const selectedBooking = bookings.find((booking) => booking.id === bookingId)
    if (!selectedBooking) return

    setBookings((previous) => previous.map((booking) => {
      if (booking.id !== bookingId) return booking

      if (action === 'confirm') {
        return { ...booking, status: 'confirmed' }
      }

      return {
        ...booking,
        status: 'rejected',
        refundIssued: true,
      }
    }))

    if (action === 'confirm') void sendReservationConfirmation(selectedBooking)
  }

  const handleAdminRequest = async (username: string, action: 'approve' | 'reject') => {
    setAdminRequestError('')
    try {
      const response = await fetch(`/api/admin/requests/${encodeURIComponent(username)}/${action}`, { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update admin request.')
      setAdminRequests((previous) => previous.filter((request) => request.username !== username))
      setAdminCount(result.activeAdminCount)
    } catch (error) {
      setAdminRequestError(error instanceof Error ? error.message : 'Could not update admin request.')
    }
  }

  const myReservations = currentUser
    ? bookings.filter((booking) => booking.user === currentUser.username)
    : []

  const adminReservations = [...bookings].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div class="redcourt-app">
      <header class="topbar">
        <div>
          <p class="eyebrow">Red Court</p>
          <h1>Sport court reservation and scheduling</h1>
        </div>
        <div class="topbar-actions">
          {currentUser ? (
            <>
              <span className="user-badge">{currentUser.username} · {currentUser.role}</span>
              <button className="secondary" onClick={() => {
                setIsManagingAccount((open) => !open)
                setProfileError('')
                setProfileMessage('')
              }}>{isManagingAccount ? 'Back to dashboard' : 'Manage Account'}</button>
              <button className="secondary" onClick={handleLogout}>Logout</button>
            </>
          ) : (
            <>
              <button className={authMode === 'login' ? 'primary' : 'secondary'} onClick={toggleAuthRole}>{authRole === 'player' ? 'Admin Log In' : 'Player Log In'}</button>
              <button className={authMode === 'signup' ? 'primary' : 'secondary'} onClick={() => changeAuthMode('signup')}>Create Account</button>
            </>
          )}
        </div>
      </header>

      {currentUser && isManagingAccount ? (
        <main className="profile-layout">
          <section className="panel profile-panel">
            <h2>Manage account</h2>
            <p className="muted">Update the personal details saved with your account.</p>
            <form className="auth-form" onSubmit={handleProfileSave}>
              <label>
                Name
                <input
                  type="text"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  value={accountProfile.name}
                  onInput={(e) => setAccountProfile({ ...accountProfile, name: (e.target as HTMLInputElement).value })}
                />
              </label>
              <label>
                Birthdate
                <input
                  type="date"
                  autoComplete="bday"
                  required
                  max={addDays(0)}
                  value={accountProfile.birthdate}
                  onInput={(e) => setAccountProfile({ ...accountProfile, birthdate: (e.target as HTMLInputElement).value })}
                />
              </label>
              <label>
                Contact number
                <input
                  type="tel"
                  autoComplete="tel"
                  required
                  value={accountProfile.phone}
                  onInput={(e) => setAccountProfile({ ...accountProfile, phone: (e.target as HTMLInputElement).value })}
                />
              </label>
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={accountProfile.email}
                  onInput={(e) => setAccountProfile({ ...accountProfile, email: (e.target as HTMLInputElement).value })}
                />
              </label>
              {profileError ? <p className="auth-error" role="alert">{profileError}</p> : null}
              {profileMessage ? <p className="auth-notice" role="status">{profileMessage}</p> : null}
              <button type="submit" className="primary wide">Save account details</button>
            </form>
          </section>
        </main>
      ) : !currentUser ? (
        <main className="auth-layout">
          <section className="auth-panel">
            <h2>{authMode === 'login' ? `${authRole === 'admin' ? 'Admin' : 'Player'} login` : registrationRole === 'admin' ? 'Request admin account' : 'Create account'}</h2>
            <p>{authMode === 'login'
              ? 'Log in with your username and password.'
              : registrationRole === 'admin'
                ? `Admin requests need approval from an existing admin. The limit is ${adminLimit} admin accounts.`
                : 'Create an account with your username, password and verified contact.'}</p>

            {authMode === 'signup' && (
              <div className="role-switch" aria-label="Account type">
                <button type="button" className={registrationRole === 'player' ? 'primary' : 'secondary'} onClick={() => setRegistrationRole('player')}>Player Account</button>
                <button type="button" className={registrationRole === 'admin' ? 'primary' : 'secondary'} onClick={() => setRegistrationRole('admin')}>Request Admin</button>
              </div>
            )}

            <form className="auth-form" onSubmit={handleAuthSubmit}>
              <label>
                Username
                <input
                  value={authForm.username}
                  onInput={(e) => setAuthForm({ ...authForm, username: (e.target as HTMLInputElement).value })}
                  placeholder="playername"
                />
              </label>

              <label>
                Password
                <span className="password-input-wrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={authForm.password}
                    onInput={(e) => setAuthForm({ ...authForm, password: (e.target as HTMLInputElement).value })}
                    placeholder="Your password"
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    <span className="eye-icon" aria-hidden="true" />
                  </button>
                </span>
              </label>

              {authMode === 'signup' && (
                <>
                  <label>
                    Email or phone number
                    <input
                      type="text"
                      autoComplete="email"
                      value={authForm.contact}
                      onInput={(e) => setAuthForm({ ...authForm, contact: (e.target as HTMLInputElement).value })}
                      placeholder="you@gmail.com or +63 912 345 6789"
                    />
                  </label>

                  <div className="otp-row">
                    <button type="button" className="secondary" onClick={generateOtp}>{otpSent ? 'Resend OTP' : 'Send OTP'}</button>
                  </div>
                  {otpMessage ? <p className="otp-message" role="status">{otpMessage}</p> : null}

                  <label>
                    Enter OTP
                    <input
                      value={authForm.otp}
                      onInput={(e) => setAuthForm({ ...authForm, otp: (e.target as HTMLInputElement).value })}
                      placeholder="123456"
                    />
                  </label>
                </>
              )}

              {authError ? <p className="auth-error" role="alert">{authError}</p> : null}
              {authNotice ? <p className="auth-notice" role="status">{authNotice}</p> : null}

              <button type="submit" className="primary wide">{authMode === 'login' ? 'Login' : 'Create account'}</button>
            </form>
          </section>

          <aside className="info-panel">
            <h3>Reservation rules</h3>
            <ul>
              <li>Courts 1-3 support Pickleball and Badminton.</li>
              <li>Courts 4-9 are Badminton only.</li>
              <li>Occupied time slots are disabled in this booking view.</li>
              <li>Hourly rate: PHP 200 for Pickleball and PHP 175 for Badminton.</li>
              <li>Admin can confirm or reject bookings and refund for rejected reservations.</li>
            </ul>
          </aside>
        </main>
      ) : currentUser.role === 'admin' ? (
        <main className="dashboard admin-dashboard">
          <section className="panel schedule-panel">
            <div className="panel-header">
              <h2>Admin court schedule</h2>
              <label>
                Date
                <input type="date" value={selectedDate} onInput={(e) => setSelectedDate((e.target as HTMLInputElement).value)} />
              </label>
            </div>

            <div className="court-grid">
              {COURTS.map((court) => (
                <div key={court.id} className="court-card admin-court">
                  <h3>{court.name}</h3>
                  <p>{court.sports.join(' / ')}</p>
                  <div className="slot-list">
                    {HOURS.map((time) => {
                      const occupied = isSlotTaken(court.id, selectedDate, time)
                      return (
                        <span className={occupied ? 'slot occupied' : 'slot free'} key={`${court.id}-${time}`}>
                          {time}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Reservation requests</h2>
            </div>

            <div className="reservation-list">
              {adminReservations.map((booking) => (
                <div key={booking.id} className="reservation-card">
                  <div>
                    <p className="muted">{booking.user}</p>
                    <h3>{courtSummary(bookingSlots(booking)) || 'Equipment only'}</h3>
                    <p>{booking.date}{bookingSlots(booking).length > 0 ? ` · ${slotSummary(bookingSlots(booking))}` : ''} · {booking.sport}</p>
                    {bookingAddOns(booking) ? <p className="muted">{bookingAddOns(booking)}</p> : null}
                    <p className="status status--pending">Status: {booking.status}</p>
                  </div>

                  <div className="reservation-actions">
                    {booking.status === 'pending' && (
                      <>
                        <button className="primary" onClick={() => handleAdminAction(booking.id, 'confirm')}>Confirm</button>
                        <button className="secondary danger" onClick={() => handleAdminAction(booking.id, 'reject')}>Reject & refund</button>
                      </>
                    )}
                    {booking.status === 'confirmed' && (
                      <>
                        {bookingSlots(booking).length > 0 ? (
                          <button className="secondary" onClick={() => void sendReservationConfirmation(booking)}>Resend confirmation SMS</button>
                        ) : null}
                        <button className="secondary danger" onClick={() => handleAdminAction(booking.id, 'reject')}>Reject & refund</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel admin-requests-panel">
            <div className="panel-header">
              <h2>Admin account requests</h2>
              <span className="muted">{adminCount}/{adminLimit} accounts</span>
            </div>
            {adminRequestError ? <p className="auth-error" role="alert">{adminRequestError}</p> : null}
            {adminCount >= adminLimit && adminRequests.length > 0
              ? <p className="auth-error" role="status">The admin account limit has been reached. Requests cannot be approved.</p>
              : null}
            {adminRequests.length === 0 ? (
              <p className="muted">No admin account requests pending.</p>
            ) : (
              <div className="reservation-list">
                {adminRequests.map((request) => (
                  <div key={request.username} className="reservation-card">
                    <div>
                      <h3>{request.username}</h3>
                      <p className="muted">{request.contact}</p>
                    </div>
                    <div className="reservation-actions">
                      <button className="primary" disabled={adminCount >= adminLimit} onClick={() => handleAdminRequest(request.username, 'approve')}>Approve</button>
                      <button className="secondary danger" onClick={() => handleAdminRequest(request.username, 'reject')}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      ) : (
        <main className="dashboard player-dashboard">
          <section className="panel booking-panel">
            <div className="panel-header">
              <div>
                <h2>Book a court</h2>
                <span className="muted">Availability for {selectedDate}</span>
              </div>
            </div>

            <label className="sport-filter">
              Sport
              <select value={selectedSport} onChange={(e) => {
                const sport = (e.target as HTMLSelectElement).value
                setSelectedSport(sport)
                setSelectedSlots([])
                if (sport !== 'Badminton') {
                  setRacketRental(false)
                  setShuttlecockQuantity(0)
                }
              }}>
                {SPORTS.map((sport) => (
                  <option value={sport} key={sport}>{sport}</option>
                ))}
              </select>
            </label>

            <label className="booking-date-picker">
              Day
              <input type="date" value={selectedDate} onInput={(e) => {
                setSelectedDate((e.target as HTMLInputElement).value)
                setSelectedSlots([])
              }} />
            </label>

            <section className="availability-results" aria-live="polite">
              <div className="panel-header">
                <h3>Courts and available times</h3>
                <span className="muted">Select hours across courts</span>
              </div>
              {availableCourts.length === 0 ? (
                <p className="empty-state">No courts offer {selectedSport.toLowerCase()}.</p>
              ) : (
                <div className="court-grid">
                  {availableCourts.map((court) => {
                    const freeTimes = HOURS.filter((time) => !isSlotTaken(court.id, selectedDate, time))
                    return (
                      <section key={court.id} className={`court-card schedule-court${selectedSlots.some((slot) => slot.courtId === court.id) ? ' selected' : ''}`}>
                        <div className="schedule-court-heading">
                          <h3>{court.name}</h3>
                          <span>{freeTimes.length} free</span>
                        </div>
                        <div className="court-time-list">
                          {HOURS.map((time) => {
                            const occupied = isSlotTaken(court.id, selectedDate, time)
                            const selected = selectedSlots.some((slot) => slot.courtId === court.id && slot.time === time)
                            return (
                              <label key={time} className={`time-slot${selected ? ' selected' : ''}${occupied ? ' occupied' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  disabled={occupied}
                                  onChange={() => {
                                    if (selected) {
                                      setSelectedSlots((previous) => previous.filter((slot) => !(slot.courtId === court.id && slot.time === time)))
                                    } else {
                                      setSelectedSlots((previous) => [...previous, { courtId: court.id, time }])
                                    }
                                  }}
                                />
                                <span>{time}</span>
                                {occupied ? <span className="slot-unavailable">Booked</span> : null}
                              </label>
                            )
                          })}
                        </div>
                      </section>
                    )
                  })}
                </div>
              )}
            </section>

            <details className="preferred-time-search">
              <summary>Select preferred time</summary>
              <div className="booking-form-grid">
                <label>
                  Preferred time
                  <select value={preferredTime} onChange={(e) => setPreferredTime((e.target as HTMLSelectElement).value)}>
                    {HOURS.map((time) => <option value={time} key={time}>{time}</option>)}
                  </select>
                </label>
              </div>
              <p className="muted">Courts free at {preferredTime} on {selectedDate}</p>
              {preferredTimeCourts.length === 0 ? (
                <p className="empty-state">No courts are available at that time.</p>
              ) : (
                <div className="preferred-court-list">
                  {preferredTimeCourts.map((court) => (
                    <button
                      type="button"
                      key={court.id}
                      className="secondary"
                      onClick={() => {
                        setSelectedSlots((previous) => previous.some((slot) => slot.courtId === court.id && slot.time === preferredTime)
                          ? previous
                          : [...previous, { courtId: court.id, time: preferredTime }])
                      }}
                    >
                      {court.name}
                    </button>
                  ))}
                </div>
              )}
            </details>

            {selectedSport === 'Badminton' ? (
              <section className="addon-options">
                <h3>Optional badminton add-ons</h3>
                <label className="addon-checkbox">
                  <input type="checkbox" checked={racketRental} onChange={(e) => setRacketRental((e.target as HTMLInputElement).checked)} />
                  <span>
                    <strong>Rent a racket</strong>
                    <small>PHP {RACKET_RENTAL_PER_DAY} per day</small>
                  </span>
                </label>
                <label className="addon-quantity">
                  <span>
                    <strong>Shuttlecocks</strong>
                    <small>PHP {SHUTTLECOCK_PRICE} each</small>
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={shuttlecockQuantity}
                    aria-label="Shuttlecock quantity"
                    onInput={(e) => setShuttlecockQuantity(Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0)))}
                  />
                </label>
              </section>
            ) : null}

            <div className="booking-summary">
              <div>
                <span>Selected courts</span>
                <strong>{courtSummary(selectedSlots) || (racketRental || shuttlecockQuantity > 0 ? 'Equipment only' : 'Not selected')}</strong>
              </div>
              <div>
                <span>Selected court-hours</span>
                <strong>{selectedSlots.length}</strong>
              </div>
              <div>
                <span>Total payment · PHP {hourlyRate}/hour</span>
                <strong>PHP {totalPayment.toFixed(2)}</strong>
              </div>
            </div>

            <button type="button" className="primary wide" disabled={!(selectedSlots.length > 0 || (selectedSport === 'Badminton' && (racketRental || shuttlecockQuantity > 0)))} onClick={handleBookingReview}>Review order</button>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Your reservations</h2>
            </div>

            <div className="reservation-list">
              {myReservations.length === 0 ? (
                <p className="empty-state">No reservations yet. Start by selecting a court and time.</p>
              ) : (
                myReservations.map((booking) => (
                  <div key={booking.id} className="reservation-card">
                    <div>
                      <p className="muted">{courtSummary(bookingSlots(booking)) || 'Equipment only'}</p>
                      <h3>{booking.sport}</h3>
                      <p>{booking.date}{bookingSlots(booking).length > 0 ? ` · ${slotSummary(bookingSlots(booking))}` : ''}</p>
                      {bookingAddOns(booking) ? <p className="muted">{bookingAddOns(booking)}</p> : null}
                      <p className="status">Status: {booking.status}</p>
                    </div>

                    <div className="reservation-actions">
                      {booking.status === 'pending' || booking.status === 'confirmed' ? (
                        <button className="secondary danger" onClick={() => cancelUserBooking(booking.id)}>Cancel</button>
                      ) : null}
                      <span className="deposit-tag">Total PHP {booking.deposit.toFixed(2)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {draftReservation && (
            <aside className="payment-panel panel">
              <h2>Payment</h2>
              {draftReservation.slots.length > 0
                ? <p>Hourly rate: PHP {HOURLY_RATES[draftReservation.sport as keyof typeof HOURLY_RATES]} per hour.</p>
                : <p>Equipment-only order; no court booking included.</p>}
              <div className="payment-summary">
                <span>Courts</span>
                <strong>{courtSummary(draftReservation.slots) || 'Equipment only'}</strong>
                <span>Sport</span>
                <strong>{draftReservation.sport}</strong>
                <span>{draftReservation.slots.length > 0 ? 'Date & time' : 'Rental date'}</span>
                <strong>{draftReservation.date}{draftReservation.slots.length > 0 ? ` · ${slotSummary(draftReservation.slots)}` : ''}</strong>
                {draftReservation.slots.length > 0 ? (
                  <>
                    <span>Selected court-hours</span>
                    <strong>{draftReservation.slots.length}</strong>
                  </>
                ) : null}
                {draftReservation.racketRental ? (
                  <>
                    <span>Racket rental</span>
                    <strong>PHP {RACKET_RENTAL_PER_DAY.toFixed(2)} / day</strong>
                  </>
                ) : null}
                {draftReservation.shuttlecockQuantity > 0 ? (
                  <>
                    <span>Shuttlecocks ×{draftReservation.shuttlecockQuantity}</span>
                    <strong>PHP {(draftReservation.shuttlecockQuantity * SHUTTLECOCK_PRICE).toFixed(2)}</strong>
                  </>
                ) : null}
                <span>Total payment due</span>
                <strong>PHP {draftReservation.deposit.toFixed(2)}</strong>
              </div>

              <div className="payment-buttons">
                <button className="primary" onClick={confirmDeposit}>Pay total</button>
                <button className="secondary" onClick={() => setDraftReservation(null)}>Cancel</button>
              </div>
            </aside>
          )}
        </main>
      )}
      {canReviewOrder && !draftReservation ? (
        <div className="quick-booking-bar" role="region" aria-label="Booking total">
          <div className="quick-booking-total" aria-live="polite">
            <span>{selectedSlots.length} court-hour{selectedSlots.length === 1 ? '' : 's'} selected</span>
            <strong>Total PHP {totalPayment.toFixed(2)}</strong>
          </div>
          <button type="button" className="primary" onClick={handleBookingReview}>Review payment</button>
        </div>
      ) : null}
    </div>
  )
}
