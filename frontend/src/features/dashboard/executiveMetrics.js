import { formatMoney } from '../../utils/formatters.js'

const PERIOD_SCALE = {
  'Last 7 days': 0.09,
  'Last month': 0.18,
  Quarter: 0.32,
  'FY26 YTD': 1,
}

function parseMoneyish(value) {
  if (typeof value === 'number') return value
  if (value == null) return 0
  const cleaned = String(value).replace(/[^0-9.-]/g, '')
  return Number(cleaned) || 0
}

function uniqueOptions(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b)),
  )
}

export function periodScale(period) {
  return PERIOD_SCALE[period] ?? 1
}

export function scaleAmount(value, period) {
  return Number(value || 0) * periodScale(period)
}

export function filterExecutiveStreams(streams = [], filters = {}) {
  const {
    search = '',
    region = 'all',
    category = 'all',
    businessUnit = 'all',
    product = 'all',
    owner = 'all',
    risk = 'all',
  } = filters
  const query = search.trim().toLowerCase()

  return streams.filter((row) => {
    if (region !== 'all' && row.location !== region) return false
    if (category !== 'all' && row.category !== category) return false
    if (businessUnit !== 'all' && row.segment !== businessUnit) return false
    if (product !== 'all' && row.stream !== product) return false
    if (owner !== 'all' && row.owner !== owner) return false
    if (risk !== 'all' && (row.risk || 'normal') !== risk) return false
    if (!query) return true
    return [
      row.stream,
      row.segment,
      row.categoryLabel,
      row.owner,
      row.location,
      row.status,
      row.risk,
      row.action,
    ].some((field) => String(field || '').toLowerCase().includes(query))
  })
}

export function filterExecutiveDeals(deals = [], filters = {}, streams = []) {
  const { owner = 'all', risk = 'all', search = '', product = 'all' } = filters
  const query = search.trim().toLowerCase()
  const allowedProducts = new Set(
    streams.map((row) => String(row.stream || '').toLowerCase()).filter(Boolean),
  )

  return deals.filter((deal) => {
    const dealProduct = String(deal.product || deal.product_name || '').toLowerCase()
    if (product !== 'all') {
      if (!dealProduct.includes(String(product).toLowerCase().slice(0, 10))) return false
    } else if (allowedProducts.size && dealProduct) {
      const matched = [...allowedProducts].some(
        (name) => dealProduct.includes(name.split(' ')[0]) || name.includes(dealProduct.split(' ')[0]),
      )
      if (!matched) return false
    }
    if (owner !== 'all' && deal.owner && deal.owner !== owner) return false
    if (risk !== 'all') {
      const dealRisk =
        Number(deal.margin_pct) < 50 ? 'critical' : Number(deal.margin_pct) < 58 ? 'warning' : 'normal'
      if (dealRisk !== risk) return false
    }
    if (!query) return true
    return [deal.quote_number, deal.status, deal.product, deal.product_name].some((field) =>
      String(field || '')
        .toLowerCase()
        .includes(query),
    )
  })
}

export function buildFilterOptions({ streams = [], deals = [], recommendations = [] }) {
  return {
    regions: uniqueOptions(streams, 'location'),
    categories: uniqueOptions(streams, 'category').map((value) => ({
      value,
      label:
        streams.find((row) => row.category === value)?.categoryLabel ||
        String(value).replace(/_/g, ' '),
    })),
    businessUnits: uniqueOptions(streams, 'segment'),
    products: uniqueOptions(streams, 'stream'),
    owners: [
      ...new Set([
        ...streams.map((row) => row.owner),
        ...deals.map((deal) => deal.owner).filter(Boolean),
        ...recommendations.map((item) => item.owner).filter(Boolean),
      ]),
    ]
      .filter(Boolean)
      .sort((a, b) => String(a).localeCompare(String(b))),
    risks: ['normal', 'warning', 'critical'],
  }
}

