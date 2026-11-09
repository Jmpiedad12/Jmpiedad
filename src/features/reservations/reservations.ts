import {
  COURTS,
  formatTimeRange,
  RACKET_RENTAL_PER_DAY,
  SHUTTLECOCK_PRICE,
} from '../courts/schedule'

export type BookingSlot = { courtId: number; time: string }

export type Booking = {
  id: string
  user: string
  date: string
  courtId?: number | null
  time?: string
  times?: string[]
  slots?: BookingSlot[]
  sport: string
  deposit: number
  totalPrice?: number
  racketRental?: boolean
  shuttlecockQuantity?: number
  status: string
  createdAt?: string
  statusHistory?: { status: string; at: string; message: string }[]
  refundIssued: boolean
}

export type ScheduleBlock = {
  id: string
  date: string
  slots: BookingSlot[]
  reason: string
}

export const formatDateTime = (dateTime: string) => new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}).format(new Date(dateTime))

export const bookingStatusLabel = (status: string) => status === 'confirmed' ? 'approved' : status
export const reservationOccupiesSlot = (status: string) => status === 'pending' || status === 'confirmed'
export const slotStatusLabel = (status: string) => ({
  pending: 'Pending approval',
  confirmed: 'Reserved',
  completed: 'Completed',
}[status] || status)

export const bookingTimes = (booking: Booking) => booking.times ?? (booking.time ? [booking.time] : [])
export const bookingSlots = (booking: Booking): BookingSlot[] => booking.slots ?? (
  booking.courtId == null ? [] : bookingTimes(booking).map((time) => ({ courtId: booking.courtId as number, time }))
)
export const slotSummary = (slots: BookingSlot[]) => [...new Set(slots.map((slot) => slot.courtId))]
  .map((courtId) => `${COURTS.find((court) => court.id === courtId)?.name}: ${slots.filter((slot) => slot.courtId === courtId).map((slot) => formatTimeRange(slot.time)).join(', ')}`)
  .join(' · ')
export const courtSummary = (slots: BookingSlot[]) => [...new Set(slots.map((slot) => slot.courtId))]
  .map((courtId) => COURTS.find((court) => court.id === courtId)?.name)
  .filter(Boolean)
  .join(', ')
export const bookingAddOns = (booking: Booking) => [
  booking.racketRental ? `Racket rental (PHP ${RACKET_RENTAL_PER_DAY}/day)` : null,
  booking.shuttlecockQuantity ? `Shuttlecock ×${booking.shuttlecockQuantity} (PHP ${SHUTTLECOCK_PRICE} each)` : null,
].filter(Boolean).join(' · ')
