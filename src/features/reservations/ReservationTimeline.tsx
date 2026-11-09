import { bookingStatusLabel, formatDateTime, type Booking } from './reservations'

export function ReservationTimeline({ booking }: { booking: Booking }) {
  const history = booking.statusHistory?.length
    ? booking.statusHistory
    : [{ status: booking.status, at: booking.createdAt || '', message: 'Reservation status recorded.' }]

  return (
    <ol className="status-timeline" aria-label="Reservation status timeline">
      {history.map((entry, index) => (
        <li className={`timeline-step ${entry.status}`} key={`${entry.status}-${entry.at}-${index}`}>
          <strong>{bookingStatusLabel(entry.status)}</strong>
          <span>{entry.message}</span>
          {entry.at ? <time dateTime={entry.at}>{formatDateTime(entry.at)}</time> : null}
        </li>
      ))}
    </ol>
  )
}