export function buildExecutiveKpis({
  streams = [],
  pricingRows = [],
  deals = [],
  recommendations = [],
  leakageAlerts = [],
  period = 'FY26 YTD',
}) {
  const moneyStreams = streams.filter((row) => row.currency !== '$/learner')
  const ltv = streams.find((row) => row.category === 'learner_ltv' || row.currency === '$/learner')
  const byCategory = (category) =>
    moneyStreams
      .filter((row) => row.category === category)
      .reduce((sum, row) => sum + scaleAmount(row.actual, period), 0)

  const revenue = moneyStreams.reduce((sum, row) => sum + scaleAmount(row.actual, period), 0)
  const profit = pricingRows.length
    ? pricingRows.reduce((sum, row) => sum + scaleAmount(row.profitabilityAmount || 0, period), 0)
    : revenue * 0.58
  const marginPts = pricingRows.length
    ? pricingRows.reduce((sum, row) => sum + Number(row.contributionMarginPct || 0), 0) /
      Math.max(pricingRows.length, 1)
    : moneyStreams.length
      ? 58 +
        moneyStreams.reduce((sum, row) => sum + Number(row.variancePct || 0), 0) /
          Math.max(moneyStreams.length, 1) /
          4
      : 0

  const forecastAccuracy = (() => {
    const scored = moneyStreams.filter((row) => Number(row.forecast))
    if (!scored.length) return 0
    const avgError =
      scored.reduce((sum, row) => {
        const forecast = Math.abs(Number(row.forecast) || 1)
        return sum + Math.abs(Number(row.forecastGap) || 0) / forecast
      }, 0) / scored.length
    return Math.max(0, Math.min(99, Math.round((1 - avgError) * 100)))
  })()

  const activeDeals = deals.filter((deal) =>
    ['pending_approval', 'approved', 'contracted', 'draft'].includes(String(deal.status || '')),
  ).length
  const pendingApprovals =
    deals.filter((deal) => deal.status === 'pending_approval').length +
    recommendations.filter((item) => item.status && item.status !== 'approved').length

  const leakage = leakageAlerts.reduce((sum, item) => sum + parseMoneyish(item.exposure), 0)

  const compact = (value, unit = '$') => {
    if (unit === '%') return `${Math.round(value)}%`
    if (unit === 'count') return String(Math.round(value))
    return formatMoney(value, unit)
  }

  return [
    {
      id: 'revenue',
      label: 'Revenue',
      value: compact(revenue),
      trend: period,
      tone: 'good',
      raw: revenue,
    },
    {
      id: 'profit',
      label: 'Profit',
      value: compact(profit),
      trend: marginPts >= 55 ? 'Healthy contribution' : 'Below target',
      tone: marginPts >= 55 ? 'good' : 'warning',
      raw: profit,
    },
    {
      id: 'margin',
      label: 'Margin',
      value: compact(marginPts, '%'),
      trend: `${marginPts >= 0 ? '+' : ''}${marginPts.toFixed(1)} pts blend`,
      tone: marginPts >= 55 ? 'good' : 'warning',
      raw: marginPts,
    },
    {
      id: 'forecast-accuracy',
      label: 'Forecast Accuracy',
      value: compact(forecastAccuracy, '%'),
      trend: 'vs latest forecast',
      tone: forecastAccuracy >= 85 ? 'good' : 'warning',
      raw: forecastAccuracy,
    },
    {
      id: 'ai-recommendations',
      label: 'AI Recommendations',
      value: compact(recommendations.length, 'count'),
      trend: `${pendingApprovals} need review`,
      tone: recommendations.length ? 'good' : 'warning',
      raw: recommendations.length,
    },
    {
      id: 'active-deals',
      label: 'Active Deals',
      value: compact(activeDeals || deals.length, 'count'),
      trend: 'In commercial pipeline',
      tone: 'good',
      raw: activeDeals || deals.length,
    },
    {
      id: 'pending-approvals',
      label: 'Pending Approvals',
      value: compact(pendingApprovals, 'count'),
      trend: 'Quotes + AI reviews',
      tone: pendingApprovals ? 'danger' : 'good',
      raw: pendingApprovals,
    },
    {
      id: 'margin-leakage',
      label: 'Margin Leakage',
      value: compact(scaleAmount(leakage, period)),
      trend: `${leakageAlerts.length} open alerts`,
      tone: leakage ? 'warning' : 'good',
      raw: leakage,
    },
    {
      id: 'ltv',
      label: 'Customer Lifetime Value',
      value: formatMoney(scaleAmount(ltv?.actual || 0, period), '$/learner'),
      trend: ltv?.status || 'Learner economics',
      tone: Number(ltv?.variance || 0) >= 0 ? 'good' : 'warning',
      raw: Number(ltv?.actual || 0),
    },
    {
      id: 'subscriptions',
      label: 'Subscription Revenue',
      value: compact(byCategory('subscriptions')),
      trend: 'Recurring book',
      tone: 'good',
      raw: byCategory('subscriptions'),
    },
    {
      id: 'enterprise',
      label: 'Enterprise Licenses',
      value: compact(byCategory('enterprise_licences')),
      trend: 'B2B licences',
      tone: 'good',
      raw: byCategory('enterprise_licences'),
    },
    {
      id: 'courses',
      label: 'Course Revenue',
      value: compact(byCategory('course_fees')),
      trend: 'Cohort fees',
      tone: byCategory('course_fees') ? 'good' : 'warning',
      raw: byCategory('course_fees'),
    },
    {
      id: 'certifications',
      label: 'Certification Revenue',
      value: compact(byCategory('certifications')),
      trend: 'Credential renewals',
      tone: 'good',
      raw: byCategory('certifications'),
    },
  ]
}

