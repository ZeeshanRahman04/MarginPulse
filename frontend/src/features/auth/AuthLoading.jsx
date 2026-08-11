import { memo } from 'react'

export const AuthLoading = memo(function AuthLoading({
  title = 'Securing your session',
  message = 'Verifying JWT credentials and restoring your role workspace…',
}) {
  return (
    <main className="loading-screen" aria-busy="true" aria-live="polite">
      <div className="auth-loader" role="progressbar" aria-label={title}>
        <div className="auth-loader-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="auth-loader-core" aria-hidden="true" />
      </div>
      <div className="auth-loader-copy">
        <p className="eyebrow">Authentication</p>
        <h1>{title}</h1>
        <p>{message}</p>
      </div>
    </main>
  )
})
