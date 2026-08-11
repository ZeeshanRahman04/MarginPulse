import { memo, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, MenuItem, TextField } from '@mui/material'
import {
  GeoInsightsChart,
  MarginWaterfallChart,
  RevenueBridgeChart,
  RevenueTrendChart,
  VarianceBarChart,
} from '../../components/charts/DashboardCharts.jsx'
import { SoftRevenueBars } from '../../components/charts/SoftRevenueBars.jsx'
import { SectionHeader } from '../../components/SectionHeader.jsx'
import { StatusChip } from '../../components/StatusChip.jsx'
import { formatMoney } from '../../utils/formatters.js'
import {
  buildExecutiveKpis,
  buildFilterOptions,
  buildGeoInsights,
  buildMarginWaterfall,
  buildRevenueTrend,
  buildTopCourses,
  buildWorstSegments,
  filterExecutiveDeals,
  filterExecutiveStreams,
} from './executiveMetrics.js'

function trendPill(metric = {}) {
  const tone = metric.tone || 'good'
  const label = metric.trend || 'Live'
  if (tone === 'danger' || tone === 'warning') {
    return { className: 'trend-pill trend-pill--down', label: `↓ ${label}` }
  }
  return { className: 'trend-pill trend-pill--up', label: `↑ ${label}` }
}

const PERIODS = ['Last 7 days', 'Last month', 'Quarter', 'FY26 YTD']

