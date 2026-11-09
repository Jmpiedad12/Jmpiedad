# Red Court

## Requirements

- Node.js 22.13.0 or newer (the server uses the built-in SQLite module).

## Code organization

The client code is grouped by the website's development increments:

1. **Website design and navigation:** shared layout and page styling are in `src/app.tsx` and `src/app.css`; role-based navigation is in `src/features/navigation/DashboardNavigation.tsx`.
2. **User account management:** sign-in, registration, and profile forms are in `src/features/accounts/AccountViews.tsx`; account types/profile mapping are in `src/features/accounts/account.ts`; account API workflows are coordinated in `src/app.tsx`.
3. **Court schedule viewing:** court data, time slots, availability dates, and schedule formatting are in `src/features/courts/schedule.ts`; schedule screens are composed in `src/app.tsx`.
4. **Court reservation management:** booking types and reservation display helpers are in `src/features/reservations/reservations.ts`; the status timeline is in `src/features/reservations/ReservationTimeline.tsx`; reservation workflows are coordinated in `src/app.tsx`.
5. **Administrator dashboard and database:** administrator screens and API synchronization are in `src/app.tsx`; persistent database and server routes are in `server.mjs`.
6. **Combining website features:** `src/app.tsx` connects the feature modules and selects the player, administrator, account, and sign-in views.

## Reservation data

Accounts, reservations, and schedule blocks are stored in `.redcourt-data/redcourt.sqlite`.
On first startup, existing `accounts.json`, `bookings.json`, and `blocks.json` files in
that directory are imported into the database and kept as migration backups.

## Run locally

```sh
npm install
npm run dev
```

Email and SMS status notifications are sent when the corresponding Resend or Twilio
environment variables are configured. Reservation status updates are also saved to each
booking and shown in the player reservation timeline.

## Access, security, and operations

The interface adapts to phone, tablet, and desktop widths and supports keyboard navigation.
Player and administrator actions are checked by the server; passwords are stored as scrypt
hashes, and session cookies are HttpOnly and SameSite. In production, serve the site through
HTTPS so the server also marks session cookies Secure.

Reservation, account, and schedule data persist in SQLite. Sessions, OTPs, and authentication
rate limits are held in memory, so a server restart requires users to sign in again and clears
pending verification codes and rate-limit counters. Back up `.redcourt-data` securely and keep
it outside public web access.