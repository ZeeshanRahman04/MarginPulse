import path from 'node:path'
import { pathToFileURL } from 'node:url'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { config, isOriginAllowed } from './config/env.js'
import { all, initDatabase } from './db/database.js'
import { startJobRunner } from './jobs/jobRunner.js'
import { errorHandler } from './middleware/errorHandler.js'
import { createApiRouter } from './routes/index.js'
import { ApiError } from './utils/errors.js'

export async function createApp() {
  const db = await initDatabase()
  const app = express()

  app.use(helmet())
  app.use(
    cors({
      origin(origin, callback) {
        if (isOriginAllowed(origin)) {
          callback(null, true)
          return
        }
        callback(new ApiError(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed.'))
      },
      credentials: false,
    }),
  )
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'margin-pulse-api',
      database: config.memoryDatabase ? 'sqlite-memory' : 'sqlite',
      jobs: all(db, 'SELECT status, COUNT(*) AS count FROM background_jobs GROUP BY status'),
      timestamp: new Date().toISOString(),
    })
  })

  app.use('/api/v1', createApiRouter(db))
  app.use(errorHandler)
  startJobRunner(db)

  return app
}

const isDirectRun =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isDirectRun) {
  const app = await createApp()
  app.listen(config.port, () => {
    console.log(`MarginPulse API listening on http://localhost:${config.port}`)
  })
}
