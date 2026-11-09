export const COURTS = [
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

export const HOURLY_RATES = { Pickleball: 400, Badminton: 350 }
export const RACKET_RENTAL_PER_DAY = 100
export const SHUTTLECOCK_PRICE = 140
export const SPORTS = ['Pickleball', 'Badminton']

export const HOURS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00',
  '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00',
]

export const formatClockTime = (time: string) => {
  const hour = Number(time.slice(0, 2))
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`
}

export const formatTimeRange = (time: string) => {
  const hour = Number(time.slice(0, 2))
  const nextHour = hour + 1
  const formatHour = (value: number) => String(value % 12 || 12)
  const startPeriod = hour < 12 ? 'AM' : 'PM'
  const endPeriod = nextHour < 12 ? 'AM' : 'PM'
  const start = `${formatHour(hour)}${startPeriod !== endPeriod ? ` ${startPeriod}` : ''}`
  return `${start}–${formatHour(nextHour)} ${endPeriod}`
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
