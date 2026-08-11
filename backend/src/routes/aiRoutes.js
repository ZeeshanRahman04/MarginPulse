import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { config } from '../config/env.js'
import { feedbackSchema } from '../config/schemas.js'
import { get, run, saveDatabase } from '../db/database.js'
import { permit } from '../middleware/auth.js'
import { idempotent } from '../middleware/idempotency.js'
import { validate } from '../middleware/validate.js'
import {
  evaluateRevenueIntelligence,
  generateVarianceNarrative,
} from '../services/ai-engine.js'
import { ApiError } from '../utils/errors.js'
import { audit, loadAiContext, tenantRow } from '../utils/helpers.js'

export function createAiRoutes(db) {
  const router = Router()

  router.get('/ai/revenue-intelligence', permit('finance:read'), async (req, res) => {
    const context = loadAiContext(db, req.user.organisationId)
    const intelligence = evaluateRevenueIntelligence(context)
    const modelVersion = get(
      db,
      `SELECT * FROM model_versions
       WHERE organisation_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.organisationId],
    )
    if (!modelVersion) {
      throw new ApiError(503, 'MODEL_NOT_CONFIGURED', 'No active AI model version is configured.')
    }
    const runId = uuid()
    const now = new Date().toISOString()
    const explanation =
      'Revenue intelligence generated from tenant products, posted transactions, budgets, forecasts, and active quotes.'
    run(
      db,
      `INSERT INTO ai_runs
       (id, organisation_id, model_version_id, input_data_json, output_json, confidence, explanation,
        status, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?)`,
      [
        runId,
        req.user.organisationId,
        modelVersion.id,
        JSON.stringify({
          productCount: context.products?.length || 0,
          transactionCount: context.transactions?.length || 0,
          quoteCount: context.quotes?.length || 0,
        }),
        JSON.stringify(intelligence),
        0.86,
        explanation,
        now,
        now,
        now,
      ],
    )
    const persistedRecommendations = intelligence.recommendations.map((recommendation) => {
      const title = `${recommendation.product}: ${recommendation.recommendation}`
      const existingRecommendation = get(
        db,
        `SELECT id FROM recommendations
         WHERE organisation_id = ? AND title = ? AND status IN ('draft','needs_review')
         ORDER BY created_at DESC LIMIT 1`,
        [req.user.organisationId, title],
      )
      if (existingRecommendation) {
        run(db, 'UPDATE recommendations SET ai_run_id = ?, updated_at = ? WHERE id = ?', [
          runId,
          now,
          existingRecommendation.id,
        ])
        return { ...recommendation, id: existingRecommendation.id, aiRunId: runId }
      }
      const id = uuid()
      run(
        db,
        `INSERT INTO recommendations
         (id, organisation_id, ai_run_id, title, recommendation_type, expected_impact,
          confidence_low, confidence_high, assumptions_json, rationale, status, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, 'pricing', ?, ?, ?, ?, ?, 'draft', ?, ?, 1)`,
        [
          id,
          req.user.organisationId,
          runId,
          title,
          recommendation.expectedUplift,
          recommendation.confidenceInterval[0],
          recommendation.confidenceInterval[1],
          JSON.stringify(recommendation.constraints),
          recommendation.explanation,
          now,
          now,
        ],
      )
      return { ...recommendation, id, aiRunId: runId }
    })
    audit(db, req.user.organisationId, req.user.id, 'ai.execute', 'ai_run', runId, {
      modelVersion: intelligence.modelVersion,
      capabilities: [
        'elasticity',
        'deal_scoring',
        'anomaly_detection',
        'recommendations',
        'forecasting',
      ],
    })
    await saveDatabase(db)
    res.json({
      ...intelligence,
      aiRunId: runId,
      recommendations: persistedRecommendations,
      safety: {
        chainOfThought: 'not exposed',
        explanationPolicy:
          'Concise explanations use observable inputs, policy rules, model factors, and cited evidence only.',
        constraints: ['cost', 'contract', 'policy', 'fairness', 'approval'],
      },
    })
  })

  router.get('/ai/variance-narrative', permit('finance:read'), async (req, res) => {
    const context = evaluateRevenueIntelligence(loadAiContext(db, req.user.organisationId))
    const narrative = await generateVarianceNarrative({
      geminiApiKey: config.geminiApiKey,
      context,
    })
    audit(db, req.user.organisationId, req.user.id, 'ai.variance_narrative', 'ai_run', null, {
      generator: narrative.generator,
      modelVersion: narrative.modelVersion,
      geminiConfigured: Boolean(config.geminiApiKey),
    })
    await saveDatabase(db)
    res.json(narrative)
  })

  router.post(
    '/ai/feedback',
    permit('deals:approve'),
    validate(feedbackSchema),
    idempotent(db),
    async (req, res) => {
      const recommendation = tenantRow(
        db,
        'recommendations',
        req.body.recommendationId,
        req.user.organisationId,
      )
      if (!recommendation) {
        throw new ApiError(404, 'RECOMMENDATION_NOT_FOUND', 'Recommendation was not found.')
      }
      if (req.body.decision === 'overridden') {
        if (
          !req.user.permissions.includes('ai:override') &&
          !req.user.permissions.includes('admin:manage')
        ) {
          throw new ApiError(403, 'FORBIDDEN', 'Missing permission: ai:override')
        }
        if (!req.body.overrideReason) {
          throw new ApiError(400, 'OVERRIDE_REASON_REQUIRED', 'Override reason is required.')
        }
      }
      const aiRun = recommendation.ai_run_id
        ? get(
            db,
            'SELECT id, input_data_json FROM ai_runs WHERE id = ? AND organisation_id = ?',
            [recommendation.ai_run_id, req.user.organisationId],
          )
        : null

      const now = new Date().toISOString()
      run(db, 'INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?)', [
        uuid(),
        req.user.organisationId,
        'recommendation',
        recommendation.id,
        req.user.id,
        req.body.correction,
        now,
      ])
      if (req.body.decision === 'overridden') {
        run(db, 'INSERT INTO overrides VALUES (?, ?, ?, ?, ?, ?)', [
          uuid(),
          req.user.organisationId,
          recommendation.id,
          req.user.id,
          req.body.overrideReason,
          now,
        ])
      }
      audit(
        db,
        req.user.organisationId,
        req.user.id,
        `ai.feedback.${req.body.decision}`,
        'recommendation',
        recommendation.id,
        {
          correctionCaptured: true,
          overrideReason: req.body.overrideReason ?? null,
        },
      )
      await saveDatabase(db)
      res.json({
        recommendationId: recommendation.id,
        feedbackCaptured: true,
        decision: req.body.decision,
        modelTrace: {
          aiRunId: aiRun?.id ?? null,
          inputSnapshotStored: Boolean(aiRun?.input_data_json),
        },
      })
    },
  )

  return router
}
