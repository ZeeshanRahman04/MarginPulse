import { saveDatabase } from '../db/database.js'
import { audit } from '../utils/helpers.js'

export function auditDataAccess(db) {
  return (req, res, next) => {
    if (req.method !== 'GET') {
      next()
      return
    }

    res.once('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 400 || !req.user) return
      audit(db, req.user.organisationId, req.user.id, 'data.access', 'api_route', req.path, {
        queryKeys: Object.keys(req.query).sort(),
        statusCode: res.statusCode,
      })
      saveDatabase(db).catch((error) => {
        console.error('Failed to persist data-access audit event.', error)
      })
    })
    next()
  }
}
