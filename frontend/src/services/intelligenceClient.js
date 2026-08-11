import axios from 'axios'
import { intelligenceSnapshot } from '../data/intelligenceSnapshot.js'

const TOKEN_KEY = 'rpm-access-token'
const REFRESH_TOKEN_KEY = 'rpm-refresh-token'
const USER_KEY = 'rpm-session-user'
const PERMISSIONS_KEY = 'rpm-session-permissions'
const REMEMBER_KEY = 'rpm-remember-me'
const SESSION_EVENT = 'rpm:session-expired'

/**
 * Same-origin `/api/v1` works with the Vite proxy locally and reverse-proxied production setups.
 * In DEV, prefer the Vite proxy unless `VITE_API_BASE_URL` is set to an absolute remote URL
 * (that path needs the API `ALLOWED_ORIGINS` / local-origin CORS allow-list to include the Vite origin).
 */
export function resolveApiBaseUrl(env = import.meta.env) {
  const configured = String(env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
  if (env.DEV) {
    if (!configured || configured.startsWith('/')) {
      return configured || '/api/v1'
    }
    // Absolute URL is an explicit remote override (not the default local path).
    return configured
  }
  if (configured) return configured
  return '/api/v1'
}

export function getApiUnavailableMessage(env = import.meta.env) {
  if (env.DEV) {
    return 'The MarginPulse API is unavailable. Run `npm run server` (or `npm run dev:full`) locally.'
  }
  const configured = String(env.VITE_API_BASE_URL || '').trim()
  if (configured) {
    return `The MarginPulse API is unreachable at ${configured}. Confirm the API host is running and that CORS allows this site.`
  }
  return 'The MarginPulse API is unreachable. Confirm the API deployment is healthy (GET /health) and that this frontend build can reach /api/v1.'
}

export const intelligenceClient = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: 10000,
  headers: { Accept: 'application/json' },
})

let refreshPromise = null
let expiryTimer = null
let sessionExpiryHandler = null
/** While > 0, clear tokens but never notify the UI (login bootstrap / credential calls). */
let sessionExpiryMuteCount = 0
/**
 * Bumped on interactive login/logout so an in-flight restoreSession cannot
 * clearSession() / saveSession() over a newer credential exchange.
 */
let sessionGeneration = 0

export function muteSessionExpiryNotifications() {
  sessionExpiryMuteCount += 1
  return () => {
    sessionExpiryMuteCount = Math.max(0, sessionExpiryMuteCount - 1)
  }
}

async function withMutedSessionExpiry(work) {
  const unmute = muteSessionExpiryNotifications()
  try {
    return await work()
  } finally {
    unmute()
  }
}

export function getSessionGeneration() {
  return sessionGeneration
}

function beginInteractiveAuth() {
  sessionGeneration += 1
  return sessionGeneration
}

function storageWithToken() {
  if (window.localStorage.getItem(TOKEN_KEY)) return window.localStorage
  if (window.sessionStorage.getItem(TOKEN_KEY)) return window.sessionStorage
  return null
}

function preferredStorage(remember) {
  return remember ? window.localStorage : window.sessionStorage
}

export function decodeAccessToken(token = getAccessToken()) {
  if (!token) return null
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

export function getAccessToken() {
  return storageWithToken()?.getItem(TOKEN_KEY) ?? null
}

export function getRefreshToken() {
  const storage = storageWithToken()
  return storage?.getItem(REFRESH_TOKEN_KEY) ?? null
}

export function clearSession() {
  if (expiryTimer) {
    window.clearTimeout(expiryTimer)
    expiryTimer = null
  }
  for (const storage of [window.localStorage, window.sessionStorage]) {
    storage.removeItem(TOKEN_KEY)
    storage.removeItem(REFRESH_TOKEN_KEY)
    storage.removeItem(USER_KEY)
    storage.removeItem(PERMISSIONS_KEY)
    storage.removeItem(REMEMBER_KEY)
  }
}

export function saveSession(
  { token, refreshToken, user, permissions = [], rememberMe },
  remember = false,
) {
  const shouldRemember = Boolean(rememberMe ?? remember)
  clearSession()
  const storage = preferredStorage(shouldRemember)
  storage.setItem(TOKEN_KEY, token)
  if (refreshToken) storage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  storage.setItem(USER_KEY, JSON.stringify(user))
  storage.setItem(PERMISSIONS_KEY, JSON.stringify(permissions))
  storage.setItem(REMEMBER_KEY, shouldRemember ? '1' : '0')
  scheduleSessionWatch()
}

export function getStoredSession() {
  const storage = storageWithToken()
  if (!storage) return null
  try {
    return {
      token: storage.getItem(TOKEN_KEY),
      refreshToken: storage.getItem(REFRESH_TOKEN_KEY),
      user: JSON.parse(storage.getItem(USER_KEY)),
      permissions: JSON.parse(storage.getItem(PERMISSIONS_KEY) || '[]'),
      rememberMe: storage.getItem(REMEMBER_KEY) === '1',
    }
  } catch {
    clearSession()
    return null
  }
}

export function onSessionExpired(handler) {
  sessionExpiryHandler = handler
  return () => {
    if (sessionExpiryHandler === handler) sessionExpiryHandler = null
  }
}

function emitSessionExpired(reason = 'Your session expired. Please sign in again.') {
  clearSession()
  // Never spam the SignIn screen during bootstrap / credential flows.
  if (sessionExpiryMuteCount > 0) return
  sessionExpiryHandler?.(reason)
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { reason } }))
}

