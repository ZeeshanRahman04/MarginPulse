import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  archiveNotification,
  clearSession,
  createUser,
  enqueueReport,
  evaluateScenario,
  getAccessToken,
  getApiUnavailableMessage,
  intelligenceClient,
  login,
  markNotificationRead,
  normalizeApiError,
  resolveApiBaseUrl,
  restoreSession,
  retryJob,
  searchAudits,
  toConfidencePct,
  updateConfiguration,
  updateOutcome,
  updateUser,
} from '../services/intelligenceClient.js'

describe('operational API contracts', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('resolves API base URL from VITE_API_BASE_URL and defaults to same-origin /api/v1', () => {
    expect(resolveApiBaseUrl({ VITE_API_BASE_URL: 'https://api.example.com/api/v1/' })).toBe(
      'https://api.example.com/api/v1',
    )
    expect(resolveApiBaseUrl({ VITE_API_BASE_URL: '' })).toBe('/api/v1')
    expect(resolveApiBaseUrl({ DEV: true, VITE_API_BASE_URL: '' })).toBe('/api/v1')
    expect(resolveApiBaseUrl({ DEV: true, VITE_API_BASE_URL: '/api/v1' })).toBe('/api/v1')
    expect(resolveApiBaseUrl({ DEV: true, VITE_API_BASE_URL: 'https://api.example.com/api/v1' })).toBe(
      'https://api.example.com/api/v1',
    )
  })

  it('uses environment-aware unavailable copy without legacy branding', () => {
    expect(getApiUnavailableMessage({ DEV: true })).toMatch(/npm run server/)
    expect(getApiUnavailableMessage({ DEV: false, VITE_API_BASE_URL: '' })).toMatch(/unreachable/i)
    expect(getApiUnavailableMessage({ DEV: false, VITE_API_BASE_URL: 'https://api.example.com/api/v1' })).toMatch(
      /https:\/\/api\.example\.com\/api\/v1/,
    )
    const normalized = normalizeApiError({ request: {}, message: 'Network Error', code: 'ERR_NETWORK' })
    expect(normalized.message).toMatch(/MarginPulse API/i)
    expect(normalized.message).not.toMatch(/revenue intelligence/i)
  })

  it('maps plain HTML 404/500 error pages to actionable API errors', () => {
    const notFound = normalizeApiError({
      message: 'Request failed with status code 404',
      response: {
        status: 404,
        data: 'Not Found',
      },
    })
    expect(notFound.status).toBe(404)
    expect(notFound.code).toBe('API_ROUTE_NOT_FOUND')
    expect(notFound.message).toMatch(/API route was not found/i)

    const crashed = normalizeApiError({
      message: 'Request failed with status code 500',
      response: {
        status: 500,
        data: '<!doctype html><html><body>Internal Server Error</body></html>',
      },
    })
    expect(crashed.status).toBe(500)
    expect(crashed.code).toBe('API_INVOCATION_FAILED')
    expect(crashed.message).toMatch(/failed to start/i)
  })

  it('does not let a late restoreSession clear tokens from a newer login', async () => {
    clearSession()
    window.localStorage.setItem('rpm-access-token', 'stale-token')
    window.localStorage.setItem('rpm-refresh-token', 'stale-refresh')
    window.localStorage.setItem(
      'rpm-session-user',
      JSON.stringify({ email: 'stale@example.com', role: 'Executive' }),
    )
    window.localStorage.setItem('rpm-session-permissions', '[]')

    let releaseMe
    const meGate = new Promise((resolve) => {
      releaseMe = resolve
    })
    vi.spyOn(intelligenceClient, 'get').mockImplementation(async (url) => {
      if (url === '/me') {
        await meGate
        const error = new Error('Unauthorized')
        error.response = { status: 401, data: { error: { code: 'AUTH_INVALID_TOKEN', message: 'bad' } } }
        throw error
      }
      return { data: {} }
    })
    vi.spyOn(intelligenceClient, 'post').mockImplementation(async (url) => {
      if (url === '/auth/login') {
        return {
          data: {
            token: 'fresh-token',
            refreshToken: 'fresh-refresh',
            user: { email: 'manager@edtech.example', display_name: 'Executive' },
            roles: ['Executive'],
            permissions: ['admin:manage'],
            rememberMe: true,
          },
        }
      }
      if (url === '/auth/refresh') {
        const error = new Error('Unauthorized')
        error.response = {
          status: 401,
          data: { error: { code: 'AUTH_REFRESH_INVALID', message: 'bad refresh' } },
        }
        throw error
      }
      return { data: {} }
    })

    const restorePromise = restoreSession()
    await login({ email: 'manager@edtech.example', password: 'Revenue24', mfaCode: '123456' }, true)
    expect(getAccessToken()).toBe('fresh-token')

    releaseMe()
    await expect(restorePromise).resolves.toBeNull()
    expect(getAccessToken()).toBe('fresh-token')
  })

  it('normalises recommendation confidence to a 0-100 percent score', () => {
    expect(toConfidencePct({ confidence_low: 80, confidence_high: 94 })).toBe(87)
    expect(toConfidencePct({ expected_impact: 91000, confidence_low: 72000, confidence_high: 146000 })).toBe(72)
    expect(toConfidencePct({ expected_impact: 91000, confidence_low: 72000, confidence_high: 146000 }, 0.92)).toBe(92)
  })

  it('marks notifications read and archives them with idempotency', async () => {
    const patch = vi.spyOn(intelligenceClient, 'patch').mockResolvedValue({ data: { data: { id: 'n1', status: 'read' } } })
    const remove = vi.spyOn(intelligenceClient, 'delete').mockResolvedValue({ data: { id: 'n1', deleted: true } })
    await markNotificationRead('n1')
    await archiveNotification('n1')
    expect(patch).toHaveBeenCalledWith('/notifications/n1/read', { status: 'read' }, { headers: { 'Idempotency-Key': expect.any(String) } })
    expect(remove).toHaveBeenCalledWith('/notifications/n1', { headers: { 'Idempotency-Key': expect.any(String) } })
  })

  it('creates and version-updates users', async () => {
    const post = vi.spyOn(intelligenceClient, 'post').mockResolvedValue({ data: { data: { id: 'u1' } } })
    const patch = vi.spyOn(intelligenceClient, 'patch').mockResolvedValue({ data: { data: { id: 'u1', version: 2 } } })
    const input = { email: 'new@example.com', displayName: 'New User', password: 'Revenue24', role: 'Sales User' }
    await createUser(input)
    await updateUser('u1', { displayName: 'Renamed User', role: 'Executive', status: 'active', version: 1 })
    expect(post).toHaveBeenCalledWith('/users', input, { headers: { 'Idempotency-Key': expect.any(String) } })
    expect(patch).toHaveBeenCalledWith('/users/u1', expect.objectContaining({ version: 1 }), { headers: { 'Idempotency-Key': expect.any(String) } })
  })

  it('searches audits and persists configuration values', async () => {
    const get = vi.spyOn(intelligenceClient, 'get').mockResolvedValue({ data: { data: [] } })
    const put = vi.spyOn(intelligenceClient, 'put').mockResolvedValue({ data: { key: 'ai.threshold', value: 0.8 } })
    await searchAudits('user update', 2)
    await updateConfiguration('ai.threshold', 0.8)
    expect(get).toHaveBeenCalledWith('/audits?search=user%20update&page=2&limit=50')
    expect(put).toHaveBeenCalledWith('/configurations/ai.threshold', { value: 0.8 }, { headers: { 'Idempotency-Key': expect.any(String) } })
  })

  it('enqueues and retries report jobs', async () => {
    const post = vi.spyOn(intelligenceClient, 'post').mockResolvedValue({ data: { data: { id: 'j1', status: 'queued' } } })
    await enqueueReport({ format: 'csv' })
    await retryJob('j1')
    expect(post).toHaveBeenNthCalledWith(1, '/jobs', {
      jobType: 'report-generation', payload: { format: 'csv' }, maxAttempts: 3,
    }, { headers: { 'Idempotency-Key': expect.any(String) } })
    expect(post).toHaveBeenNthCalledWith(2, '/jobs/j1/retry', {}, { headers: { 'Idempotency-Key': expect.any(String) } })
  })

  it('updates realised outcomes and evaluates scenarios', async () => {
    const patch = vi.spyOn(intelligenceClient, 'patch').mockResolvedValue({ data: { data: { id: 'o1' } } })
    const post = vi.spyOn(intelligenceClient, 'post').mockResolvedValue({ data: { data: { status: 'warning' } } })
    const outcome = { actualRevenue: 12000, actualMargin: 42, notes: 'Measured' }
    const scenario = { productId: 'p1', priceChangePct: 5, volumeChangePct: -2 }
    await updateOutcome('o1', outcome)
    await evaluateScenario(scenario)
    expect(patch).toHaveBeenCalledWith('/realised-outcomes/o1', outcome, { headers: { 'Idempotency-Key': expect.any(String) } })
    expect(post).toHaveBeenCalledWith('/scenarios/evaluate', scenario, { headers: { 'Idempotency-Key': expect.any(String) } })
  })
})
