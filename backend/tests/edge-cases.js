import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from '../src/index.js'
import { all, initDatabase } from '../src/db/database.js'

const app = await createApp()
const server = app.listen(0)
const { port } = server.address()
const baseUrl = `http://127.0.0.1:${port}`

try {
  const db = await initDatabase()
  const auditsBefore = all(db, 'SELECT * FROM audits').length

  await expectStatus('/health', 200)
  await expectStatus('/api/v1/docs', 200)

  const unauthenticated = await expectStatus('/api/v1/products', 401)
  assert.equal(unauthenticated.error.code, 'AUTH_REQUIRED')

  const invalidToken = await expectStatus('/api/v1/products', 401, {
    token: 'invalid.jwt.token',
  })
  assert.equal(invalidToken.error.code, 'AUTH_INVALID_TOKEN')

  const invalidLoginBody = await expectStatus('/api/v1/auth/login', 400, {
    method: 'POST',
    body: { email: 'invalid', password: 'short' },
  })
  assert.equal(invalidLoginBody.error.code, 'VALIDATION_ERROR')

  const invalidJson = await expectStatus('/api/v1/auth/login', 400, {
    method: 'POST',
    rawBody: '{"email":',
  })
  assert.equal(invalidJson.error.code, 'INVALID_JSON')

  const wrongPassword = await expectStatus('/api/v1/auth/login', 401, {
    method: 'POST',
    body: { email: 'manager@edtech.example', password: 'WrongPass1' },
  })
  assert.equal(wrongPassword.error.code, 'AUTH_INVALID_CREDENTIALS')

  const mfaChallenge = await expectStatus('/api/v1/auth/login', 202, {
    method: 'POST',
    body: { email: 'manager@edtech.example', password: 'Revenue24' },
  })
  assert.equal(mfaChallenge.mfaRequired, true)

  const analyst = await expectStatus('/api/v1/auth/login', 200, {
    method: 'POST',
    body: { email: 'analyst@edtech.example', password: 'Revenue24', rememberMe: true },
  })
  assert.ok(analyst.token)
  assert.ok(analyst.refreshToken)
  assert.equal(analyst.rememberMe, true)

  const refreshed = await expectStatus('/api/v1/auth/refresh', 200, {
    method: 'POST',
    body: { refreshToken: analyst.refreshToken },
  })
  assert.ok(refreshed.token)
  assert.ok(refreshed.refreshToken)
  assert.notEqual(refreshed.refreshToken, analyst.refreshToken)
  await expectStatus('/api/v1/me', 200, { token: refreshed.token })
  await expectStatus('/api/v1/auth/refresh', 401, {
    method: 'POST',
    body: { refreshToken: analyst.refreshToken },
  })
  await expectStatus('/api/v1/auth/logout', 200, {
    method: 'POST',
    body: { refreshToken: refreshed.refreshToken },
  })
  await expectStatus('/api/v1/auth/refresh', 401, {
    method: 'POST',
    body: { refreshToken: refreshed.refreshToken },
  })

  assert.equal((await expectStatus('/api/v1/security/controls', 403, {
    token: refreshed.token,
  })).error.code, 'FORBIDDEN')
  assert.equal((await expectStatus('/api/v1/jobs', 403, {
    token: refreshed.token,
  })).error.code, 'FORBIDDEN')
  await expectStatus('/api/v1/products', 200, { token: refreshed.token })

  const admin = await expectStatus('/api/v1/auth/login', 200, {
    method: 'POST',
    body: {
      email: 'admin@edtech.example',
      password: 'Revenue24',
      mfaCode: '123456',
    },
  })
  assert.deepEqual(admin.roles, ['Administrator'])
  assert.ok(admin.refreshToken)

  const manager = await expectStatus('/api/v1/auth/login', 200, {
    method: 'POST',
    body: {
      email: 'manager@edtech.example',
      password: 'Revenue24',
      mfaCode: '123456',
    },
  })
  assert.ok(manager.token)
  assert.ok(all(db, 'SELECT * FROM audits').length > auditsBefore)

  const invalidPage = await expectStatus('/api/v1/products?limit=101', 400, {
    token: manager.token,
  })
  assert.equal(invalidPage.error.code, 'VALIDATION_ERROR')
  await expectStatus('/api/v1/products?sort=not_a_column', 200, {
    token: manager.token,
  })

  const unknownResource = await expectStatus('/api/v1/not-real', 404, {
    token: manager.token,
  })
  assert.equal(unknownResource.error.code, 'RESOURCE_NOT_FOUND')

  await expectStatus('/api/v1/contribution-margin', 400, {
    method: 'POST',
    token: manager.token,
    body: { productId: 'not-a-uuid', revenue: -1 },
  })
  await expectStatus('/api/v1/contribution-margin', 404, {
    method: 'POST',
    token: manager.token,
    body: { productId: randomUUID(), revenue: 1000 },
  })

  const products = await expectStatus('/api/v1/products?limit=1', 200, {
    token: manager.token,
  })
  const productId = products.data[0].id
  await expectStatus('/api/v1/contribution-margin', 400, {
    method: 'POST',
    token: manager.token,
    body: { productId, revenue: 1000, discountAmount: 1000 },
  })

  await expectStatus('/api/v1/scenarios/evaluate', 400, {
    method: 'POST',
    token: manager.token,
    body: { productId, priceChangePct: 4, discountPct: 81 },
  })

  const constrainedScenario = await expectStatus('/api/v1/scenarios/evaluate', 200, {
    method: 'POST',
    token: manager.token,
    body: {
      productId,
      priceChangePct: -20,
      discountPct: 20,
      constraints: {
        ceilingDiscountPct: 10,
        contractFloorPrice: 100000,
        requiresHumanReviewAboveImpact: 1,
      },
    },
  })
  assert.equal(constrainedScenario.requiresHumanReview, true)
  assert.ok(constrainedScenario.violations.length >= 1)

  const intelligence = await expectStatus('/api/v1/ai/revenue-intelligence', 200, {
    token: manager.token,
  })
  assert.ok(intelligence.modelVersion)
  assert.ok(intelligence.recommendations.length > 0)
  assert.equal(intelligence.safety.chainOfThought, 'not exposed')

  const narrative = await expectStatus('/api/v1/ai/variance-narrative', 200, {
    token: manager.token,
  })
  assert.ok(narrative.narrative)
  assert.ok(narrative.citedEvidence.length > 0)

  const recommendations = await expectStatus('/api/v1/recommendations?limit=1', 200, {
    token: manager.token,
  })
  await expectStatus(`/api/v1/recommendations/${recommendations.data[0].id}/review`, 400, {
    method: 'POST',
    token: manager.token,
    body: { decision: 'overridden' },
  })
  await expectStatus('/api/v1/ai/feedback', 404, {
    method: 'POST',
    token: manager.token,
    body: {
      recommendationId: randomUUID(),
      correction: 'Correct the recommendation using updated costs.',
      decision: 'corrected',
    },
  })

  const quotes = await expectStatus('/api/v1/quotes?limit=1', 200, {
    token: manager.token,
  })
  const idempotencyKey = `edge-${randomUUID()}`
  const approvalOptions = {
    method: 'POST',
    token: manager.token,
    idempotencyKey,
    body: { decision: 'approved', reason: 'Margin and contract controls passed.' },
  }
  const firstApproval = await expectStatus(
    `/api/v1/deal-approvals/${quotes.data[0].id}`,
    200,
    approvalOptions,
  )
  const replayedApproval = await expectStatus(
    `/api/v1/deal-approvals/${quotes.data[0].id}`,
    200,
    approvalOptions,
  )
  assert.deepEqual(replayedApproval, firstApproval)

  let rateLimited = false
  for (let index = 0; index < 12; index += 1) {
    const result = await rawRequest('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'nobody@example.com', password: 'WrongPass1' },
    })
    if (result.status === 429) {
      rateLimited = true
      assert.equal(result.payload.error.code, 'RATE_LIMITED')
      break
    }
  }
  assert.equal(rateLimited, true)

  console.log('Backend edge-case tests passed.')
} finally {
  server.close()
}

async function expectStatus(path, expectedStatus, options = {}) {
  const result = await rawRequest(path, options)
  assert.equal(
    result.status,
    expectedStatus,
    `${path}: expected ${expectedStatus}, received ${result.status}: ${JSON.stringify(result.payload)}`,
  )
  return result.payload
}

async function rawRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    body: options.rawBody ?? (options.body ? JSON.stringify(options.body) : undefined),
  })

  return {
    status: response.status,
    payload: await response.json(),
  }
}