export function buildRevenueTrend(streams = [], period = 'FY26 YTD') {
  const labels = ['W1', 'W2', 'W3', 'W4', 'W5']
  const moneyStreams = streams.filter((row) => row.currency !== '$/learner')
  if (!moneyStreams.length) return []

  return labels.map((label, index) => {
    const actual = moneyStreams.reduce((sum, row) => {
      const point = Array.isArray(row.trend) ? row.trend[index] : 60 + index * 3
      const ratio = Number(point || 60) / 100
      return sum + scaleAmount(Number(row.actual || 0) * ratio, period)
    }, 0)
    const forecast = moneyStreams.reduce((sum, row) => {
      const point = Array.isArray(row.trend) ? row.trend[index] : 60 + index * 3
      const ratio = (Number(point || 60) + 4) / 100
      return sum + scaleAmount(Number(row.forecast || row.actual || 0) * ratio, period)
    }, 0)
    return { label, actual, forecast, budget: actual * 0.94 }
  })
}

export function buildMarginWaterfall(pricingRows = [], period = 'FY26 YTD') {
  if (!pricingRows.length) {
    const list = scaleAmount(1000000, period)
    const discounts = -scaleAmount(120000, period)
    const costs = -scaleAmount(280000, period)
    return [
      { name: 'List', value: list, fill: 'ink' },
      { name: 'Discounts', value: discounts, fill: 'danger' },
      { name: 'Delivery cost', value: costs, fill: 'warning' },
      { name: 'Contribution', value: list + discounts + costs, fill: 'accent', isTotal: true },
    ]
  }

  const profit = pricingRows.reduce(
    (sum, row) => sum + scaleAmount(Number(row.profitabilityAmount || 0), period),
    0,
  )
  const list =
    pricingRows.reduce(
      (sum, row) => sum + scaleAmount(Number(row.listPrice || 0) * 1200, period),
      0,
    ) || profit * 1.45
  const costs = -(
    pricingRows.reduce(
      (sum, row) => sum + scaleAmount(Number(row.costComponents?.total || 0) * 900, period),
      0,
    ) || profit * 0.35
  )
  const discounts = -(Math.max(list * 0.1, list + costs - profit))
  const contribution = Math.max(profit || list + discounts + costs, 0)

  return [
    { name: 'List', value: list, fill: 'ink' },
    { name: 'Discounts', value: discounts, fill: 'danger' },
    { name: 'Delivery cost', value: costs, fill: 'warning' },
    { name: 'Contribution', value: contribution, fill: 'accent', isTotal: true },
  ]
}

export function buildGeoInsights(streams = [], period = 'FY26 YTD') {
  const map = new Map()
  for (const row of streams.filter((item) => item.currency !== '$/learner')) {
    const key = row.location || 'Unassigned'
    const current = map.get(key) || { region: key, revenue: 0, variance: 0, streams: 0 }
    current.revenue += scaleAmount(row.actual, period)
    current.variance += scaleAmount(row.variance, period)
    current.streams += 1
    map.set(key, current)
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue)
}

export function buildTopCourses(pricingRows = [], elasticity = []) {
  const courses = pricingRows.filter((row) =>
    ['course_fee', 'certification', 'subscription'].includes(row.category),
  )
  const ranked = (courses.length ? courses : pricingRows)
    .map((row) => {
      const elastic = elasticity.find((item) => item.product === row.product)
      return {
        id: row.id,
        name: row.product,
        category: row.category,
        margin: Number(row.contributionMarginPct || 0),
        profit: Number(row.profitabilityAmount || 0),
        risk: row.risk || 'normal',
        demand: elastic?.demandShift || '—',
      }
    })
    .sort((a, b) => b.profit - a.profit || b.margin - a.margin)
  return ranked.slice(0, 5)
}

export function buildWorstSegments(streams = []) {
  return streams
    .filter((row) => row.currency !== '$/learner')
    .map((row) => ({
      id: row.id,
      name: row.segment || row.stream,
      stream: row.stream,
      variance: Number(row.variance) || 0,
      variancePct: Number(row.variancePct) || 0,
      risk: row.risk || 'normal',
      action: row.action,
    }))
    .sort((a, b) => a.variance - b.variance || a.variancePct - b.variancePct)
    .slice(0, 5)
}
