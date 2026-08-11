import { memo, useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  TextField,
} from '@mui/material'
import { useSearchParams } from 'react-router-dom'
import {
  requestPasswordReset,
  resetPassword,
} from '../../services/intelligenceClient.js'
import { APP_NAME, APP_NAME_SHORT } from '../../brand.js'

function PasswordVisibilityIcon({ visible }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      {visible ? (
        <path
          d="m4 4 16 16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      ) : null}
    </svg>
  )
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const demoAccounts = [
  { label: 'Executive demo', email: 'manager@edtech.example' },
  { label: 'Administrator demo', email: 'admin@edtech.example' },
  { label: 'Finance Controller demo', email: 'finance@edtech.example' },
  { label: 'Pricing Manager demo', email: 'pricing@edtech.example' },
  { label: 'Sales User demo', email: 'analyst@edtech.example' },
]

const privilegedDemoEmails = new Set([
  'manager@edtech.example',
  'admin@edtech.example',
  'finance@edtech.example',
  'pricing@edtech.example',
])

const DEMO_MFA_CODE = '123456'

function demoMfaForEmail(email) {
  return privilegedDemoEmails.has(String(email || '').trim()) ? DEMO_MFA_CODE : ''
}

function validateLoginForm({ email, password, mfaCode }, { mfaRequired }) {
  const errors = {}
  const requiresMfa = mfaRequired || privilegedDemoEmails.has(String(email || '').trim())
  if (!email.trim()) errors.email = 'Email is required.'
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid work email address.'
  if (!password) errors.password = 'Password is required.'
  else if (password.length < 8) errors.password = 'Password must be at least 8 characters.'
  if (requiresMfa && !/^\d{6}$/.test(mfaCode || '')) {
    errors.mfaCode = 'Enter the 6-digit MFA code (demo: 123456).'
  }
  return errors
}

function validateForgotForm({ email }) {
  const errors = {}
  if (!email.trim()) errors.email = 'Email is required.'
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid work email address.'
  return errors
}

function validateResetForm({ password, confirmPassword }) {
  const errors = {}
  if (!password) errors.password = 'New password is required.'
  else if (password.length < 8) errors.password = 'Password must be at least 8 characters.'
  if (!confirmPassword) errors.confirmPassword = 'Confirm your new password.'
  else if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.'
  return errors
}

export const SignIn = memo(function SignIn({
  authError,
  authLoading,
  authSuccess,
  handleSignIn,
  mfaRequired,
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const resetToken = searchParams.get('resetToken') || searchParams.get('token') || ''

  const [mode, setMode] = useState('login')
  const activeMode = resetToken ? 'reset' : mode
  const [form, setForm] = useState({
    email: 'manager@edtech.example',
    password: 'Revenue24',
    confirmPassword: '',
    mfaCode: DEMO_MFA_CODE,
    rememberMe: true,
  })
  const privilegedDemoSelected = privilegedDemoEmails.has(form.email.trim())
  const showMfaHint = mfaRequired || privilegedDemoSelected
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [localError, setLocalError] = useState('')
  const [localSuccess, setLocalSuccess] = useState('')
  const [localLoading, setLocalLoading] = useState(false)
  const [touched, setTouched] = useState({})

  const updateForm = useCallback((field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
    setLocalError('')
  }, [])

  const markTouched = useCallback((field) => {
    setTouched((current) => ({ ...current, [field]: true }))
  }, [])

  const busy = authLoading || localLoading
  const heading = useMemo(() => {
    if (activeMode === 'forgot') return 'Reset your password'
    if (activeMode === 'reset') return 'Choose a new password'
    return 'Sign in securely'
  }, [activeMode])

  const passwordAdornment = (visible, onToggle, labelShow, labelHide) => (
    <InputAdornment position="end">
      <IconButton
        aria-label={visible ? labelHide : labelShow}
        edge="end"
        onClick={onToggle}
        title={visible ? labelHide : labelShow}
        type="button"
      >
        <PasswordVisibilityIcon visible={visible} />
      </IconButton>
    </InputAdornment>
  )

  const submitLogin = async (event) => {
    event.preventDefault()
    const errors = validateLoginForm(form, { mfaRequired })
    setFieldErrors(errors)
    setTouched({ email: true, password: true, mfaCode: true })
    if (Object.keys(errors).length) {
      setLocalError('Fix the highlighted fields before signing in.')
      return
    }
    setLocalError('')
    setLocalSuccess('')
    await handleSignIn({
      email: form.email.trim(),
      password: form.password,
      mfaCode: form.mfaCode,
      rememberMe: form.rememberMe,
    })
  }

  const submitForgot = async (event) => {
    event.preventDefault()
    const errors = validateForgotForm(form)
    setFieldErrors(errors)
    setTouched({ email: true })
    if (Object.keys(errors).length) {
      setLocalError('Enter a valid work email to continue.')
      return
    }
    setLocalLoading(true)
    setLocalError('')
    setLocalSuccess('')
    try {
      const result = await requestPasswordReset(form.email.trim())
      const baseMessage =
        result?.message ||
        `If an account exists for ${form.email.trim()}, password reset instructions have been queued.`
      if (result?.demoResetPath) {
        setLocalSuccess(`${baseMessage} Demo reset link is ready below.`)
        setSearchParams({ resetToken: result.demoResetToken })
      } else {
        setLocalSuccess(baseMessage)
      }
    } catch (error) {
      setLocalError(error.message || 'Unable to start the password reset flow.')
    } finally {
      setLocalLoading(false)
    }
  }

  const submitReset = async (event) => {
    event.preventDefault()
    const errors = validateResetForm(form)
    setFieldErrors(errors)
    setTouched({ password: true, confirmPassword: true })
    if (!resetToken) {
      setLocalError('Reset token is missing or invalid. Request a new reset link.')
      return
    }
    if (Object.keys(errors).length) {
      setLocalError('Fix the highlighted fields before resetting your password.')
      return
    }
    setLocalLoading(true)
    setLocalError('')
    setLocalSuccess('')
    try {
      const result = await resetPassword({
        token: resetToken,
        newPassword: form.password,
      })
      setLocalSuccess(result?.message || 'Password was reset successfully. You can sign in now.')
      setForm((current) => ({ ...current, password: '', confirmPassword: '', mfaCode: '' }))
      setSearchParams({})
      setMode('login')
    } catch (error) {
      setLocalError(error.message || 'Unable to reset the password.')
    } finally {
      setLocalLoading(false)
    }
  }

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setFieldErrors({})
    setLocalError('')
    setLocalSuccess('')
    setTouched({})
    if (nextMode !== 'reset') setSearchParams({})
  }

  return (
    <main className="signin-shell">
      <section className="signin-card" aria-busy={busy}>
        {busy ? <LinearProgress className="signin-progress" /> : null}
        <div className="signin-card__header">
          <div className="signin-brand">
            <span className="brand-mark brand-mark--soft" aria-hidden="true">
              {APP_NAME_SHORT}
            </span>
            <div>
              <p className="eyebrow">{APP_NAME}</p>
              <h1>{activeMode === 'login' ? 'Sign in to continue' : heading}</h1>
            </div>
          </div>
        </div>

        {authSuccess ? <Alert severity="success">{authSuccess}</Alert> : null}
        {localSuccess ? <Alert severity="success">{localSuccess}</Alert> : null}
        {localError ? <Alert severity="warning">{localError}</Alert> : null}
        {authError &&
        activeMode === 'login' &&
        !/session expired|saved session expired/i.test(authError) ? (
          <Alert
            severity={
              mfaRequired || /sign in again to continue/i.test(authError) ? 'info' : 'error'
            }
          >
            {authError}
          </Alert>
        ) : null}

        {activeMode === 'login' ? (
          <form className="signin-form" onSubmit={submitLogin} noValidate>
            <TextField
              autoComplete="username"
              error={Boolean(touched.email && fieldErrors.email)}
              fullWidth
              helperText={touched.email && fieldErrors.email ? fieldErrors.email : ' '}
              label="Work email"
              name="email"
              onBlur={() => markTouched('email')}
              onChange={(event) => updateForm('email', event.target.value)}
              required
              type="email"
              value={form.email}
            />
            <TextField
              fullWidth
              helperText={
                privilegedDemoSelected
                  ? 'Privileged demos need MFA — code is prefilled as 123456.'
                  : ' '
              }
              label="Demo account"
              onChange={(event) => {
                const email = event.target.value
                setForm((current) => ({
                  ...current,
                  email,
                  mfaCode: demoMfaForEmail(email),
                }))
                setFieldErrors((current) => {
                  if (!current.email && !current.mfaCode) return current
                  const next = { ...current }
                  delete next.email
                  delete next.mfaCode
                  return next
                })
                setLocalError('')
              }}
              select
              value={demoAccounts.some(({ email }) => email === form.email) ? form.email : ''}
            >
              {demoAccounts.map(({ label, email }) => (
                <MenuItem key={email} value={email}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              autoComplete="current-password"
              error={Boolean(touched.password && fieldErrors.password)}
              fullWidth
              helperText={touched.password && fieldErrors.password ? fieldErrors.password : ' '}
              label="Password"
              name="password"
              onBlur={() => markTouched('password')}
              onChange={(event) => updateForm('password', event.target.value)}
              required
              slotProps={{
                input: {
                  endAdornment: passwordAdornment(
                    showPassword,
                    () => setShowPassword((value) => !value),
                    'Show password',
                    'Hide password',
                  ),
                },
              }}
              type={showPassword ? 'text' : 'password'}
              value={form.password}
            />
            <TextField
              autoComplete="one-time-code"
              error={Boolean(touched.mfaCode && fieldErrors.mfaCode)}
              fullWidth
              helperText={
                touched.mfaCode && fieldErrors.mfaCode
                  ? fieldErrors.mfaCode
                  : showMfaHint
                    ? 'Demo MFA code: 123456'
                    : 'Not required for Sales User demo'
              }
              label="MFA code"
              name="mfaCode"
              onBlur={() => markTouched('mfaCode')}
              onChange={(event) => updateForm('mfaCode', event.target.value.replace(/\D/g, ''))}
              required={showMfaHint}
              slotProps={{
                htmlInput: { inputMode: 'numeric', maxLength: 6, pattern: '[0-9]*' },
              }}
              value={form.mfaCode}
            />
            <label className="remember-row">
              <input
                checked={form.rememberMe}
                disabled={busy}
                onChange={(event) => updateForm('rememberMe', event.target.checked)}
                type="checkbox"
              />
              Remember me on this device
            </label>
            <Button
              disabled={busy}
              size="large"
              startIcon={busy ? <CircularProgress color="inherit" size={18} /> : null}
              type="submit"
              variant="contained"
            >
              {busy ? 'Signing in...' : 'Sign in securely'}
            </Button>
            <Button disabled={busy} onClick={() => switchMode('forgot')} type="button" variant="text">
              Forgot password?
            </Button>
          </form>
        ) : null}

        {activeMode === 'forgot' ? (
          <form className="signin-form" onSubmit={submitForgot} noValidate>
            <Alert severity="info">
              Enter your work email. If the account exists, reset instructions are queued securely
              without revealing whether the email is registered.
            </Alert>
            <TextField
              autoComplete="username"
              error={Boolean(touched.email && fieldErrors.email)}
              fullWidth
              helperText={touched.email && fieldErrors.email ? fieldErrors.email : ' '}
              label="Work email"
              name="email"
              onBlur={() => markTouched('email')}
              onChange={(event) => updateForm('email', event.target.value)}
              required
              type="email"
              value={form.email}
            />
            <Button
              disabled={busy}
              size="large"
              startIcon={busy ? <CircularProgress color="inherit" size={18} /> : null}
              type="submit"
              variant="contained"
            >
              {busy ? 'Sending...' : 'Send reset instructions'}
            </Button>
            <Button disabled={busy} onClick={() => switchMode('login')} type="button" variant="text">
              Back to sign in
            </Button>
          </form>
        ) : null}

        {activeMode === 'reset' ? (
          <form className="signin-form" onSubmit={submitReset} noValidate>
            <Alert severity="info">
              Use the reset token from your email link to set a new password, then sign in with JWT
              authentication.
            </Alert>
            <TextField
              autoComplete="new-password"
              error={Boolean(touched.password && fieldErrors.password)}
              fullWidth
              helperText={touched.password && fieldErrors.password ? fieldErrors.password : ' '}
              label="New password"
              name="password"
              onBlur={() => markTouched('password')}
              onChange={(event) => updateForm('password', event.target.value)}
              required
              slotProps={{
                input: {
                  endAdornment: passwordAdornment(
                    showPassword,
                    () => setShowPassword((value) => !value),
                    'Show password',
                    'Hide password',
                  ),
                },
              }}
              type={showPassword ? 'text' : 'password'}
              value={form.password}
            />
            <TextField
              autoComplete="new-password"
              error={Boolean(touched.confirmPassword && fieldErrors.confirmPassword)}
              fullWidth
              helperText={
                touched.confirmPassword && fieldErrors.confirmPassword
                  ? fieldErrors.confirmPassword
                  : ' '
              }
              label="Confirm new password"
              name="confirmPassword"
              onBlur={() => markTouched('confirmPassword')}
              onChange={(event) => updateForm('confirmPassword', event.target.value)}
              required
              slotProps={{
                input: {
                  endAdornment: passwordAdornment(
                    showConfirmPassword,
                    () => setShowConfirmPassword((value) => !value),
                    'Show confirm password',
                    'Hide confirm password',
                  ),
                },
              }}
              type={showConfirmPassword ? 'text' : 'password'}
              value={form.confirmPassword}
            />
            <Button
              disabled={busy}
              size="large"
              startIcon={busy ? <CircularProgress color="inherit" size={18} /> : null}
              type="submit"
              variant="contained"
            >
              {busy ? 'Updating password...' : 'Reset password'}
            </Button>
            <Button disabled={busy} onClick={() => switchMode('login')} type="button" variant="text">
              Back to sign in
            </Button>
          </form>
        ) : null}
      </section>
    </main>
  )
})
