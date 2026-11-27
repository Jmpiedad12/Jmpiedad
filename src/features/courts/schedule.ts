export const COURTS = [
  { id: 1, name: 'Court 1', sports: ['Pickleball', 'Badminton', 'Sepak Takraw'] },
  { id: 2, name: 'Court 2', sports: ['Pickleball', 'Badminton', 'Sepak Takraw'] },
  { id: 3, name: 'Court 3', sports: ['Pickleball', 'Badminton', 'Sepak Takraw'] },
  { id: 4, name: 'Court 4', sports: ['Badminton'] },
  { id: 5, name: 'Court 5', sports: ['Badminton'] },
  { id: 6, name: 'Court 6', sports: ['Badminton'] },
  { id: 7, name: 'Court 7', sports: ['Badminton'] },
  { id: 8, name: 'Court 8', sports: ['Badminton'] },
  { id: 9, name: 'Court 9', sports: ['Badminton'] },
]

export const HOURLY_RATES = { Pickleball: 400, Badminton: 350, 'Sepak Takraw': 400 }
export const RACKET_RENTAL_PER_DAY = 100
export const SHUTTLECOCK_PRICE = 140
export const SPORTS = ['Pickleball', 'Badminton', 'Sepak Takraw']

export const BOOKING_START_TIMES = Array.from({ length: 31 }, (_, index) => {
  const minutes = 8 * 60 + index * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

export const BOOKING_END_TIMES = Array.from({ length: 33 }, (_, index) => {
  const minutes = 8 * 60 + index * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

export const clockTimeToMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

export const formatClockTime = (time: string) => {
  const hour = Number(time.slice(0, 2)) % 24
  const minute = Number(time.slice(3, 5))
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

export const formatTimeRange = (time: string, durationMinutes = 60) => {
  const startMinutes = clockTimeToMinutes(time)
  const endMinutes = startMinutes + durationMinutes
  const formatTime = (minutes: number) => {
    const hour = Math.floor(minutes / 60) % 24
    const minute = minutes % 60
    return {
      clock: `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}`,
      period: hour < 12 ? 'AM' : 'PM',
    }
  }
  const start = formatTime(startMinutes)
  const end = formatTime(endMinutes)
  const startLabel = start.period === end.period ? start.clock : `${start.clock} ${start.period}`
  return `${startLabel}–${end.clock} ${end.period}`
}

export const formatInputDate = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export const formatDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  const parsedDate = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return date
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsedDate)
}

export const reportDateRange = (date: string, period: 'day' | 'week' | 'month') => {
  const [year, month, day] = date.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, day))
  if (period === 'week') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
  if (period === 'month') start.setUTCDate(1)
  const end = new Date(start)
  if (period === 'month') end.setUTCMonth(end.getUTCMonth() + 1)
  else end.setUTCDate(end.getUTCDate() + (period === 'week' ? 7 : 1))
  end.setUTCDate(end.getUTCDate() - 1)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export const addDays = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return formatInputDate(date)
}

export const slotIsInFuture = (date: string, time: string) =>
  Date.parse(`${date}T${time}:00+08:00`) > Date.now()
