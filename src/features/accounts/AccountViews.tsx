import { addDays, HOURLY_RATES } from '../courts/schedule'
import type { AccountProfile, AccountRole, AuthForm, AuthMode } from './account'

type AccountProfileViewProps = {
  profile: AccountProfile
  error: string
  message: string
  onChange: (field: keyof AccountProfile, value: string) => void
  onSubmit: (event: Event) => void
}

export function AccountProfileView({ profile, error, message, onChange, onSubmit }: AccountProfileViewProps) {
  return (
    <main className="profile-layout">
      <section className="panel profile-panel" id="main-content">
        <h2>Manage account</h2>
        <p className="muted">Update the personal details saved with your account.</p>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            Name
            <input
              type="text"
              autoComplete="name"
              required
              minLength={2}
              maxLength={100}
              value={profile.name}
              onInput={(event) => onChange('name', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            Birthdate
            <input
              type="date"
              autoComplete="bday"
              required
              max={addDays(0)}
              value={profile.birthdate}
              onInput={(event) => onChange('birthdate', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            Contact number
            <input
              type="tel"
              autoComplete="tel"
              required
              value={profile.phone}
              onInput={(event) => onChange('phone', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={profile.email}
              onInput={(event) => onChange('email', (event.target as HTMLInputElement).value)}
            />
          </label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          {message ? <p className="auth-notice" role="status">{message}</p> : null}
          <button type="submit" className="primary wide">Save account details</button>
        </form>
      </section>
    </main>
  )
}

type AuthenticationViewProps = {
  mode: AuthMode
  role: AccountRole
  registrationRole: AccountRole
  adminLimit: number
  form: AuthForm
  showPassword: boolean
  otpSent: boolean
  otpMessage: string
  error: string
  notice: string
  onRegistrationRoleChange: (role: AccountRole) => void
  onFormChange: (field: keyof AuthForm, value: string) => void
  onPasswordToggle: () => void
  onGenerateOtp: () => void
  onSubmit: (event: Event) => void
}

export function AuthenticationView({
  mode,
  role,
  registrationRole,
  adminLimit,
  form,
  showPassword,
  otpSent,
  otpMessage,
  error,
  notice,
  onRegistrationRoleChange,
  onFormChange,
  onPasswordToggle,
  onGenerateOtp,
  onSubmit,
}: AuthenticationViewProps) {
  return (
    <main className="auth-layout" id="main-content">
      <section className="auth-panel">
        <h2>{mode === 'login' ? `${role === 'admin' ? 'Admin' : 'Player'} login` : registrationRole === 'admin' ? 'Request admin account' : 'Create account'}</h2>
        <p>{mode === 'login'
          ? 'Log in with your username and password.'
          : registrationRole === 'admin'
            ? `Admin requests need approval from an existing admin. The limit is ${adminLimit} admin accounts.`
            : 'Create an account with your username, password and verified contact.'}</p>

        {mode === 'signup' && (
          <div className="role-switch" aria-label="Account type">
            <button type="button" className={registrationRole === 'player' ? 'primary' : 'secondary'} onClick={() => onRegistrationRoleChange('player')}>Player Account</button>
            <button type="button" className={registrationRole === 'admin' ? 'primary' : 'secondary'} onClick={() => onRegistrationRoleChange('admin')}>Request Admin</button>
          </div>
        )}

        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            Username
            <input
              type="text"
              autoComplete="username"
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_.-]+"
              value={form.username}
              onInput={(event) => onFormChange('username', (event.target as HTMLInputElement).value)}
              placeholder="playername"
            />
          </label>

          <label>
            Password
            <span className="password-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'signup' ? 10 : undefined}
                value={form.password}
                onInput={(event) => onFormChange('password', (event.target as HTMLInputElement).value)}
                placeholder="Your password"
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                onClick={onPasswordToggle}
              >
                <span className="eye-icon" aria-hidden="true" />
              </button>
            </span>
          </label>

          {mode === 'signup' && (
            <>
              <label>
                Full name
                <input
                  type="text"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  value={form.name}
                  onInput={(event) => onFormChange('name', (event.target as HTMLInputElement).value)}
                  placeholder="Your full name"
                />
              </label>

              <label>
                Contact number
                <input
                  type="tel"
                  autoComplete="tel"
                  required
                  pattern="\+?[\d\s()-]{7,20}"
                  value={form.phone}
                  onInput={(event) => onFormChange('phone', (event.target as HTMLInputElement).value)}
                  placeholder="+63 912 345 6789"
                />
              </label>

              <label>
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onInput={(event) => onFormChange('email', (event.target as HTMLInputElement).value)}
                  placeholder="you@example.com"
                />
              </label>

              <div className="otp-row">
                <button type="button" className="secondary" onClick={onGenerateOtp}>{otpSent ? 'Resend phone OTP' : 'Send verification code to phone'}</button>
              </div>
              {otpMessage ? <p className="otp-message" role="status">{otpMessage}</p> : null}

              <label>
                Enter OTP
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={form.otp}
                  onInput={(event) => onFormChange('otp', (event.target as HTMLInputElement).value)}
                  placeholder="123456"
                />
              </label>
            </>
          )}

          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          {notice ? <p className="auth-notice" role="status">{notice}</p> : null}

          <button type="submit" className="primary wide">{mode === 'login' ? 'Login' : 'Create account'}</button>
        </form>
      </section>

      <aside className="info-panel">
        <h3>Welcome to Red Court</h3>
        <img className="promo-image" src="/redcourt-promo.png" alt="Red Court Sports Center rates, opening hours, and promotions" />
        <details className="reservation-rules">
          <summary>Reservation rules</summary>
          <ul>
            <li>Courts 1-3 support Pickleball and Badminton.</li>
            <li>Courts 4-9 are Badminton only.</li>
            <li>Occupied time slots are disabled in this booking view.</li>
            <li>Hourly rate: PHP {HOURLY_RATES.Pickleball} for Pickleball and PHP {HOURLY_RATES.Badminton} for Badminton.</li>
            <li>A 50% downpayment is due when you place a reservation.</li>
            <li>Admin can confirm or reject bookings and refund for rejected reservations.</li>
          </ul>
        </details>
      </aside>
    </main>
  )
}
