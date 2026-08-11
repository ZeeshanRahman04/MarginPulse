import { memo, useMemo, useState } from 'react'
import { Alert, Button, MenuItem, TextField } from '@mui/material'
import { SectionHeader } from '../../components/SectionHeader.jsx'
import { StatusChip } from '../../components/StatusChip.jsx'
import { TrendBars } from '../../components/TrendBars.jsx'
import { RevenueBridgeChart } from '../../components/charts/DashboardCharts.jsx'
import { downloadCsv } from '../../services/intelligenceClient.js'
import { filterBySearch, formatMoney } from '../../utils/formatters.js'

const PAGE_SIZE_OPTIONS = [5, 10, 20]
const SORT_OPTIONS = [
  { value: 'variance', label: 'Variance' },
  { value: 'actual', label: 'Actual' },
  { value: 'forecast', label: 'Forecast' },
  { value: 'forecastGap', label: 'Forecast gap' },
  { value: 'stream', label: 'Stream name' },
]

function titleCase(value = '') {
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function statusState(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'ahead' || normalized === 'on_track') return 'approved'
  if (normalized === 'watch') return 'warning'
  if (normalized === 'behind') return 'critical'
  return 'normal'
}

function compareValues(left, right, sortKey) {
  const a = left?.[sortKey]
  const b = right?.[sortKey]
  if (typeof a === 'number' || typeof b === 'number') {
    return Math.abs(Number(b) || 0) - Math.abs(Number(a) || 0)
  }
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base' })
}

function enrichRow(row) {
  if (row.status && row.risk && row.category) return row
  const variance = Number(row.variance) || 0
  const budget = Math.max(Math.abs(Number(row.budget) || 0), 1)
  const variancePct = (variance / budget) * 100
  const forecastGap = Number(row.forecast || 0) - Number(row.actual || 0)
  const status =
    variancePct < -5 ? 'behind' : variancePct > 3 ? 'ahead' : variancePct < 0 ? 'watch' : 'on_track'
  const risk =
    variancePct <= -10 ? 'critical' : status === 'behind' || status === 'watch' ? 'warning' : 'normal'
  return {
    ...row,
    category: row.category || String(row.segment || 'general').toLowerCase().replace(/\s+/g, '_'),
    categoryLabel: row.categoryLabel || row.stream,
    owner: row.owner || 'Finance Controller',
    location: row.location || 'Global Digital',
    period: row.period || 'FY26 YTD',
    asOf: row.asOf || '2026-08-01',
    status,
    risk,
    forecastGap: row.forecastGap ?? forecastGap,
    variancePct: row.variancePct ?? Number(variancePct.toFixed(1)),
    action:
      row.action ||
      (risk === 'critical'
        ? 'Escalate margin recovery and reforecast'
        : risk === 'warning'
          ? 'Review pricing, discounts, and demand assumptions'
          : 'Maintain current pricing posture'),
  }
}

