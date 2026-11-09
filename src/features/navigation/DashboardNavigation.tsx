import type { SignedInUser } from '../accounts/account'

export function DashboardNavigation({ user }: { user: SignedInUser }) {
  return (
    <nav className="dashboard-nav" aria-label="Dashboard navigation">
      {user.role === 'admin' ? (
        <>
          <a href="#admin-schedule">Court schedule</a>
          <a href="#admin-reports">Reports</a>
          <a href="#admin-reservations">Reservations</a>
          <a href="#admin-accounts">Admin requests</a>
        </>
      ) : (
        <>
          <a href="#player-booking">Book a court</a>
          <a href="#player-reservations">My reservations</a>
        </>
      )}
    </nav>
  )
}