export class IntelligenceApiError extends Error {
  constructor(message, { code = 'REQUEST_FAILED', status = 0, details = null } = {}) {
    super(message)
    this.name = 'IntelligenceApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

function responseBodyText(data) {
  if (typeof data === 'string') return data
  if (data == null) return ''
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

export function normalizeApiError(error) {
  if (error instanceof IntelligenceApiError) return error
  const status = error.response?.status || 0
  const data = error.response?.data
  const payload = data && typeof data === 'object' ? data.error : null
  const bodyText = responseBodyText(data)
  if (status === 404 && !payload) {
    return new IntelligenceApiError(
      'The MarginPulse API route was not found (HTTP 404). Confirm the API is running and reachable at /api/v1.',
      { code: 'API_ROUTE_NOT_FOUND', status: 404, details: null },
    )
  }

  if (status >= 500 && typeof data === 'string' && /<!doctype html|<html/i.test(bodyText)) {
    return new IntelligenceApiError(
      'The MarginPulse API failed to start on the host. Check API logs and ensure JWT_SECRET is set.',
      {
        code: 'API_INVOCATION_FAILED',
        status,
        details: null,
      },
    )
  }

  const message =
    payload?.message ||
    (typeof data?.message === 'string' ? data.message : null) ||
    (error.code === 'ECONNABORTED'
      ? 'The MarginPulse API took too long to respond.'
      : error.request && !error.response
        ? getApiUnavailableMessage()
        : error.message) ||
    'The request could not be completed.'
  return new IntelligenceApiError(message, {
    code: payload?.code || error.code,
    status,
    details: payload?.details,
  })
}

async function refreshAccessToken({ suppressSessionExpiry = false } = {}) {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    throw new IntelligenceApiError('Refresh token is missing.', {
      code: 'AUTH_REFRESH_INVALID',
      status: 401,
    })
  }
  if (!refreshPromise) {
    refreshPromise = intelligenceClient
      .post(
        '/auth/refresh',
        { refreshToken },
        { skipAuthRefresh: true, skipAuthHeader: true, suppressSessionExpiry },
      )
      .then(({ data }) => {
        const remember = Boolean(data.rememberMe ?? window.localStorage.getItem(TOKEN_KEY))
        const session = {
          token: data.token,
          refreshToken: data.refreshToken,
          user: createSessionUser(
            { ...data.user, role: data.user?.role || data.roles?.[0] },
            data.permissions,
          ),
          permissions: data.permissions || [],
          rememberMe: remember,
        }
        saveSession(session, remember)
        return session
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

export function scheduleSessionWatch() {
  if (expiryTimer) {
    window.clearTimeout(expiryTimer)
    expiryTimer = null
  }
  const payload = decodeAccessToken()
  if (!payload?.exp) return

  const expiresAtMs = payload.exp * 1000
  const refreshAtMs = expiresAtMs - 45_000
  const delay = Math.max(refreshAtMs - Date.now(), 1_000)

  expiryTimer = window.setTimeout(async () => {
    try {
      if (!getRefreshToken()) {
        emitSessionExpired('Your access token expired. Please sign in again.')
        return
      }
      await refreshAccessToken()
    } catch {
      emitSessionExpired('Your session expired. Please sign in again.')
    }
  }, delay)
}

intelligenceClient.interceptors.request.use((config) => {
  // skipAuthRefresh only disables 401→refresh; skipAuthHeader omits Bearer (login/logout).
  if (!config.skipAuthHeader) {
    const token = getAccessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

intelligenceClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    const status = error.response?.status
    const normalized = normalizeApiError(error)
    const suppressSessionExpiry =
      Boolean(original?.suppressSessionExpiry) || sessionExpiryMuteCount > 0
    const requestUrl = String(original?.url || '')
    const isAuthCredentialCall =
      requestUrl.includes('/auth/login') ||
      requestUrl.includes('/auth/forgot-password') ||
      requestUrl.includes('/auth/reset-password') ||
      requestUrl.includes('/auth/refresh')

    // Credential failures must never be mapped to "session expired".
    if (isAuthCredentialCall || suppressSessionExpiry) {
      return Promise.reject(normalized)
    }

    if (
      status === 401 &&
      original &&
      !original.skipAuthRefresh &&
      !original._retry &&
      getRefreshToken() &&
      !requestUrl.includes('/auth/login') &&
      !requestUrl.includes('/auth/refresh')
    ) {
      original._retry = true
      try {
        await refreshAccessToken()
        original.headers = original.headers || {}
        original.headers.Authorization = `Bearer ${getAccessToken()}`
        return intelligenceClient(original)
      } catch (refreshError) {
        emitSessionExpired('Your session expired. Please sign in again.')
        return Promise.reject(normalizeApiError(refreshError))
      }
    }

    if (
      status === 401 &&
      getAccessToken() &&
      (normalized.code === 'AUTH_INVALID_TOKEN' || normalized.code === 'AUTH_REQUIRED')
    ) {
      emitSessionExpired('Your session expired. Please sign in again.')
    }

    return Promise.reject(normalized)
  },
)

export const backendPermissionMap = Object.freeze({
  'finance:read': ['financeData', 'exportData', 'pricingData'],
  'finance:write': ['financeData', 'editOutcomes'],
  'pricing:read': ['pricingData'],
  'pricing:write': ['pricingData'],
  'enterprise:read': ['enterpriseData'],
  'deals:read': ['enterpriseData'],
  'deals:approve': ['approveDeals', 'pricingData'],
  'ai:override': ['overrideAI'],
  'users:manage': ['manageUsers'],
  'configuration:manage': ['manageSettings'],
  'audits:read': ['viewAudits'],
  'jobs:manage': ['manageJobs', 'exportData'],
  'education:read': ['educationData'],
  'admin:manage': ['allData', 'exportData', 'manageUsers', 'manageSettings'],
})

export function mapPermissions(codes = []) {
  return [...new Set(codes.flatMap((code) => backendPermissionMap[code] || []))]
}

const supportedRoles = new Set([
  'Sales User',
  'Pricing Manager',
  'Finance Controller',
  'Executive',
  'Administrator',
])

const roleTeams = {
  'Sales User': 'Sales',
  'Pricing Manager': 'Pricing Strategy',
  'Finance Controller': 'Finance Control',
  Executive: 'Executive Office',
  Administrator: 'Platform Administration',
}

export function deriveRole(user, permissionCodes = []) {
  const backendRole = user?.role || user?.roleName || user?.displayRole
  if (supportedRoles.has(backendRole)) return backendRole
  if (backendRole === 'Platform Manager') return 'Executive'
  if (permissionCodes.includes('admin:manage') && backendRole === 'Administrator') {
    return 'Administrator'
  }
  if (permissionCodes.includes('admin:manage')) return 'Executive'
  if (permissionCodes.includes('ai:override')) return 'Pricing Manager'
  if (backendRole === 'Revenue Analyst' || permissionCodes.includes('deals:approve')) {
    return 'Finance Controller'
  }
  return 'Sales User'
}

export function createSessionUser(user, permissionCodes = []) {
  const role = deriveRole(user, permissionCodes)
  return {
    ...user,
    role,
    team: user?.team || roleTeams[role],
  }
}

export async function login(credentials, remember = false) {
  return withMutedSessionExpiry(async () => {
    // Invalidate in-flight restoreSession and drop any stale Bearer first.
    const generation = beginInteractiveAuth()
    clearSession()
    const { data } = await intelligenceClient.post(
      '/auth/login',
      { ...credentials, rememberMe: Boolean(remember) },
      { skipAuthRefresh: true, skipAuthHeader: true, suppressSessionExpiry: true },
    )
    if (data.mfaRequired) return data
    const session = {
      token: data.token,
      refreshToken: data.refreshToken,
      user: createSessionUser(
        { ...data.user, role: data.user?.role || data.roles?.[0] },
        data.permissions,
      ),
      permissions: data.permissions || [],
      rememberMe: Boolean(data.rememberMe ?? remember),
    }
    // Another interactive auth won the race — do not clobber its tokens.
    if (generation !== sessionGeneration) return session
    saveSession(session, session.rememberMe)
    return session
  })
}

export async function requestPasswordReset(email) {
  const { data } = await intelligenceClient.post(
    '/auth/forgot-password',
    { email },
    { skipAuthRefresh: true, skipAuthHeader: true },
  )
  return data
}

export async function resetPassword({ token, newPassword }) {
  const { data } = await intelligenceClient.post(
    '/auth/reset-password',
    { token, newPassword },
    { skipAuthRefresh: true, skipAuthHeader: true },
  )
  return data
}

export function roleHomePath(role) {
  switch (role) {
    case 'Sales User':
      return '/dashboards'
    case 'Pricing Manager':
      return '/pricing'
    case 'Finance Controller':
      return '/dashboards'
    case 'Executive':
      return '/'
    case 'Administrator':
      return '/users'
    default:
      return '/'
  }
}

export async function restoreSession() {
  const stored = getStoredSession()
  if (!stored?.token) return null
  const generation = sessionGeneration

  return withMutedSessionExpiry(async () => {
    const remember = Boolean(window.localStorage.getItem(TOKEN_KEY)) || stored.rememberMe
    const refreshToken = stored.refreshToken
    const accessPayload = decodeAccessToken(stored.token)
    // Opaque/non-JWT tokens still attempt /me; only skip when JWT exp is known-past.
    const accessExpired =
      Boolean(accessPayload?.exp) && accessPayload.exp * 1000 <= Date.now()

    const stillCurrent = () => generation === sessionGeneration

    try {
      if (!accessExpired) {
        const { data } = await intelligenceClient.get('/me', {
          skipAuthRefresh: true,
          suppressSessionExpiry: true,
        })
        if (!stillCurrent()) return null
        const session = {
          token: stored.token,
          refreshToken,
          user: createSessionUser(data.user, data.permissions),
          permissions: data.permissions || [],
          rememberMe: remember,
        }
        saveSession(session, remember)
        return session
      }
    } catch {
      // Fall through to refresh / clear — never toast on bootstrap.
    }

    if (!stillCurrent()) return null

    if (refreshToken) {
      try {
        return await refreshAccessToken({ suppressSessionExpiry: true })
      } catch {
        if (stillCurrent()) clearSession()
        return null
      }
    }

    if (stillCurrent()) clearSession()
    return null
  })
}

export async function logout() {
  beginInteractiveAuth()
  const refreshToken = getRefreshToken()
  try {
    if (refreshToken) {
      await intelligenceClient.post(
        '/auth/logout',
        { refreshToken },
        { skipAuthRefresh: true, skipAuthHeader: true },
      )
    }
  } catch {
    // Local sign-out still proceeds if the network call fails.
  } finally {
    clearSession()
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value) || 0)
}

/**
 * Recommendation confidence_low/high store dollar impact ranges in the API,
 * while some tests/demos use percentage bands. Normalise to a 0-100 score.
 */
export function toConfidencePct(item, aiRunConfidence) {
  if (aiRunConfidence != null && Number.isFinite(Number(aiRunConfidence))) {
    const value = Number(aiRunConfidence)
    return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)))
  }

  const low = Number(item?.confidence_low)
  const high = Number(item?.confidence_high)
  if (Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high <= 100 && high >= low) {
    return Math.round((low + high) / 2)
  }

  const impact = Math.abs(Number(item?.expected_impact)) || Math.abs(((low || 0) + (high || 0)) / 2) || 1
  const width = Math.abs((high || 0) - (low || 0))
  const relative = Math.min(1.5, width / impact)
  return Math.max(60, Math.min(95, Math.round(95 - relative * 28)))
}

function titleCase(value = '') {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function dedupeByTitle(items = []) {
  const seen = new Set()
  return items.filter((item) => {
    const key = String(item.title || item.segment || item.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const REVENUE_CATEGORY_META = {
  subscription: {
    category: 'subscriptions',
    label: 'Subscriptions',
    owner: 'Finance Controller',
    location: 'Global Digital',
    segment: 'Professional learners',
  },
  course: {
    category: 'course_fees',
    label: 'Course fees',
    owner: 'Pricing Manager',
    location: 'APAC Hub',
    segment: 'Career switchers',
  },
  enterprise_licence: {
    category: 'enterprise_licences',
    label: 'Enterprise licences',
    owner: 'Enterprise Manager',
    location: 'Americas Hub',
    segment: 'B2B academies',
  },
  certification: {
    category: 'certifications',
    label: 'Certifications',
    owner: 'Credentialing Lead',
    location: 'EMEA Hub',
    segment: 'Credential renewals',
  },
  service: {
    category: 'services',
    label: 'Services',
    owner: 'Revenue Ops',
    location: 'Global Digital',
    segment: 'Managed delivery',
  },
  learner_ltv: {
    category: 'learner_ltv',
    label: 'Learner lifetime value',
    owner: 'Learner Success',
    location: 'Global Digital',
    segment: 'Premium learning paths',
  },
}

function resolveRevenueCategory(productType, name = '', sku = '') {
  if (/cert/i.test(name) || /cert/i.test(sku) || productType === 'certification') {
    return REVENUE_CATEGORY_META.certification
  }
  if (/ltv|lifetime/i.test(name)) return REVENUE_CATEGORY_META.learner_ltv
  return REVENUE_CATEGORY_META[productType] || {
    category: productType || 'other',
    label: titleCase(String(productType || 'other').replace(/_/g, ' ')),
    owner: 'Finance Controller',
    location: 'Global Digital',
    segment: titleCase(String(productType || 'General').replace(/_/g, ' ')),
  }
}

function deriveRevenueHealth({ actual, budget, forecast, variance, trend = [] }) {
  const budgetBase = Math.max(Math.abs(Number(budget) || 0), 1)
  const variancePct = (Number(variance) || 0) / budgetBase
  const forecastGap = Number(forecast || 0) - Number(actual || 0)
  const declining = trend.length >= 2 && trend[trend.length - 1] < trend[0]
  let status = 'on_track'
  if (variancePct < -0.05) status = 'behind'
  else if (variancePct > 0.03) status = 'ahead'
  else if (variancePct < 0) status = 'watch'

  let risk = 'normal'
  if (variancePct <= -0.1 || (status === 'behind' && declining)) risk = 'critical'
  else if (status === 'behind' || status === 'watch' || forecastGap < 0) risk = 'warning'

  const action =
    risk === 'critical'
      ? 'Escalate margin recovery and reforecast'
      : risk === 'warning'
        ? 'Review pricing, discounts, and demand assumptions'
        : 'Maintain current pricing posture'

  return { status, risk, forecastGap, action, variancePct: Number((variancePct * 100).toFixed(1)) }
}

function buildTrendFromBridge(item, index) {
  const actual = Number(item.actual) || 0
  const budget = Number(item.budget) || 0
  const forecast = Number(item.forecast) || 0
  const base = Math.max(budget || actual || forecast || 1, 1)
  const actualScore = Math.max(12, Math.min(96, Math.round((actual / base) * 70)))
  const forecastScore = Math.max(12, Math.min(96, Math.round((forecast / base) * 78)))
  const step = Math.round((forecastScore - actualScore) / 4)
  return [
    Math.max(10, actualScore - step * 2 + index),
    Math.max(10, actualScore - step + index),
    Math.max(10, actualScore),
    Math.max(10, actualScore + step),
    Math.max(10, forecastScore),
  ]
}

function buildRevenueStreamRow(item, index = 0, overrides = {}) {
  const meta = resolveRevenueCategory(
    overrides.productType || item.productType || item.category,
    overrides.name || item.product || item.stream,
    overrides.sku || item.sku,
  )
  const actual = Number(overrides.actual ?? item.actual) || 0
  const budget = Number(overrides.budget ?? item.budget) || 0
  const forecast = Number(overrides.forecast ?? item.forecast) || 0
  const variance = Number(overrides.variance ?? item.varianceToBudget ?? item.variance ?? actual - budget)
  const trend = overrides.trend || item.trend || buildTrendFromBridge({ actual, budget, forecast }, index)
  const health = deriveRevenueHealth({ actual, budget, forecast, variance, trend })
  const period = overrides.period || item.period || 'FY26 YTD'
  const asOf = overrides.asOf || item.asOf || item.generatedAt || new Date().toISOString().slice(0, 10)

  return {
    id: overrides.id || item.productId || item.id || `rev-${meta.category}-${index}`,
    stream: overrides.stream || item.product || item.stream || meta.label,
    segment: overrides.segment || meta.segment,
    category: meta.category,
    categoryLabel: meta.label,
    owner: overrides.owner || meta.owner,
    location: overrides.location || meta.location,
    period,
    asOf,
    actual,
    budget,
    forecast,
    variance,
    forecastGap: health.forecastGap,
    variancePct: health.variancePct,
    status: health.status,
    risk: health.risk,
    action: health.action,
    trend,
    currency: overrides.currency || item.currency || '$',
    permission:
      overrides.permission ||
      (meta.category === 'enterprise_licences' ? 'enterpriseData' : 'financeData'),
  }
}

function buildLifecycle(education = {}) {
  const learners = education.learners?.length || 0
  const enrolments = education.enrolments?.length || 0
  const assessments = education.assessments?.length || 0
  const certificates = education.certificates?.length || 0
  const instructors = education.instructors?.length || 0
  const clamp = (value) => Math.max(55, Math.min(96, value))

  return [
    {
      stage: 'Onboarding',
      owner: 'Learner Success',
      signal: `${learners} active learners`,
      health: clamp(70 + learners * 3),
    },
    {
      stage: 'Discovery',
      owner: 'Content Team',
      signal: `${education.courses?.length || 0} published courses`,
      health: clamp(68 + (education.courses?.length || 0) * 4),
    },
    {
      stage: 'Enrolment',
      owner: 'Revenue Ops',
      signal: `${enrolments} live enrolments`,
      health: clamp(66 + enrolments * 2),
    },
    {
      stage: 'Learning',
      owner: 'Instructors',
      signal: `${instructors} instructors staffing delivery`,
      health: clamp(72 + instructors * 5),
    },
    {
      stage: 'Assessment',
      owner: 'Academic Ops',
      signal: `${assessments} recent assessments`,
      health: clamp(64 + assessments * 2),
    },
    {
      stage: 'Mentoring',
      owner: 'Mentors',
      signal: 'Capacity tracked against policy ceilings',
      health: 78,
    },
    {
      stage: 'Certification',
      owner: 'Credentialing',
      signal: `${certificates} certificates issued`,
      health: clamp(70 + certificates * 4),
    },
    {
      stage: 'Support',
      owner: 'Platform Support',
      signal: 'SLA cost exposure monitored',
      health: 72,
    },
  ]
}

function buildPolicyControls(configurations = []) {
  const fromConfig = configurations
    .filter((item) => String(item.config_key || item.key || '').startsWith('policy.'))
    .map((item) => {
      const key = item.config_key || item.key
      try {
        const raw = item.value ?? item.config_value_json ?? item.value_json
        const value = typeof raw === 'string' ? JSON.parse(raw) : raw
        return `${key.replace('policy.', '')}: ${JSON.stringify(value)}`
      } catch {
        return `${key}: configured`
      }
    })

  return fromConfig.length
    ? fromConfig
    : [
        'Human approval for material pricing changes',
        'Margin floor enforcement by product and client tier',
        'Discount exception workflow with audit trail',
        'Mentor and instructor capacity constraints',
        'Enterprise contract guardrails and renewal alerts',
      ]
}

function mergeLiveData(results) {
  const products = results.products?.data || []
  const bridges = results.bridges?.data || []
  const ai = results.ai || {}
  const recommendations = dedupeByTitle(results.recommendations?.data || [])
  const notifications = results.notifications?.data || []
  const priceLists = results.priceLists?.data || []
  const costs = results.costs?.data || []
  const discounts = results.discounts?.data || []
  const quotes = results.quotes?.data || []
  const education = Object.fromEntries(
    ['learners', 'instructors', 'courses', 'lessons', 'enrolments', 'progress', 'assessments', 'certificates']
      .map((key) => [key, results[key]?.data || []]),
  )

  const profitability = ai.profitability || []
  const aiRecommendations = ai.recommendations || []
  const configurations = results.configurations?.data || []
  const aiRunConfidenceById = Object.fromEntries(
    (results.aiRuns?.data || [])
      .filter((run) => run?.id != null)
      .map((run) => [run.id, run.confidence]),
  )

  return {
    lifecycle: buildLifecycle(education),
    policyControls: buildPolicyControls(configurations),
    simulations: aiRecommendations.map((item) => ({
      scenario: `${item.product}: ${item.recommendation}`,
      expectedImpact: `Uplift ${formatCurrency(item.expectedUplift)}, downside ${formatCurrency(item.downsideRisk)}`,
      confidenceRange: `${formatCurrency(item.confidenceInterval?.[0])} to ${formatCurrency(item.confidenceInterval?.[1])}`,
      assumptions: item.comparableHistory || 'Based on tenant-scoped historical performance.',
      constraints: Array.isArray(item.constraints)
        ? item.constraints.join('; ')
        : String(item.constraints || 'Policy constraints apply.'),
    })),
    leakageAlerts: (ai.marginLeakage || []).map((item) => ({
      alert: `${item.product}: ${item.signal}`,
      exposure: formatCurrency(item.estimatedLeakage),
      severity: item.severity === 'high' ? 'High' : 'Medium',
      owner: 'Finance Controller',
    })),
    cohorts: (ai.propensity || []).map((item) => {
      const profit = profitability.find((entry) => entry.productId === item.productId)
      return {
        cohort: item.product,
        learners: 'Live cohort',
        revenue: formatCurrency(profit?.actualRevenue),
        margin: `${profit?.actualMarginPct ?? '—'}%`,
        ltv:
          item.renewalOrConversionPropensity != null
            ? `${Math.round(item.renewalOrConversionPropensity * 100)}% propensity`
            : '—',
      }
    }),
    domainRecords: Object.entries(education).flatMap(([type, records]) =>
      records.map((record) => ({
        id: record.id,
        domain: titleCase(type.replace(/s$/, '')),
        name: record.name || record.title || record.code || record.email || record.id,
        detail:
          record.status ||
          record.specialty ||
          (record.score != null ? `Score ${record.score}` : null) ||
          (record.progress_pct != null ? `${record.progress_pct}% complete` : null) ||
          record.type ||
          'Live operational record',
        permission: 'educationData',
        type,
      })),
    ),
    metrics: bridges.length
      ? [
          {
            label: 'Net Revenue',
            value: formatCurrency(bridges.reduce((sum, item) => sum + item.actual, 0)),
            trend: 'Live actuals',
            tone: 'good',
          },
          {
            label: 'Budget Variance',
            value: formatCurrency(
              bridges.reduce((sum, item) => sum + item.varianceToBudget, 0),
            ),
            trend: 'vs current budget',
            tone: 'warning',
          },
          {
            label: 'Forecast',
            value: formatCurrency(bridges.reduce((sum, item) => sum + item.forecast, 0)),
            trend: 'Latest forecast',
            tone: 'good',
          },
          {
            label: 'Open Recommendations',
            value: String(recommendations.filter((item) => item.status !== 'approved').length),
            trend: 'Needs review',
            tone: 'danger',
          },
        ]
      : [],
    revenueStreams: (() => {
      const asOf = (results.bridges?.generatedAt || new Date().toISOString()).slice(0, 10)
      const productById = Object.fromEntries(products.map((product) => [product.id, product]))
      const streams = bridges.map((item, index) => {
        const product = productById[item.productId]
        return buildRevenueStreamRow(item, index, {
          productType: item.productType || product?.product_type,
          name: item.product || product?.name,
          sku: product?.sku,
          asOf,
          period: 'FY26 YTD',
        })
      })

      const profitRows = profitability.filter((item) => item.actualRevenue != null)
      if (profitRows.length) {
        const learners = Math.max(education.learners?.length || 0, 1)
        const actualRevenue = profitRows.reduce((sum, item) => sum + Number(item.actualRevenue || 0), 0)
        const actualLtv = Number((actualRevenue / learners).toFixed(0))
        const budgetLtv = Number((actualLtv * 0.92).toFixed(0))
        const forecastLtv = Number((actualLtv * 1.05).toFixed(0))
        streams.push(
          buildRevenueStreamRow(
            {
              productType: 'learner_ltv',
              product: 'Learner lifetime value',
              actual: actualLtv,
              budget: budgetLtv,
              forecast: forecastLtv,
              varianceToBudget: actualLtv - budgetLtv,
            },
            streams.length,
            {
              currency: '$/learner',
              permission: 'financeData',
              asOf,
              period: 'FY26 YTD',
            },
          ),
        )
      }

      return streams
    })(),
    pricingRows: products.map((product) => {
      const price = priceLists.find((item) => item.product_id === product.id)
      const cost = costs.find((item) => item.product_id === product.id)
      const bridge = bridges.find((item) => item.productId === product.id)
      const linkedQuotes = quotes.filter((quote) => quote.product_id === product.id)
      const unitCost = cost
        ? Number(cost.direct_cost || 0) +
          Number(cost.instructor_cost || 0) +
          Number(cost.mentor_cost || 0) +
          Number(cost.support_cost || 0) +
          Number(cost.content_cost || 0)
        : null
      const listPrice = price ? Number(price.list_price) : null
      const primaryDiscount = discounts.find((item) => item.status === 'active') || discounts[0]
      const discountPct = primaryDiscount ? Number(primaryDiscount.value || 0) : 0
      const netPrice =
        listPrice != null ? listPrice * (1 - Math.min(Math.max(discountPct, 0), 80) / 100) : null
      const contributionMarginPct =
        netPrice && unitCost != null && netPrice > 0
          ? Number((((netPrice - unitCost) / netPrice) * 100).toFixed(1))
          : bridge?.actualMarginPct ?? null
      const profitabilityAmount = bridge?.actual ?? null
      const approvalStatus = price?.status || product.status || 'active'
      const risk =
        contributionMarginPct != null && contributionMarginPct < 50
          ? 'critical'
          : linkedQuotes.some((quote) => quote.status === 'pending_approval') ||
              String(approvalStatus).toLowerCase().includes('review')
            ? 'warning'
            : 'normal'
      const owner =
        product.product_type === 'enterprise_licence'
          ? 'Enterprise Manager'
          : product.product_type === 'subscription'
            ? 'Finance Controller'
            : 'Pricing Manager'
      const costComponents = cost
        ? {
            direct: cost.direct_cost,
            instructor: cost.instructor_cost,
            mentor: cost.mentor_cost,
            support: cost.support_cost,
            content: cost.content_cost,
            total: unitCost,
            version: cost.version_label,
          }
        : null
      const versionHistory = [
        {
          label: 'Product version',
          value: `v${product.version || 1}`,
          at: product.updated_at || product.created_at,
        },
        price
          ? {
              label: 'Price list version',
              value: `${price.name || 'Price list'} · v${price.version || 1}`,
              at: price.updated_at || price.created_at,
            }
          : null,
        cost
          ? {
              label: 'Cost version',
              value: cost.version_label || 'cost-version',
              at: cost.created_at || cost.effective_from,
            }
          : null,
      ].filter(Boolean)

      return {
        id: product.id,
        product: product.name,
        sku: product.sku,
        category: product.product_type || 'product',
        owner,
        risk,
        priceList: price
          ? `${formatCurrency(price.list_price)} ${price.currency || 'USD'}`
          : 'Not set',
        listPrice,
        currency: price?.currency || 'USD',
        priceListName: price?.name || 'No active price list',
        priceListId: price?.id || null,
        discount: primaryDiscount
          ? `${primaryDiscount.name} · ${primaryDiscount.value}% ${primaryDiscount.discount_type}`
          : discounts.length
            ? `${discounts.length} active discount rules`
            : 'No active rule',
        discountStructure: discounts.map((item) => ({
          id: item.id,
          name: item.name,
          type: item.discount_type,
          value: item.value,
          floorMarginPct: item.floor_margin_pct,
          status: item.status,
          requiresApproval: Boolean(item.requires_approval),
        })),
        costs: cost
          ? `Direct ${formatCurrency(cost.direct_cost)}, support ${formatCurrency(cost.support_cost)}`
          : 'Not available',
        costComponents,
        contributionMargin:
          contributionMarginPct != null ? `${contributionMarginPct}%` : 'Unavailable',
        contributionMarginPct,
        profitability:
          profitabilityAmount != null ? formatCurrency(profitabilityAmount) : 'Unavailable',
        profitabilityAmount,
        approvalStatus,
        version: price?.version || product.version || 1,
        updatedAt: price?.updated_at || product.updated_at,
        activity: {
          productVersion: product.version,
          priceListVersion: price?.version,
          priceListId: price?.id,
          costVersion: cost?.version_label,
        },
        versionHistory,
        linkedQuotes: linkedQuotes.map((quote) => ({
          id: quote.id,
          quoteNumber: quote.quote_number,
          status: quote.status,
          netAmount: quote.net_amount,
          marginPct: quote.margin_pct,
          quantity: quote.quantity,
        })),
        linkedRecords: [
          price
            ? {
                type: 'price-list',
                id: price.id,
                label: price.name,
                status: price.status,
              }
            : null,
          cost
            ? {
                type: 'cost-version',
                id: cost.id || cost.version_label,
                label: cost.version_label,
                status: cost.status,
              }
            : null,
          ...linkedQuotes.map((quote) => ({
            type: 'quote',
            id: quote.id,
            label: quote.quote_number,
            status: quote.status,
          })),
        ].filter(Boolean),
        permission:
          product.product_type === 'enterprise_licence' ? 'enterpriseData' : 'pricingData',
      }
    }),
    recommendations: recommendations.map((item) => {
      const matchedAi = aiRecommendations.find((entry) =>
        String(item.title || '').includes(entry.product || ''),
      )
      const confidence = toConfidencePct(
        item,
        item.ai_confidence ?? aiRunConfidenceById[item.ai_run_id] ?? matchedAi?.confidencePct,
      )
      return {
        id: item.id,
        segment: item.title,
        action: item.title,
        confidence,
        impact: formatCurrency(item.expected_impact),
        reason: item.rationale,
        guardrail: 'Human approval and policy constraints apply.',
        status: item.status,
      }
    }),
    aiOutputs: recommendations.map((item) => {
      const matchedAi = aiRecommendations.find((entry) =>
        String(item.title || '').includes(entry.product || ''),
      )
      const confidence = toConfidencePct(
        item,
        item.ai_confidence ?? aiRunConfidenceById[item.ai_run_id] ?? matchedAi?.confidencePct,
      )
      return {
        id: item.id,
        title: item.title,
        sourceData: 'Tenant-scoped pricing, revenue, cost and forecast records',
        confidence,
        range: `${formatCurrency(item.confidence_low)}–${formatCurrency(item.confidence_high)}`,
        explanation: item.rationale,
        timestamp: item.updated_at || item.created_at,
        model: ai.modelVersion || 'Backend intelligence service',
      }
    }),
    elasticity: (ai.elasticity || []).map((item) => {
      const recommendation = aiRecommendations.find((entry) => entry.productId === item.productId)
      return {
        product: item.product,
        elasticity: item.elasticity,
        demandShift:
          item.demandShift ||
          `${item.priceSensitivity || 'unknown'} sensitivity`,
        marginImpact:
          item.marginImpact ||
          (recommendation ? formatCurrency(recommendation.expectedUplift) : 'Pending'),
      }
    }),
    notifications,
    deals: quotes,
    savedViews: [
      'Executive margin view',
      'Live revenue view',
      'Pricing review queue',
      'Pricing & deals',
      'Notifications',
    ],
    liveAi: ai,
    users: results.users?.data || [],
    audits: results.audits?.data || [],
    auditPagination: results.audits?.pagination || null,
    configurations,
    outcomes: results.outcomes?.data || [],
    jobs: results.jobs?.data || [],
    deadLetters: results.jobs?.deadLetters || [],
    education,
  }
}

export async function loadIntelligenceData(permissionCodes = []) {
  const canReadFinance =
    permissionCodes.includes('finance:read') || permissionCodes.includes('admin:manage')
  const canReadEnterprise =
    permissionCodes.includes('enterprise:read') || permissionCodes.includes('admin:manage')
  const requests = {
    notifications: intelligenceClient.get('/notifications'),
  }
  const isAdmin = permissionCodes.includes('admin:manage')
  const has = (permission) => isAdmin || permissionCodes.includes(permission)
  if (canReadFinance) {
    Object.assign(requests, {
      products: intelligenceClient.get('/products?limit=100'),
      bridges: intelligenceClient.get('/revenue-bridges'),
      ai: intelligenceClient.get('/ai/revenue-intelligence'),
      recommendations: intelligenceClient.get('/recommendations?limit=100'),
      priceLists: intelligenceClient.get('/price-lists?limit=100'),
      costs: intelligenceClient.get('/costs?limit=100'),
      discounts: intelligenceClient.get('/discounts?limit=100'),
      quotes: intelligenceClient.get('/quotes?limit=100'),
    })
  }
  if (canReadEnterprise && !canReadFinance) {
    Object.assign(requests, {
      products: intelligenceClient.get('/products?limit=100'),
      bridges: intelligenceClient.get('/revenue-bridges'),
      priceLists: intelligenceClient.get('/price-lists?limit=100'),
      costs: intelligenceClient.get('/costs?limit=100'),
      discounts: intelligenceClient.get('/discounts?limit=100'),
      quotes: intelligenceClient.get('/quotes?limit=100'),
    })
  }
  if (has('users:manage')) requests.users = intelligenceClient.get('/users')
  if (has('audits:read')) requests.audits = intelligenceClient.get('/audits?page=1&limit=100')
  if (has('configuration:manage')) requests.configurations = intelligenceClient.get('/configurations')
  if (has('finance:read')) requests.outcomes = intelligenceClient.get('/realised-outcomes')
  if (has('jobs:manage')) requests.jobs = intelligenceClient.get('/jobs')
  if (has('education:read')) {
    for (const resource of ['learners', 'instructors', 'courses', 'lessons', 'enrolments', 'progress', 'assessments', 'certificates', 'subscriptions']) {
      requests[resource] = intelligenceClient.get(`/${resource}?limit=100`)
    }
  }

  const entries = await Promise.allSettled(Object.values(requests))
  const keys = Object.keys(requests)
  const failures = entries.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason)
  const networkFailure = failures.some((error) => !error.status)

  if (networkFailure) {
    return {
      snapshot: intelligenceSnapshot,
      source: 'fallback',
      error: failures.find((error) => !error.status),
    }
  }

  const values = Object.fromEntries(
    entries.flatMap((entry, index) =>
      entry.status === 'fulfilled' ? [[keys[index], entry.value.data]] : [],
    ),
  )
  return {
    snapshot: mergeLiveData(values),
    source: 'api',
    error: failures[0] || null,
  }
}

function idempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
}

const writeConfig = () => ({ headers: { 'Idempotency-Key': idempotencyKey() } })

export async function markNotificationRead(id) {
  const { data } = await intelligenceClient.patch(`/notifications/${id}/read`, { status: 'read' }, writeConfig())
  return data.data
}

export async function archiveNotification(id) {
  const { data } = await intelligenceClient.delete(`/notifications/${id}`, writeConfig())
  return data
}

export async function createUser(input) {
  const { data } = await intelligenceClient.post('/users', input, writeConfig())
  return data.data
}

export async function updateUser(id, input) {
  const { data } = await intelligenceClient.patch(`/users/${id}`, input, writeConfig())
  return data.data
}

export async function updateConfiguration(key, value) {
  const { data } = await intelligenceClient.put(`/configurations/${encodeURIComponent(key)}`, { value }, writeConfig())
  return data
}

export async function searchAudits(search = '', page = 1) {
  const { data } = await intelligenceClient.get(`/audits?search=${encodeURIComponent(search)}&page=${page}&limit=50`)
  return data
}

export async function enqueueReport(payload = {}) {
  const { data } = await intelligenceClient.post('/jobs', {
    jobType: 'report-generation',
    payload,
    maxAttempts: 3,
  }, writeConfig())
  return data.data
}

export async function retryJob(id) {
  const { data } = await intelligenceClient.post(`/jobs/${id}/retry`, {}, writeConfig())
  return data.data
}

export async function updateOutcome(id, input) {
  const { data } = await intelligenceClient.patch(`/realised-outcomes/${id}`, input, writeConfig())
  return data.data
}

export async function evaluateScenario(input) {
  const { data } = await intelligenceClient.post('/scenarios/evaluate', input, writeConfig())
  return data.data || data
}

export function downloadCsv(filename, rows) {
  const values = rows.map((row) => Array.isArray(row) ? row : Object.values(row))
  const csv = values.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function reviewRecommendation(id, decision, reason) {
  if (!reason?.trim()) throw new IntelligenceApiError('A review reason is required.')
  const { data } = await intelligenceClient.post(
    `/recommendations/${id}/review`,
    {
      decision,
      reason: reason.trim(),
      ...(decision === 'overridden' ? { overrideReason: reason.trim() } : {}),
    },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  )
  return data
}

export async function submitAiFeedback(id, decision, reason) {
  if (!reason?.trim()) throw new IntelligenceApiError('A feedback reason is required.')
  const { data } = await intelligenceClient.post(
    '/ai/feedback',
    {
      recommendationId: id,
      correction: reason.trim(),
      decision,
      ...(decision === 'overridden' ? { overrideReason: reason.trim() } : {}),
    },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  )
  return data
}

export async function approveDeal(quoteId, decision, reason) {
  if (!reason?.trim()) throw new IntelligenceApiError('A deal decision reason is required.')
  const { data } = await intelligenceClient.post(
    `/deal-approvals/${quoteId}`,
    { decision, reason: reason.trim() },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  )
  return data
}
