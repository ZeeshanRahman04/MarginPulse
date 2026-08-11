import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { auditDataAccess } from '../middleware/auditAccess.js'
import { createAiRoutes } from './aiRoutes.js'
import { createAnalyticsRoutes } from './analyticsRoutes.js'
import { createAuthRoutes } from './authRoutes.js'
import { createResourceRoutes } from './resourceRoutes.js'
import { createSystemRoutes } from './systemRoutes.js'

export function createApiRouter(db) {
  const router = Router()

  router.use(createAuthRoutes(db))
  router.use(authenticate(db))
  router.use(auditDataAccess(db))
  router.use(createSystemRoutes(db))
  router.use(createAnalyticsRoutes(db))
  router.use(createAiRoutes(db))
  // Parameterized resource route must stay last.
  router.use(createResourceRoutes(db))

  return router
}
