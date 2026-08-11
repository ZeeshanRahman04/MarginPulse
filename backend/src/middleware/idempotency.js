import crypto from 'node:crypto'
import { v4 as uuid } from 'uuid'
import { get, run, saveDatabase } from '../db/database.js'
import { ApiError } from '../utils/errors.js'

export function idempotent(db) {
  return (req, res, next) => {
    const key = req.headers['idempotency-key']
    if (!key) return next()
    if (typeof key !== 'string' || key.length > 200) {
      throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be at most 200 characters.')
    }
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ method: req.method, path: req.originalUrl, body: req.body }))
      .digest('hex')

    const existing = get(
      db,
      'SELECT * FROM idempotency_keys WHERE organisation_id = ? AND idempotency_key = ?',
      [req.user.organisationId, key],
    )
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This Idempotency-Key was already used with a different request.',
        )
      }
      res.status(existing.response_status ?? 200).json(JSON.parse(existing.response_json))
      return
    }

    const originalJson = res.json.bind(res)
    res.json = (body) => {
      if (res.statusCode >= 400) return originalJson(body)
      run(
        db,
        `INSERT INTO idempotency_keys
         (id, organisation_id, idempotency_key, request_hash, response_json, created_at, response_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
        uuid(),
        req.user.organisationId,
        key,
        requestHash,
        JSON.stringify(body),
        new Date().toISOString(),
          res.statusCode,
        ],
      )
      saveDatabase(db)
      return originalJson(body)
    }
    next()
  }
}
