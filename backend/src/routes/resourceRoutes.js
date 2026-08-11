import { Router } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { educationResources, resources } from '../config/resources.js'
import { querySchema } from '../config/schemas.js'
import { all, get, run, saveDatabase } from '../db/database.js'
import { idempotent } from '../middleware/idempotency.js'
import { ApiError } from '../utils/errors.js'
import { audit, safeSort } from '../utils/helpers.js'

export function createResourceRoutes(db) {
  const router = Router()

  router.get('/education/:resource', (req, res, next) => {
    try {
      const config = educationResources[req.params.resource]
      if (!config) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Education resource was not found.')
      requirePermission(req, config.readPermission)
      res.json(listRows(db, req, config))
    } catch (error) {
      next(error)
    }
  })

  router.get('/education/:resource/:id', (req, res, next) => {
    try {
      const config = educationResources[req.params.resource]
      if (!config) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Education resource was not found.')
      requirePermission(req, config.readPermission)
      const row = readableRow(
        db,
        config,
        req.params.id,
        req.user.organisationId,
        req.user.permissions,
      )
      if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Education record was not found.')
      res.json({ data: row })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:resource', (req, res, next) => {
    try {
      const config = requireReadableResource(req.params.resource)
      requirePermission(req, config.readPermission)
      res.json(listRows(db, req, config))
    } catch (error) {
      next(error)
    }
  })

  router.get('/:resource/:id', (req, res, next) => {
    try {
      const config = requireReadableResource(req.params.resource)
      requirePermission(req, config.readPermission)
      const row = readableRow(
        db,
        config,
        req.params.id,
        req.user.organisationId,
        req.user.permissions,
      )
      if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource record was not found.')
      res.json({ data: row })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:resource', idempotent(db), async (req, res, next) => {
    try {
      const config = requireWritableResource(req.params.resource)
      requirePermission(req, config.writePermission)
      const body = parseWriteBody(config, req.body, false)
      verifyTenantReferences(db, body, req.user.organisationId)
      verifyEnterpriseWriteScope(
        db,
        config,
        body,
        req.user.organisationId,
        req.user.permissions,
      )
      const now = new Date().toISOString()
      const id = uuid()
      const record = {
        id,
        organisation_id: req.user.organisationId,
        ...body,
      }
      const columns = tableColumns(db, config.table)
      if (columns.has('created_by')) record.created_by = req.user.id
      if (columns.has('created_at')) record.created_at = now
      if (columns.has('updated_at')) record.updated_at = now
      if (columns.has('version')) record.version = 1
      const keys = Object.keys(record).filter((key) => columns.has(key))
      run(
        db,
        `INSERT INTO ${config.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        keys.map((key) => normaliseValue(record[key])),
      )
      audit(db, req.user.organisationId, req.user.id, 'resource.create', req.params.resource, id, {
        fields: Object.keys(body),
      })
      await saveDatabase(db)
      res.status(201).json({
        data: resourceRow(db, config, id, req.user.organisationId, req.user.permissions),
      })
    } catch (error) {
      next(error)
    }
  })

  for (const method of ['put', 'patch']) {
    router[method]('/:resource/:id', idempotent(db), async (req, res, next) => {
      try {
        const config = requireWritableResource(req.params.resource)
        requirePermission(req, config.writePermission)
        const body = parseWriteBody(config, req.body, true)
        const existing = resourceRow(
          db,
          config,
          req.params.id,
          req.user.organisationId,
          req.user.permissions,
        )
        if (!existing) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource record was not found.')
        const expectedVersion = getExpectedVersion(req, config)
        verifyTenantReferences(db, body, req.user.organisationId)
        verifyEnterpriseWriteScope(
          db,
          config,
          { ...existing, ...body },
          req.user.organisationId,
          req.user.permissions,
        )
        const updates = { ...body }
        const columns = tableColumns(db, config.table)
        if (columns.has('updated_at')) updates.updated_at = new Date().toISOString()
        const assignments = Object.keys(updates).map((column) => `${column} = ?`)
        if (config.versioned) assignments.push('version = version + 1')
        const where = ['id = ?', 'organisation_id = ?']
        const params = [...Object.values(updates).map(normaliseValue), req.params.id, req.user.organisationId]
        if (config.softDelete) where.push('deleted_at IS NULL')
        if (config.versioned) {
          where.push('version = ?')
          params.push(expectedVersion)
        }
        run(db, `UPDATE ${config.table} SET ${assignments.join(', ')} WHERE ${where.join(' AND ')}`, params)
        if (get(db, 'SELECT changes() AS count').count === 0) {
          throw new ApiError(409, 'VERSION_CONFLICT', 'The record changed since it was read.')
        }
        audit(db, req.user.organisationId, req.user.id, 'resource.update', req.params.resource, req.params.id, {
          fields: Object.keys(body),
          previousVersion: expectedVersion ?? null,
        })
        await saveDatabase(db)
        res.json({
          data: resourceRow(
            db,
            config,
            req.params.id,
            req.user.organisationId,
            req.user.permissions,
          ),
        })
      } catch (error) {
        next(error)
      }
    })
  }

  router.delete('/:resource/:id', idempotent(db), async (req, res, next) => {
    try {
      const config = requireWritableResource(req.params.resource)
      requirePermission(req, config.writePermission)
      const existing = resourceRow(
        db,
        config,
        req.params.id,
        req.user.organisationId,
        req.user.permissions,
      )
      if (!existing) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource record was not found.')
      const expectedVersion = getExpectedVersion(req, config)
      const where = ['id = ?', 'organisation_id = ?']
      const params = [req.params.id, req.user.organisationId]
      if (config.versioned) {
        where.push('version = ?')
        params.push(expectedVersion)
      }
      if (config.softDelete) {
        const assignments = ['deleted_at = ?']
        const updateParams = [new Date().toISOString()]
        if (tableColumns(db, config.table).has('updated_at')) {
          assignments.push('updated_at = ?')
          updateParams.push(new Date().toISOString())
        }
        if (config.versioned) assignments.push('version = version + 1')
        run(db, `UPDATE ${config.table} SET ${assignments.join(', ')} WHERE ${where.join(' AND ')}`, [
          ...updateParams,
          ...params,
        ])
      } else {
        run(db, `DELETE FROM ${config.table} WHERE ${where.join(' AND ')}`, params)
      }
      if (get(db, 'SELECT changes() AS count').count === 0) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'The record changed since it was read.')
      }
      audit(db, req.user.organisationId, req.user.id, 'resource.delete', req.params.resource, req.params.id, {
        softDelete: Boolean(config.softDelete),
      })
      await saveDatabase(db)
      res.json({ id: req.params.id, deleted: true, softDelete: Boolean(config.softDelete) })
    } catch (error) {
      next(error)
    }
  })

  return router
}

function requireResource(name) {
  const config = resources[name]
  if (!config) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource endpoint was not found.')
  return config
}

function requireReadableResource(name) {
  const config = resources[name] ?? educationResources[name]
  if (!config) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource endpoint was not found.')
  return config
}

function requireWritableResource(name) {
  const config = requireResource(name)
  if (!config.writable) throw new ApiError(405, 'RESOURCE_READ_ONLY', 'This resource is read-only.')
  return config
}

function requirePermission(req, permission) {
  const permissions = Array.isArray(permission) ? permission : [permission]
  if (
    !req.user.permissions.includes('admin:manage') &&
    !permissions.some((item) => req.user.permissions.includes(item))
  ) {
    throw new ApiError(403, 'FORBIDDEN', `Missing one of: ${permissions.join(', ')}`)
  }
}

function listRows(db, req, config) {
  const query = querySchema.parse(req.query)
  const alias = config.table
  const tenantColumn = config.tenantColumn ?? `${alias}.organisation_id`
  const clauses = [`${tenantColumn} = ?`]
  const params = [req.user.organisationId]
  const columns = tableColumns(db, config.table)
  if (config.softDelete || columns.has('deleted_at')) clauses.push(`${alias}.deleted_at IS NULL`)
  applyEnterpriseScope(config, alias, clauses, req.user.permissions)
  if (query.status && columns.has('status')) {
    clauses.push(`${alias}.status = ?`)
    params.push(query.status)
  }
  if (query.search && config.searchColumns.length) {
    clauses.push(`(${config.searchColumns.map((column) => `${alias}.${column} LIKE ?`).join(' OR ')})`)
    params.push(...config.searchColumns.map(() => `%${query.search}%`))
  }
  const orderBy = safeSort(
    query.sort,
    new Set([...columns].map((column) => `${alias}.${column}`)),
    config.defaultSort,
    alias,
  )
  const from = `${config.table} ${config.tenantJoin ?? ''}`
  const offset = (query.page - 1) * query.limit
  const data = all(
    db,
    `SELECT ${alias}.* FROM ${from} WHERE ${clauses.join(' AND ')}
     ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, query.limit, offset],
  )
  const total = get(db, `SELECT COUNT(*) AS count FROM ${from} WHERE ${clauses.join(' AND ')}`, params)
  const enriched =
    config.table === 'recommendations'
      ? data.map((row) => {
          if (!row.ai_run_id) return row
          const aiRun = get(db, 'SELECT confidence FROM ai_runs WHERE id = ? AND organisation_id = ?', [
            row.ai_run_id,
            req.user.organisationId,
          ])
          return { ...row, ai_confidence: aiRun?.confidence ?? null }
        })
      : data
  return { data: enriched, pagination: { page: query.page, limit: query.limit, total: total.count } }
}

function resourceRow(db, config, id, organisationId, permissions = []) {
  const clauses = ['id = ?', 'organisation_id = ?']
  if (config.softDelete || tableColumns(db, config.table).has('deleted_at')) clauses.push('deleted_at IS NULL')
  applyEnterpriseScope(config, config.table, clauses, permissions)
  return get(db, `SELECT * FROM ${config.table} WHERE ${clauses.join(' AND ')}`, [id, organisationId])
}

function readableRow(db, config, id, organisationId, permissions = []) {
  if (!config.tenantJoin) return resourceRow(db, config, id, organisationId, permissions)
  const alias = config.table
  return get(
    db,
    `SELECT ${alias}.* FROM ${config.table} ${config.tenantJoin}
     WHERE ${alias}.id = ? AND ${config.tenantColumn} = ?`,
    [id, organisationId],
  )
}

function parseWriteBody(config, input, partial) {
  const shape = Object.fromEntries(
    Object.entries(config.fields).map(([name, descriptor]) => {
      let schema =
        descriptor.type === 'number'
          ? z.number().finite()
          : descriptor.type === 'integer'
            ? z.number().int()
            : descriptor.type === 'boolean'
              ? z.boolean()
              : z.string().min(1).max(5000)
      if (!descriptor.required || partial) schema = schema.optional().nullable()
      return [name, schema]
    }),
  )
  const schema = z.object(shape).strict()
  const parsed = schema.parse(input)
  if (partial && Object.keys(parsed).length === 0) {
    throw new ApiError(400, 'EMPTY_UPDATE', 'At least one writable field is required.')
  }
  return parsed
}

function getExpectedVersion(req, config) {
  if (!config.versioned) return null
  const raw = req.headers['if-match']
  if (!raw) throw new ApiError(428, 'VERSION_REQUIRED', 'If-Match is required for versioned records.')
  const version = Number(String(raw).replaceAll('"', ''))
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError(400, 'INVALID_VERSION', 'If-Match must contain a positive integer version.')
  }
  return version
}

function tableColumns(db, table) {
  return new Set(all(db, `PRAGMA table_info(${table})`).map((column) => column.name))
}

const referenceTables = {
  segment_id: 'segments',
  product_id: 'products',
  price_list_id: 'price_lists',
  discount_id: 'discounts',
  customer_id: 'customers',
  quote_id: 'quotes',
  ai_run_id: 'ai_runs',
  model_version_id: 'model_versions',
}

function verifyTenantReferences(db, body, organisationId) {
  for (const [field, table] of Object.entries(referenceTables)) {
    if (!body[field]) continue
    const found = get(db, `SELECT id FROM ${table} WHERE id = ? AND organisation_id = ?`, [
      body[field],
      organisationId,
    ])
    if (!found) throw new ApiError(400, 'INVALID_REFERENCE', `${field} is not valid for this tenant.`)
  }
}

function normaliseValue(value) {
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

function applyEnterpriseScope(config, alias, clauses, permissions) {
  const enterpriseOnly =
    permissions.includes('enterprise:read') &&
    !permissions.includes('finance:read') &&
    !permissions.includes('admin:manage')
  if (!enterpriseOnly || !config.enterpriseScope) return

  if (config.enterpriseScope === 'customer_type') {
    clauses.push(`${alias}.customer_type = 'enterprise'`)
  } else if (config.enterpriseScope === 'product_type') {
    clauses.push(`${alias}.product_type = 'enterprise_licence'`)
  } else if (config.enterpriseScope === 'product_id') {
    clauses.push(
      `${alias}.product_id IN (SELECT id FROM products WHERE product_type = 'enterprise_licence')`,
    )
  } else if (config.enterpriseScope === 'quote_id') {
    clauses.push(
      `${alias}.quote_id IN (
        SELECT q.id FROM quotes q
        JOIN products p ON p.id = q.product_id
        WHERE p.product_type = 'enterprise_licence'
      )`,
    )
  }
}

function verifyEnterpriseWriteScope(db, config, record, organisationId, permissions) {
  const enterpriseOnly =
    permissions.includes('enterprise:read') &&
    !permissions.includes('finance:read') &&
    !permissions.includes('admin:manage')
  if (!enterpriseOnly || !config.enterpriseScope) return

  let allowed = true
  if (config.enterpriseScope === 'customer_type') {
    allowed = record.customer_type === 'enterprise'
  } else if (config.enterpriseScope === 'product_type') {
    allowed = record.product_type === 'enterprise_licence'
  } else if (config.enterpriseScope === 'product_id') {
    allowed = Boolean(
      get(
        db,
        `SELECT id FROM products
         WHERE id = ? AND organisation_id = ? AND product_type = 'enterprise_licence'`,
        [record.product_id, organisationId],
      ),
    )
  } else if (config.enterpriseScope === 'quote_id') {
    allowed = Boolean(
      get(
        db,
        `SELECT q.id FROM quotes q
         JOIN products p ON p.id = q.product_id
         WHERE q.id = ? AND q.organisation_id = ? AND p.product_type = 'enterprise_licence'`,
        [record.quote_id, organisationId],
      ),
    )
  }
  if (!allowed) {
    throw new ApiError(403, 'ENTERPRISE_SCOPE_REQUIRED', 'Sales users may only change enterprise-scoped records.')
  }
}
