import { useEffect, useState } from 'preact/hooks'
import './app.css'
import {
  addDays,
  COURTS,
  formatClockTime,
  formatDate,
  formatTimeRange,
  HOURS,
  HOURLY_RATES,
  RACKET_RENTAL_PER_DAY,
  reportDateRange,
  SHUTTLECOCK_PRICE,
  slotIsInFuture,
  SPORTS,
} from './features/courts/schedule'
import { defaultAuth, emptyAccountProfile, profileFromAccount } from './features/accounts/account'
import type { SignedInUser } from './features/accounts/account'
import { AccountProfileView, AuthenticationView } from './features/accounts/AccountViews'
import { DashboardNavigation } from './features/navigation/DashboardNavigation'
import { ReservationTimeline } from './features/reservations/ReservationTimeline'
import {
  bookingAddOns,
  bookingSlots,
  bookingStatusLabel,
  courtSummary,
  reservationOccupiesSlot,
  slotStatusLabel,
  slotSummary,
} from './features/reservations/reservations'
import type { Booking, BookingSlot, ScheduleBlock } from './features/reservations/reservations'

export function App() {
  const [currentUser, setCurrentUser] = useState<SignedInUser | null>(null)
  const [accountProfile, setAccountProfile] = useState(emptyAccountProfile)
  const [isManagingAccount, setIsManagingAccount] = useState(false)
  const [resumeBookingReview, setResumeBookingReview] = useState(false)
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
  const [bookingSyncNotice, setBookingSyncNotice] = useState('')
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([])
  const [selectedBlockSlots, setSelectedBlockSlots] = useState<BookingSlot[]>([])
  const [blockReason, setBlockReason] = useState('')
  const [blockError, setBlockError] = useState('')
  const [reportPeriod, setReportPeriod] = useState<'day' | 'week' | 'month'>('day')
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
  const [rangeCourtId, setRangeCourtId] = useState(1)
  const [rangeStart, setRangeStart] = useState('18:00')
  const [rangeEnd, setRangeEnd] = useState('19:00')
  const [rangeError, setRangeError] = useState('')
  const [preferredTime, setPreferredTime] = useState('18:00')
  const [selectedSlots, setSelectedSlots] = useState<BookingSlot[]>([])
  const [racketRental, setRacketRental] = useState(false)
  const [shuttlecockQuantity, setShuttlecockQuantity] = useState(0)
  const [draftReservation, setDraftReservation] = useState<null | {
    slots: BookingSlot[]
    date: string
    sport: string
    deposit: number
    totalPrice: number
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
    if (!currentUser) return

    let active = true
    let legacyImported = false
    const refreshBookings = async () => {
      try {
        if (currentUser.role === 'admin' && !legacyImported) {
          const saved = window.localStorage.getItem('redcourt-bookings')
          const legacyBookings = saved ? JSON.parse(saved) : []
          if (Array.isArray(legacyBookings) && legacyBookings.length > 0) {
            const importResponse = await fetch('/api/bookings/import-legacy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bookings: legacyBookings }),
            })
            const importResult = await importResponse.json()
            if (!importResponse.ok) throw new Error(importResult.error || 'Could not migrate previous reservations.')
            if (importResult.imported > 0 || importResult.skippedConflicts > 0) {
              setBookingSyncNotice(`${importResult.imported} previous reservations imported${importResult.skippedConflicts > 0 ? `; ${importResult.skippedConflicts} conflicting entries skipped` : ''}.`)
            }
          }
          legacyImported = true
        }

        const [response, blocksResponse] = await Promise.all([
          fetch('/api/bookings'),
          fetch('/api/blocks'),
        ])
        const [result, blocksResult] = await Promise.all([response.json(), blocksResponse.json()])
        if (!response.ok) throw new Error(result.error || 'Could not refresh reservations.')
        if (!blocksResponse.ok) throw new Error(blocksResult.error || 'Could not refresh blocked court times.')
        if (!active) return

        const serverBookings = result.bookings as Booking[]
        const serverIds = new Set(serverBookings.map((booking) => booking.id))
        const saved = window.localStorage.getItem('redcourt-bookings')
        const localBookings = saved ? JSON.parse(saved) : []
        const ownLegacyBookings = currentUser.role === 'player' && Array.isArray(localBookings)
          ? localBookings.filter((booking: Booking) => (
            booking.user.toLowerCase() === currentUser.username.toLowerCase() && !serverIds.has(booking.id)
          ))
          : []
        setBookings([...serverBookings, ...ownLegacyBookings])
        setScheduleBlocks(blocksResult.blocks as ScheduleBlock[])
        setBookingSyncNotice((previous) => previous.startsWith('Could not') ? '' : previous)
      } catch (error) {
        if (active) setBookingSyncNotice(error instanceof Error ? `Could not sync reservations: ${error.message}` : 'Could not sync reservations.')
      }
    }

    void refreshBookings()
    const refreshTimer = window.setInterval(() => { void refreshBookings() }, 8000)
    return () => {
      active = false
      window.clearInterval(refreshTimer)
    }
  }, [currentUser])

  useEffect(() => {
    window.localStorage.setItem('redcourt-bookings', JSON.stringify(bookings))
  }, [bookings])

  const hourlyRate = HOURLY_RATES[selectedSport as keyof typeof HOURLY_RATES]
  const racketRentalTotal = selectedSport === 'Badminton' && racketRental ? RACKET_RENTAL_PER_DAY : 0
  const shuttlecockTotal = selectedSport === 'Badminton' ? shuttlecockQuantity * SHUTTLECOCK_PRICE : 0
  const totalPayment = hourlyRate * selectedSlots.length + racketRentalTotal + shuttlecockTotal
  const canReviewOrder = selectedSlots.length > 0 || (selectedSport === 'Badminton' && (racketRental || shuttlecockQuantity > 0))

  const slotReservation = (courtId: number, date: string, time: string) =>
    bookings.find((booking) => (
      bookingSlots(booking).some((slot) => slot.courtId === courtId && slot.time === time) &&
      booking.date === date &&
      reservationOccupiesSlot(booking.status)
    ))
  const isSlotTaken = (courtId: number, date: string, time: string) => Boolean(slotReservation(courtId, date, time))

  const availableCourts = COURTS.filter((court) => court.sports.includes(selectedSport))
  const isSlotBlocked = (courtId: number, time: string) => scheduleBlocks.some((block) => (
    block.date === selectedDate && block.slots.some((slot) => slot.courtId === courtId && slot.time === time)
  ))
  const rangeStartOptions = HOURS.filter((time) => slotIsInFuture(selectedDate, time))
  const effectiveRangeStart = rangeStartOptions.includes(rangeStart) ? rangeStart : rangeStartOptions[0] || ''
  const rangeEndOptions = effectiveRangeStart
    ? HOURS.slice(HOURS.indexOf(effectiveRangeStart) + 1).concat('22:00')
    : []
  const effectiveRangeEnd = rangeEndOptions.includes(rangeEnd) ? rangeEnd : rangeEndOptions[0] || ''
  const preferredTimeOptions = HOURS.filter((time) => slotIsInFuture(selectedDate, time))
  const effectivePreferredTime = preferredTimeOptions.includes(preferredTime) ? preferredTime : preferredTimeOptions[0] || ''
  const preferredTimeCourts = availableCourts.filter((court) => (
    effectivePreferredTime &&
    !isSlotTaken(court.id, selectedDate, effectivePreferredTime) &&
    !isSlotBlocked(court.id, effectivePreferredTime)
  ))

  const addTimeRange = () => {
    setRangeError('')
    const startIndex = HOURS.indexOf(effectiveRangeStart)
    const endIndex = effectiveRangeEnd === '22:00' ? HOURS.length : HOURS.indexOf(effectiveRangeEnd)
    if (startIndex < 0 || endIndex <= startIndex) {
      setRangeError('Choose an end time after the start time.')
      return
    }
    const slots = HOURS.slice(startIndex, endIndex).map((time) => ({ courtId: rangeCourtId, time }))
    if (slots.some((slot) => !slotIsInFuture(selectedDate, slot.time) || isSlotTaken(slot.courtId, selectedDate, slot.time) || isSlotBlocked(slot.courtId, slot.time))) {
      setRangeError('That time range includes a past, reserved, or blocked slot. Choose another range.')
      return
    }
    setSelectedSlots((previous) => [
      ...previous,
      ...slots.filter((slot) => !previous.some((selected) => selected.courtId === slot.courtId && selected.time === slot.time)),
    ])
  }

  // Increment 2: user account, registration, and profile workflows.
  const generateOtp = async () => {
    setOtpSent(false)
    setOtpMessage('Sending OTP...')
    try {
      const response = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: authForm.phone }),
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

    if (authMode === 'signup' && (!authForm.name.trim() || !authForm.phone.trim() || !authForm.email.trim() || !authForm.otp.trim())) {
      setAuthError('Enter your name, contact number, email, and the OTP sent to your contact number.')
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
            ? {
                name: authForm.name,
                phone: authForm.phone,
                email: authForm.email,
                otp: authForm.otp,
                role: registrationRole,
              }
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
    setAccountProfile(emptyAccountProfile)
    setIsManagingAccount(false)
    setResumeBookingReview(false)
    setDraftReservation(null)
    setSelectedSlots([])
    setRacketRental(false)
    setShuttlecockQuantity(0)
    setProfileError('')
    setProfileMessage('')
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
      setCurrentUser(result.user)
      setProfileMessage('Account details saved.')
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not save account details.')
    }
  }

  // Increment 4: reservation creation, payment review, and cancellation.
  const handleBookingReview = () => {
    if (!currentUser || currentUser.role !== 'player') {
      window.alert('Log in as a player to reserve a court.')
      return
    }
    if (selectedSlots.length > 0 && ![currentUser.name, currentUser.birthdate, currentUser.phone, currentUser.email].every((value) => value?.trim())) {
      setResumeBookingReview(true)
      setIsManagingAccount(true)
      setProfileMessage('')
      setProfileError('Complete and save your name, birthdate, contact number, and email before reserving.')
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

    const totalPrice = HOURLY_RATES[selectedSport as keyof typeof HOURLY_RATES] * slots.length
      + (bookingRacketRental ? RACKET_RENTAL_PER_DAY : 0)
      + bookingShuttlecockQuantity * SHUTTLECOCK_PRICE
    const deposit = totalPrice / 2

    setDraftReservation({
      slots,
      date: selectedDate,
      sport: selectedSport,
      deposit,
      totalPrice,
      racketRental: bookingRacketRental,
      shuttlecockQuantity: bookingShuttlecockQuantity,
    })
  }

  useEffect(() => {
    if (!resumeBookingReview || !currentUser || currentUser.role !== 'player') return
    if (![currentUser.name, currentUser.birthdate, currentUser.phone, currentUser.email].every((value) => value?.trim())) return

    setResumeBookingReview(false)
    setIsManagingAccount(false)
    setProfileMessage('')
    handleBookingReview()
  }, [resumeBookingReview, currentUser])

  const confirmDeposit = async () => {
    if (!draftReservation || !currentUser) return

    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: draftReservation.date,
          slots: draftReservation.slots,
          sport: draftReservation.sport,
          racketRental: draftReservation.racketRental,
          shuttlecockQuantity: draftReservation.shuttlecockQuantity,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        if (response.status === 401) {
          setDraftReservation(null)
          setCurrentUser(null)
          setIsManagingAccount(false)
          setAuthMode('login')
          setAuthRole('player')
        }
        if (response.status === 409) {
          const refreshResponse = await fetch('/api/bookings')
          if (refreshResponse.ok) {
            const refreshed = await refreshResponse.json()
            setBookings(refreshed.bookings)
          }
        }
        throw new Error(result.error || 'Could not reserve those court times.')
      }

      setBookings((previous) => [result.booking, ...previous.filter((booking) => booking.id !== result.booking.id)])
      setSelectedSlots([])
      setRacketRental(false)
      setShuttlecockQuantity(0)
      setDraftReservation(null)
      window.alert('Your 50% downpayment was recorded. Your reservation is pending admin approval.')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not complete the reservation.')
    }
  }

  const cancelUserBooking = async (bookingId: string) => {
    try {
      const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not cancel reservation.')
      setBookings((previous) => previous.map((booking) => booking.id === bookingId ? result.booking : booking))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not cancel reservation.')
    }
  }

  // Increment 3 and 5: court schedule updates and administrator actions.
  const handleBlockSlots = async () => {
    setBlockError('')
    if (selectedBlockSlots.length === 0 || blockReason.trim().length < 3) {
      setBlockError('Select at least one free time and enter a reason.')
      return
    }
    try {
      const response = await fetch('/api/admin/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, slots: selectedBlockSlots, reason: blockReason }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not block those court times.')
      setScheduleBlocks((previous) => [...previous, result.block])
      setSelectedBlockSlots([])
      setBlockReason('')
    } catch (error) {
      setBlockError(error instanceof Error ? error.message : 'Could not block those court times.')
    }
  }

  const handleRemoveBlock = async (blockId: string) => {
    setBlockError('')
    try {
      const response = await fetch(`/api/admin/blocks/${encodeURIComponent(blockId)}`, { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not remove schedule block.')
      setScheduleBlocks((previous) => previous.filter((block) => block.id !== blockId))
    } catch (error) {
      setBlockError(error instanceof Error ? error.message : 'Could not remove schedule block.')
    }
  }

  const downloadScheduleReport = () => {
    const range = reportDateRange(selectedDate, reportPeriod)
    const rows = adminReservations.filter((booking) => booking.date >= range.start && booking.date <= range.end)
    const escapeCsv = (value: string | number) => {
      const safe = String(value).replace(/^[=+@]/, "'$&")
      return `"${safe.replace(/"/g, '""')}"`
    }
    const csv = [
      ['Date', 'Player', 'Sport', 'Court schedule', 'Status', 'Total price PHP', 'Downpayment PHP'].map(escapeCsv).join(','),
      ...rows.map((booking) => [
        booking.date,
        booking.user,
        booking.sport,
        slotSummary(bookingSlots(booking)) || 'Equipment only',
        bookingStatusLabel(booking.status),
        booking.totalPrice ?? booking.deposit,
        booking.deposit,
      ].map(escapeCsv).join(',')),
    ].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `redcourt-${reportPeriod}-report-${selectedDate}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleAdminAction = async (bookingId: string, action: 'confirm' | 'reject') => {
    try {
      const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/${action}`, { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update reservation.')
      setBookings((previous) => previous.map((booking) => booking.id === bookingId ? result.booking : booking))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not update reservation.')
    }
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

  // Increment 6: connect the feature views into the complete website.
  return (
    <div class="redcourt-app">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header class="topbar">
        <div class="topbar-brand">
          <img class="brand-logo" src="/redcourt-logo.png" alt="Red Court Sports Center" />
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

      {!isManagingAccount && (
        <section className="venue-hero" aria-label="Red Court Sports Center">
          <img src="/redcourt-courts.png" alt="Players enjoying a game at the Red Court indoor courts" />
          <div className="venue-hero-copy">
            <p>PLAY YOUR GAME</p>
            <h2>Make room for one more rally.</h2>
            <span>Badminton · Pickleball · Sepak Takraw</span>
          </div>
        </section>
      )}

      {currentUser && !isManagingAccount ? (
        <DashboardNavigation user={currentUser} />
      ) : null}

      {currentUser && isManagingAccount ? (
        <AccountProfileView
          profile={accountProfile}
          error={profileError}
          message={profileMessage}
          onChange={(field, value) => setAccountProfile((previous) => ({ ...previous, [field]: value }))}
          onSubmit={handleProfileSave}
        />
      ) : !currentUser ? (
        <AuthenticationView
          mode={authMode}
          role={authRole}
          registrationRole={registrationRole}
          adminLimit={adminLimit}
          form={authForm}
          showPassword={showPassword}
          otpSent={otpSent}
          otpMessage={otpMessage}
          error={authError}
          notice={authNotice}
          onRegistrationRoleChange={setRegistrationRole}
          onFormChange={(field, value) => setAuthForm((previous) => ({ ...previous, [field]: value }))}
          onPasswordToggle={() => setShowPassword((visible) => !visible)}
          onGenerateOtp={() => void generateOtp()}
          onSubmit={handleAuthSubmit}
        />
      ) : currentUser.role === 'admin' ? (
        <main className="dashboard admin-dashboard" id="main-content">
          <section className="panel schedule-panel" id="admin-schedule">
            <div className="panel-header">
              <h2>Admin court schedule</h2>
              <label>
                Date
                <input type="date" value={selectedDate} onInput={(e) => {
                  setSelectedDate((e.target as HTMLInputElement).value)
                  setSelectedBlockSlots([])
                }} />
              </label>
            </div>

            <div className="court-grid">
              {COURTS.map((court) => (
                <div key={court.id} className="court-card admin-court">
                  <h3>{court.name}</h3>
                  <p>{court.sports.join(' / ')}</p>
                  <div className="slot-list">
                    {HOURS.map((time) => {
                      const reservation = slotReservation(court.id, selectedDate, time)
                      const occupied = Boolean(reservation)
                      const block = scheduleBlocks.find((entry) => entry.date === selectedDate && entry.slots.some((slot) => slot.courtId === court.id && slot.time === time))
                      const selected = selectedBlockSlots.some((slot) => slot.courtId === court.id && slot.time === time)
                      return (
                        <button
                          type="button"
                          className={`slot ${block ? 'occupied' : occupied ? 'occupied' : selected ? 'selected' : 'free'}`}
                          key={`${court.id}-${time}`}
                          disabled={occupied && !block}
                          onClick={() => {
                            if (block) {
                              void handleRemoveBlock(block.id)
                            } else {
                              setSelectedBlockSlots((previous) => selected
                                ? previous.filter((slot) => !(slot.courtId === court.id && slot.time === time))
                                : [...previous, { courtId: court.id, time }])
                            }
                          }}
                        >
                          {formatTimeRange(time)}
                          <small>{block ? 'Blocked' : reservation ? slotStatusLabel(reservation.status) : selected ? 'Selected' : 'Available'}</small>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="schedule-block-tools">
              <h3>Block court times</h3>
              <p className="muted">Select available times above to reserve them for maintenance or an event.</p>
              <label>
                Reason
                <input
                  type="text"
                  maxLength={120}
                  value={blockReason}
                  onInput={(event) => setBlockReason((event.target as HTMLInputElement).value)}
                  placeholder="Maintenance or event"
                />
              </label>
              {blockError ? <p className="auth-error" role="alert">{blockError}</p> : null}
              <button type="button" className="primary" disabled={selectedBlockSlots.length === 0} onClick={() => void handleBlockSlots()}>
                Block {selectedBlockSlots.length || ''} selected time{selectedBlockSlots.length === 1 ? '' : 's'}
              </button>
            </div>
          </section>

          <section className="panel report-panel" id="admin-reports">
            <div className="panel-header">
              <div>
                <h2>Booking history and reports</h2>
                <span className="muted">All players · {formatDate(reportDateRange(selectedDate, reportPeriod).start)} to {formatDate(reportDateRange(selectedDate, reportPeriod).end)}</span>
              </div>
              <label>
                Report period
                <select value={reportPeriod} onChange={(event) => setReportPeriod((event.target as HTMLSelectElement).value as typeof reportPeriod)}>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </label>
            </div>
            <p>{adminReservations.filter((booking) => {
              const range = reportDateRange(selectedDate, reportPeriod)
              return booking.date >= range.start && booking.date <= range.end
            }).length} reservations in this period.</p>
            <button type="button" className="secondary" onClick={downloadScheduleReport}>Download CSV report</button>
          </section>

          <section className="panel" id="admin-reservations">
            <div className="panel-header">
              <h2>Reservation requests</h2>
            </div>
            {bookingSyncNotice ? <p className="auth-error" role="status">{bookingSyncNotice}</p> : null}

            <div className="reservation-list">
              {adminReservations.map((booking) => (
                <div key={booking.id} className="reservation-card">
                  <div>
                    <p className="muted">{booking.user}</p>
                    <h3>{courtSummary(bookingSlots(booking)) || 'Equipment only'}</h3>
                    <p>{formatDate(booking.date)}{bookingSlots(booking).length > 0 ? ` · ${slotSummary(bookingSlots(booking))}` : ''} · {booking.sport}</p>
                    {bookingAddOns(booking) ? <p className="muted">{bookingAddOns(booking)}</p> : null}
                    {booking.totalPrice != null ? <p className="muted">Total PHP {booking.totalPrice.toFixed(2)} · 50% downpayment PHP {booking.deposit.toFixed(2)}</p> : null}
                    <p className="status status--pending">Status: {bookingStatusLabel(booking.status)}</p>
                    <ReservationTimeline booking={booking} />
                  </div>

                  <div className="reservation-actions">
                    {booking.status === 'pending' && (
                      <>
                        <button className="primary" onClick={() => handleAdminAction(booking.id, 'confirm')}>Approve</button>
                        <button className="secondary danger" onClick={() => handleAdminAction(booking.id, 'reject')}>Reject & refund</button>
                      </>
                    )}
                    {booking.status === 'confirmed' && (
                      <>
                        <button className="secondary danger" onClick={() => handleAdminAction(booking.id, 'reject')}>Reject & refund</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel admin-requests-panel" id="admin-accounts">
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
        <main className="dashboard player-dashboard" id="main-content">
          <section className="panel booking-panel" id="player-booking">
            <div className="panel-header">
              <div>
                <h2>Book a court</h2>
                <span className="muted">Availability for {formatDate(selectedDate)}</span>
              </div>
            </div>

            <label className="sport-filter">
              Sport
              <select value={selectedSport} onChange={(e) => {
                const sport = (e.target as HTMLSelectElement).value
                setSelectedSport(sport)
                setRangeCourtId(1)
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
              <input type="date" min={addDays(0)} value={selectedDate} onInput={(e) => {
                setSelectedDate((e.target as HTMLInputElement).value)
                setSelectedSlots([])
              }} />
            </label>

            <section className="range-booking-tools" aria-label="Choose reservation start and end time">
              <h3>Choose a time range</h3>
              <div className="range-booking-fields">
                <label>
                  Court
                  <select value={rangeCourtId} onChange={(event) => setRangeCourtId(Number((event.target as HTMLSelectElement).value))}>
                    {availableCourts.map((court) => <option value={court.id} key={court.id}>{court.name}</option>)}
                  </select>
                </label>
                <label>
                  Start time
                  <select value={effectiveRangeStart} onChange={(event) => {
                    const start = (event.target as HTMLSelectElement).value
                    setRangeStart(start)
                    if (effectiveRangeEnd <= start) setRangeEnd(HOURS[HOURS.indexOf(start) + 1] || '22:00')
                  }}>
                    {rangeStartOptions.length > 0
                      ? rangeStartOptions.map((time) => <option value={time} key={time}>{formatClockTime(time)}</option>)
                      : <option value="">No future times available</option>}
                  </select>
                </label>
                <label>
                  End time
                  <select value={effectiveRangeEnd} onChange={(event) => setRangeEnd((event.target as HTMLSelectElement).value)}>
                    {rangeEndOptions.length > 0 ? rangeEndOptions.map((time) => (
                      <option value={time} key={time}>{formatClockTime(time)}</option>
                    )) : <option value="">No future times available</option>}
                  </select>
                </label>
              </div>
              {rangeError ? <p className="auth-error" role="alert">{rangeError}</p> : null}
              <button type="button" className="secondary" disabled={!effectiveRangeStart || !effectiveRangeEnd} onClick={addTimeRange}>Add time range</button>
            </section>

            {bookingSyncNotice ? <p className="auth-error" role="status">{bookingSyncNotice}</p> : null}

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
                    const freeTimes = HOURS.filter((time) => slotIsInFuture(selectedDate, time) && !isSlotTaken(court.id, selectedDate, time) && !isSlotBlocked(court.id, time))
                    return (
                      <section key={court.id} className={`court-card schedule-court${selectedSlots.some((slot) => slot.courtId === court.id) ? ' selected' : ''}`}>
                        <div className="schedule-court-heading">
                          <h3>{court.name}</h3>
                          <span>{freeTimes.length} free</span>
                        </div>
                        <div className="court-time-list">
                          {HOURS.map((time) => {
                            const blocked = isSlotBlocked(court.id, time)
                            const reservation = slotReservation(court.id, selectedDate, time)
                            const past = !slotIsInFuture(selectedDate, time)
                            const occupied = Boolean(reservation) || blocked || past
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
                                <span>{formatTimeRange(time)}</span>
                                {occupied ? <span className="slot-unavailable">{blocked ? 'Blocked' : past ? 'Past' : slotStatusLabel(reservation?.status || 'reserved')}</span> : null}
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
                  <select value={effectivePreferredTime} onChange={(e) => setPreferredTime((e.target as HTMLSelectElement).value)}>
                    {preferredTimeOptions.length > 0
                      ? preferredTimeOptions.map((time) => <option value={time} key={time}>{formatTimeRange(time)}</option>)
                      : <option value="">No future times available</option>}
                  </select>
                </label>
              </div>
              <p className="muted">{effectivePreferredTime ? `Courts free at ${formatTimeRange(effectivePreferredTime)} on ${formatDate(selectedDate)}` : 'No future times are available on this date.'}</p>
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
                        setSelectedSlots((previous) => previous.some((slot) => slot.courtId === court.id && slot.time === effectivePreferredTime)
                          ? previous
                          : [...previous, { courtId: court.id, time: effectivePreferredTime }])
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
                <span>Total price · PHP {hourlyRate}/hour</span>
                <strong>PHP {totalPayment.toFixed(2)}</strong>
                <span>50% downpayment</span>
                <strong>PHP {(totalPayment / 2).toFixed(2)}</strong>
              </div>
            </div>

            <button type="button" className="primary wide" disabled={!(selectedSlots.length > 0 || (selectedSport === 'Badminton' && (racketRental || shuttlecockQuantity > 0)))} onClick={handleBookingReview}>Review order</button>
          </section>

          <section className="panel" id="player-reservations">
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
                      <p>{formatDate(booking.date)}{bookingSlots(booking).length > 0 ? ` · ${slotSummary(bookingSlots(booking))}` : ''}</p>
                      {bookingAddOns(booking) ? <p className="muted">{bookingAddOns(booking)}</p> : null}
                      <p className="status">Status: {bookingStatusLabel(booking.status)}</p>
                      <ReservationTimeline booking={booking} />
                    </div>

                    <div className="reservation-actions">
                      {booking.status === 'pending' || booking.status === 'confirmed' ? (
                        <button className="secondary danger" onClick={() => cancelUserBooking(booking.id)}>Cancel</button>
                      ) : null}
                      <span className="deposit-tag">
                        Total PHP {(booking.totalPrice ?? booking.deposit).toFixed(2)}
                        {booking.totalPrice != null ? ` · 50% downpayment PHP ${booking.deposit.toFixed(2)}` : ''}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {draftReservation && (
            <div className="payment-overlay" onClick={() => setDraftReservation(null)}>
              <aside className="payment-panel panel" role="dialog" aria-modal="true" aria-labelledby="payment-dialog-title" onClick={(e) => e.stopPropagation()}>
              <h2 id="payment-dialog-title">Payment review</h2>
              {draftReservation.slots.length > 0
                ? <p>Hourly rate: PHP {HOURLY_RATES[draftReservation.sport as keyof typeof HOURLY_RATES]} per hour.</p>
                : <p>Equipment-only order; no court booking included.</p>}
              <div className="payment-summary">
                <span>Courts</span>
                <strong>{courtSummary(draftReservation.slots) || 'Equipment only'}</strong>
                <span>Sport</span>
                <strong>{draftReservation.sport}</strong>
                <span>{draftReservation.slots.length > 0 ? 'Date & time' : 'Rental date'}</span>
                <strong>{formatDate(draftReservation.date)}{draftReservation.slots.length > 0 ? ` · ${slotSummary(draftReservation.slots)}` : ''}</strong>
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
                <span>Total price</span>
                <strong>PHP {draftReservation.totalPrice.toFixed(2)}</strong>
                <span>50% downpayment due now</span>
                <strong>PHP {draftReservation.deposit.toFixed(2)}</strong>
              </div>

              <div className="payment-buttons">
                <button className="primary" onClick={confirmDeposit}>Pay 50% downpayment</button>
                <button className="secondary" onClick={() => setDraftReservation(null)}>Cancel</button>
              </div>
              </aside>
            </div>
          )}
        </main>
      )}
      {canReviewOrder && !draftReservation ? (
        <div className="quick-booking-bar" role="region" aria-label="Booking total">
          <div className="quick-booking-total" aria-live="polite">
            <span>50% downpayment · total PHP {totalPayment.toFixed(2)}</span>
            <strong>PHP {(totalPayment / 2).toFixed(2)}</strong>
          </div>
          <button type="button" className="primary" onClick={handleBookingReview}>Review downpayment</button>
        </div>
      ) : null}
    </div>
  )
}
