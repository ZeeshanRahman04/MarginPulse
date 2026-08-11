import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from '../src/index.js'
import { all, get, initDatabase, run, saveDatabase } from '../src/db/database.js'

const app = await createApp()
const server = app.listen(0)
const { port } = server.address()
const baseUrl = `http://127.0.0.1:${port}`

try {
  const db = await initDatabase()
  const executive = await request('/api/v1/auth/login', {
    method: 'POST',
    body: {
      email: 'manager@edtech.example',
      password: 'Revenue24',
      mfaCode: '123456',
    },
  })
  const token = executive.token
  assert.deepEqual(executive.roles, ['Executive'])

  for (const [email, role, privileged] of [
    ['analyst@edtech.example', 'Sales User', false],
    ['pricing@edtech.example', 'Pricing Manager', true],
    ['finance@edtech.example', 'Finance Controller', true],
    ['manager@edtech.example', 'Executive', true],
    ['admin@edtech.example', 'Administrator', true],
  ]) {
    const login = await rawRequest('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password: 'Revenue24' },
    })
    assert.equal(login.status, privileged ? 202 : 200)
    if (!privileged) assert.deepEqual(login.payload.roles, [role])
  }

  const sales = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'analyst@edtech.example', password: 'Revenue24' },
  })
  const salesProducts = await request('/api/v1/products?limit=100', {
    token: sales.token,
  })
  assert.ok(salesProducts.data.length > 0)
  assert.ok(salesProducts.data.every((product) => product.product_type === 'enterprise_licence'))
  const nonEnterpriseProduct = get(
    db,
    "SELECT id FROM products WHERE product_type != 'enterprise_licence' LIMIT 1",
  )
  await expectStatus(`/api/v1/products/${nonEnterpriseProduct.id}`, 404, {
    token: sales.token,
  })
  const salesRevenue = await request('/api/v1/revenue-bridges', {
    token: sales.token,
  })
  assert.ok(salesRevenue.data.every((row) => row.productType === 'enterprise_licence'))

  const commercialResources = [
    'customers',
    'segments',
    'products',
    'price-lists',
    'costs',
    'discounts',
    'promotions',
    'quotes',
    'contracts',
    'transactions',
    'budgets',
    'forecasts',
    'recommendations',
    'approvals',
  ]
  for (const resource of commercialResources) {
    const payload = await request(`/api/v1/${resource}?limit=2`, { token })
    assert.ok(Array.isArray(payload.data), resource)
  }

  for (const resource of [
    'learners',
    'instructors',
    'courses',
    'lessons',
    'enrolments',
    'progress',
    'assessments',
    'certificates',
    'subscriptions',
  ]) {
    const payload = await request(`/api/v1/${resource}?limit=2`, { token })
    assert.ok(Array.isArray(payload.data), resource)
  }

  const promotion = await request('/api/v1/promotions', {
    method: 'POST',
    token,
    idempotencyKey: `promotion-${randomUUID()}`,
    body: {
      name: `Compliance promotion ${randomUUID()}`,
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: '2026-09-30T00:00:00.000Z',
      status: 'planned',
    },
  })
  assert.equal(promotion.data.status, 'planned')
  const promotionDetail = await request(`/api/v1/promotions/${promotion.data.id}`, { token })
  assert.equal(promotionDetail.data.id, promotion.data.id)
  await request(`/api/v1/promotions/${promotion.data.id}`, {
    method: 'PATCH',
    token,
    idempotencyKey: `promotion-update-${randomUUID()}`,
    body: { status: 'active' },
  })

  const productCreate = await request('/api/v1/products', {
    method: 'POST',
    token,
    idempotencyKey: `product-${randomUUID()}`,
    body: {
      sku: `TEST-${randomUUID()}`,
      name: 'Versioned compliance product',
      product_type: 'service',
      status: 'active',
    },
  })
  const productId = productCreate.data.id
  await expectStatus(`/api/v1/products/${productId}`, 428, {
    method: 'PATCH',
    token,
    body: { name: 'No version' },
  })
  const updatedProduct = await request(`/api/v1/products/${productId}`, {
    method: 'PATCH',
    token,
    headers: { 'If-Match': String(productCreate.data.version) },
    idempotencyKey: `product-update-${randomUUID()}`,
    body: { name: 'Updated compliance product' },
  })
  assert.equal(updatedProduct.data.version, 2)
  await expectStatus(`/api/v1/products/${productId}`, 409, {
    method: 'PATCH',
    token,
    headers: { 'If-Match': '1' },
    body: { name: 'Stale update' },
  })

  const runsBefore = all(db, 'SELECT * FROM ai_runs').length
  const intelligence = await request('/api/v1/ai/revenue-intelligence', { token })
  assert.ok(intelligence.aiRunId)
  const persistedRun = get(db, 'SELECT * FROM ai_runs WHERE id = ?', [intelligence.aiRunId])
  assert.ok(persistedRun.input_data_json)
  assert.ok(persistedRun.output_json)
  assert.ok(persistedRun.updated_at)
  assert.ok(persistedRun.completed_at)
  assert.equal(all(db, 'SELECT * FROM ai_runs').length, runsBefore + 1)
  assert.ok(
    all(db, 'SELECT * FROM recommendations WHERE ai_run_id = ?', [intelligence.aiRunId]).length > 0,
  )
  const manualRecommendation = await request('/api/v1/recommendations', {
    method: 'POST',
    token,
    idempotencyKey: `recommendation-${randomUUID()}`,
    body: {
      title: 'Manual recommendation without an AI snapshot',
      recommendation_type: 'pricing',
      expected_impact: 1000,
      confidence_low: 500,
      confidence_high: 1500,
      assumptions_json: '[]',
      rationale: 'Created manually to verify trace reporting.',
      status: 'draft',
    },
  })
  const feedback = await request('/api/v1/ai/feedback', {
    method: 'POST',
    token,
    idempotencyKey: `feedback-${randomUUID()}`,
    body: {
      recommendationId: manualRecommendation.data.id,
      correction: 'Use a current cost snapshot before approving.',
      decision: 'corrected',
    },
  })
  assert.equal(feedback.modelTrace.aiRunId, null)
  assert.equal(feedback.modelTrace.inputSnapshotStored, false)

  const courseProduct = get(db, "SELECT id FROM products WHERE sku = 'AI-BOOT'")
  const floorScenario = await request('/api/v1/scenarios/evaluate', {
    method: 'POST',
    token,
    body: {
      productId: courseProduct.id,
      priceChangePct: -20,
      discountPct: 20,
      constraints: { floorMarginPct: 70 },
    },
  })
  assert.ok(floorScenario.violations.includes('Resulting margin is below the configured floor.'))
  assert.ok(Number.isFinite(floorScenario.resultingMarginPct))

  const idempotencyKey = `conflict-${randomUUID()}`
  await request('/api/v1/configurations/compliance.test', {
    method: 'PUT',
    token,
    idempotencyKey,
    body: { value: { enabled: true } },
  })
  const idempotencyConflict = await expectStatus('/api/v1/configurations/compliance.test', 409, {
    method: 'PUT',
    token,
    idempotencyKey,
    body: { value: { enabled: false } },
  })
  assert.equal(idempotencyConflict.error.code, 'IDEMPOTENCY_CONFLICT')

  assert.ok((await request('/api/v1/configurations', { token })).data.length > 0)
  assert.ok(Array.isArray((await request('/api/v1/audits?search=configuration', { token })).data))
  const job = await request('/api/v1/jobs', {
    method: 'POST',
    token,
    idempotencyKey: `job-${randomUUID()}`,
    body: { jobType: 'compliance-refresh', payload: { source: 'test' } },
  })
  assert.equal(job.data.status, 'queued')
  run(db, "UPDATE background_jobs SET status = 'failed' WHERE id = ?", [job.data.id])
  await saveDatabase(db)
  const retriedJob = await request(`/api/v1/jobs/${job.data.id}/retry`, {
    method: 'POST',
    token,
    idempotencyKey: `retry-${randomUUID()}`,
  })
  assert.equal(retriedJob.data.status, 'queued')

  const notificationId = randomUUID()
  run(db, 'INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?)', [
    notificationId,
    executive.user.organisationId,
    executive.user.id,
    'Compliance notification',
    'Notification preference behavior test.',
    'unread',
    new Date().toISOString(),
  ])
  await saveDatabase(db)
  const readNotification = await request(`/api/v1/notifications/${notificationId}/read`, {
    method: 'PATCH',
    token,
    idempotencyKey: `notification-read-${randomUUID()}`,
    body: {},
  })
  assert.equal(readNotification.data.status, 'read')
  const deletedNotification = await request(`/api/v1/notifications/${notificationId}`, {
    method: 'DELETE',
    token,
    idempotencyKey: `notification-delete-${randomUUID()}`,
  })
  assert.equal(deletedNotification.deleted, true)

  const outcomes = await request('/api/v1/realised-outcomes', { token })
  const outcome = await request(`/api/v1/realised-outcomes/${outcomes.data[0].id}`, {
    method: 'PATCH',
    token,
    idempotencyKey: `outcome-${randomUUID()}`,
    body: { actualRevenue: 125000, actualMargin: 54, notes: 'Measured by compliance test.' },
  })
  assert.equal(outcome.data.actual_revenue, 125000)

  const users = await request('/api/v1/users', { token })
  assert.deepEqual(
    new Set(users.data.flatMap((user) => user.roles)),
    new Set(['Sales User', 'Pricing Manager', 'Finance Controller', 'Executive', 'Administrator']),
  )
  const newUser = await request('/api/v1/users', {
    method: 'POST',
    token,
    idempotencyKey: `user-${randomUUID()}`,
    body: {
      email: `sales-${randomUUID()}@edtech.example`,
      displayName: 'Compliance Sales User',
      password: 'Revenue24',
      role: 'Sales User',
    },
  })
  const changedUser = await request(`/api/v1/users/${newUser.data.id}`, {
    method: 'PATCH',
    token,
    idempotencyKey: `user-update-${randomUUID()}`,
    body: {
      displayName: 'Compliance Pricing User',
      role: 'Pricing Manager',
      version: newUser.data.version,
    },
  })
  assert.deepEqual(changedUser.data.roles, ['Pricing Manager'])

  console.log('Backend compliance tests passed.')
} finally {
  server.close()
}

async function request(path, options = {}) {
  const result = await rawRequest(path, options)
  assert.ok(
    result.status >= 200 && result.status < 300,
    `${path}: received ${result.status}: ${JSON.stringify(result.payload)}`,
  )
  return result.payload
}

async function expectStatus(path, status, options = {}) {
  const result = await rawRequest(path, options)
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.payload)}`)
  return result.payload
}

async function rawRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  return { status: response.status, payload: response.status === 204 ? null : await response.json() }
}
