# Red Court

## Requirements

- Node.js 22.13.0 or newer (the server uses the built-in SQLite module).

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