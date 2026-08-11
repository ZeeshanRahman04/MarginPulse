import { ApiError } from '../utils/errors.js'

const rateLimitBuckets = new Map()

export function rateLimit(namespace, limit, windowMs) {
  return (req, _res, next) => {
    const key = `${namespace}:${req.ip ?? 'local'}`
    const now = Date.now()
    const bucket = rateLimitBuckets.get(key) ?? { count: 0, resetAt: now + windowMs }

    if (now > bucket.resetAt) {
      bucket.count = 0
      bucket.resetAt = now + windowMs
    }

    bucket.count += 1
    rateLimitBuckets.set(key, bucket)

    if (bucket.count > limit) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again later.')
    }

    next()
  }
}
