import { Router } from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { config } from '../config/env.js'
import { loginSchema, logoutSchema, refreshTokenSchema } from '../config/schemas.js'
import { get, run, saveDatabase } from '../db/database.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { validate } from '../middleware/validate.js'
import { ApiError } from '../utils/errors.js'
import { audit, getPermissions, getRoles, safeUser } from '../utils/helpers.js'

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function parseDurationMs(value, fallbackMs) {
  if (!value || typeof value !== 'string') return fallbackMs
  const match = /^(\d+)([smhd])$/i.exec(value.trim())
  if (!match) return fallbackMs
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return amount * (multipliers[unit] || 0) || fallbackMs
}

function issueAccessToken(user, permissions) {
  return jwt.sign(
    { sub: user.id, organisationId: user.organisation_id, permissions, typ: 'access' },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  )
}

async function issueRefreshToken(db, user, { rememberMe = false } = {}) {
  const refreshToken = crypto.randomBytes(48).toString('base64url')
  const now = new Date()
  const ttl = rememberMe
    ? parseDurationMs(config.jwtRefreshExpiresInRemembered, 30 * 86_400_000)
    : parseDurationMs(config.jwtRefreshExpiresIn, 7 * 86_400_000)
  const expiresAt = new Date(now.getTime() + ttl).toISOString()
  const id = uuid()

  run(
    db,
    `INSERT INTO refresh_tokens
     (id, organisation_id, user_id, token_hash, expires_at, revoked_at, remember_me, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    [
      id,
      user.organisation_id,
      user.id,
      hashToken(refreshToken),
      expiresAt,
      rememberMe ? 1 : 0,
      now.toISOString(),
    ],
  )

  return { refreshToken, refreshExpiresAt: expiresAt, refreshTokenId: id }
}

function revokeRefreshToken(db, tokenHash, now = new Date().toISOString()) {
  run(db, 'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [
    now,
    tokenHash,
  ])
}

function findActiveRefreshToken(db, refreshToken) {
  return get(
    db,
    `SELECT rt.*, u.status AS user_status, u.email, u.display_name, u.organisation_id AS user_organisation_id
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = ?
       AND rt.revoked_at IS NULL
       AND rt.expires_at > ?
       AND u.deleted_at IS NULL`,
    [hashToken(refreshToken), new Date().toISOString()],
  )
}

export function createAuthRoutes(db) {
  const router = Router()
  const forgotPasswordSchema = z.object({ email: z.string().email() }).strict()
  const resetPasswordSchema = z
    .object({
      token: z.string().min(32).max(256),
      newPassword: z.string().min(8).max(128),
    })
    .strict()

  router.get('/docs', (_req, res) => {
    res.json({
      title: 'MarginPulse API',
      auth: 'POST /api/v1/auth/login returns a Bearer JWT and refresh token',
      versioning: 'All business APIs are under /api/v1',
      idempotency: 'Critical writes accept Idempotency-Key',
      endpoints: [
        'GET|POST /api/v1/:resource',
        'GET|PUT|PATCH|DELETE /api/v1/:resource/:id',
        'POST /api/v1/auth/login',
        'POST /api/v1/auth/refresh',
        'POST /api/v1/auth/logout',
        'POST /api/v1/auth/forgot-password',
        'POST /api/v1/auth/reset-password',
        'GET /api/v1/{learners|instructors|courses|lessons|enrolments|progress|assessments|certificates|subscriptions}',
        'GET /api/v1/revenue-bridges',
        'POST /api/v1/contribution-margin',
        'GET /api/v1/price-waterfall?quoteId=...',
        'GET /api/v1/variance-analysis?period=2026-Q3',
        'POST /api/v1/deal-approvals/:quoteId',
        'POST /api/v1/scenarios/evaluate',
        'GET /api/v1/ai/revenue-intelligence',
        'GET /api/v1/ai/variance-narrative',
        'POST /api/v1/ai/feedback',
        'GET /api/v1/security/controls',
        'POST /api/v1/recommendations/:id/review',
        'GET /api/v1/model-monitoring',
        'GET /api/v1/jobs',
        'POST /api/v1/jobs',
        'POST /api/v1/jobs/:id/retry',
        'GET|PUT /api/v1/configurations[/:key]',
        'GET /api/v1/audits',
        'GET|PATCH|DELETE /api/v1/notifications[/:id]',
        'GET|POST|PATCH /api/v1/users[/:id]',
        'GET|PATCH /api/v1/realised-outcomes[/:id]',
      ],
    })
  })

  router.post(
    '/auth/forgot-password',
    rateLimit('forgot-password', 5, 60000),
    validate(forgotPasswordSchema),
    async (req, res) => {
      const user = get(db, 'SELECT * FROM users WHERE email = ? AND status = ?', [
        req.body.email,
        'active',
      ])
      let demoResetToken = null
      if (user) {
        const token = crypto.randomBytes(32).toString('base64url')
        const now = new Date()
        const resetId = uuid()
        run(
          db,
          `INSERT INTO password_reset_tokens
           (id, organisation_id, user_id, token_hash, expires_at, used_at, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?)`,
          [
            resetId,
            user.organisation_id,
            user.id,
            hashToken(token),
            new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
            now.toISOString(),
          ],
        )
        run(
          db,
          `INSERT INTO background_jobs
           (id, organisation_id, job_type, payload_json, status, attempts, max_attempts,
            scheduled_at, last_error, created_at, updated_at)
           VALUES (?, ?, 'password-reset-email', ?, 'queued', 0, 3, ?, NULL, ?, ?)`,
          [
            uuid(),
            user.organisation_id,
            JSON.stringify({ email: user.email, resetId, token }),
            now.toISOString(),
            now.toISOString(),
            now.toISOString(),
          ],
        )
        audit(db, user.organisation_id, user.id, 'auth.password_reset_requested', 'user', user.id, {})
        await saveDatabase(db)
        if (config.nodeEnv !== 'production') demoResetToken = token
      }
      res.status(202).json({
        message: 'If the account exists, password reset instructions have been queued.',
        ...(demoResetToken
          ? {
              demoResetToken,
              demoResetPath: `/?resetToken=${demoResetToken}`,
            }
          : {}),
      })
    },
  )

  router.post(
    '/auth/reset-password',
    rateLimit('reset-password', 5, 60000),
    validate(resetPasswordSchema),
    async (req, res) => {
      const tokenHash = hashToken(req.body.token)
      const reset = get(
        db,
        `SELECT prt.*, u.status AS user_status
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
         WHERE prt.token_hash = ? AND prt.used_at IS NULL AND prt.expires_at > ?`,
        [tokenHash, new Date().toISOString()],
      )
      if (!reset || reset.user_status !== 'active') {
        throw new ApiError(400, 'RESET_TOKEN_INVALID', 'Reset token is invalid or expired.')
      }
      const now = new Date().toISOString()
      run(
        db,
        'UPDATE users SET password_hash = ?, updated_at = ?, version = version + 1 WHERE id = ?',
        [await bcrypt.hash(req.body.newPassword, 10), now, reset.user_id],
      )
      run(db, 'UPDATE password_reset_tokens SET used_at = ? WHERE id = ?', [now, reset.id])
      run(
        db,
        'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        [now, reset.user_id],
      )
      audit(
        db,
        reset.organisation_id,
        reset.user_id,
        'auth.password_reset_completed',
        'user',
        reset.user_id,
        {},
      )
      await saveDatabase(db)
      res.json({ message: 'Password was reset successfully.' })
    },
  )

  router.post('/auth/login', rateLimit('auth', 10, 60000), validate(loginSchema), async (req, res, next) => {
    try {
      const user = get(db, 'SELECT * FROM users WHERE email = ? AND status = ?', [
        req.body.email,
        'active',
      ])

      if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) {
        throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid email or password.')
      }

      const permissions = getPermissions(db, user.id)
      const privileged = permissions.some((permission) =>
        ['deals:approve', 'ai:override', 'admin:manage'].includes(permission),
      )

      if (privileged && req.body.mfaCode !== '123456') {
        if (req.body.mfaCode) {
          audit(db, user.organisation_id, user.id, 'auth.mfa_failed', 'user', user.id, {
            email: user.email,
          })
          await saveDatabase(db)
          throw new ApiError(
            401,
            'AUTH_MFA_INVALID',
            'Invalid MFA code. Privileged demo accounts use 123456.',
          )
        }
        audit(db, user.organisation_id, user.id, 'auth.mfa_required', 'user', user.id, {
          email: user.email,
        })
        await saveDatabase(db)
        res.status(202).json({
          mfaRequired: true,
          message: 'Privileged roles require MFA. Use demo code 123456.',
        })
        return
      }

      const rememberMe = Boolean(req.body.rememberMe)
      const token = issueAccessToken(user, permissions)
      const { refreshToken, refreshExpiresAt } = await issueRefreshToken(db, user, { rememberMe })
      const roles = getRoles(db, user.id)

      audit(db, user.organisation_id, user.id, 'auth.login', 'user', user.id, {
        email: user.email,
        rememberMe,
      })
      await saveDatabase(db)

      res.json({
        token,
        refreshToken,
        expiresIn: config.jwtExpiresIn,
        refreshExpiresAt,
        rememberMe,
        user: safeUser(user),
        roles,
        permissions,
      })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/auth/refresh',
    rateLimit('auth-refresh', 30, 60000),
    validate(refreshTokenSchema),
    async (req, res) => {
      const stored = findActiveRefreshToken(db, req.body.refreshToken)
      if (!stored || stored.user_status !== 'active') {
        throw new ApiError(401, 'AUTH_REFRESH_INVALID', 'Refresh token is invalid or expired.')
      }

      const user = get(db, 'SELECT * FROM users WHERE id = ? AND status = ? AND deleted_at IS NULL', [
        stored.user_id,
        'active',
      ])
      if (!user) {
        throw new ApiError(401, 'AUTH_REFRESH_INVALID', 'Refresh token is invalid or expired.')
      }

      const now = new Date().toISOString()
      revokeRefreshToken(db, stored.token_hash, now)
      const permissions = getPermissions(db, user.id)
      const token = issueAccessToken(user, permissions)
      const { refreshToken, refreshExpiresAt } = await issueRefreshToken(db, user, {
        rememberMe: Boolean(stored.remember_me),
      })
      run(db, 'UPDATE refresh_tokens SET last_used_at = ? WHERE id = ?', [now, stored.id])
      audit(db, user.organisation_id, user.id, 'auth.token_refreshed', 'user', user.id, {})
      await saveDatabase(db)

      res.json({
        token,
        refreshToken,
        expiresIn: config.jwtExpiresIn,
        refreshExpiresAt,
        rememberMe: Boolean(stored.remember_me),
        user: safeUser(user),
        roles: getRoles(db, user.id),
        permissions,
      })
    },
  )

  router.post(
    '/auth/logout',
    rateLimit('auth-logout', 30, 60000),
    validate(logoutSchema),
    async (req, res) => {
      const now = new Date().toISOString()
      if (req.body.refreshToken) {
        const stored = get(db, 'SELECT * FROM refresh_tokens WHERE token_hash = ?', [
          hashToken(req.body.refreshToken),
        ])
        if (stored && !stored.revoked_at) {
          revokeRefreshToken(db, stored.token_hash, now)
          audit(db, stored.organisation_id, stored.user_id, 'auth.logout', 'user', stored.user_id, {})
          await saveDatabase(db)
        }
      }
      res.json({ message: 'Signed out successfully.' })
    },
  )

  return router
}
