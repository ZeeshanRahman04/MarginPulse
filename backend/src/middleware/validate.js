import { ApiError } from '../utils/errors.js'

export function validate(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      next(new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.', parsed.error.flatten()))
      return
    }
    req.body = parsed.data
    next()
  }
}
