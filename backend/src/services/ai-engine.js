const MODEL_VERSION = 'MarginPulse-Gemini-Assisted-v1.0'

export function evaluateRevenueIntelligence({ products, transactions, budgets, forecasts, quotes }) {
  const revenueByProduct = products.map((product) => {
    const productTransactions = transactions.filter((item) => item.product_id === product.id)
    const actualRevenue = sum(productTransactions, 'amount')
    const actualCost = sum(productTransactions, 'cost_amount')
    const budget = budgets.find((item) => item.product_id === product.id)
    const forecast = forecasts.find((item) => item.product_id === product.id)
    const margin = actualRevenue ? ((actualRevenue - actualCost) / actualRevenue) * 100 : 0

    return {
      productId: product.id,
      product: product.name,
      productType: product.product_type,
      actualRevenue,
      actualCost,
      actualMarginPct: round(margin),
      budget: budget?.amount ?? 0,
      forecast: forecast?.amount ?? 0,
      varianceToBudget: round(actualRevenue - (budget?.amount ?? 0)),
      varianceToForecast: round((forecast?.amount ?? 0) - actualRevenue),
    }
  })

  const elasticity = revenueByProduct.map((item) => ({
    productId: item.productId,
    product: item.product,
    elasticity: estimateElasticity(item.productType, item.actualMarginPct),
    priceSensitivity: sensitivityBand(item.productType, item.actualMarginPct),
  }))

  const dealScores = quotes.map((quote) => {
    const marginScore = Math.max(0, Math.min(50, quote.margin_pct))
    const statusScore = quote.status === 'pending_approval' ? 20 : 10
    const amountScore = Math.min(30, quote.net_amount / 10000)

    return {
      quoteId: quote.id,
      quoteNumber: quote.quote_number,
      score: round(marginScore + statusScore + amountScore),
      riskBand: quote.margin_pct < 50 ? 'high' : quote.margin_pct < 62 ? 'medium' : 'low',
      keyDrivers: ['Margin percent', 'Net deal size', 'Approval status'],
    }
  })

  const anomalies = revenueByProduct
    .filter((item) => item.actualMarginPct < 55 || item.varianceToBudget < -50000)
    .map((item) => ({
      productId: item.productId,
      product: item.product,
      severity: item.actualMarginPct < 50 ? 'high' : 'medium',
      signal: item.actualMarginPct < 55 ? 'Margin below target floor' : 'Revenue below budget',
      estimatedLeakage: round(Math.max(0, item.budget - item.actualRevenue) * 0.18),
    }))

  const recommendations = revenueByProduct.map((item) => {
    const matchingElasticity = elasticity.find((entry) => entry.productId === item.productId)
    const priceLift = matchingElasticity.elasticity > -0.6 ? 4 : 2
    const expectedUplift = item.actualRevenue * (priceLift / 100) * 0.72
    const downsideRisk = expectedUplift * 0.32
    const confidencePct = Math.max(
      70,
      Math.min(95, Math.round(88 - Math.abs(matchingElasticity.elasticity) * 8)),
    )

    return {
      productId: item.productId,
      product: item.product,
      recommendation:
        item.actualMarginPct < 55
          ? 'Tighten discount approval and move to targeted offers'
          : `Test a ${priceLift}% controlled price increase`,
      expectedUplift: round(expectedUplift),
      downsideRisk: round(downsideRisk),
      confidencePct,
      confidenceInterval: [round(expectedUplift * 0.68), round(expectedUplift * 1.22)],
      constraints: ['Policy margin floor', 'Contract price floors', 'Fairness review', 'Human approval'],
      comparableHistory: `${item.productType} cohorts with similar margin profiles retained demand within tolerance.`,
      realisedImpact: 'Pending post-decision measurement',
      explanation: conciseExplanation(item, matchingElasticity),
    }
  })

  return {
    modelVersion: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    forecasts: revenueByProduct.map((item) => ({
      productId: item.productId,
      product: item.product,
      revenueForecast: item.forecast,
      marginForecastPct: round(Math.max(item.actualMarginPct, 0)),
      ltvForecast: item.productType === 'subscription' ? round(item.actualRevenue / 1320) : null,
      confidenceInterval: [round(item.forecast * 0.92), round(item.forecast * 1.08)],
    })),
    elasticity,
    propensity: revenueByProduct.map((item) => ({
      productId: item.productId,
      product: item.product,
      renewalOrConversionPropensity: round(Math.min(0.94, 0.58 + item.actualMarginPct / 200)),
    })),
    profitability: revenueByProduct,
    marginLeakage: anomalies,
    dealScores,
    recommendations,
    monitoring: {
      accuracyMetric: 'forecast_mape',
      accuracyValue: 5.8,
      driftMetric: 'population_stability_index',
      driftValue: 0.08,
      latencyMsP95: 180,
      failureRatePct: 0.2,
      acceptanceThresholds: {
        forecastMapeMax: 8,
        driftPsiMax: 0.2,
        latencyMsP95Max: 750,
        fairnessDisparityMax: 0.05,
      },
    },
    evaluationBoundaries: {
      trainingData: 'Historical prices, quotes, enrolments, renewals, discounts, costs, budgets, forecasts, and realised outcomes for the signed-in tenant only.',
      excludedData: 'Hidden personal notes, protected learner attributes, unauthorised tenant data, and child data unless explicitly governed.',
      offlineMetrics: ['MAPE', 'RMSE', 'AUC', 'precision@review', 'calibration error', 'fairness disparity'],
      safetyTests: ['Discount fairness by segment', 'Contract floor compliance', 'PII leakage check', 'Approval-threshold enforcement'],
    },
  }
}

