import { z } from 'zod'

export function errorHandler(error, _req, res, _next) {
  void _next

  if (error.type === 'entity.parse.failed') {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body contains invalid JSON.',
      },
    })
    return
  }

  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: error.flatten(),
      },
    })
    return
  }

  if (/UNIQUE constraint failed/i.test(error.message ?? '')) {
    res.status(409).json({
      error: {
        code: 'RESOURCE_CONFLICT',
        message: 'A record with the same unique value already exists.',
      },
    })
    return
  }

  if (/(CHECK|FOREIGN KEY|NOT NULL) constraint failed/i.test(error.message ?? '')) {
    res.status(400).json({
      error: {
        code: 'INVALID_RESOURCE_DATA',
        message: 'The submitted values violate a resource constraint.',
      },
    })
    return
  }

  const status = error.status ?? 500
  res.status(status).json({
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: status === 500 ? 'Unexpected server error.' : error.message,
      details: error.details,
    },
  })
}