export const CommandCenter = memo(function CommandCenter({
  activeSegment,
  cohorts = [],
  deals = [],
  domainRecords = [],
  elasticity = [],
  globalSearch = '',
  leakageAlerts = [],
  lifecycle = [],
  metrics = [],
  pricingRows = [],
  recommendations = [],
  revenueStreams = [],
  selectedRecommendation,
  setActiveSegment,
}) {
  const navigate = useNavigate()
  const [period, setPeriod] = useState('FY26 YTD')
  const [region, setRegion] = useState('all')
  const [category, setCategory] = useState('all')
  const [businessUnit, setBusinessUnit] = useState('all')
  const [product, setProduct] = useState('all')
  const [owner, setOwner] = useState('all')
  const [risk, setRisk] = useState('all')
  const [activeStreamId, setActiveStreamId] = useState(null)
  const [focusedKpi, setFocusedKpi] = useState(null)

  const filters = useMemo(
    () => ({
      search: globalSearch,
      region,
      category,
      businessUnit,
      product,
      owner,
      risk,
    }),
    [businessUnit, category, globalSearch, owner, product, region, risk],
  )

  const options = useMemo(
    () => buildFilterOptions({ streams: revenueStreams, deals, recommendations }),
    [deals, recommendations, revenueStreams],
  )

  const filteredStreams = useMemo(
    () => filterExecutiveStreams(revenueStreams, filters),
    [filters, revenueStreams],
  )

  const filteredDeals = useMemo(
    () => filterExecutiveDeals(deals, filters, filteredStreams),
    [deals, filteredStreams, filters],
  )

  const filteredLeakage = useMemo(() => {
    const query = globalSearch.trim().toLowerCase()
    return leakageAlerts.filter((item) => {
      if (owner !== 'all' && item.owner !== owner) return false
      if (risk === 'critical' && String(item.severity).toLowerCase() !== 'high') return false
      if (risk === 'warning' && !['medium', 'high'].includes(String(item.severity).toLowerCase())) {
        return false
      }
      if (!query) return true
      return [item.alert, item.owner, item.severity, item.exposure].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(query),
      )
    })
  }, [globalSearch, leakageAlerts, owner, risk])

  const filteredRecommendations = useMemo(() => {
    const query = globalSearch.trim().toLowerCase()
    return recommendations.filter((item) => {
      if (businessUnit !== 'all' && item.segment && item.segment !== businessUnit) return false
      if (!query) return true
      return [item.segment, item.action, item.reason].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(query),
      )
    })
  }, [businessUnit, globalSearch, recommendations])

  const scopedPricing = useMemo(() => {
    if (product === 'all' && category === 'all' && owner === 'all' && risk === 'all') {
      return pricingRows
    }
    return pricingRows.filter((row) => {
      if (product !== 'all' && row.product !== product && !String(row.product).includes(product)) {
        const match = filteredStreams.some((stream) =>
          String(row.product || '')
            .toLowerCase()
            .includes(String(stream.stream || '').toLowerCase().split(' ')[0]),
        )
        if (!match && product !== 'all') return false
      }
      if (owner !== 'all' && row.owner !== owner) return false
      if (risk !== 'all' && (row.risk || 'normal') !== risk) return false
      if (category !== 'all') {
        const map = {
          subscriptions: 'subscription',
          course_fees: 'course_fee',
          enterprise_licences: 'enterprise_licence',
          certifications: 'certification',
        }
        if (row.category !== map[category] && row.category !== category) return false
      }
      return true
    })
  }, [category, filteredStreams, owner, pricingRows, product, risk])

  const kpis = useMemo(
    () =>
      buildExecutiveKpis({
        streams: filteredStreams,
        pricingRows: scopedPricing,
        deals: filteredDeals,
        recommendations: filteredRecommendations,
        leakageAlerts: filteredLeakage,
        period,
      }),
    [
      filteredDeals,
      filteredLeakage,
      filteredRecommendations,
      filteredStreams,
      period,
      scopedPricing,
    ],
  )

  const revenueTrend = useMemo(
    () => buildRevenueTrend(filteredStreams, period),
    [filteredStreams, period],
  )
  const marginWaterfall = useMemo(
    () => buildMarginWaterfall(scopedPricing, period),
    [period, scopedPricing],
  )
  const geoRows = useMemo(() => buildGeoInsights(filteredStreams, period), [filteredStreams, period])
  const topCourses = useMemo(
    () => buildTopCourses(scopedPricing, elasticity),
    [elasticity, scopedPricing],
  )
  const worstSegments = useMemo(() => buildWorstSegments(filteredStreams), [filteredStreams])

  const moneyStreams = useMemo(
    () => filteredStreams.filter((row) => row.currency !== '$/learner'),
    [filteredStreams],
  )
  const activeStream =
    moneyStreams.find((row) => row.id === activeStreamId) || moneyStreams[0] || null

  const segmentOptions = filteredRecommendations.map(({ segment }) => segment).filter(Boolean)
  const selectedSegment = segmentOptions.includes(activeSegment)
    ? activeSegment
    : segmentOptions[0] || ''
  const confidence = Math.min(100, selectedRecommendation?.confidence ?? 0)

  const resetFilters = () => {
    setRegion('all')
    setCategory('all')
    setBusinessUnit('all')
    setProduct('all')
    setOwner('all')
    setRisk('all')
    setPeriod('FY26 YTD')
  }

  return (
    <div className="page-stack exec-dashboard">
      <section className="wide-card exec-hero">
        <SectionHeader
          eyebrow="Executive Dashboard"
          title="Overall health of the business"
        >
          <Button onClick={resetFilters} size="small" variant="outlined">
            Reset filters
          </Button>
        </SectionHeader>
        <p className="section-lead">
          Interactive KPIs, trends, and AI alerts update with every filter. Baseline metrics:{' '}
          {metrics[0]?.label || 'Net Revenue'} {metrics[0]?.value || '—'}.
        </p>
        <div className="filter-row exec-filters">
          <TextField
            label="Date"
            onChange={(event) => setPeriod(event.target.value)}
            select
            size="small"
            value={period}
          >
            {PERIODS.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Region"
            onChange={(event) => setRegion(event.target.value)}
            select
            size="small"
            value={region}
          >
            <MenuItem value="all">All regions</MenuItem>
            {options.regions.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Category"
            onChange={(event) => setCategory(event.target.value)}
            select
            size="small"
            value={category}
          >
            <MenuItem value="all">All categories</MenuItem>
            {options.categories.map((item) => (
              <MenuItem key={item.value} value={item.value}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Business Unit"
            onChange={(event) => setBusinessUnit(event.target.value)}
            select
            size="small"
            value={businessUnit}
          >
            <MenuItem value="all">All units</MenuItem>
            {options.businessUnits.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Product"
            onChange={(event) => setProduct(event.target.value)}
            select
            size="small"
            value={product}
          >
            <MenuItem value="all">All products</MenuItem>
            {options.products.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Owner"
            onChange={(event) => setOwner(event.target.value)}
            select
            size="small"
            value={owner}
          >
            <MenuItem value="all">All owners</MenuItem>
            {options.owners.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Risk Level"
            onChange={(event) => setRisk(event.target.value)}
            select
            size="small"
            value={risk}
          >
            <MenuItem value="all">All risk levels</MenuItem>
            {options.risks.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
        </div>
        {focusedKpi ? (
          <p className="soft-focus-note">Focused on {focusedKpi}. Charts below reflect current filters.</p>
        ) : null}
      </section>

      <section className="wide-card">
        <SectionHeader eyebrow="KPI cards" title="Business health at a glance" />
        <div className="exec-kpi-grid">
          {kpis.map((metric) => {
            const pill = trendPill(metric)
            return (
              <button
                className={`soft-kpi exec-kpi${focusedKpi === metric.label ? ' is-active' : ''}`}
                key={metric.id}
                onClick={() => setFocusedKpi(metric.label)}
                type="button"
              >
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <em className={pill.className}>{pill.label}</em>
              </button>
            )
          })}
        </div>
      </section>

      <div className="exec-chart-grid">
        <section className="wide-card chart-card">
          <SectionHeader eyebrow="Revenue trend" title="Actual vs budget vs forecast" />
          <RevenueTrendChart rows={revenueTrend} />
        </section>
        <section className="wide-card chart-card">
          <SectionHeader eyebrow="Profitability" title="Category contribution bridge" />
          <RevenueBridgeChart rows={moneyStreams} />
        </section>
        <section className="wide-card chart-card">
          <SectionHeader eyebrow="Margin waterfall" title="List to contribution" />
          <MarginWaterfallChart steps={marginWaterfall} />
        </section>
        <section className="wide-card chart-card">
          <SectionHeader eyebrow="Geographic insights" title="Revenue by region hub" />
          <GeoInsightsChart rows={geoRows} />
        </section>
      </div>

      <div className="exec-split">
        <section className="wide-card chart-card">
          <SectionHeader eyebrow="Interactive revenue" title="Click a stream to inspect">
            {activeStream ? <StatusChip state={activeStream.risk || 'normal'} /> : null}
          </SectionHeader>
          <SoftRevenueBars
            activeKey={activeStream?.id}
            onSelect={setActiveStreamId}
            rows={moneyStreams}
          />
          {activeStream ? (
            <div className="soft-chart-meta">
              <span>
                {activeStream.stream} · {formatMoney(activeStream.actual, activeStream.currency)} ·
                Variance {formatMoney(activeStream.variance, activeStream.currency)}
              </span>
            </div>
          ) : (
            <Alert severity="info">No revenue streams match the current filters.</Alert>
          )}
        </section>
        <section className="wide-card chart-card">
          <SectionHeader eyebrow="Variance" title="Budget exceptions by stream" />
          <VarianceBarChart rows={moneyStreams} />
        </section>
      </div>

      <div className="exec-split">
        <section className="wide-card">
          <SectionHeader eyebrow="AI alerts" title="Recommendations needing attention">
            <TextField
              className="soft-select"
              label="Segment"
              onChange={(event) => setActiveSegment(event.target.value)}
              select
              size="small"
              value={selectedSegment || ''}
            >
              {segmentOptions.length ? (
                segmentOptions.map((segment) => (
                  <MenuItem key={segment} value={segment}>
                    {segment}
                  </MenuItem>
                ))
              ) : (
                <MenuItem value="">No segments</MenuItem>
              )}
            </TextField>
          </SectionHeader>
          <div className="exec-ai-panel">
            <div>
              <strong>{selectedRecommendation?.action || 'No recommendation in scope'}</strong>
              <p>
                {selectedRecommendation?.reason ||
                  'Adjust filters or open AI Governance for the full review queue.'}
              </p>
              <small>{selectedRecommendation?.guardrail}</small>
              <div className="operator-strip" style={{ marginTop: 12 }}>
                <Button onClick={() => navigate('/ai')} size="small" variant="contained">
                  Open AI Governance
                </Button>
                <Button onClick={() => navigate('/pricing')} size="small" variant="outlined">
                  Pricing & deals
                </Button>
                <Button
                  onClick={() => navigate('/recommendations-impact')}
                  size="small"
                  variant="outlined"
                >
                  Approval queue
                </Button>
              </div>
            </div>
            <div className="soft-insight-stats">
              <div>
                <span>Impact</span>
                <strong>{selectedRecommendation?.impact || '—'}</strong>
              </div>
              <div>
                <span>Confidence</span>
                <strong>{confidence}%</strong>
              </div>
            </div>
          </div>
          <ul className="exec-alert-list">
            {filteredLeakage.length ? (
              filteredLeakage.slice(0, 4).map((item) => (
                <li key={`${item.alert}-${item.owner}`}>
                  <div>
                    <strong>{item.alert}</strong>
                    <small>
                      {item.owner} · {item.exposure}
                    </small>
                  </div>
                  <StatusChip
                    state={String(item.severity).toLowerCase() === 'high' ? 'critical' : 'warning'}
                    label={item.severity}
                  />
                </li>
              ))
            ) : (
              <li>
                <div>
                  <strong>No leakage alerts in scope</strong>
                  <small>Filters cleared the current alert set.</small>
                </div>
              </li>
            )}
          </ul>
        </section>

        <section className="wide-card">
          <SectionHeader eyebrow="Commercial pulse" title="Deals, approvals, and cohorts" />
          <div className="soft-progress-row exec-pulse">
            <div>
              <strong>{filteredDeals.length}</strong>
              <span>Active deals</span>
            </div>
            <div>
              <strong>
                {filteredDeals.filter((deal) => deal.status === 'pending_approval').length}
              </strong>
              <span>Pending approvals</span>
            </div>
            <div>
              <strong>{lifecycle.length}</strong>
              <span>Journey stages</span>
            </div>
            <div>
              <strong>{cohorts.length}</strong>
              <span>Cohorts</span>
            </div>
          </div>
          <ul className="exec-deal-list">
            {filteredDeals.length ? (
              filteredDeals.slice(0, 5).map((deal) => (
                <li key={deal.id || deal.quote_number}>
                  <div>
                    <strong>{deal.quote_number || deal.id}</strong>
                    <small>
                      {formatMoney(Number(deal.net_amount) || 0)} · margin{' '}
                      {Number(deal.margin_pct || 0).toFixed(0)}%
                    </small>
                  </div>
                  <StatusChip
                    state={
                      deal.status === 'pending_approval'
                        ? 'warning'
                        : deal.status === 'rejected'
                          ? 'critical'
                          : 'approved'
                    }
                    label={String(deal.status || 'open').replace(/_/g, ' ')}
                  />
                </li>
              ))
            ) : (
              <li>
                <div>
                  <strong>No deals in the filtered scope</strong>
                  <small>
                    {domainRecords.length
                      ? `${domainRecords.length} operational records still visible via search.`
                      : 'Connect quotes or clear filters.'}
                  </small>
                </div>
              </li>
            )}
          </ul>
        </section>
      </div>

      <div className="exec-split">
        <section className="wide-card">
          <SectionHeader eyebrow="Top performing courses" title="Highest contribution products" />
          <ul className="exec-rank-list">
            {topCourses.length ? (
              topCourses.map((course, index) => (
                <li key={course.id}>
                  <span className="exec-rank">#{index + 1}</span>
                  <div>
                    <strong>{course.name}</strong>
                    <small>
                      {course.margin}% margin · {formatMoney(course.profit)} · demand {course.demand}
                    </small>
                  </div>
                  <StatusChip state={course.risk} />
                </li>
              ))
            ) : (
              <Alert severity="info">No course economics match the current filters.</Alert>
            )}
          </ul>
        </section>
        <section className="wide-card">
          <SectionHeader eyebrow="Worst performing segments" title="Largest adverse variance" />
          <ul className="exec-rank-list">
            {worstSegments.length ? (
              worstSegments.map((segment, index) => (
                <li key={segment.id}>
                  <span className="exec-rank exec-rank--warn">#{index + 1}</span>
                  <div>
                    <strong>{segment.name}</strong>
                    <small>
                      {segment.stream} · {formatMoney(segment.variance)} (
                      {segment.variancePct.toFixed(1)}%)
                    </small>
                  </div>
                  <StatusChip state={segment.risk} />
                </li>
              ))
            ) : (
              <Alert severity="info">No underperforming segments in scope.</Alert>
            )}
          </ul>
        </section>
      </div>
    </div>
  )
})
