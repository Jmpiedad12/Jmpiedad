import { useEffect, useState } from 'preact/hooks'
import './app.css'
import {
  addDays,
  BOOKING_END_TIMES,
  COURTS,
  clockTimeToMinutes,
  formatDate,
  formatClockTime,
  formatTimeRange,
  BOOKING_START_TIMES,
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
  bookingSlotHours,
  bookingSlotsOverlap,
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
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false)
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
  const [selectedSlots, setSelectedSlots] = useState<BookingSlot[]>([])
  const [reservationStartTime, setReservationStartTime] = useState('')
  const [reservationEndTime, setReservationEndTime] = useState('')
  const [reservationCourtId, setReservationCourtId] = useState<number | ''>('')
  const [racketRentalQuantity, setRacketRentalQuantity] = useState(0)
  const [shuttlecockQuantity, setShuttlecockQuantity] = useState(0)
  const [draftReservation, setDraftReservation] = useState<null | {
    slots: BookingSlot[]
    date: string
    sport: string
    deposit: number
    totalPrice: number
    racketRentalQuantity: number
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
  const racketRentalTotal = selectedSport === 'Badminton' ? racketRentalQuantity * RACKET_RENTAL_PER_DAY : 0
  const shuttlecockTotal = selectedSport === 'Badminton' ? shuttlecockQuantity * SHUTTLECOCK_PRICE : 0
  const selectedCourtHours = selectedSlots.reduce((total, slot) => total + bookingSlotHours(slot), 0)
  const totalPayment = hourlyRate * selectedCourtHours + racketRentalTotal + shuttlecockTotal
  const amountDueNow = hourlyRate * selectedCourtHours / 2 + racketRentalTotal + shuttlecockTotal
  const canReviewOrder = selectedSlots.length > 0 || (selectedSport === 'Badminton' && (racketRentalQuantity > 0 || shuttlecockQuantity > 0))

  const slotReservation = (courtId: number, date: string, time: string, durationMinutes = 60) =>
    bookings.find((booking) => (
      bookingSlots(booking).some((slot) => bookingSlotsOverlap(slot, { courtId, time, durationMinutes })) &&
      booking.date === date &&
      reservationOccupiesSlot(booking.status)
    ))
  const isSlotTaken = (courtId: number, date: string, time: string, durationMinutes = 60) => (
    Boolean(slotReservation(courtId, date, time, durationMinutes))
  )

  const availableCourts = COURTS.filter((court) => court.sports.includes(selectedSport))
  const isSlotBlocked = (courtId: number, time: string, durationMinutes = 60) => scheduleBlocks.some((block) => (
    block.date === selectedDate && block.slots.some((slot) => bookingSlotsOverlap(slot, { courtId, time, durationMinutes }))
  ))
  const isSelectedTimeOverlapping = (courtId: number, time: string, durationMinutes = 60) => selectedSlots.some((slot) => (
    bookingSlotsOverlap(slot, { courtId, time, durationMinutes })
  ))
  const selectableCourtsForRange = (time: string, durationMinutes: number) => availableCourts.filter((court) => (
    slotIsInFuture(selectedDate, time) &&
    !isSlotTaken(court.id, selectedDate, time, durationMinutes) &&
    !isSlotBlocked(court.id, time, durationMinutes) &&
    !isSelectedTimeOverlapping(court.id, time, durationMinutes)
  ))
  const selectableEndTimesForStart = (startTime: string) => BOOKING_END_TIMES.filter((endTime) => {
    const durationMinutes = clockTimeToMinutes(endTime) - clockTimeToMinutes(startTime)
    return durationMinutes >= 60 && selectableCourtsForRange(startTime, durationMinutes).length > 0
  })
  const selectableStartTimes = BOOKING_START_TIMES.filter((time) => selectableEndTimesForStart(time).length > 0)
  const effectiveReservationStartTime = selectableStartTimes.includes(reservationStartTime)
    ? reservationStartTime
    : selectableStartTimes[0] || ''
  const selectableEndTimes = effectiveReservationStartTime
    ? selectableEndTimesForStart(effectiveReservationStartTime)
    : []
  const effectiveReservationEndTime = selectableEndTimes.includes(reservationEndTime)
    ? reservationEndTime
    : selectableEndTimes[0] || ''
  const selectedDurationMinutes = effectiveReservationStartTime && effectiveReservationEndTime
    ? clockTimeToMinutes(effectiveReservationEndTime) - clockTimeToMinutes(effectiveReservationStartTime)
    : 0
  const courtsForSelectedRange = effectiveReservationStartTime && selectedDurationMinutes > 0
    ? selectableCourtsForRange(effectiveReservationStartTime, selectedDurationMinutes)
    : []
  const effectiveReservationCourtId = courtsForSelectedRange.some((court) => court.id === reservationCourtId)
    ? reservationCourtId
    : courtsForSelectedRange[0]?.id || ''
  // Increment 2: user account, registration, and profile workflows.
  const generateOtp = async () => {
    setOtpSent(false)
    setOtpMessage('Sending OTP...')
    try {
      const email = authForm.email.trim().toLowerCase()
      if (!email) throw new Error('Enter your email address before requesting a verification code.')
      if (authForm.password.length < 10 || !/[A-Za-z]/.test(authForm.password) || !/\d/.test(authForm.password)) {
        throw new Error('Use a password with at least 10 characters, 1 letter, and 1 number before requesting a verification code.')
      }
      const response = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: authForm.password }),
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
    if (isAuthSubmitting) return

    if (!authForm.username.trim() || !authForm.password.trim()) {
      window.alert('Please enter your username and password.')
      return
    }

    if (authMode === 'signup' && (!authForm.name.trim() || !authForm.phone.trim() || !authForm.email.trim() || !authForm.otp.trim())) {
      setAuthError('Enter your name, contact number, email, and the OTP sent to your email address.')
      return
    }

    if (authMode === 'signup' && (authForm.password.length < 10 || !/[A-Za-z]/.test(authForm.password) || !/\d/.test(authForm.password))) {
      setAuthError('Use a password with at least 10 characters, 1 letter, and 1 number.')
      return
    }

    if (authMode === 'signup' && !/^\d{11}$/.test(authForm.phone)) {
      setAuthError('Contact number must contain exactly 11 digits.')
      return
    }

    setAuthError('')
    setAuthNotice('')
    setIsAuthSubmitting(true)
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
      if (authMode === 'signup') {
        setAuthMode('login')
        setAuthRole(result.pendingApproval ? 'admin' : 'player')
        setRegistrationRole('player')
        setAuthForm({ ...defaultAuth, username: authForm.username.trim() })
        setShowPassword(false)
        setOtpSent(false)
        setOtpMessage('')
        setAuthNotice(result.pendingApproval
          ? result.message
          : 'Your account was created. Please sign in.')
        return
      }
      setCurrentUser(result.user)
      setAccountProfile(profileFromAccount(result.user))
      setAuthForm(defaultAuth)
      setOtpSent(false)
      setOtpMessage('')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed.')
    } finally {
      setIsAuthSubmitting(false)
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
    setRacketRentalQuantity(0)
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
      left.courtId - right.courtId || BOOKING_START_TIMES.indexOf(left.time) - BOOKING_START_TIMES.indexOf(right.time)
    ))
    const bookingRacketRentalQuantity = selectedSport === 'Badminton' ? racketRentalQuantity : 0
    const bookingShuttlecockQuantity = selectedSport === 'Badminton' ? shuttlecockQuantity : 0
    const equipmentOnly = slots.length === 0 && (bookingRacketRentalQuantity > 0 || bookingShuttlecockQuantity > 0)

    if (slots.length === 0 && !equipmentOnly) {
      window.alert('Select an available time or a badminton add-on.')
      return
    }
    if (slots.some((slot) => isSlotTaken(slot.courtId, selectedDate, slot.time, slot.durationMinutes))) {
      window.alert('One or more selected time slots are already booked. Please update your selection.')
      return
    }

    const courtHours = slots.reduce((total, slot) => total + bookingSlotHours(slot), 0)
    const courtTotal = HOURLY_RATES[selectedSport as keyof typeof HOURLY_RATES] * courtHours
    const equipmentTotal = bookingRacketRentalQuantity * RACKET_RENTAL_PER_DAY
      + bookingShuttlecockQuantity * SHUTTLECOCK_PRICE
    const totalPrice = courtTotal + equipmentTotal
    const deposit = courtTotal / 2 + equipmentTotal

    setDraftReservation({
      slots,
      date: selectedDate,
      sport: selectedSport,
      deposit,
      totalPrice,
      racketRentalQuantity: bookingRacketRentalQuantity,
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

  const submitReservation = async () => {
    if (!draftReservation || !currentUser) return

    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: draftReservation.date,
          slots: draftReservation.slots,
          sport: draftReservation.sport,
          racketRentalQuantity: draftReservation.racketRentalQuantity,
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
      setRacketRentalQuantity(0)
      setShuttlecockQuantity(0)
      setDraftReservation(null)
      window.alert('Your reservation request was submitted. The amount due now is 50% of court fees plus the full equipment cost. Your reservation is pending admin approval.')
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
      ['Date', 'Player', 'Sport', 'Court schedule', 'Status', 'Rental rackets', 'Shuttlecocks', 'Total price PHP', 'Amount due now PHP'].map(escapeCsv).join(','),
      ...rows.map((booking) => [
        booking.date,
        booking.user,
        booking.sport,
        slotSummary(bookingSlots(booking)) || 'Equipment only',
        bookingStatusLabel(booking.status),
        booking.racketRentalQuantity ?? (booking.racketRental ? 1 : 0),
        booking.shuttlecockQuantity ?? 0,
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

  const adminReservations = [...bookings].sort((a, b) => {
    const pendingOrder = Number(b.status === 'pending') - Number(a.status === 'pending')
    return pendingOrder || a.date.localeCompare(b.date)
  })
  const pendingReservationCount = adminReservations.filter((booking) => booking.status === 'pending').length

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
            authMode === 'signup' ? (
              <button className="secondary" disabled={isAuthSubmitting} onClick={() => changeAuthMode('login')}>Go back to Sign In</button>
            ) : (
              <>
                <button className="primary" onClick={toggleAuthRole}>{authRole === 'player' ? 'Admin Log In' : 'Player Log In'}</button>
                <button className="secondary" onClick={() => changeAuthMode('signup')}>Create Account</button>
              </>
            )
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
          isSubmitting={isAuthSubmitting}
          showPassword={showPassword}
          otpSent={otpSent}
          otpMessage={otpMessage}
          error={authError}
          notice={authNotice}
          onRegistrationRoleChange={setRegistrationRole}
          onFormChange={(field, value) => {
            setAuthForm((previous) => ({
              ...previous,
              [field]: value,
              ...(['email', 'password'].includes(field) ? { otp: '' } : {}),
            }))
            if (field === 'email' || field === 'password') {
              setOtpSent(false)
              setOtpMessage('')
            }
          }}
          onPasswordToggle={() => setShowPassword((visible) => !visible)}
          onGenerateOtp={() => void generateOtp()}
          onSubmit={handleAuthSubmit}
        />
      ) : currentUser.role === 'admin' ? (
        <main className="dashboard admin-dashboard" id="main-content">
          <div className="admin-overview">
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
                    {BOOKING_START_TIMES.map((time) => {
                      const reservation = slotReservation(court.id, selectedDate, time)
                      const occupied = Boolean(reservation)
                      const block = scheduleBlocks.find((entry) => entry.date === selectedDate && entry.slots.some((slot) => bookingSlotsOverlap(slot, { courtId: court.id, time })))
                      const selected = selectedBlockSlots.some((slot) => slot.courtId === court.id && slot.time === time)
                      const selectedOverlap = !selected && selectedBlockSlots.some((slot) => bookingSlotsOverlap(slot, { courtId: court.id, time }))
                      return (
                        <button
                          type="button"
                          className={`slot ${block ? 'occupied' : occupied ? 'occupied' : selected ? 'selected' : 'free'}`}
                          key={`${court.id}-${time}`}
                          disabled={(occupied && !block) || (!block && selectedOverlap)}
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

          <aside className="admin-approval-sidebar" aria-label="Approval requests">
            <section className="panel" id="admin-reservations">
              <div className="panel-header">
                <h2>Reservation requests</h2>
                <span className="muted">{pendingReservationCount} pending</span>
              </div>
              {bookingSyncNotice ? <p className="auth-error" role="status">{bookingSyncNotice}</p> : null}

              <div className="reservation-list">
                {adminReservations.map((booking) => (
                  <div key={booking.id} className={`reservation-card reservation-card--${booking.status}`}>
                    <div>
                      <p className="muted">{booking.user}</p>
                      <h3>{courtSummary(bookingSlots(booking)) || 'Equipment only'}</h3>
                      <p>{formatDate(booking.date)}{bookingSlots(booking).length > 0 ? ` · ${slotSummary(bookingSlots(booking))}` : ''} · {booking.sport}</p>
                      {bookingAddOns(booking) ? <p className="muted">{bookingAddOns(booking)}</p> : null}
                      {booking.totalPrice != null ? <p className="muted">Total PHP {booking.totalPrice.toFixed(2)} · Amount due now PHP {booking.deposit.toFixed(2)}</p> : null}
                      <p className={`status status--${booking.status}`}>Status: {bookingStatusLabel(booking.status)}</p>
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
                        <button className="secondary danger" onClick={() => handleAdminAction(booking.id, 'reject')}>Reject & refund</button>
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
          </aside>
          </div>

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
                setSelectedSlots([])
                if (sport !== 'Badminton') {
                  setRacketRentalQuantity(0)
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

            {bookingSyncNotice ? <p className="auth-error" role="status">{bookingSyncNotice}</p> : null}

            <div className="booking-workspace">
              <section className="availability-results" aria-live="polite">
                <div className="panel-header">
                  <h3>Availability schedule</h3>
                  <span className="muted">Open 8:00 AM–midnight. View only; swipe to see all courts and choose a free time below.</span>
                </div>
                <div className="availability-grid-legend" aria-label="Availability key">
                  <span className="availability-grid-legend-item"><span className="availability-legend-swatch availability-legend-swatch--available" />Available</span>
                  <span className="availability-grid-legend-item"><span className="availability-legend-swatch availability-legend-swatch--pending" />Pending</span>
                  <span className="availability-grid-legend-item"><span className="availability-legend-swatch availability-legend-swatch--reserved" />Booked or blocked</span>
                  <span className="availability-grid-legend-item"><span className="availability-legend-swatch availability-legend-swatch--past" />Past</span>
                </div>
                {availableCourts.length === 0 ? (
                  <p className="empty-state">No courts offer {selectedSport.toLowerCase()}.</p>
                ) : (
                  <div className="availability-grid-scroll" role="region" aria-label="Court availability" tabIndex={0}>
                    <table className="availability-grid">
                      <thead>
                        <tr>
                          <th className="availability-time-heading" scope="col">Time</th>
                          {availableCourts.map((court) => (
                            <th key={court.id} scope="col">
                              {court.name}
                              <small>PHP {HOURLY_RATES[selectedSport as keyof typeof HOURLY_RATES]}/hour</small>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {BOOKING_START_TIMES.map((time) => (
                          <tr key={time}>
                            <th className="availability-time-heading" scope="row">{formatClockTime(time)}</th>
                            {availableCourts.map((court) => {
                              const blocked = isSlotBlocked(court.id, time)
                              const reservation = slotReservation(court.id, selectedDate, time)
                              const past = !slotIsInFuture(selectedDate, time)
                              const state = blocked
                                ? 'blocked'
                                : reservation?.status === 'pending'
                                  ? 'pending'
                                  : reservation
                                    ? 'reserved'
                                    : past
                                      ? 'past'
                                      : 'available'
                              const cellText = blocked ? 'Blocked' : reservation ? 'Booked' : past ? 'Past' : 'Free'

                              return (
                                <td key={court.id}>
                                  <span className={`availability-cell availability-cell--${state}`}>
                                    {cellText}
                                  </span>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <div className="booking-controls">
                <section className="reservation-slot-picker" aria-labelledby="reservation-slot-picker-title">
                  <h3 id="reservation-slot-picker-title">Choose a start time, end time, and court</h3>
                  <p className="muted">Bookings must be at least one hour and end by midnight. Start and end times are available in 30-minute increments; half-hours are prorated.</p>
                  {selectableStartTimes.length === 0 ? (
                    <p className="empty-state">No future court ranges are available for this date and sport.</p>
                  ) : (
                    <>
                      <div className="booking-form-grid">
                        <label>
                          Start time
                          <select
                            value={effectiveReservationStartTime}
                            onChange={(event) => setReservationStartTime((event.target as HTMLSelectElement).value)}
                          >
                            {selectableStartTimes.map((time) => (
                              <option value={time} key={time}>{formatClockTime(time)}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          End time
                          <select
                            value={effectiveReservationEndTime}
                            onChange={(event) => setReservationEndTime((event.target as HTMLSelectElement).value)}
                          >
                            {selectableEndTimes.map((time) => (
                              <option value={time} key={time}>{formatClockTime(time)}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Court
                          <select
                            value={effectiveReservationCourtId}
                            onChange={(event) => setReservationCourtId(Number((event.target as HTMLSelectElement).value))}
                          >
                            {courtsForSelectedRange.map((court) => (
                              <option value={court.id} key={court.id}>{court.name}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!effectiveReservationStartTime || !effectiveReservationEndTime || effectiveReservationCourtId === ''}
                        onClick={() => {
                          if (effectiveReservationStartTime && effectiveReservationEndTime && effectiveReservationCourtId !== '') {
                            setSelectedSlots((previous) => [...previous, {
                              courtId: effectiveReservationCourtId,
                              time: effectiveReservationStartTime,
                              durationMinutes: selectedDurationMinutes,
                            }])
                          }
                        }}
                      >
                        Add reservation
                      </button>
                    </>
                  )}
                  {selectedSlots.length > 0 ? (
                    <div className="selected-reservation-slots">
                      <h4>Chosen reservations</h4>
                      <ul>
                        {selectedSlots.map((slot) => (
                          <li key={`${slot.courtId}-${slot.time}`}>
                            <span>{COURTS.find((court) => court.id === slot.courtId)?.name} · {formatTimeRange(slot.time, slot.durationMinutes)}</span>
                            <button
                              type="button"
                              className="secondary"
                              aria-label={`Remove ${COURTS.find((court) => court.id === slot.courtId)?.name} at ${formatClockTime(slot.time)}`}
                              onClick={() => setSelectedSlots((previous) => previous.filter((entry) => (
                                entry.courtId !== slot.courtId || entry.time !== slot.time
                              )))}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>

                {selectedSport === 'Badminton' ? (
                  <section className="addon-options">
                    <h3>Optional badminton add-ons</h3>
                    <label className="addon-quantity">
                      <span>
                        <strong>Rental rackets</strong>
                        <small>PHP {RACKET_RENTAL_PER_DAY} per racket/day</small>
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={racketRentalQuantity}
                        aria-label="Rental racket quantity"
                        onInput={(e) => setRacketRentalQuantity(Math.min(100, Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0))))}
                      />
                    </label>
                    <label className="addon-quantity">
                      <span>
                        <strong>Shuttlecocks</strong>
                        <small>PHP {SHUTTLECOCK_PRICE} each</small>
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={shuttlecockQuantity}
                        aria-label="Shuttlecock quantity"
                        onInput={(e) => setShuttlecockQuantity(Math.min(100, Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0))))}
                      />
                    </label>
                  </section>
                ) : null}

                <div className="booking-summary">
                  <div>
                    <span>Selected courts</span>
                    <strong>{courtSummary(selectedSlots) || (racketRentalQuantity > 0 || shuttlecockQuantity > 0 ? 'Equipment only' : 'Not selected')}</strong>
                  </div>
                  <div>
                    <span>Selected court-hours</span>
                    <strong>{selectedCourtHours}</strong>
                  </div>
                  <div>
                    <span>Total price · PHP {hourlyRate}/hour</span>
                    <strong>PHP {totalPayment.toFixed(2)}</strong>
                    <span>Amount due now · 50% court fees + full equipment</span>
                    <strong>PHP {amountDueNow.toFixed(2)}</strong>
                  </div>
                </div>

                <button type="button" className="primary wide" disabled={!canReviewOrder} onClick={handleBookingReview}>Review order</button>
              </div>
            </div>
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
                  <div key={booking.id} className={`reservation-card reservation-card--${booking.status}`}>
                    <div>
                      <p className="muted">{courtSummary(bookingSlots(booking)) || 'Equipment only'}</p>
                      <h3>{booking.sport}</h3>
                      <p>{formatDate(booking.date)}{bookingSlots(booking).length > 0 ? ` · ${slotSummary(bookingSlots(booking))}` : ''}</p>
                      {bookingAddOns(booking) ? <p className="muted">{bookingAddOns(booking)}</p> : null}
                      <p className={`status status--${booking.status}`}>Status: {bookingStatusLabel(booking.status)}</p>
                      <ReservationTimeline booking={booking} />
                    </div>

                    <div className="reservation-actions">
                      {booking.status === 'pending' || booking.status === 'confirmed' ? (
                        <button className="secondary danger" onClick={() => cancelUserBooking(booking.id)}>Cancel</button>
                      ) : null}
                      <span className="deposit-tag">
                        Total PHP {(booking.totalPrice ?? booking.deposit).toFixed(2)}
                        {booking.totalPrice != null ? ` · Amount due now PHP ${booking.deposit.toFixed(2)}` : ''}
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
              <h2 id="payment-dialog-title">Reservation review</h2>
              <p className="muted">Submitting creates a reservation request; payment is handled separately. Half of court fees and the full equipment cost are due now.</p>
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
                    <strong>{draftReservation.slots.reduce((total, slot) => total + bookingSlotHours(slot), 0)}</strong>
                  </>
                ) : null}
                {draftReservation.racketRentalQuantity > 0 ? (
                  <>
                    <span>Rental rackets ×{draftReservation.racketRentalQuantity}</span>
                    <strong>PHP {(draftReservation.racketRentalQuantity * RACKET_RENTAL_PER_DAY).toFixed(2)} / day</strong>
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
                <span>Amount due now · 50% court fees + full equipment</span>
                <strong>PHP {draftReservation.deposit.toFixed(2)}</strong>
              </div>

              <div className="payment-buttons">
                <button className="primary" onClick={submitReservation}>Submit reservation request</button>
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
            <span>Amount due now · total PHP {totalPayment.toFixed(2)}</span>
            <strong>PHP {amountDueNow.toFixed(2)}</strong>
          </div>
          <button type="button" className="primary" onClick={handleBookingReview}>Review payment</button>
        </div>
      ) : null}
    </div>
  )
}
