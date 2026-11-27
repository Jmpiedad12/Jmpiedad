import { useEffect, useState } from 'preact/hooks'
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
  isSubmitting: boolean
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
  isSubmitting,
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
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [signupProgressFields, setSignupProgressFields] = useState({
    username: false,
    password: false,
    name: false,
    phone: false,
    email: false,
    otp: false,
  })
  const passwordMeetsRequirements = form.password.length >= 10 && /[A-Za-z]/.test(form.password) && /\d/.test(form.password)
  const passwordInvalid = mode === 'signup' && passwordTouched && !passwordMeetsRequirements

  useEffect(() => {
    setPasswordTouched(false)
    setSignupProgressFields({
      username: false,
      password: false,
      name: false,
      phone: false,
      email: false,
      otp: false,
    })
  }, [mode])

  const signupFieldProgress = Object.values(signupProgressFields).filter(Boolean).length
  const markSignupField = (field: keyof typeof signupProgressFields, complete: boolean) => {
    setSignupProgressFields((previous) => ({ ...previous, [field]: complete }))
  }

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

        {mode === 'signup' && (
          <div className="signup-progress">
            <div className="signup-progress-heading">
              <span>Account setup</span>
              <span>{signupFieldProgress}/6 complete</span>
            </div>
            <div
              className="signup-progress-track"
              role="progressbar"
              aria-label="Account setup progress"
              aria-valuemin={0}
              aria-valuemax={6}
              aria-valuenow={signupFieldProgress}
              aria-valuetext={`${signupFieldProgress} of 6 required fields complete`}
            >
              <div className="signup-progress-fill" style={{ width: `${(signupFieldProgress / 6) * 100}%` }} />
            </div>
          </div>
        )}

        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            Username
            <input
              type="text"
              autoComplete="username"
              required
              minLength={mode === 'signup' ? 3 : undefined}
              maxLength={mode === 'signup' ? 32 : undefined}
              {...(mode === 'signup' ? { pattern: '[A-Za-z0-9_.-]+' } : {})}
              value={form.username}
              onInput={(event) => onFormChange('username', (event.target as HTMLInputElement).value)}
              onBlur={(event) => markSignupField('username', /^[A-Za-z0-9_.-]{3,32}$/.test((event.target as HTMLInputElement).value))}
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
                {...(mode === 'signup' ? { pattern: '(?=.*[A-Za-z])(?=.*\\d).{10,}' } : {})}
                title={mode === 'signup' ? 'Use at least 10 characters, including at least 1 letter and 1 number.' : undefined}
                className={passwordInvalid ? 'password-input--invalid' : undefined}
                value={form.password}
                onInput={(event) => onFormChange('password', (event.target as HTMLInputElement).value)}
                onBlur={(event) => {
                  const password = (event.target as HTMLInputElement).value
                  setPasswordTouched(true)
                  markSignupField('password', password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password))
                }}
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
            {mode === 'signup' ? <small className="muted">Use at least 10 characters and include at least 1 letter and 1 number.</small> : null}
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
                  onBlur={(event) => markSignupField('name', (event.target as HTMLInputElement).value.trim().length >= 2)}
                  placeholder="Your full name"
                />
              </label>

              <label>
                Contact number
                <input
                  type="tel"
                  autoComplete="tel"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{11}"
                  minLength={11}
                  maxLength={11}
                  value={form.phone}
                  onInput={(event) => onFormChange('phone', (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11))}
                  onBlur={(event) => markSignupField('phone', /^\d{11}$/.test((event.target as HTMLInputElement).value))}
                  placeholder="09123456789"
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
                  onBlur={(event) => markSignupField('email', /^[^\s@]+@gmail\.com$/i.test((event.target as HTMLInputElement).value))}
                  placeholder="you@example.com"
                />
              </label>

              <div className="otp-row">
                <button type="button" className="secondary" onClick={onGenerateOtp}>
                  {otpSent ? 'Send another verification code' : 'Send email verification code'}
                </button>
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
                  onInput={(event) => onFormChange('otp', (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))}
                  onBlur={(event) => markSignupField('otp', otpSent && /^\d{6}$/.test((event.target as HTMLInputElement).value))}
                  placeholder="******"
                />
              </label>
            </>
          )}

          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          {notice ? <p className="auth-notice" role="status">{notice}</p> : null}

          <button type="submit" className="primary wide" disabled={isSubmitting}>
            {isSubmitting ? (mode === 'login' ? 'Signing in...' : 'Signing up...') : mode === 'login' ? 'Login' : 'Create account'}
          </button>
        </form>
      </section>

      <aside className="info-panel">
        <h3>Welcome to Red Court</h3>
        <img className="promo-image" src="/redcourt-promo.png" alt="Red Court Sports Center rates, opening hours, and promotions" />
        <details className="reservation-rules">
          <summary>Reservation rules</summary>
          <ul>
            <li>Courts 1-3 support Pickleball, Badminton, and Sepak Takraw.</li>
            <li>Courts 4-9 are Badminton only.</li>
            <li>Occupied time slots are disabled in this booking view.</li>
            <li>Hourly rate: PHP {HOURLY_RATES.Pickleball} for Pickleball, PHP {HOURLY_RATES.Badminton} for Badminton, and PHP {HOURLY_RATES['Sepak Takraw']} for Sepak Takraw.</li>
            <li>Amount due now is 50% of court fees plus the full cost of any equipment. Payment is handled separately; the site does not process payments.</li>
            <li>Admin can confirm or reject bookings and refund for rejected reservations.</li>
          </ul>
        </details>
      </aside>
    </main>
  )
}
