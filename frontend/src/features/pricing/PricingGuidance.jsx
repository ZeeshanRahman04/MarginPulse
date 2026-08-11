import { memo, useMemo, useState } from 'react'
import { Alert, Button, TextField } from '@mui/material'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { EvidenceDrawer } from '../../components/EvidenceDrawer.jsx'
import { SectionHeader } from '../../components/SectionHeader.jsx'
import { StatusChip } from '../../components/StatusChip.jsx'
import { chartTooltipStyle, palette } from '../../styles/palette.js'
import { filterBySearch, formatMoney } from '../../utils/formatters.js'
import {
  buildEvidenceItems,
  cohortWorkflowState,
  dealWorkflowState,
  elasticityWorkflowState,
  leakageWorkflowState,
  recommendationWorkflowState,
  simulationWorkflowState,
  withLocalDealStatus,
} from '../../utils/workflowStatus.js'

export const PricingGuidance = memo(function PricingGuidance({
  approvedActions,
  canApprove,
  cohorts = [],
  dealDecisions = {},
  deals = [],
  elasticity = [],
  globalSearch,
  leakageAlerts = [],
  onDealDecision,
  pricingRows = [],
  recommendationDecisions = {},
  recommendations = [],
  reviewRecommendation,
  simulations = [],
}) {
  const [reason, setReason] = useState('')
  const [pendingId, setPendingId] = useState('')
  const [actionError, setActionError] = useState('')
  const [evidence, setEvidence] = useState(null)
  const [experiment, setExperiment] = useState({ priceChangePct: 4, discountPct: 5, offerLift: 2 })

  const visiblePricingRows = useMemo(() => {
    return filterBySearch(pricingRows, globalSearch, [
      'product',
      'priceList',
      'discount',
      'approvalStatus',
    ])
  }, [globalSearch, pricingRows])

  const visibleDeals = useMemo(() => {
    const localized = deals.map((deal) => withLocalDealStatus(deal, dealDecisions))
    return filterBySearch(localized, globalSearch, ['quote_number', 'status', 'id'])
  }, [dealDecisions, deals, globalSearch])

  const stateSummary = useMemo(() => {
    const counts = {
      normal: 0,
      warning: 0,
      critical: 0,
      'pending-review': 0,
      approved: 0,
      rejected: 0,
      completed: 0,
    }
    for (const deal of deals) {
      counts[dealWorkflowState(withLocalDealStatus(deal, dealDecisions))] += 1
    }
    for (const recommendation of recommendations) {
      counts[
        recommendationWorkflowState(recommendation, approvedActions, recommendationDecisions)
      ] += 1
    }
    for (const alert of leakageAlerts) counts[leakageWorkflowState(alert)] += 1
    return counts
  }, [
    approvedActions,
    dealDecisions,
    deals,
    leakageAlerts,
    recommendationDecisions,
    recommendations,
  ])

  const openEvidence = (payload) => setEvidence(buildEvidenceItems(payload))

  const liveExperiment = useMemo(() => {
    const baseRevenue = 1000000
    const elasticityAvg =
      elasticity.reduce((sum, item) => sum + Math.abs(Number(item.elasticity) || 0), 0) /
        Math.max(elasticity.length, 1) || 0.8
    const price = Number(experiment.priceChangePct) || 0
    const discount = Number(experiment.discountPct) || 0
    const offer = Number(experiment.offerLift) || 0
    const demandShift = -elasticityAvg * (price - discount) + offer
    const revenue = baseRevenue * (1 + price / 100) * (1 - discount / 100) * (1 + demandShift / 100)
    const margin = 58 + price * 0.35 - discount * 0.45 + offer * 0.2
    const conversion = Math.max(10, Math.min(90, 52 + demandShift * 0.4))
    const profit = revenue * (margin / 100)
    const series = [-8, -4, 0, 4, 8].map((step) => {
      const p = price + step
      const dShift = -elasticityAvg * (p - discount) + offer
      const rev = baseRevenue * (1 + p / 100) * (1 - discount / 100) * (1 + dShift / 100)
      return {
        label: `${p > 0 ? '+' : ''}${p}%`,
        revenue: Math.round(rev),
        profit: Math.round(rev * ((58 + p * 0.35 - discount * 0.45 + offer * 0.2) / 100)),
        conversion: Math.max(10, Math.min(90, 52 + dShift * 0.4)),
      }
    })
    return {
      revenue,
      margin: Number(margin.toFixed(1)),
      conversion: Number(conversion.toFixed(1)),
      profit,
      elasticity: Number((-elasticityAvg).toFixed(2)),
      leakage:
        discount > 12 || margin < 50
          ? 'Margin leakage risk — discount or floor breach'
          : 'Within policy band',
      series,
    }
  }, [elasticity, experiment])

  return (
    <div className="page-stack">
      <section className="wide-card">
        <p className="breadcrumb">Home / Pricing Simulation & Deal Approval</p>
        <SectionHeader
          eyebrow="Commercial control room"
          title="Price simulations, leakage alerts, and quote decisions"
        />
        <p className="section-lead">
          Review elasticity and offer impact, investigate margin leakage, approve or reject deals,
          and drill into the records behind each summary.
        </p>
        <div className="status-legend" aria-label="Workflow states">
          {Object.entries(stateSummary).map(([state, count]) => (
            <div className="status-legend__item" key={state}>
              <StatusChip state={state} />
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="wide-card">
        <SectionHeader
          eyebrow="AI Pricing Simulator"
          title="Experiment with price, discount, and offer lifts — charts update instantly"
        />
        <div className="form-grid">
          <TextField
            type="number"
            label="New price change %"
            value={experiment.priceChangePct}
            onChange={(event) =>
              setExperiment((current) => ({ ...current, priceChangePct: event.target.value }))
            }
          />
          <TextField
            type="number"
            label="Discount / offer %"
            value={experiment.discountPct}
            onChange={(event) =>
              setExperiment((current) => ({ ...current, discountPct: event.target.value }))
            }
          />
          <TextField
            type="number"
            label="Bundle / promo lift pts"
            value={experiment.offerLift}
            onChange={(event) =>
              setExperiment((current) => ({ ...current, offerLift: event.target.value }))
            }
          />
        </div>
        <div className="metric-grid">
          <article className="metric-card good">
            <span>Predicted revenue</span>
            <strong>{formatMoney(liveExperiment.revenue)}</strong>
          </article>
          <article className="metric-card">
            <span>Predicted margin</span>
            <strong>{liveExperiment.margin}%</strong>
          </article>
          <article className="metric-card warning">
            <span>Conversion</span>
            <strong>{liveExperiment.conversion}%</strong>
          </article>
          <article className="metric-card good">
            <span>Predicted profit</span>
            <strong>{formatMoney(liveExperiment.profit)}</strong>
            <small>Elasticity {liveExperiment.elasticity}</small>
          </article>
        </div>
        {liveExperiment.leakage.includes('risk') ? (
          <Alert severity="warning">{liveExperiment.leakage}</Alert>
        ) : (
          <Alert severity="success">{liveExperiment.leakage}</Alert>
        )}
        <div className="chart-frame chart-frame--compact">
          <div className="chart-frame__canvas chart-frame__canvas--compact">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={liveExperiment.series} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={palette.grid} strokeDasharray="4 8" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: palette.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: palette.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Area type="monotone" dataKey="revenue" stroke={palette.accentDeep} fill={palette.accentSoft} name="Revenue" />
                <Area type="monotone" dataKey="profit" stroke={palette.ink} fill="transparent" name="Profit" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="wide-card">
        <SectionHeader
          eyebrow="Price elasticity"
          title="Sensitivity by product with demand and margin signals"
        >
          <Button
            disabled={!elasticity.length}
            onClick={() =>
              openEvidence({
                title: 'Elasticity evidence',
                summary: 'Product-level elasticity estimates used for offer and price tests.',
                records: elasticity.map((item) => ({
                  ...item,
                  heading: item.product,
                  status: elasticityWorkflowState(item),
                })),
                fields: [
                  { label: 'Elasticity', key: 'elasticity' },
                  { label: 'Demand shift', key: 'demandShift' },
                  { label: 'Margin impact', key: 'marginImpact' },
                ],
              })
            }
            size="small"
            variant="outlined"
          >
            View records
          </Button>
        </SectionHeader>
        <div className="simulation-grid">
          {elasticity.length ? (
            elasticity.map((item) => {
              const magnitude = Math.abs(Number(item.elasticity) || 0)
              const width = Math.min(100, (magnitude / 1.5) * 100)
              const state = elasticityWorkflowState(item)
              return (
                <article className="simulation-card" key={item.product}>
                  <div className="card-top-row">
                    <span>{item.product}</span>
                    <StatusChip state={state} />
                  </div>
                  <strong>{item.elasticity}</strong>
                  <div
                    aria-label={`${item.product} price elasticity magnitude ${magnitude}`}
                    className="elasticity-graph"
                    role="img"
                  >
                    <span aria-hidden="true" style={{ width: `${width}%` }} />
                  </div>
                  <p>Demand shift {item.demandShift || 'Unavailable'}</p>
                  <div className="card-actions">
                    <StatusChip label={item.marginImpact || 'Impact pending'} state={state} />
                    <Button
                      onClick={() =>
                        openEvidence({
                          title: `${item.product} elasticity`,
                          summary: 'Supporting elasticity estimate and commercial impact context.',
                          records: [
                            {
                              ...item,
                              heading: item.product,
                              status: state,
                              product: item.product,
                            },
                          ],
                          fields: [
                            { label: 'Elasticity', key: 'elasticity' },
                            { label: 'Demand shift', key: 'demandShift' },
                            { label: 'Margin impact', key: 'marginImpact' },
                          ],
                        })
                      }
                      size="small"
                    >
                      Drill down
                    </Button>
                  </div>
                </article>
              )
            })
          ) : (
            <Alert severity="info">Elasticity graph data is unavailable.</Alert>
          )}
        </div>
      </section>

      <section className="wide-card sim-board">
        <SectionHeader
          eyebrow="Price and offer simulations"
          title="What-if offer tests with assumptions and constraints"
        >
          <Button
            disabled={!simulations.length}
            onClick={() =>
              openEvidence({
                title: 'Simulation portfolio',
                summary: 'Scenario outputs with expected impact ranges and policy constraints.',
                records: simulations.map((scenario) => ({
                  ...scenario,
                  heading: scenario.scenario,
                  status: simulationWorkflowState(scenario),
                })),
                fields: [
                  { label: 'Expected impact', key: 'expectedImpact' },
                  { label: 'Confidence range', key: 'confidenceRange' },
                  { label: 'Assumptions', key: 'assumptions' },
                  { label: 'Constraints', key: 'constraints' },
                ],
              })
            }
            size="small"
            variant="outlined"
          >
            View records
          </Button>
        </SectionHeader>
        <div className="sim-board__grid">
          {simulations.length ? (
            simulations.map((scenario) => {
              const state = simulationWorkflowState(scenario)
              return (
                <article className="sim-offer-card" key={scenario.scenario}>
                  <div className="sim-offer-card__top">
                    <StatusChip state={state} />
                    <span className="sim-offer-card__range">{scenario.confidenceRange}</span>
                  </div>
                  <h4>{scenario.scenario}</h4>
                  <p className="sim-offer-card__impact">{scenario.expectedImpact}</p>
                  <dl className="sim-offer-card__meta">
                    <div>
                      <dt>Assumptions</dt>
                      <dd>{scenario.assumptions}</dd>
                    </div>
                    <div>
                      <dt>Constraints</dt>
                      <dd>{scenario.constraints}</dd>
                    </div>
                  </dl>
                  <div className="sim-offer-card__footer">
                    <Button
                      onClick={() =>
                        openEvidence({
                          title: scenario.scenario,
                          summary: 'Underlying assumptions and constraint evidence for this offer test.',
                          records: [{ ...scenario, heading: scenario.scenario, status: state }],
                          fields: [
                            { label: 'Expected impact', key: 'expectedImpact' },
                            { label: 'Confidence range', key: 'confidenceRange' },
                            { label: 'Assumptions', key: 'assumptions' },
                            { label: 'Constraints', key: 'constraints' },
                          ],
                        })
                      }
                      size="small"
                      variant="contained"
                    >
                      Inspect evidence
                    </Button>
                  </div>
                </article>
              )
            })
          ) : (
            <Alert severity="info">No simulation results are available.</Alert>
          )}
        </div>
      </section>

      <section className="split-grid pricing-ops-split">
        <div className="wide-card soft-panel">
          <SectionHeader eyebrow="Margin-leakage alerts" title="Exposure requiring action">
            <Button
              disabled={!leakageAlerts.length}
              onClick={() =>
                openEvidence({
                  title: 'Leakage alert records',
                  summary: 'Alerts ranked by severity with owner and exposure.',
                  records: leakageAlerts.map((alert) => ({
                    ...alert,
                    heading: alert.alert,
                    status: leakageWorkflowState(alert),
                  })),
                  fields: [
                    { label: 'Exposure', key: 'exposure' },
                    { label: 'Severity', key: 'severity' },
                    { label: 'Owner', key: 'owner' },
                  ],
                })
              }
              size="small"
              variant="outlined"
            >
              View records
            </Button>
          </SectionHeader>
          <div className="soft-tile-stack">
            {leakageAlerts.length ? (
              leakageAlerts.map((alert) => {
                const state = leakageWorkflowState(alert)
                const exposureLabel =
                  !alert.exposure ||
                  String(alert.exposure).replace(/[^0-9.]/g, '') === '0' ||
                  String(alert.exposure).replace(/[^0-9.]/g, '') === '0.0'
                    ? 'Watch'
                    : alert.exposure
                return (
                  <button
                    className={`leak-tile leak-tile--${state}`}
                    key={alert.alert}
                    onClick={() =>
                      openEvidence({
                        title: alert.alert,
                        summary: 'Supporting leakage record and ownership context.',
                        records: [{ ...alert, heading: alert.alert, status: state }],
                        fields: [
                          { label: 'Exposure', key: 'exposure' },
                          { label: 'Severity', key: 'severity' },
                          { label: 'Owner', key: 'owner' },
                        ],
                      })
                    }
                    type="button"
                  >
                    <span className="leak-tile__rail" aria-hidden="true" />
                    <div className="leak-tile__body">
                      <div className="leak-tile__top">
                        <StatusChip state={state} />
                        <div className="leak-tile__exposure">
                          <span>Exposure</span>
                          <strong>{exposureLabel}</strong>
                        </div>
                      </div>
                      <h4>{alert.alert}</h4>
                      <div className="leak-tile__footer">
                        <span className="leak-tile__owner">{alert.owner}</span>
                        <span className="leak-tile__action">Inspect</span>
                      </div>
                    </div>
                  </button>
                )
              })
            ) : (
              <Alert severity="success">No active margin-leakage alerts.</Alert>
            )}
          </div>
        </div>

        <div className="wide-card soft-panel">
          <SectionHeader eyebrow="Cohort analysis" title="Learner economics by cohort">
            <Button
              disabled={!cohorts.length}
              onClick={() =>
                openEvidence({
                  title: 'Cohort records',
                  summary: 'Cohort revenue, margin, and propensity evidence.',
                  records: cohorts.map((cohort) => ({
                    ...cohort,
                    heading: cohort.cohort,
                    status: cohortWorkflowState(cohort),
                  })),
                  fields: [
                    { label: 'Learners', key: 'learners' },
                    { label: 'Revenue', key: 'revenue' },
                    { label: 'Margin', key: 'margin' },
                    { label: 'LTV', key: 'ltv' },
                  ],
                })
              }
              size="small"
              variant="outlined"
            >
              View records
            </Button>
          </SectionHeader>
          <div className="soft-tile-stack">
            {cohorts.length ? (
              cohorts.map((cohort) => {
                const state = cohortWorkflowState(cohort)
                return (
                  <button
                    className="soft-tile soft-tile--cohort"
                    key={cohort.cohort}
                    onClick={() =>
                      openEvidence({
                        title: cohort.cohort,
                        summary: 'Underlying cohort metrics used in pricing guidance.',
                        records: [{ ...cohort, heading: cohort.cohort, status: state }],
                        fields: [
                          { label: 'Learners', key: 'learners' },
                          { label: 'Revenue', key: 'revenue' },
                          { label: 'Margin', key: 'margin' },
                          { label: 'LTV', key: 'ltv' },
                        ],
                      })
                    }
                    type="button"
                  >
                    <div className="soft-tile__top">
                      <StatusChip state={state} />
                      <span className="soft-tile__muted">{cohort.learners} learners</span>
                    </div>
                    <h4>{cohort.cohort}</h4>
                    <div className="soft-stat-row">
                      <div>
                        <span>Revenue</span>
                        <strong>{cohort.revenue}</strong>
                      </div>
                      <div>
                        <span>Margin</span>
                        <strong>{cohort.margin}</strong>
                      </div>
                      <div>
                        <span>LTV</span>
                        <strong>{cohort.ltv}</strong>
                      </div>
                    </div>
                    <span className="soft-tile__cta">Open cohort</span>
                  </button>
                )
              })
            ) : (
              <Alert severity="info">No cohort analysis is available.</Alert>
            )}
          </div>
        </div>
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader
          eyebrow="Price lists and profitability"
          title="Discounts, costs, contribution margin, and approval status"
        />
        <div className="soft-product-grid">
          {visiblePricingRows.length ? (
            visiblePricingRows.map((row) => {
              const approved = String(row.approvalStatus || '')
                .toLowerCase()
                .includes('approv')
              const state = approved ? 'approved' : 'pending-review'
              return (
                <article className="soft-product-card" key={row.id}>
                  <div className="soft-tile__top">
                    <StatusChip state={state} />
                    <strong className="soft-tile__value soft-tile__value--accent">
                      {row.contributionMargin}
                    </strong>
                  </div>
                  <h4>{row.product}</h4>
                  <div className="soft-stat-row soft-stat-row--compact">
                    <div>
                      <span>List</span>
                      <strong>{row.priceList}</strong>
                    </div>
                    <div>
                      <span>Profit</span>
                      <strong>{row.profitability}</strong>
                    </div>
                  </div>
                  <dl className="soft-meta-list">
                    <div>
                      <dt>Discount</dt>
                      <dd>{row.discount}</dd>
                    </div>
                    <div>
                      <dt>Costs</dt>
                      <dd>{row.costs}</dd>
                    </div>
                  </dl>
                  <div className="soft-tile__footer">
                    <Button
                      onClick={() =>
                        openEvidence({
                          title: row.product,
                          summary: 'Price list, discount, and cost evidence for this product.',
                          records: [
                            {
                              ...row,
                              heading: row.product,
                              status: state,
                            },
                          ],
                          fields: [
                            { label: 'Price list', key: 'priceList' },
                            { label: 'Discount structure', key: 'discount' },
                            { label: 'Cost components', key: 'costs' },
                            { label: 'Contribution margin', key: 'contributionMargin' },
                            { label: 'Product profitability', key: 'profitability' },
                            { label: 'Approval status', key: 'approvalStatus' },
                          ],
                        })
                      }
                      size="small"
                      variant="contained"
                    >
                      Drill down
                    </Button>
                  </div>
                </article>
              )
            })
          ) : (
            <Alert severity="info">No live pricing records are available for this role.</Alert>
          )}
        </div>
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader
          eyebrow="Deal and quote approval"
          title="Persisted quote decisions with mandatory reasons"
        >
          <Button
            disabled={!visibleDeals.length}
            onClick={() =>
              openEvidence({
                title: 'Quote approval queue',
                summary: 'All deals in the current queue with commercial evidence.',
                records: visibleDeals.map((deal) => ({
                  ...deal,
                  heading: deal.quote_number,
                  status: dealWorkflowState(deal),
                  net_amount: formatMoney(Number(deal.net_amount) || 0),
                })),
                fields: [
                  { label: 'Status', key: 'status' },
                  { label: 'Net amount', key: 'net_amount' },
                  { label: 'Margin %', key: 'margin_pct' },
                  { label: 'Quantity', key: 'quantity' },
                ],
              })
            }
            size="small"
            variant="outlined"
          >
            View records
          </Button>
        </SectionHeader>
        <div className="soft-reason-bar">
          <TextField
            fullWidth
            helperText={reason.trim() ? ' ' : 'Required for the audit trail'}
            label="Decision reason"
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </div>
        {actionError ? <Alert severity="error">{actionError}</Alert> : null}
        {visibleDeals.length ? (
          <div className="soft-deal-grid">
            {visibleDeals.map((deal) => {
              const state = dealWorkflowState(deal)
              const pending = state === 'pending-review'
              return (
                <article className={`soft-deal-card soft-deal-card--${state}`} key={deal.id}>
                  <div className="soft-tile__top">
                    <StatusChip state={state} />
                    <button
                      className="soft-link-btn"
                      onClick={() =>
                        openEvidence({
                          title: deal.quote_number,
                          summary: 'Quote commercial evidence and current approval state.',
                          records: [
                            {
                              ...deal,
                              heading: deal.quote_number,
                              status: state,
                              net_amount: formatMoney(Number(deal.net_amount) || 0),
                            },
                          ],
                          fields: [
                            { label: 'Status', key: 'status' },
                            { label: 'Net amount', key: 'net_amount' },
                            { label: 'Margin %', key: 'margin_pct' },
                            { label: 'Quantity', key: 'quantity' },
                            { label: 'Product ID', key: 'product_id' },
                          ],
                        })
                      }
                      type="button"
                    >
                      Evidence
                    </button>
                  </div>
                  <h4>{deal.quote_number}</h4>
                  <div className="soft-stat-row">
                    <div>
                      <span>Net</span>
                      <strong>{formatMoney(Number(deal.net_amount) || 0)}</strong>
                    </div>
                    <div>
                      <span>Margin</span>
                      <strong>{deal.margin_pct}%</strong>
                    </div>
                    <div>
                      <span>Qty</span>
                      <strong>{deal.quantity || 1}</strong>
                    </div>
                  </div>
                  {pending ? (
                    <div className="soft-action-row">
                      {['approved', 'rejected'].map((decision) => (
                        <Button
                          color={decision === 'rejected' ? 'error' : 'primary'}
                          disabled={!canApprove || pendingId === deal.id}
                          key={decision}
                          onClick={async () => {
                            if (!reason.trim()) {
                              setActionError('Enter a decision reason before reviewing a deal.')
                              return
                            }
                            setPendingId(deal.id)
                            const saved = await onDealDecision(deal.id, decision, reason)
                            setPendingId('')
                            if (saved) {
                              setActionError('')
                              setReason('')
                            }
                          }}
                          size="small"
                          variant={decision === 'approved' ? 'contained' : 'outlined'}
                        >
                          {decision === 'approved' ? 'Approve' : 'Reject'}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="soft-tile__muted soft-tile__muted--footer">
                      Decision locked · {String(state).replace(/-/g, ' ')}
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        ) : (
          <Alert severity="info">No deals are waiting for approval.</Alert>
        )}
      </section>

      <section className="wide-card soft-panel soft-panel--ai">
        <SectionHeader eyebrow="AI pricing co-pilot" title="Human-controlled material actions">
          <StatusChip
            label={`${approvedActions.length} approved`}
            state={approvedActions.length ? 'approved' : 'pending-review'}
          />
        </SectionHeader>
        <div className="soft-copilot-grid">
          {recommendations.length ? (
            recommendations.map((recommendation) => {
              const state = recommendationWorkflowState(
                recommendation,
                approvedActions,
                recommendationDecisions,
              )
              return (
                <article
                  className={`soft-copilot-card soft-copilot-card--${state}`}
                  key={recommendation.id || recommendation.segment}
                >
                  <div className="soft-copilot-card__ai">
                    <span className="eyebrow">AI suggestion</span>
                    <StatusChip state={state} />
                  </div>
                  <h4>{recommendation.action}</h4>
                  <p className="soft-copilot-card__reason">{recommendation.reason}</p>
                  <div className="soft-copilot-card__stats">
                    <div>
                      <span>Impact</span>
                      <strong>{recommendation.impact}</strong>
                    </div>
                    <div>
                      <span>Confidence</span>
                      <strong>{recommendation.confidence ?? '—'}%</strong>
                    </div>
                  </div>
                  <p className="soft-copilot-card__guard">{recommendation.guardrail}</p>
                  <div className="soft-copilot-card__actions">
                    <Button
                      onClick={() =>
                        openEvidence({
                          title: recommendation.action,
                          summary: 'Recommendation rationale, impact, and guardrail evidence.',
                          records: [
                            {
                              ...recommendation,
                              heading: recommendation.action,
                              status: state,
                            },
                          ],
                          fields: [
                            { label: 'Segment', key: 'segment' },
                            { label: 'Impact', key: 'impact' },
                            { label: 'Confidence', key: 'confidence' },
                            { label: 'Reason', key: 'reason' },
                            { label: 'Guardrail', key: 'guardrail' },
                            { label: 'Status', key: 'status' },
                          ],
                        })
                      }
                      size="small"
                      variant="outlined"
                    >
                      Evidence
                    </Button>
                    <Button
                      color={state === 'approved' ? 'success' : 'primary'}
                      disabled={!canApprove || pendingId === recommendation.id || state === 'approved'}
                      onClick={async () => {
                        if (!reason.trim()) {
                          setActionError('Enter a decision reason before approving.')
                          return
                        }
                        setPendingId(recommendation.id)
                        const saved = await reviewRecommendation(recommendation, 'approved', reason)
                        setPendingId('')
                        if (saved) {
                          setActionError('')
                          setReason('')
                        }
                      }}
                      size="small"
                      variant="contained"
                    >
                      {state === 'approved' ? 'Approved' : canApprove ? 'Approve' : 'View only'}
                    </Button>
                    <Button
                      color="error"
                      disabled={!canApprove || pendingId === recommendation.id || state === 'rejected'}
                      onClick={async () => {
                        if (!reason.trim()) {
                          setActionError('Enter a decision reason before rejecting.')
                          return
                        }
                        setPendingId(recommendation.id)
                        const saved = await reviewRecommendation(recommendation, 'rejected', reason)
                        setPendingId('')
                        if (saved) {
                          setActionError('')
                          setReason('')
                        }
                      }}
                      size="small"
                      variant="outlined"
                    >
                      Reject
                    </Button>
                  </div>
                </article>
              )
            })
          ) : (
            <Alert severity="info">No recommendations are waiting for review.</Alert>
          )}
        </div>
      </section>

      <EvidenceDrawer
        onClose={() => setEvidence(null)}
        open={Boolean(evidence)}
        records={evidence?.records || []}
        summary={evidence?.summary || ''}
        title={evidence?.title || 'Supporting evidence'}
      />
    </div>
  )
})