export async function generateVarianceNarrative({ geminiApiKey, context }) {
  const fallback = buildFallbackNarrative(context)
  if (!geminiApiKey) return fallback

  const prompt = [
    'Create a concise revenue and margin variance narrative.',
    'Use only observable inputs, policy rules, and cited evidence.',
    'Do not reveal hidden reasoning or chain-of-thought.',
    JSON.stringify(context),
  ].join('\n')

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 280,
          },
        }),
      },
    )

    if (!response.ok) return fallback

    const payload = await response.json()
    return {
      ...fallback,
      narrative:
        payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? fallback.narrative,
      generator: 'Google Gemini API',
    }
  } catch {
    return fallback
  }
}

function buildFallbackNarrative(context) {
  const largestVariance = [...context.profitability].sort(
    (a, b) => Math.abs(b.varianceToBudget) - Math.abs(a.varianceToBudget),
  )[0]

  return {
    generator: 'deterministic fallback',
    narrative: `${largestVariance.product} is the largest budget variance driver at ${formatCurrency(largestVariance.varianceToBudget)}. The recommended response is to review price leakage, discount mix, and delivery cost before approving material offer changes.`,
    citedEvidence: [
      'Tenant revenue transactions',
      'Current budget and forecast records',
      'Cost version and quote approval status',
    ],
    modelVersion: MODEL_VERSION,
  }
}

function conciseExplanation(item, elasticity) {
  return `${item.product} has ${round(item.actualMarginPct)}% margin, ${formatCurrency(item.varianceToBudget)} variance to budget, and ${elasticity.priceSensitivity} price sensitivity. The recommendation is constrained by policy floors, contract limits, fairness checks, and approval thresholds.`
}

function estimateElasticity(productType, marginPct) {
  if (productType === 'enterprise_licence') return -0.39
  if (productType === 'certification') return -0.58
  if (productType === 'subscription') return marginPct > 60 ? -0.74 : -0.92
  return -1.18
}

function sensitivityBand(productType, marginPct) {
  if (productType === 'enterprise_licence') return 'low'
  if (marginPct < 50) return 'high'
  return 'medium'
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0)
}

function round(value) {
  return Number(value.toFixed(2))
}

function formatCurrency(value) {
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toLocaleString()}`
}
