import { memo, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material'
import { EvidenceDrawer } from '../../components/EvidenceDrawer.jsx'
import { SectionHeader } from '../../components/SectionHeader.jsx'
import { StatusChip } from '../../components/StatusChip.jsx'
import { downloadCsv } from '../../services/intelligenceClient.js'
import { filterBySearch, formatMoney } from '../../utils/formatters.js'
import {
  buildEvidenceItems,
  normalizeWorkflowState,
} from '../../utils/workflowStatus.js'

const PAGE_SIZE_OPTIONS = [5, 10, 20]
const SORT_OPTIONS = [
  { value: 'product', label: 'Product' },
  { value: 'contributionMarginPct', label: 'Contribution margin' },
  { value: 'profitabilityAmount', label: 'Profitability' },
  { value: 'approvalStatus', label: 'Approval status' },
  { value: 'risk', label: 'Risk' },
  { value: 'updatedAt', label: 'Updated' },
]

function titleCase(value = '') {
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function approvalState(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized.includes('approv') || normalized === 'active') return 'approved'
  if (normalized.includes('reject')) return 'rejected'
  if (normalized.includes('review') || normalized.includes('pending')) return 'pending-review'
  return normalizeWorkflowState(status, 'normal')
}

function compareValues(left, right, sortKey) {
  const a = left?.[sortKey]
  const b = right?.[sortKey]
  if (typeof a === 'number' || typeof b === 'number') {
    return (Number(a) || 0) - (Number(b) || 0)
  }
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base' })
}

export const PricingDetailsPage = memo(function PricingDetailsPage({
  records = [],
  canExport = false,
  role = 'Viewer',
  organisationScope = 'Current organisation',
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [riskFilter, setRiskFilter] = useState('all')
  const [sort, setSort] = useState('product')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const [selected, setSelected] = useState(null)
  const [evidence, setEvidence] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [calculator, setCalculator] = useState({ price: 1000, cost: 400, discount: 10 })
  const canEditPricing = ['Pricing Manager', 'Finance Controller', 'Administrator', 'Executive'].includes(role)

  const categories = useMemo(
    () => [...new Set(records.map((row) => row.category).filter(Boolean))],
    [records],
  )
  const statuses = useMemo(
    () => [...new Set(records.map((row) => row.approvalStatus).filter(Boolean))],
    [records],
  )

  const filtered = useMemo(() => {
    const searched = filterBySearch(records, search, [
      'product',
      'sku',
      'priceList',
      'discount',
      'costs',
      'contributionMargin',
      'profitability',
      'approvalStatus',
      'owner',
      'category',
    ])
    return searched
      .filter((row) => (statusFilter === 'all' ? true : row.approvalStatus === statusFilter))
      .filter((row) => (categoryFilter === 'all' ? true : row.category === categoryFilter))
      .filter((row) => (riskFilter === 'all' ? true : row.risk === riskFilter))
      .sort((left, right) => {
        const result = compareValues(left, right, sort)
        return sortDir === 'asc' ? result : -result
      })
  }, [categoryFilter, records, riskFilter, search, sort, sortDir, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const shown = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const summary = useMemo(() => {
    const withMargin = records.filter((row) => row.contributionMarginPct != null)
    const averageMargin = withMargin.length
      ? withMargin.reduce((sum, row) => sum + Number(row.contributionMarginPct), 0) / withMargin.length
      : null
    return {
      activeLists: records.filter((row) => row.priceListId).length,
      averageMargin,
      pending: records.filter((row) => approvalState(row.approvalStatus) === 'pending-review').length,
      critical: records.filter((row) => row.risk === 'critical').length,
    }
  }, [records])

  const calculatedMargin = useMemo(() => {
    const price = Number(calculator.price) || 0
    const cost = Number(calculator.cost) || 0
    const discount = Number(calculator.discount) || 0
    const net = price * (1 - discount / 100)
    if (!net) return { net: 0, marginPct: 0, contribution: 0 }
    const contribution = net - cost
    return {
      net,
      contribution,
      marginPct: Number(((contribution / net) * 100).toFixed(1)),
    }
  }, [calculator])

  const discountMatrix = useMemo(() => {
    const bands = [0, 5, 10, 15, 20]
    return records.slice(0, 5).map((row) => {
      const price = Number(row.listPrice || row.price || 1000)
      const cost = Number(row.costComponents?.total || price * 0.4)
      return {
        product: row.product,
        bands: bands.map((discount) => {
          const net = price * (1 - discount / 100)
          const margin = net ? ((net - cost) / net) * 100 : 0
          return { discount, margin: Number(margin.toFixed(1)) }
        }),
      }
    })
  }, [records])

  const openEvidence = (row) => {
    setEvidence(
      buildEvidenceItems({
        title: `${row.product} linked records`,
        summary: 'Price lists, cost versions, and quotes in organisational scope.',
        records: (row.linkedRecords || []).map((item) => ({
          id: item.id,
          heading: `${titleCase(item.type)} · ${item.label}`,
          status: item.status,
          type: item.type,
          label: item.label,
        })),
        fields: [
          { label: 'Type', key: 'type' },
          { label: 'Label', key: 'label' },
          { label: 'Status', key: 'status' },
        ],
      }),
    )
  }

  const exportRows = () => {
    try {
      if (!canExport) {
        setError('Export is restricted for this role.')
        return
      }
      downloadCsv('pricing-cost-margin-detail.csv', [
        [
          'Product',
          'SKU',
          'Category',
          'Price list',
          'Discount structure',
          'Cost components',
          'Contribution margin',
          'Profitability',
          'Approval status',
          'Owner',
          'Risk',
          'Version',
        ],
        ...filtered.map((row) => [
          row.product,
          row.sku,
          row.category,
          row.priceList,
          row.discount,
          row.costs,
          row.contributionMargin,
          row.profitability,
          row.approvalStatus,
          row.owner,
          row.risk,
          row.version,
        ]),
      ])
      setFeedback(`Exported ${filtered.length} scoped pricing records.`)
      setError('')
    } catch (caught) {
      setError(caught.message)
    }
  }

  return (
    <div className="page-stack route-shell">
      <section className="wide-card soft-panel">
        <p className="breadcrumb">Home / Pricing, Cost & Margin Detail</p>
        <SectionHeader
          eyebrow="Pricing, cost and margin"
          title="Price lists, discounts, costs, profitability, and approvals"
        />
        <p className="section-lead">
          Records are limited to your role ({role}) and permitted organisational scope (
          {organisationScope}). Use search, filters, sorting, and pagination to inspect detail,
          linked records, and version history.
        </p>
        {feedback ? <Alert severity="success">{feedback}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Alert severity="info" className="scope-banner">
          Visible products: {records.length}. Actions available:{' '}
          {canExport ? 'export enabled' : 'export restricted'}.
        </Alert>
      </section>

      <section className="metric-grid soft-metric-grid pricing-detail-metrics">
        <article className="metric-card good soft-kpi-metric">
          <span>Active price lists</span>
          <strong>{summary.activeLists}</strong>
          <small>In current organisational scope</small>
        </article>
        <article className="metric-card good soft-kpi-metric">
          <span>Average contribution margin</span>
          <strong>
            {summary.averageMargin != null ? `${summary.averageMargin.toFixed(1)}%` : '—'}
          </strong>
          <small>Across permitted products</small>
        </article>
        <article className="metric-card warning soft-kpi-metric">
          <span>Approval exceptions</span>
          <strong>{summary.pending}</strong>
          <small>{summary.critical} critical margin risks</small>
        </article>
      </section>

      <section className="split-grid pricing-ops-split">
        <div className="wide-card soft-panel">
          <SectionHeader eyebrow="Margin calculator" title="Contribution margin from price, cost, and discount" />
          <div className="form-grid soft-form">
            <TextField
              type="number"
              label="List price"
              value={calculator.price}
              disabled={!canEditPricing}
              onChange={(event) => setCalculator((current) => ({ ...current, price: event.target.value }))}
            />
            <TextField
              type="number"
              label="Unit cost"
              value={calculator.cost}
              disabled={!canEditPricing}
              onChange={(event) => setCalculator((current) => ({ ...current, cost: event.target.value }))}
            />
            <TextField
              type="number"
              label="Discount %"
              value={calculator.discount}
              disabled={!canEditPricing}
              onChange={(event) => setCalculator((current) => ({ ...current, discount: event.target.value }))}
            />
          </div>
          <div className="metric-grid soft-metric-grid category-profit-stats">
            <article className="metric-card soft-kpi-metric">
              <span>Net price</span>
              <strong>{formatMoney(calculatedMargin.net)}</strong>
            </article>
            <article className="metric-card good soft-kpi-metric">
              <span>Contribution</span>
              <strong>{formatMoney(calculatedMargin.contribution)}</strong>
            </article>
            <article className="metric-card warning soft-kpi-metric">
              <span>Contribution margin</span>
              <strong>{calculatedMargin.marginPct}%</strong>
            </article>
          </div>
          {!canEditPricing ? (
            <Alert severity="info" className="scope-banner">
              Role {role} can view the calculator; Pricing Manager and above can edit inputs.
            </Alert>
          ) : null}
        </div>
        <div className="wide-card soft-panel">
          <SectionHeader eyebrow="Discount matrix" title="Margin by discount band" />
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>0%</th>
                  <th>5%</th>
                  <th>10%</th>
                  <th>15%</th>
                  <th>20%</th>
                </tr>
              </thead>
              <tbody>
                {discountMatrix.map((row) => (
                  <tr key={row.product}>
                    <td>{row.product}</td>
                    {row.bands.map((band) => (
                      <td key={band.discount}>
                        <StatusChip
                          state={band.margin < 45 ? 'critical' : band.margin < 55 ? 'warning' : 'approved'}
                          label={`${band.margin}%`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader
          eyebrow="Scoped catalogue"
          title="Search, filter, sort, and page through pricing detail"
        >
          <Button disabled={!canExport || !filtered.length} onClick={exportRows} variant="outlined">
            Export CSV
          </Button>
        </SectionHeader>

        <div className="filter-row pricing-detail-filters">
          <TextField
            label="Search pricing"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
          <TextField
            select
            label="Status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value)
              setPage(1)
            }}
          >
            <MenuItem value="all">All statuses</MenuItem>
            {statuses.map((status) => (
              <MenuItem key={status} value={status}>
                {status}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Category"
            value={categoryFilter}
            onChange={(event) => {
              setCategoryFilter(event.target.value)
              setPage(1)
            }}
          >
            <MenuItem value="all">All categories</MenuItem>
            {categories.map((category) => (
              <MenuItem key={category} value={category}>
                {titleCase(category)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Risk"
            value={riskFilter}
            onChange={(event) => {
              setRiskFilter(event.target.value)
              setPage(1)
            }}
          >
            <MenuItem value="all">All risks</MenuItem>
            <MenuItem value="normal">normal</MenuItem>
            <MenuItem value="warning">warning</MenuItem>
            <MenuItem value="critical">critical</MenuItem>
          </TextField>
          <TextField
            select
            label="Sort by"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            {SORT_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Direction"
            value={sortDir}
            onChange={(event) => setSortDir(event.target.value)}
          >
            <MenuItem value="asc">Ascending</MenuItem>
            <MenuItem value="desc">Descending</MenuItem>
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
                <th>Product</th>
                <th>Price list</th>
                <th>Discount structure</th>
                <th>Cost components</th>
                <th>Contribution margin</th>
                <th>Profitability</th>
                <th>Approval status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.product}</strong>
                    <div className="table-subtext">
                      {row.sku} · {titleCase(row.category)} · {row.owner}
                    </div>
                  </td>
                  <td>{row.priceList}</td>
                  <td>{row.discount}</td>
                  <td>{row.costs}</td>
                  <td>
                    <StatusChip state={row.risk} label={row.contributionMargin} />
                  </td>
                  <td>{row.profitability}</td>
                  <td>
                    <StatusChip state={approvalState(row.approvalStatus)} label={row.approvalStatus} />
                  </td>
                  <td>
                    <div className="table-actions">
                      <Button onClick={() => setSelected(row)} size="small" variant="outlined">
                        Record details
                      </Button>
                      <Button onClick={() => openEvidence(row)} size="small">
                        Linked records
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!filtered.length ? (
          <Alert severity="info">No pricing records match the current search and filters.</Alert>
        ) : null}

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

      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        fullWidth
        maxWidth="md"
        aria-labelledby="pricing-detail-title"
      >
        <DialogTitle id="pricing-detail-title">
          {selected?.product || 'Pricing record details'}
        </DialogTitle>
        <DialogContent className="pricing-detail-dialog">
          {selected ? (
            <>
              <div className="detail-chip-row">
                <StatusChip state={approvalState(selected.approvalStatus)} label={selected.approvalStatus} />
                <StatusChip state={selected.risk} />
                <StatusChip state="normal" label={`v${selected.version}`} />
              </div>

              <section>
                <h4>Commercial summary</h4>
                <dl className="detail-grid">
                  <div><dt>SKU</dt><dd>{selected.sku || '—'}</dd></div>
                  <div><dt>Category</dt><dd>{titleCase(selected.category)}</dd></div>
                  <div><dt>Owner</dt><dd>{selected.owner}</dd></div>
                  <div><dt>Price list</dt><dd>{selected.priceListName} · {selected.priceList}</dd></div>
                  <div><dt>Contribution margin</dt><dd>{selected.contributionMargin}</dd></div>
                  <div><dt>Customer / product profitability</dt><dd>{selected.profitability}</dd></div>
                  <div><dt>Updated</dt><dd>{selected.updatedAt || '—'}</dd></div>
                </dl>
              </section>

              <section>
                <h4>Discount structures</h4>
                {selected.discountStructure?.length ? (
                  <div className="responsive-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Value</th>
                          <th>Floor margin</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.discountStructure.map((discount) => (
                          <tr key={discount.id || discount.name}>
                            <td>{discount.name}</td>
                            <td>{discount.type}</td>
                            <td>{discount.value}%</td>
                            <td>{discount.floorMarginPct}%</td>
                            <td>
                              <StatusChip state={approvalState(discount.status)} label={discount.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Alert severity="info">No discount structures linked to this product.</Alert>
                )}
              </section>

              <section>
                <h4>Cost components</h4>
                {selected.costComponents ? (
                  <dl className="detail-grid">
                    <div><dt>Direct</dt><dd>{formatMoney(selected.costComponents.direct)}</dd></div>
                    <div><dt>Instructor</dt><dd>{formatMoney(selected.costComponents.instructor)}</dd></div>
                    <div><dt>Mentor</dt><dd>{formatMoney(selected.costComponents.mentor)}</dd></div>
                    <div><dt>Support</dt><dd>{formatMoney(selected.costComponents.support)}</dd></div>
                    <div><dt>Content</dt><dd>{formatMoney(selected.costComponents.content)}</dd></div>
                    <div><dt>Total unit cost</dt><dd>{formatMoney(selected.costComponents.total)}</dd></div>
                    <div><dt>Cost version</dt><dd>{selected.costComponents.version}</dd></div>
                  </dl>
                ) : (
                  <Alert severity="warning">Cost components are unavailable for this product.</Alert>
                )}
              </section>

              <section>
                <h4>Linked records</h4>
                {selected.linkedRecords?.length ? (
                  <ul className="linked-record-list">
                    {selected.linkedRecords.map((item) => (
                      <li key={`${item.type}-${item.id}`}>
                        <StatusChip state={approvalState(item.status)} label={item.status} />
                        <span>
                          {titleCase(item.type)} · {item.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Alert severity="info">No linked records in scope.</Alert>
                )}
              </section>

              <section>
                <h4>Version / activity history</h4>
                {selected.versionHistory?.length ? (
                  <ol className="activity-timeline">
                    {selected.versionHistory.map((entry) => (
                      <li key={`${entry.label}-${entry.value}`}>
                        <strong>{entry.label}</strong>
                        <span>{entry.value}</span>
                        <small>{entry.at || 'Timestamp unavailable'}</small>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Alert severity="info">No version history is available.</Alert>
                )}
              </section>
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => selected && openEvidence(selected)} variant="outlined">
            Open linked evidence
          </Button>
          <Button onClick={() => setSelected(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <EvidenceDrawer
        onClose={() => setEvidence(null)}
        open={Boolean(evidence)}
        records={evidence?.records || []}
        summary={evidence?.summary || ''}
        title={evidence?.title || 'Linked records'}
      />
    </div>
  )
})
