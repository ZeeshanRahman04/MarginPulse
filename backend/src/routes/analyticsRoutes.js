import { Router } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import {
  approvalSchema,
  marginSchema,
  reviewSchema,
  scenarioSchema,
} from '../config/schemas.js'
import { all, get, run, saveDatabase } from '../db/database.js'
import { idempotent } from '../middleware/idempotency.js'
import { permit, permitAny } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { ApiError } from '../utils/errors.js'
import { audit, tenantRow } from '../utils/helpers.js'

export function createAnalyticsRoutes(db) {
  const router = Router()

  router.get('/revenue-bridges', permitAny('finance:read', 'enterprise:read'), (req, res) => {
    const enterpriseOnly =
      req.user.permissions.includes('enterprise:read') &&
      !req.user.permissions.includes('finance:read') &&
      !req.user.permissions.includes('admin:manage')
    const data = all(
      db,
      `SELECT p.id AS productId, p.name AS product, p.product_type AS productType,
              COALESCE(SUM(t.amount), 0) AS actual,
              COALESCE(MAX(b.amount), 0) AS budget,
              COALESCE(MAX(f.amount), 0) AS forecast,
              COALESCE(SUM(t.amount), 0) - COALESCE(MAX(b.amount), 0) AS varianceToBudget,
              COALESCE(MAX(f.amount), 0) - COALESCE(SUM(t.amount), 0) AS bridgeToForecast
       FROM products p
       LEFT JOIN transactions t ON t.product_id = p.id AND t.status = 'posted'
       LEFT JOIN budgets b ON b.product_id = p.id
       LEFT JOIN forecasts f ON f.product_id = p.id
       WHERE p.organisation_id = ? AND p.deleted_at IS NULL
         ${enterpriseOnly ? "AND p.product_type = 'enterprise_licence'" : ''}
       GROUP BY p.id
       ORDER BY actual DESC`,
      [req.user.organisationId],
    )
    res.json({ data, generatedAt: new Date().toISOString() })
  })

  router.post('/contribution-margin', permit('finance:read'), validate(marginSchema), (req, res) => {
    const product = tenantRow(db, 'products', req.body.productId, req.user.organisationId)
    if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.')

    const cost = get(
      db,
      `SELECT * FROM cost_versions
       WHERE organisation_id = ? AND product_id = ? AND status = 'active'
       ORDER BY effective_from DESC LIMIT 1`,
      [req.user.organisationId, req.body.productId],
    )
    const variableCosts =
      req.body.variableCosts ??
      (cost
        ? cost.direct_cost +
          cost.instructor_cost +
          cost.mentor_cost +
          cost.support_cost +
          cost.content_cost
        : 0)
    const netRevenue = req.body.revenue - req.body.discountAmount
    const contribution = netRevenue - variableCosts

    res.json({
      product: product.name,
      netRevenue,
      variableCosts,
      contribution,
      marginPct: Number(((contribution / netRevenue) * 100).toFixed(2)),
      costVersion: cost?.version_label ?? 'manual',
    })
  })

  router.get('/price-waterfall', permit('finance:read'), (req, res) => {
    const quoteId = z.string().uuid().parse(req.query.quoteId)
    const quote = tenantRow(db, 'quotes', quoteId, req.user.organisationId)
    if (!quote) throw new ApiError(404, 'QUOTE_NOT_FOUND', 'Quote was not found.')

    const priceList = tenantRow(db, 'price_lists', quote.price_list_id, req.user.organisationId)
    const discount = quote.discount_id
      ? tenantRow(db, 'discounts', quote.discount_id, req.user.organisationId)
      : null
    const gross = priceList.list_price * quote.quantity
    const discountAmount = discount ? gross * (discount.value / 100) : gross - quote.net_amount

    res.json({
      quoteNumber: quote.quote_number,
      waterfall: [
        { label: 'List price', value: gross },
        { label: 'Discounts and promotions', value: -discountAmount },
        { label: 'Net price', value: quote.net_amount },
      ],
      marginPct: quote.margin_pct,
      floorLeakage: quote.margin_pct < (discount?.floor_margin_pct ?? 0),
      approvalStatus: quote.status,
    })
  })

  router.get('/variance-analysis', permit('finance:read'), (req, res) => {
    const period = z.string().default('2026-Q3').parse(req.query.period)
    const data = all(
      db,
      `SELECT p.name AS product, b.period, b.amount AS budget,
              COALESCE(SUM(t.amount), 0) AS actual,
              f.amount AS forecast,
              COALESCE(SUM(t.amount), 0) - b.amount AS budgetVariance,
              f.amount - COALESCE(SUM(t.amount), 0) AS forecastVariance
       FROM budgets b
       JOIN products p ON p.id = b.product_id
       LEFT JOIN transactions t ON t.product_id = p.id AND t.status = 'posted'
       LEFT JOIN forecasts f ON f.product_id = p.id AND f.period = b.period
       WHERE b.organisation_id = ? AND b.period = ?
       GROUP BY b.id`,
      [req.user.organisationId, period],
    )
    res.json({ period, data })
  })

  router.post(
    '/deal-approvals/:quoteId',
    permit('deals:approve'),
    validate(approvalSchema),
    idempotent(db),
    async (req, res) => {
      const quote = tenantRow(db, 'quotes', req.params.quoteId, req.user.organisationId)
      if (!quote) throw new ApiError(404, 'QUOTE_NOT_FOUND', 'Quote was not found.')

      const now = new Date().toISOString()
      run(db, 'UPDATE quotes SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?', [
        req.body.decision,
        now,
        quote.id,
      ])
      run(db, 'INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        uuid(),
        req.user.organisationId,
        'quote',
        quote.id,
        req.user.id,
        req.body.decision,
        req.body.reason ?? null,
        now,
        now,
      ])
      audit(db, req.user.organisationId, req.user.id, `quote.${req.body.decision}`, 'quote', quote.id, req.body)
      await saveDatabase(db)
      res.json({ quoteId: quote.id, decision: req.body.decision, decidedAt: now })
    },
  )

  router.post('/scenarios/evaluate', permit('finance:read'), validate(scenarioSchema), (req, res) => {
    const product = tenantRow(db, 'products', req.body.productId, req.user.organisationId)
    if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product was not found.')

    const price = get(
      db,
      `SELECT * FROM price_lists
       WHERE organisation_id = ? AND product_id = ? AND status = 'active'
       ORDER BY effective_from DESC LIMIT 1`,
      [req.user.organisationId, product.id],
    )
    const baseline = price?.list_price ?? 0
    const simulatedPrice = baseline * (1 + req.body.priceChangePct / 100)
    const netPrice = simulatedPrice * (1 - req.body.discountPct / 100)
    const costVersion = get(
      db,
      `SELECT * FROM cost_versions
       WHERE organisation_id = ? AND product_id = ? AND status = 'active'
       ORDER BY effective_from DESC LIMIT 1`,
      [req.user.organisationId, product.id],
    )
    const unitCost = costVersion
      ? costVersion.direct_cost +
        costVersion.instructor_cost +
        costVersion.mentor_cost +
        costVersion.support_cost +
        costVersion.content_cost
      : 0
    const resultingMarginPct = netPrice > 0 ? ((netPrice - unitCost) / netPrice) * 100 : 0
    const elasticity = product.product_type === 'enterprise_licence' ? -0.39 : -1.12
    const demandChangePct = elasticity * req.body.priceChangePct
    const impact = (netPrice - baseline) * (1 + demandChangePct / 100)
    const violations = []

    if (
      req.body.constraints.ceilingDiscountPct != null &&
      req.body.discountPct > req.body.constraints.ceilingDiscountPct
    ) {
      violations.push('Discount exceeds configured ceiling.')
    }
    if (req.body.constraints.contractFloorPrice && netPrice < req.body.constraints.contractFloorPrice) {
      violations.push('Net price is below contract floor.')
    }
    if (
      req.body.constraints.floorMarginPct != null &&
      resultingMarginPct < req.body.constraints.floorMarginPct
    ) {
      violations.push('Resulting margin is below the configured floor.')
    }

    res.json({
      product: product.name,
      baseline,
      simulatedPrice,
      netPrice,
      unitCost,
      resultingMarginPct: Number(resultingMarginPct.toFixed(2)),
      costVersion: costVersion?.version_label ?? null,
      elasticity,
      demandChangePct: Number(demandChangePct.toFixed(2)),
      expectedFinancialImpact: Number(impact.toFixed(2)),
      confidenceRange: [Number((impact * 0.72).toFixed(2)), Number((impact * 1.18).toFixed(2))],
      requiresHumanReview:
        Math.abs(impact) >= (req.body.constraints.requiresHumanReviewAboveImpact ?? 50000) ||
        violations.length > 0,
      violations,
      modelVersion: 'MarginPulse-Guidance v2.4',
    })
  })

  router.post(
    '/recommendations/:id/review',
    permit('deals:approve'),
    validate(reviewSchema),
    idempotent(db),
    async (req, res) => {
      const recommendation = tenantRow(db, 'recommendations', req.params.id, req.user.organisationId)
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

      const now = new Date().toISOString()
      const recommendationStatus = {
        approved: 'approved',
        rejected: 'rejected',
        overridden: 'overridden',
        deferred: 'needs_review',
        escalated: 'needs_review',
        closed: 'realised',
      }[req.body.decision]
      const approvalDecision = {
        approved: 'approved',
        rejected: 'rejected',
        overridden: 'overridden',
        deferred: 'pending',
        escalated: 'pending',
        closed: 'approved',
      }[req.body.decision]
      run(db, 'UPDATE recommendations SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?', [
        recommendationStatus,
        now,
        recommendation.id,
      ])
      run(db, 'INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        uuid(),
        req.user.organisationId,
        'recommendation',
        recommendation.id,
        req.user.id,
        approvalDecision,
        req.body.overrideReason ?? req.body.reason,
        now,
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
        `recommendation.${req.body.decision}`,
        'recommendation',
        recommendation.id,
        req.body,
      )
      await saveDatabase(db)
      res.json({
        recommendationId: recommendation.id,
        decision: req.body.decision,
        status: recommendationStatus,
        reviewedAt: now,
      })
    },
  )

  router.get('/model-monitoring', permit('finance:read'), (req, res) => {
    res.json({
      data: all(
        db,
        `SELECT mv.model_name, mv.version_label, m.metric_name, m.metric_value, m.measured_at
         FROM model_monitoring_metrics m
         JOIN model_versions mv ON mv.id = m.model_version_id
         WHERE m.organisation_id = ?
         ORDER BY m.measured_at DESC`,
        [req.user.organisationId],
      ),
    })
  })

  return router
}
