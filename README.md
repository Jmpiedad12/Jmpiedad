# Red Court

## Requirements

- Node.js 22.13.0 or newer (the server uses the built-in SQLite module).

## Code organization

The client code is grouped by the website's development increments:

1. **Website design and navigation:** shared layout and page styling are in `src/app.tsx` and `src/app.css`; role-based navigation is in `src/features/navigation/DashboardNavigation.tsx`.
2. **User account management:** sign-in, registration, and profile forms are in `src/features/accounts/AccountViews.tsx`; account types/profile mapping are in `src/features/accounts/account.ts`; account API workflows are coordinated in `src/app.tsx`.
3. **Court schedule viewing:** court data, time slots, availability dates, and schedule formatting are in `src/features/courts/schedule.ts`; schedule screens are composed in `src/app.tsx`.
4. **Court reservation management:** booking types and reservation display helpers are in `src/features/reservations/reservations.ts`; the status timeline is in `src/features/reservations/ReservationTimeline.tsx`; reservation workflows are coordinated in `src/app.tsx`.
5. **Administrator dashboard and database:** administrator screens and API synchronization are in `src/app.tsx`; local persistent storage and server routes are in `server.ts`.
6. **Combining website features:** `src/app.tsx` connects the feature modules and selects the player, administrator, account, and sign-in views.

## Data storage and deployment

Local development stores accounts, reservations, and schedule blocks in
`.redcourt-data/redcourt.sqlite`. On first startup, existing `accounts.json`,
`bookings.json`, and `blocks.json` files in that directory are imported and kept as
migration backups.

Vercel API requests use Supabase. Accounts remain in the existing `app_data` table;
reservations, reserved court slots, schedule blocks, rate limits, and sessions use the
tables and RPC functions defined in
`supabase/migrations/20261126000000_serverless_reservations.sql`. Apply that migration
to the Supabase project before deploying. Configure `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Vercel's server-side
environment variables; never expose the service-role key to the browser.

## Run locally

```sh
npm install
npm run dev
```

Supabase Auth generates and verifies signup OTPs; the server sends those codes using the
configured Google SMTP account. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` in the local `.env` and Vercel's server-side environment
variables. Reservation approval/rejection emails use the same SMTP sender. Configure
`SMTP_USER`, `SMTP_PASS` (a Google App Password), and optionally `SMTP_FROM`, `SMTP_HOST`,
and `SMTP_PORT` in both environments. Redeploy after changing Vercel environment
variables. Supabase's SMTP settings are not used by this custom OTP delivery flow.
Reservation SMS notifications still use Twilio environment variables.
Reservation status updates are saved to each booking and shown in the player reservation
timeline. Vercel routes `/api/*` requests through the Supabase-backed API function.

## Access, security, and operations

The interface adapts to phone, tablet, and desktop widths and supports keyboard navigation.
Player and administrator actions are checked by the server; passwords are stored as scrypt
hashes, and session cookies are HttpOnly and SameSite. In production, serve the site through
HTTPS so session cookies are marked Secure. The Supabase reservation-slot index and
transactional RPC prevent concurrent requests from reserving the same court time.

Local development keeps sessions, OTPs, and rate limits in memory, so a local server restart
requires users to sign in again and clears pending verification codes and rate-limit counters.
Back up `.redcourt-data` securely and keep it outside public web access.