export const RevenueDashboards = memo(function RevenueDashboards({
  globalSearch = '',
  revenueStreams = [],
  canExport = false,
  role = 'Viewer',
  organisationScope = 'Current organisation',
}) {
  const [search, setSearch] = useState('')
  const [periodFilter, setPeriodFilter] = useState('all')
  const [locationFilter, setLocationFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [riskFilter, setRiskFilter] = useState('all')
  const [sortBy, setSortBy] = useState('variance')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  const rows = useMemo(() => revenueStreams.map(enrichRow), [revenueStreams])

  const periods = useMemo(() => [...new Set(rows.map((row) => row.period).filter(Boolean))], [rows])
  const locations = useMemo(
    () => [...new Set(rows.map((row) => row.location).filter(Boolean))],
    [rows],
  )
  const categories = useMemo(
    () => [...new Set(rows.map((row) => row.category).filter(Boolean))],
    [rows],
  )
  const owners = useMemo(() => [...new Set(rows.map((row) => row.owner).filter(Boolean))], [rows])

  const filtered = useMemo(() => {
    const query = search || globalSearch
    const searched = filterBySearch(rows, query, [
      'stream',
      'segment',
      'categoryLabel',
      'owner',
      'location',
      'status',
      'risk',
      'action',
    ])
    return searched
      .filter((row) => (periodFilter === 'all' ? true : row.period === periodFilter))
      .filter((row) => (locationFilter === 'all' ? true : row.location === locationFilter))
      .filter((row) => (categoryFilter === 'all' ? true : row.category === categoryFilter))
      .filter((row) => (ownerFilter === 'all' ? true : row.owner === ownerFilter))
      .filter((row) => (statusFilter === 'all' ? true : row.status === statusFilter))
      .filter((row) => (riskFilter === 'all' ? true : row.risk === riskFilter))
      .sort((left, right) => compareValues(left, right, sortBy))
  }, [
    categoryFilter,
    globalSearch,
    locationFilter,
    ownerFilter,
    periodFilter,
    riskFilter,
    rows,
    search,
    sortBy,
    statusFilter,
  ])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const shown = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const summary = useMemo(() => {
    const monetary = filtered.filter((row) => row.currency !== '$/learner')
    const actual = monetary.reduce((sum, row) => sum + Number(row.actual || 0), 0)
    const budget = monetary.reduce((sum, row) => sum + Number(row.budget || 0), 0)
    const forecast = monetary.reduce((sum, row) => sum + Number(row.forecast || 0), 0)
    const variance = actual - budget
    const exceptions = filtered.filter((row) => row.risk === 'warning' || row.risk === 'critical')
    return {
      actual,
      budget,
      forecast,
      variance,
      forecastGap: forecast - actual,
      exceptions,
      critical: exceptions.filter((row) => row.risk === 'critical').length,
    }
  }, [filtered])

  const categoryCards = useMemo(() => {
    const byCategory = new Map()
    for (const row of filtered) {
      const key = row.category
      const existing = byCategory.get(key) || {
        category: key,
        label: row.categoryLabel || titleCase(key),
        actual: 0,
        budget: 0,
        forecast: 0,
        variance: 0,
        currency: row.currency || '$',
        risk: 'normal',
        trend: row.trend || [],
        count: 0,
      }
      if (row.currency === '$/learner') {
        existing.actual = row.actual
        existing.budget = row.budget
        existing.forecast = row.forecast
        existing.variance = row.variance
        existing.currency = '$/learner'
        existing.trend = row.trend
      } else {
        existing.actual += Number(row.actual || 0)
        existing.budget += Number(row.budget || 0)
        existing.forecast += Number(row.forecast || 0)
        existing.variance += Number(row.variance || 0)
      }
      if (row.risk === 'critical' || (row.risk === 'warning' && existing.risk !== 'critical')) {
        existing.risk = row.risk
      }
      existing.count += 1
      byCategory.set(key, existing)
    }
    return [...byCategory.values()].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
  }, [filtered])

  const exportRows = () => {
    try {
      if (!canExport) {
        setError('Export is restricted for this role.')
        return
      }
      downloadCsv('revenue-profitability-dashboard.csv', [
        [
          'Stream',
          'Category',
          'Segment',
          'Location',
          'Owner',
          'Period',
          'Actual',
          'Budget',
          'Forecast',
          'Variance',
          'Status',
          'Risk',
          'Action',
        ],
        ...filtered.map((row) => [
          row.stream,
          row.categoryLabel,
          row.segment,
          row.location,
          row.owner,
          row.period,
          row.actual,
          row.budget,
          row.forecast,
          row.variance,
          row.status,
          row.risk,
          row.action,
        ]),
      ])
      setFeedback(`Exported ${filtered.length} scoped revenue records.`)
      setError('')
    } catch (caught) {
      setError(caught.message)
    }
  }

  const resetPage = (setter) => (event) => {
    setter(event.target.value)
    setPage(1)
  }

  return (
    <div className="page-grid">
      <section className="wide-card">
        <p className="breadcrumb">Home / Revenue & Profitability</p>
        <SectionHeader
          eyebrow="Revenue and profitability dashboards"
          title="Subscriptions, course fees, enterprise, certifications, and learner LTV"
        />
        <p className="section-lead">
          Role-aware view for {role} within {organisationScope}. Track actual, budget, forecast,
          variance, and segment trends, then act on the highest-risk exceptions first.
        </p>
        {feedback ? <Alert severity="success">{feedback}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Alert severity="info" className="scope-banner">
          Visible streams: {rows.length}. Filters applied: {filtered.length}. Export:{' '}
          {canExport ? 'enabled' : 'restricted'}.
        </Alert>
      </section>

      <section className="metric-grid revenue-dashboard-metrics">
        <article className="metric-card good">
          <span>Net actual revenue</span>
          <strong>{formatMoney(summary.actual)}</strong>
          <small>Budget {formatMoney(summary.budget)}</small>
        </article>
        <article className={`metric-card ${summary.variance >= 0 ? 'good' : 'warning'}`}>
          <span>Budget variance</span>
          <strong>{formatMoney(summary.variance)}</strong>
          <small>{summary.variance >= 0 ? 'Ahead of budget' : 'Behind budget'}</small>
        </article>
        <article className={`metric-card ${summary.forecastGap >= 0 ? 'good' : 'warning'}`}>
          <span>Forecast gap</span>
          <strong>{formatMoney(summary.forecastGap)}</strong>
          <small>Forecast {formatMoney(summary.forecast)}</small>
        </article>
        <article className={`metric-card ${summary.exceptions.length ? 'danger' : 'good'}`}>
          <span>Exceptions</span>
          <strong>{summary.exceptions.length}</strong>
          <small>{summary.critical} critical risks</small>
        </article>
      </section>

      <section className="wide-card chart-card">
        <SectionHeader
          eyebrow="Interactive bridge"
          title="Actual, budget, and forecast by stream"
        />
        <RevenueBridgeChart rows={filtered} />
      </section>

      <section className="wide-card">
        <SectionHeader
          eyebrow="Exceptions and actions"
          title="Highest-priority status indicators for your role"
        />
        {summary.exceptions.length ? (
          <ul className="exception-action-list">
            {summary.exceptions.slice(0, 5).map((row) => (
              <li key={`exception-${row.id}`}>
                <StatusChip state={row.risk} />
                <div>
                  <strong>
                    {row.stream} · {titleCase(row.status)}
                  </strong>
                  <p>
                    Variance {formatMoney(row.variance, row.currency)} · Owner {row.owner} ·{' '}
                    {row.action}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Alert severity="success">No variance or forecast exceptions in the current filter scope.</Alert>
        )}
      </section>

      <section className="wide-card">
        <SectionHeader
          eyebrow="Category profitability"
          title="Segment trends across revenue families"
        />
        <div className="category-profit-grid">
          {categoryCards.map((card) => (
            <article className="category-profit-card" key={card.category}>
              <div className="category-profit-card__top">
                <div>
                  <p className="eyebrow">{card.label}</p>
                  <h3>{formatMoney(card.actual, card.currency)}</h3>
                </div>
                <StatusChip state={card.risk} />
              </div>
              <dl className="detail-grid category-profit-stats">
                <div>
                  <dt>Budget</dt>
                  <dd>{formatMoney(card.budget, card.currency)}</dd>
                </div>
                <div>
                  <dt>Forecast</dt>
                  <dd>{formatMoney(card.forecast, card.currency)}</dd>
                </div>
                <div>
                  <dt>Variance</dt>
                  <dd className={card.variance >= 0 ? 'positive' : 'negative'}>
                    {formatMoney(card.variance, card.currency)}
                  </dd>
                </div>
              </dl>
              <TrendBars values={card.trend} />
              <small>{card.count} stream{card.count === 1 ? '' : 's'} in scope</small>
            </article>
          ))}
          {!categoryCards.length ? (
            <Alert severity="info">No category cards match the current filters.</Alert>
          ) : null}
        </div>
      </section>

      <section className="wide-card">
        <SectionHeader
          eyebrow="Detailed bridge"
          title="Actual, budget, forecast, variance, and segment trends"
        >
          <Button disabled={!canExport || !filtered.length} onClick={exportRows} variant="outlined">
            Export CSV
          </Button>
        </SectionHeader>

        <div className="filter-row revenue-dashboard-filters">
          <TextField
            label="Search streams"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
          <TextField select label="Period" value={periodFilter} onChange={resetPage(setPeriodFilter)}>
            <MenuItem value="all">All periods</MenuItem>
            {periods.map((period) => (
              <MenuItem key={period} value={period}>
                {period}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Location"
            value={locationFilter}
            onChange={resetPage(setLocationFilter)}
          >
            <MenuItem value="all">All locations</MenuItem>
            {locations.map((location) => (
              <MenuItem key={location} value={location}>
                {location}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Category"
            value={categoryFilter}
            onChange={resetPage(setCategoryFilter)}
          >
            <MenuItem value="all">All categories</MenuItem>
            {categories.map((category) => (
              <MenuItem key={category} value={category}>
                {titleCase(category)}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Owner" value={ownerFilter} onChange={resetPage(setOwnerFilter)}>
            <MenuItem value="all">All owners</MenuItem>
            {owners.map((owner) => (
              <MenuItem key={owner} value={owner}>
                {owner}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Status" value={statusFilter} onChange={resetPage(setStatusFilter)}>
            <MenuItem value="all">All statuses</MenuItem>
            <MenuItem value="ahead">ahead</MenuItem>
            <MenuItem value="on_track">on track</MenuItem>
            <MenuItem value="watch">watch</MenuItem>
            <MenuItem value="behind">behind</MenuItem>
          </TextField>
          <TextField select label="Risk" value={riskFilter} onChange={resetPage(setRiskFilter)}>
            <MenuItem value="all">All risks</MenuItem>
            <MenuItem value="normal">normal</MenuItem>
            <MenuItem value="warning">warning</MenuItem>
            <MenuItem value="critical">critical</MenuItem>
          </TextField>
          <TextField select label="Sort by" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            {SORT_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Page size"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value))
              setPage(1)
            }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <MenuItem key={size} value={size}>
                {size} / page
              </MenuItem>
            ))}
          </TextField>
        </div>

        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Revenue stream</th>
                <th>Segment</th>
                <th>Actual</th>
                <th>Budget</th>
                <th>Forecast</th>
                <th>Variance</th>
                <th>Status</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.stream}</strong>
                      <div className="table-subtext">
                        {row.categoryLabel} · {row.location} · {row.owner}
                      </div>
                    </td>
                    <td>{row.segment}</td>
                    <td>{formatMoney(row.actual, row.currency)}</td>
                    <td>{formatMoney(row.budget, row.currency)}</td>
                    <td>{formatMoney(row.forecast, row.currency)}</td>
                    <td className={row.variance >= 0 ? 'positive' : 'negative'}>
                      {formatMoney(row.variance, row.currency)}
                      <div className="table-subtext">{row.variancePct}% vs budget</div>
                    </td>
                    <td>
                      <div className="table-actions">
                        <StatusChip state={statusState(row.status)} label={titleCase(row.status)} />
                        <StatusChip state={row.risk} />
                      </div>
                    </td>
                    <td>
                      <TrendBars values={row.trend} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="table-empty-state" colSpan="8">
                    No revenue streams match the current search, filters, and role scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination-row">
          <Button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
            Previous
          </Button>
          <span>
            Page {currentPage} of {totalPages} · {filtered.length} records
          </span>
          <Button
            disabled={currentPage >= totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </Button>
        </div>
      </section>
    </div>
  )
})
