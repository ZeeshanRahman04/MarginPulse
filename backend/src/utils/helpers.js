import { v4 as uuid } from 'uuid'
import { all, get, run } from '../db/database.js'

export function getPermissions(db, userId) {
  return all(
    db,
    `SELECT DISTINCT p.code
     FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = ?`,
    [userId],
  ).map((row) => row.code)
}

export function getRoles(db, userId) {
  return all(
    db,
    `SELECT r.name
     FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?
     ORDER BY r.name`,
    [userId],
  ).map((row) => row.name)
}

export function tenantRow(db, table, id, organisationId) {
  return get(db, `SELECT * FROM ${table} WHERE id = ? AND organisation_id = ?`, [id, organisationId])
}

export function safeUser(user) {
  const { organisation_id, ...rest } = user
  delete rest.password_hash
  return { ...rest, organisationId: organisation_id }
}

export function audit(db, organisationId, userId, action, entityType, entityId, metadata) {
  run(db, 'INSERT INTO audits VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    userId,
    action,
    entityType,
    entityId,
    JSON.stringify(metadata),
    new Date().toISOString(),
  ])
}

export function safeSort(sort, allowedColumns, defaultSort = 'created_at DESC', alias) {
  const fallback = qualifySort(defaultSort, alias)
  if (!sort) return fallback
  const direction = sort.startsWith('-') ? 'DESC' : 'ASC'
  const column = sort.replace('-', '').replace(/[^a-zA-Z0-9_]/g, '')
  const qualified = alias ? `${alias}.${column}` : column
  return allowedColumns?.has(qualified) ? `${qualified} ${direction}` : fallback
}

function qualifySort(sort, alias) {
  const [column, direction = 'DESC'] = sort.split(/\s+/)
  return `${alias ? `${alias}.${column}` : column} ${direction === 'ASC' ? 'ASC' : 'DESC'}`
}

export function loadAiContext(db, organisationId) {
  return {
    products: all(db, 'SELECT * FROM products WHERE organisation_id = ? AND deleted_at IS NULL', [
      organisationId,
    ]),
    transactions: all(db, 'SELECT * FROM transactions WHERE organisation_id = ?', [organisationId]),
    budgets: all(db, 'SELECT * FROM budgets WHERE organisation_id = ?', [organisationId]),
    forecasts: all(db, 'SELECT * FROM forecasts WHERE organisation_id = ?', [organisationId]),
    quotes: all(db, 'SELECT * FROM quotes WHERE organisation_id = ? AND deleted_at IS NULL', [
      organisationId,
    ]),
  }
}
