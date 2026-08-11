import { createApp } from '../src/index.js'

const app = await createApp()
const server = app.listen(0)
const { port } = server.address()
const baseUrl = `http://127.0.0.1:${port}`

try {
  const loginResponse = await request('/api/v1/auth/login', {
    method: 'POST',
    body: {
      email: 'manager@edtech.example',
      password: 'Revenue24',
      mfaCode: '123456',
    },
  })
  const token = loginResponse.token

  await request('/health')
  await request('/api/v1/docs')
  await request('/api/v1/me', { token })

  const products = await request('/api/v1/products?limit=1', { token })
  await request('/api/v1/customers?limit=5', { token })
  await request('/api/v1/quotes?status=pending_approval', { token })
  await request('/api/v1/revenue-bridges', { token })
  await request('/api/v1/variance-analysis?period=2026-Q3', { token })
  await request('/api/v1/contribution-margin', {
    method: 'POST',
    token,
    body: {
      productId: products.data[0].id,
      revenue: 100000,
      discountAmount: 5000,
    },
  })
  await request('/api/v1/ai/revenue-intelligence', { token })
  await request('/api/v1/ai/variance-narrative', { token })
  await request('/api/v1/security/controls', { token })
  await request('/api/v1/model-monitoring', { token })
  await request('/api/v1/notifications', { token })
  await request('/api/v1/jobs', { token })
  await request('/api/v1/scenarios/evaluate', {
    method: 'POST',
    token,
    body: {
      productId: products.data[0].id,
      priceChangePct: 4,
      discountPct: 8,
      constraints: {
        floorMarginPct: 48,
        ceilingDiscountPct: 14,
        requiresHumanReviewAboveImpact: 50000,
      },
    },
  })

  console.log('Backend smoke test passed.')
} finally {
  server.close()
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`${path} failed: ${JSON.stringify(payload)}`)
  }
  return payload
}
