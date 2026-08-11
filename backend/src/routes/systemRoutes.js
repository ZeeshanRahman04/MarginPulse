import { Router } from 'express'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { config } from '../config/env.js'
import { querySchema } from '../config/schemas.js'
import { all, get, run, saveDatabase } from '../db/database.js'
import { permit } from '../middleware/auth.js'
import { idempotent } from '../middleware/idempotency.js'
import { validate } from '../middleware/validate.js'
import { ApiError } from '../utils/errors.js'
import { audit, getPermissions, getRoles, safeUser } from '../utils/helpers.js'

const configurationSchema = z.object({ value: z.unknown() }).strict()
const notificationSchema = z.object({ status: z.literal('read').optional() }).strict()
const jobSchema = z
  .object({
    jobType: z.string().regex(/^[a-z][a-z0-9-]{2,80}$/),
    payload: z.record(z.string(), z.unknown()).default({}),
    maxAttempts: z.number().int().min(1).max(10).default(3),
    scheduledAt: z.string().datetime().optional(),
  })
  .strict()
const outcomeSchema = z
  .object({
    actualRevenue: z.number().finite(),
    actualMargin: z.number().min(-100).max(100),
    measuredAt: z.string().datetime().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()
const userCreateSchema = z
  .object({
    email: z.string().email(),
    displayName: z.string().min(2).max(120),
    password: z.string().min(8).max(128).default('Revenue24'),
    role: z.enum([
      'Sales User',
      'Pricing Manager',
      'Finance Controller',
      'Executive',
      'Administrator',
    ]),
  })
  .strict()
const userUpdateSchema = z
  .object({
    displayName: z.string().min(2).max(120).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    role: z
      .enum(['Sales User', 'Pricing Manager', 'Finance Controller', 'Executive', 'Administrator'])
      .optional(),
    version: z.number().int().positive(),
  })
  .strict()

export function createSystemRoutes(db) {
  const router = Router()

  router.get('/me', (req, res) => {
    res.json({ user: req.user, permissions: req.user.permissions })
  })

  router.get('/security/controls', permit('admin:manage'), (_req, res) => {
    res.json({
      authentication: {
        passwordHashing: 'bcrypt',
        accessTokenLifetime: config.jwtExpiresIn,
        refreshTokenLifetime: config.jwtRefreshExpiresIn,
        rememberedRefreshTokenLifetime: config.jwtRefreshExpiresInRemembered,
        mfa: 'Required for privileged roles using demo code in this prototype.',
        rememberMe: 'Extends refresh-token lifetime and persists the session locally.',
      },
      apiProtection: [
        'Helmet security headers',
        'CORS',
        'Zod validation',
        'structured errors',
        'auth rate limiting',
        'JWT access + refresh tokens',
        'server-side permissions',
      ],
      dataProtection: [
        'TLS expected at deployment edge',
        'SQLite file should be encrypted by managed volume or OS-level encryption',
        'secrets only in environment variables',
      ],
      domainControls: [
        'learner privacy',
        'child protection policy gate',
        'content rights metadata',
        'assessment integrity audit',
        'retention and legal hold procedures',
      ],
      safetyControls: [
        'approval thresholds',
        'fairness checks',
        'data provenance',
        'rollback through versioned records',
        'append-only audit events',
      ],
      operations: {
        backup: 'Nightly encrypted SQLite backup plus object-storage metadata export.',
        restore: 'Restore latest verified backup into isolated environment before promotion.',
        disasterRecovery: 'RPO 24h, RTO 4h for this prototype target.',
        incidentResponse:
          'Preserve audit logs, rotate secrets, disable affected users, review AI/actions, notify stakeholders.',
      },
    })
  })

  router.get('/notifications', (req, res) => {
    res.json({
      data: all(
        db,
        `SELECT * FROM notifications
         WHERE organisation_id = ? AND (user_id = ? OR user_id IS NULL)
           AND status != 'archived'
         ORDER BY created_at DESC`,
        [req.user.organisationId, req.user.id],
      ),
    })
  })

  router.patch(
    '/notifications/:id/read',
    validate(notificationSchema),
    idempotent(db),
    async (req, res) => {
      const notification = get(
        db,
        'SELECT * FROM notifications WHERE id = ? AND organisation_id = ? AND user_id = ?',
        [req.params.id, req.user.organisationId, req.user.id],
      )
      if (!notification) {
        throw new ApiError(
          404,
          'NOTIFICATION_NOT_FOUND',
          'User-specific notification was not found.',
        )
      }
      run(db, "UPDATE notifications SET status = 'read' WHERE id = ?", [notification.id])
      audit(db, req.user.organisationId, req.user.id, 'notification.read', 'notification', notification.id, {})
      await saveDatabase(db)
      res.json({ data: { ...notification, status: 'read' } })
    },
  )

  router.delete('/notifications/:id', idempotent(db), async (req, res) => {
    const notification = get(
      db,
      'SELECT * FROM notifications WHERE id = ? AND organisation_id = ? AND user_id = ?',
      [req.params.id, req.user.organisationId, req.user.id],
    )
    if (!notification) {
      throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'User-specific notification was not found.')
    }
    run(db, "UPDATE notifications SET status = 'archived' WHERE id = ?", [notification.id])
    audit(db, req.user.organisationId, req.user.id, 'notification.archive', 'notification', notification.id, {})
    await saveDatabase(db)
    res.json({ id: notification.id, deleted: true })
  })

  router.get('/configurations', permit('configuration:manage'), (req, res) => {
    const data = all(
      db,
      `SELECT id, config_key, config_value_json, created_at, updated_at
       FROM configurations WHERE organisation_id = ? ORDER BY config_key`,
      [req.user.organisationId],
    ).map((row) => ({ ...row, value: JSON.parse(row.config_value_json) }))
    res.json({ data })
  })

  router.put(
    '/configurations/:key',
    permit('configuration:manage'),
    validate(configurationSchema),
    idempotent(db),
    async (req, res) => {
      const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9._-]{1,120}$/).parse(req.params.key)
      const now = new Date().toISOString()
      const existing = get(
        db,
        'SELECT id FROM configurations WHERE organisation_id = ? AND config_key = ?',
        [req.user.organisationId, key],
      )
      if (existing) {
        run(db, 'UPDATE configurations SET config_value_json = ?, updated_at = ? WHERE id = ?', [
          JSON.stringify(req.body.value),
          now,
          existing.id,
        ])
      } else {
        run(db, 'INSERT INTO configurations VALUES (?, ?, ?, ?, ?, ?)', [
          uuid(),
          req.user.organisationId,
          key,
          JSON.stringify(req.body.value),
          now,
          now,
        ])
      }
      audit(db, req.user.organisationId, req.user.id, 'configuration.update', 'configuration', key, {})
      await saveDatabase(db)
      res.json({ key, value: req.body.value, updatedAt: now })
    },
  )

  router.get('/audits', permit('audits:read'), (req, res) => {
    const query = querySchema.parse(req.query)
    const clauses = ['organisation_id = ?']
    const params = [req.user.organisationId]
    if (query.search) {
      clauses.push('(action LIKE ? OR entity_type LIKE ? OR entity_id LIKE ? OR metadata_json LIKE ?)')
      params.push(...Array(4).fill(`%${query.search}%`))
    }
    const offset = (query.page - 1) * query.limit
    res.json({
      data: all(
        db,
        `SELECT * FROM audits WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, query.limit, offset],
      ),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: get(db, `SELECT COUNT(*) AS count FROM audits WHERE ${clauses.join(' AND ')}`, params)
          .count,
      },
    })
  })

  router.get('/jobs', permit('jobs:manage'), (req, res) => {
    res.json({
      data: all(
        db,
        `SELECT * FROM background_jobs
         WHERE organisation_id = ? OR organisation_id IS NULL
         ORDER BY scheduled_at DESC`,
        [req.user.organisationId],
      ),
      deadLetters: all(db, 'SELECT * FROM dead_letters ORDER BY created_at DESC'),
    })
  })

  router.post('/jobs', permit('jobs:manage'), validate(jobSchema), idempotent(db), async (req, res) => {
    const id = uuid()
    const now = new Date().toISOString()
    run(
      db,
      `INSERT INTO background_jobs
       (id, organisation_id, job_type, payload_json, status, attempts, max_attempts,
        scheduled_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, NULL, ?, ?)`,
      [
        id,
        req.user.organisationId,
        req.body.jobType,
        JSON.stringify(req.body.payload),
        req.body.maxAttempts,
        req.body.scheduledAt ?? now,
        now,
        now,
      ],
    )
    audit(db, req.user.organisationId, req.user.id, 'job.enqueue', 'background_job', id, {
      jobType: req.body.jobType,
    })
    await saveDatabase(db)
    res.status(202).json({ data: get(db, 'SELECT * FROM background_jobs WHERE id = ?', [id]) })
  })

  router.post('/jobs/:id/retry', permit('jobs:manage'), idempotent(db), async (req, res) => {
    const job = get(
      db,
      `SELECT * FROM background_jobs
       WHERE id = ? AND organisation_id = ? AND status IN ('failed','dead_letter')`,
      [req.params.id, req.user.organisationId],
    )
    if (!job) throw new ApiError(409, 'JOB_NOT_RETRYABLE', 'Job is not in a retryable state.')
    const now = new Date().toISOString()
    run(
      db,
      `UPDATE background_jobs
       SET status = 'queued', attempts = 0, last_error = NULL, scheduled_at = ?, updated_at = ?
       WHERE id = ?`,
      [now, now, job.id],
    )
    audit(db, req.user.organisationId, req.user.id, 'job.retry', 'background_job', job.id, {})
    await saveDatabase(db)
    res.status(202).json({ data: get(db, 'SELECT * FROM background_jobs WHERE id = ?', [job.id]) })
  })

  router.get('/realised-outcomes', permit('finance:read'), (req, res) => {
    res.json({
      data: all(
        db,
        `SELECT * FROM realised_outcomes
         WHERE organisation_id = ? ORDER BY measured_at DESC`,
        [req.user.organisationId],
      ),
    })
  })

  router.patch(
    '/realised-outcomes/:id',
    permit('finance:write'),
    validate(outcomeSchema),
    idempotent(db),
    async (req, res) => {
      const outcome = get(
        db,
        'SELECT * FROM realised_outcomes WHERE id = ? AND organisation_id = ?',
        [req.params.id, req.user.organisationId],
      )
      if (!outcome) throw new ApiError(404, 'OUTCOME_NOT_FOUND', 'Realised outcome was not found.')
      run(
        db,
        `UPDATE realised_outcomes
         SET actual_revenue = ?, actual_margin = ?, measured_at = ?, notes = ?
         WHERE id = ? AND organisation_id = ?`,
        [
          req.body.actualRevenue,
          req.body.actualMargin,
          req.body.measuredAt ?? new Date().toISOString(),
          req.body.notes ?? outcome.notes,
          outcome.id,
          req.user.organisationId,
        ],
      )
      audit(db, req.user.organisationId, req.user.id, 'outcome.update', 'realised_outcome', outcome.id, {})
      await saveDatabase(db)
      res.json({
        data: get(db, 'SELECT * FROM realised_outcomes WHERE id = ?', [outcome.id]),
      })
    },
  )

  router.get('/users', permit('users:manage'), (req, res) => {
    const users = all(
      db,
      `SELECT * FROM users
       WHERE organisation_id = ? AND deleted_at IS NULL ORDER BY display_name`,
      [req.user.organisationId],
    ).map((user) => ({
      ...safeUser(user),
      roles: getRoles(db, user.id),
      permissions: getPermissions(db, user.id),
    }))
    res.json({ data: users })
  })

  router.post(
    '/users',
    permit('users:manage'),
    validate(userCreateSchema),
    idempotent(db),
    async (req, res) => {
      const role = get(db, 'SELECT id FROM roles WHERE organisation_id = ? AND name = ?', [
        req.user.organisationId,
        req.body.role,
      ])
      if (!role) throw new ApiError(400, 'ROLE_NOT_FOUND', 'Requested role is not configured.')
      const id = uuid()
      const now = new Date().toISOString()
      run(
        db,
        `INSERT INTO users
         (id, organisation_id, email, password_hash, display_name, status, created_at, updated_at, deleted_at, version)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, 1)`,
        [
          id,
          req.user.organisationId,
          req.body.email,
          await bcrypt.hash(req.body.password, 10),
          req.body.displayName,
          now,
          now,
        ],
      )
      run(db, 'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, role.id])
      audit(db, req.user.organisationId, req.user.id, 'user.create', 'user', id, {
        role: req.body.role,
      })
      await saveDatabase(db)
      res.status(201).json({ data: { ...safeUser(get(db, 'SELECT * FROM users WHERE id = ?', [id])), roles: [req.body.role] } })
    },
  )

  router.patch(
    '/users/:id',
    permit('users:manage'),
    validate(userUpdateSchema),
    idempotent(db),
    async (req, res) => {
      const user = get(
        db,
        'SELECT * FROM users WHERE id = ? AND organisation_id = ? AND deleted_at IS NULL',
        [req.params.id, req.user.organisationId],
      )
      if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User was not found.')
      if (user.id === req.user.id && req.body.status === 'disabled') {
        throw new ApiError(409, 'SELF_DISABLE_FORBIDDEN', 'You cannot disable your own account.')
      }
      if (user.version !== req.body.version) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'The user changed since it was read.')
      }
      if (req.body.role) {
        const role = get(db, 'SELECT id FROM roles WHERE organisation_id = ? AND name = ?', [
          req.user.organisationId,
          req.body.role,
        ])
        if (!role) throw new ApiError(400, 'ROLE_NOT_FOUND', 'Requested role is not configured.')
        run(db, 'DELETE FROM user_roles WHERE user_id = ?', [user.id])
        run(db, 'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [user.id, role.id])
      }
      run(
        db,
        `UPDATE users SET display_name = ?, status = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND organisation_id = ? AND version = ?`,
        [
          req.body.displayName ?? user.display_name,
          req.body.status ?? user.status,
          new Date().toISOString(),
          user.id,
          req.user.organisationId,
          req.body.version,
        ],
      )
      audit(db, req.user.organisationId, req.user.id, 'user.update', 'user', user.id, {
        role: req.body.role ?? null,
        status: req.body.status ?? null,
      })
      await saveDatabase(db)
      const updated = get(db, 'SELECT * FROM users WHERE id = ?', [user.id])
      res.json({ data: { ...safeUser(updated), roles: getRoles(db, user.id) } })
    },
  )

  return router
}
