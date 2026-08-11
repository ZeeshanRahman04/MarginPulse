import jwt from 'jsonwebtoken'
import { config } from '../config/env.js'
import { get } from '../db/database.js'
import { ApiError } from '../utils/errors.js'
import { getPermissions, getRoles, safeUser } from '../utils/helpers.js'

export function authenticate(db) {
  return (req, _res, next) => {
    try {
      const [, token] = (req.headers.authorization ?? '').split(' ')
      if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Bearer token is required.')

      const payload = jwt.verify(token, config.jwtSecret)
      const user = get(
        db,
        `SELECT * FROM users
         WHERE id = ? AND organisation_id = ? AND status = 'active' AND deleted_at IS NULL`,
        [payload.sub, payload.organisationId],
      )
      if (!user) throw new ApiError(401, 'AUTH_INVALID_TOKEN', 'User token is invalid.')

      req.user = {
        ...safeUser(user),
        organisationId: payload.organisationId,
        permissions: getPermissions(db, user.id),
        roles: getRoles(db, user.id),
      }
      next()
    } catch (error) {
      if (error instanceof ApiError) {
        next(error)
        return
      }
      next(new ApiError(401, 'AUTH_INVALID_TOKEN', 'Bearer token is invalid or expired.'))
    }
  }
}

export function permit(permission) {
  return (req, _res, next) => {
    if (!req.user.permissions.includes(permission) && !req.user.permissions.includes('admin:manage')) {
      throw new ApiError(403, 'FORBIDDEN', `Missing permission: ${permission}`)
    }
    next()
  }
}

export function permitAny(...permissions) {
  return (req, _res, next) => {
    const granted =
      req.user.permissions.includes('admin:manage') ||
      permissions.some((permission) => req.user.permissions.includes(permission))
    if (!granted) {
      throw new ApiError(403, 'FORBIDDEN', `Missing one of: ${permissions.join(', ')}`)
    }
    next()
  }
}
