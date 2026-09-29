import { useEffect, useMemo, useState } from 'preact/hooks'
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

const DEPOSITS = { Pickleball: 200, Badminton: 175 }

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

const initialBookings = [
  { id: 'bk-101', user: 'mira', date: addDays(1), courtId: 1, time: '18:00', sport: 'Badminton', deposit: 175, status: 'confirmed', refundIssued: false },
  { id: 'bk-102', user: 'leo', date: addDays(2), courtId: 3, time: '16:00', sport: 'Pickleball', deposit: 200, status: 'pending', refundIssued: false },
  { id: 'bk-103', user: 'aisha', date: addDays(0), courtId: 5, time: '19:00', sport: 'Badminton', deposit: 175, status: 'confirmed', refundIssued: false },
  { id: 'bk-104', user: 'niko', date: addDays(0), courtId: 2, time: '17:00', sport: 'Badminton', deposit: 175, status: 'pending', refundIssued: false },
]

const defaultAuth = {
  username: '',
  password: '',
  contact: '',
  otp: '',
}

export function App() {
  const [currentUser, setCurrentUser] = useState<{ username: string; role: 'player' | 'admin' } | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authRole, setAuthRole] = useState<'player' | 'admin'>('player')
  const [authForm, setAuthForm] = useState(defaultAuth)
  const [showPassword, setShowPassword] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [otpMessage, setOtpMessage] = useState('')
  const [authError, setAuthError] = useState('')
  const [bookings, setBookings] = useState(initialBookings)
  const [selectedDate, setSelectedDate] = useState(addDays(0))
  const [selectedCourtId, setSelectedCourtId] = useState(1)
  const [selectedSport, setSelectedSport] = useState('Pickleball')
  const [selectedTime, setSelectedTime] = useState('18:00')
  const [draftReservation, setDraftReservation] = useState<null | {
    courtId: number
    date: string
    time: string
    sport: string
    deposit: number
  }>(null)

  useEffect(() => {
    let active = true
    fetch('/api/auth/session')
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => {
        if (active && result?.user) setCurrentUser(result.user)
      })
      .catch(() => undefined)

    return () => { active = false }
  }, [])

  const activeCourt = COURTS.find((court) => court.id === selectedCourtId) ?? COURTS[0]
  const availableSports = activeCourt.sports

  const selectedCourtOptions = useMemo(() => (
    COURTS.map((court) => ({ ...court, label: `${court.name} · ${court.sports.join(' / ')}` }))
  ), [])

  const isSlotTaken = (courtId: number, date: string, time: string) =>
    bookings.some((booking) => (
      booking.courtId === courtId &&
      booking.date === date &&
      booking.time === time &&
      booking.status !== 'cancelled' &&
      booking.status !== 'rejected'
    ))

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
    setAuthForm(defaultAuth)
    setShowPassword(false)
    setOtpSent(false)
    setOtpMessage('')
    setAuthError('')
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
    try {
      const endpoint = authMode === 'signup' ? 'register' : 'login'
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: authForm.username,
          password: authForm.password,
          ...(authMode === 'signup'
            ? { contact: authForm.contact, otp: authForm.otp }
            : { role: authRole }),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Authentication failed.')
      setCurrentUser(result.user)
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
  }

  const handleBookingReview = () => {
    if (!currentUser || currentUser.role !== 'player') {
      window.alert('Log in as a player to reserve a court.')
      return
    }

    if (isSlotTaken(selectedCourtId, selectedDate, selectedTime)) {
      window.alert('This time slot is already booked. Please choose another one.')
      return
    }

    const deposit = DEPOSITS[selectedSport as keyof typeof DEPOSITS]

    setDraftReservation({
      courtId: selectedCourtId,
      date: selectedDate,
      time: selectedTime,
      sport: selectedSport,
      deposit,
    })
  }

  const confirmDeposit = () => {
    if (!draftReservation || !currentUser) return

    if (isSlotTaken(draftReservation.courtId, draftReservation.date, draftReservation.time)) {
      setDraftReservation(null)
      window.alert('This time slot was just booked. Please choose another one.')
      return
    }

    const newReservation = {
      id: `bk-${Date.now()}`,
      user: currentUser.username,
      date: draftReservation.date,
      courtId: draftReservation.courtId,
      time: draftReservation.time,
      sport: draftReservation.sport,
      deposit: draftReservation.deposit,
      status: 'pending',
      refundIssued: false,
    }

    setBookings((previous) => [newReservation, ...previous])
    setDraftReservation(null)
    window.alert('Your downpayment has been recorded. Your reservation is pending admin approval.')
  }

  const cancelUserBooking = (bookingId: string) => {
    setBookings((previous) => previous.map((booking) =>
      booking.id === bookingId ? { ...booking, status: 'cancelled', refundIssued: false } : booking,
    ))
  }

  const handleAdminAction = (bookingId: string, action: 'confirm' | 'reject') => {
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
              <button className="secondary" onClick={handleLogout}>Logout</button>
            </>
          ) : (
            <>
              <button className={authMode === 'login' ? 'primary' : 'secondary'} onClick={() => changeAuthMode('login')}>Player Login</button>
              <button className={authMode === 'signup' ? 'primary' : 'secondary'} onClick={() => changeAuthMode('signup')}>Create Account</button>
            </>
          )}
        </div>
      </header>

      {!currentUser ? (
        <main className="auth-layout">
          <section className="auth-panel">
            <h2>{authMode === 'login' ? `${authRole === 'admin' ? 'Admin' : 'Player'} login` : 'Create account'}</h2>
            <p>{authMode === 'login' ? 'Log in with your username and password.' : 'Create an account with your username, password and verified contact.'}</p>

            {authMode === 'login' && (
              <div className="role-switch" aria-label="Account type">
                <button type="button" className={authRole === 'player' ? 'primary' : 'secondary'} onClick={() => setAuthRole('player')}>Player</button>
                <button type="button" className={authRole === 'admin' ? 'primary' : 'secondary'} onClick={() => setAuthRole('admin')}>Admin</button>
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

              <button type="submit" className="primary wide">{authMode === 'login' ? 'Login' : 'Create account'}</button>
            </form>
          </section>

          <aside className="info-panel">
            <h3>Reservation rules</h3>
            <ul>
              <li>Courts 1-3 support Pickleball and Badminton.</li>
              <li>Courts 4-9 are Badminton only.</li>
              <li>Occupied time slots are disabled in this booking view.</li>
              <li>Downpayment: PHP 200 for Pickleball and PHP 175 for Badminton.</li>
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
                    <h3>{COURTS.find((court) => court.id === booking.courtId)?.name}</h3>
                    <p>{booking.date} · {booking.time} · {booking.sport}</p>
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
                      <button className="secondary danger" onClick={() => handleAdminAction(booking.id, 'reject')}>Reject & refund</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      ) : (
        <main className="dashboard player-dashboard">
          <section className="panel booking-panel">
            <div className="panel-header">
              <h2>Book a court</h2>
              <label>
                Date
                <input type="date" value={selectedDate} onInput={(e) => setSelectedDate((e.target as HTMLInputElement).value)} />
              </label>
            </div>

            <div className="booking-form-grid">
              <label>
                Court
                <select value={selectedCourtId} onChange={(e) => {
                  const nextCourt = Number((e.target as HTMLSelectElement).value)
                  const chosen = COURTS.find((court) => court.id === nextCourt) ?? COURTS[0]
                  setSelectedCourtId(nextCourt)
                  setSelectedSport(chosen.sports.includes(selectedSport) ? selectedSport : chosen.sports[0])
                }}>
                  {selectedCourtOptions.map((court) => (
                    <option value={court.id} key={court.id}>{court.label}</option>
                  ))}
                </select>
              </label>

              <label>
                Sport
                <select value={selectedSport} onChange={(e) => setSelectedSport((e.target as HTMLSelectElement).value)}>
                  {availableSports.map((sport) => (
                    <option value={sport} key={sport}>{sport}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="time-grid">
              {HOURS.map((time) => {
                const occupied = isSlotTaken(selectedCourtId, selectedDate, time)
                const selected = selectedTime === time

                return (
                  <button
                    type="button"
                    key={time}
                    className={selected ? 'time-slot selected' : occupied ? 'time-slot occupied' : 'time-slot'}
                    disabled={occupied}
                    onClick={() => setSelectedTime(time)}
                  >
                    {time}
                  </button>
                )
              })}
            </div>

            <div className="booking-summary">
              <div>
                <span>Selected court</span>
                <strong>{activeCourt.name}</strong>
              </div>
              <div>
                <span>Downpayment</span>
                <strong>PHP {DEPOSITS[selectedSport as keyof typeof DEPOSITS].toFixed(2)}</strong>
              </div>
            </div>

            <button type="button" className="primary wide" onClick={handleBookingReview}>Review payment</button>
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
                      <p className="muted">{COURTS.find((court) => court.id === booking.courtId)?.name}</p>
                      <h3>{booking.sport}</h3>
                      <p>{booking.date} · {booking.time}</p>
                      <p className="status">Status: {booking.status}</p>
                    </div>

                    <div className="reservation-actions">
                      {booking.status === 'pending' || booking.status === 'confirmed' ? (
                        <button className="secondary danger" onClick={() => cancelUserBooking(booking.id)}>Cancel</button>
                      ) : null}
                      <span className="deposit-tag">Downpayment PHP {booking.deposit.toFixed(2)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {draftReservation && (
            <aside className="payment-panel panel">
              <h2>Payment</h2>
              <p>Downpayment to reserve the court.</p>
              <div className="payment-summary">
                <span>Court</span>
                <strong>{COURTS.find((court) => court.id === draftReservation.courtId)?.name}</strong>
                <span>Sport</span>
                <strong>{draftReservation.sport}</strong>
                <span>Date & time</span>
                <strong>{draftReservation.date} · {draftReservation.time}</strong>
                <span>Downpayment due</span>
                <strong>PHP {draftReservation.deposit.toFixed(2)}</strong>
              </div>

              <div className="payment-buttons">
                <button className="primary" onClick={confirmDeposit}>Pay deposit</button>
                <button className="secondary" onClick={() => setDraftReservation(null)}>Cancel</button>
              </div>
            </aside>
          )}
        </main>
      )}
    </div>
  )
}
