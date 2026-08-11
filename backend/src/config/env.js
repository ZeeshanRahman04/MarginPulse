import path from 'node:path'

const nodeEnv = process.env.NODE_ENV ?? 'development'
const STABLE_DEMO_JWT_SECRET = 'dev-only-change-me'
const allowInsecureDemoJwt = process.env.ALLOW_INSECURE_DEMO_JWT === '1'
const jwtSecret =
  process.env.JWT_SECRET ??
  (nodeEnv === 'production' && !allowInsecureDemoJwt ? null : STABLE_DEMO_JWT_SECRET)

if (!jwtSecret) {
  throw new Error('JWT_SECRET is required when NODE_ENV=production.')
}

if (nodeEnv === 'production' && allowInsecureDemoJwt) {
  console.warn(
    'Demo JWT fallback is enabled (ALLOW_INSECURE_DEMO_JWT=1). Set a real JWT_SECRET for any non-demo deployment.',
  )
}

const configuredDatabasePath = process.env.DATABASE_PATH?.trim() || ''
const memoryDatabase =
  configuredDatabasePath === ':memory:' || process.env.DATABASE_EPHEMERAL === '1'
const databasePath = memoryDatabase
  ? null
  : configuredDatabasePath
    ? path.resolve(configuredDatabasePath)
    : null

/** Always allowed — Vite dev (:5173) and preview (:4173) on loopback. */
export const VITE_LOCAL_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

const defaultOrigins = [
  ...VITE_LOCAL_ORIGINS,
  'http://localhost:8080',
  'http://127.0.0.1:8080',
].join(',')

// Demo default: allow other localhost / 127.0.0.1 browser origins (any port) even when
// ALLOWED_ORIGINS is production-only. Vite :5173/:4173 are always allowed separately.
// Set ALLOW_LOCAL_ORIGINS=0 to require an explicit allow-list entry for non-Vite loopback.
const allowLocalOrigins = process.env.ALLOW_LOCAL_ORIGINS !== '0'

export const config = {
  nodeEnv,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  jwtRefreshExpiresInRemembered: process.env.JWT_REFRESH_EXPIRES_IN_REMEMBERED ?? '30d',
  geminiApiKey: process.env.GEMINI_API_KEY,
  databasePath,
  memoryDatabase,
  allowLocalOrigins,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? defaultOrigins)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
}

/** Loopback browser origins used by Vite / preview / docker local demos. */
export function isLocalDemoOrigin(origin) {
  if (!origin) return false
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

export function isOriginAllowed(origin) {
  if (!origin) return true
  if (VITE_LOCAL_ORIGINS.includes(origin)) return true
  if (config.allowedOrigins.includes(origin)) return true
  if (config.allowLocalOrigins && isLocalDemoOrigin(origin)) return true
  return false
}
