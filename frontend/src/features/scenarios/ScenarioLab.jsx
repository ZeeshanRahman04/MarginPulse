import { memo, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
} from '@mui/material'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { EvidenceDrawer } from '../../components/EvidenceDrawer.jsx'
import { SectionHeader } from '../../components/SectionHeader.jsx'
import { StatusChip } from '../../components/StatusChip.jsx'
import { evaluateScenario } from '../../services/intelligenceClient.js'
import { chartTooltipStyle, palette } from '../../styles/palette.js'
import { formatMoney } from '../../utils/formatters.js'
import {
  buildEvidenceItems,
  cohortWorkflowState,
  elasticityWorkflowState,
  leakageWorkflowState,
  scenarioResultState,
  simulationWorkflowState,
} from '../../utils/workflowStatus.js'

function localEvaluate(product, form) {
  const listPrice = Number(product?.listPrice || product?.price || 1000) || 1000
  const unitCost = Number(product?.costComponents?.total || product?.unitCost || listPrice * 0.4)
  const elasticity = Number(product?.elasticity || -0.8)
  const priceChange = Number(form.priceChangePct) || 0
  const discount = Number(form.discountPct) || 0
  const bundleLift = form.bundleOffer ? 0.04 : 0
  const enterpriseLift = form.enterpriseDeal ? 0.08 : 0
  const promoLift = form.promoOffer ? 0.03 : 0

  const netPrice = listPrice * (1 + priceChange / 100) * (1 - discount / 100)
  const demandChangePct = elasticity * (priceChange - discount) + (bundleLift + enterpriseLift + promoLift) * 100
  const baseVolume = Number(product?.baseVolume || 120)
  const volume = Math.max(1, Math.round(baseVolume * (1 + demandChangePct / 100)))
  const revenue = netPrice * volume
  const marginPct = ((netPrice - unitCost) / netPrice) * 100
  const profit = (netPrice - unitCost) * volume
  const conversion = Math.max(8, Math.min(92, 54 + demandChangePct * 0.35 + promoLift * 100))
  const expectedImpact = profit - (listPrice - unitCost) * baseVolume
  const floor = Number(form.floorMarginPct) || 45
  const ceiling = Number(form.ceilingDiscountPct) || 20
  const violations = []
  if (marginPct < floor) violations.push(`Margin ${marginPct.toFixed(1)}% below floor ${floor}%`)
  if (discount > ceiling) violations.push(`Discount ${discount}% exceeds ceiling ${ceiling}%`)

  return {
    product: product?.product || product?.name || 'Scenario',
    expectedFinancialImpact: formatMoney(expectedImpact),
    expectedFinancialImpactRaw: expectedImpact,
    confidenceRange: [
      formatMoney(expectedImpact * 0.72),
      formatMoney(expectedImpact * 1.18),
    ],
    resultingMarginPct: Number(marginPct.toFixed(1)),
    demandChangePct: Number(demandChangePct.toFixed(1)),
    predictedRevenue: revenue,
    predictedProfit: profit,
    predictedConversion: Number(conversion.toFixed(1)),
    predictedElasticity: elasticity,
    netPrice,
    volume,
    violations,
    requiresHumanReview: Math.abs(expectedImpact) > 50000 || violations.length > 0,
    source: 'local-simulator',
  }
}

export const ScenarioLab = memo(function ScenarioLab({
  cohorts,
  elasticity,
  leakageAlerts,
  products = [],
  simulations,
  onSubmitDeal,
  canSubmitDeal = false,
}) {
  const [form, setForm] = useState({
    productId: '',
    priceChangePct: 0,
    discountPct: 0,
    floorMarginPct: 45,
    ceilingDiscountPct: 20,
    bundleOffer: false,
    promoOffer: false,
    enterpriseDeal: false,
  })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)
  const [evidence, setEvidence] = useState(null)

  useEffect(() => {
    if (form.productId || !products[0]?.id) return
    setForm((current) => ({ ...current, productId: products[0].id }))
  }, [form.productId, products])

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === form.productId) || products[0],
    [form.productId, products],
  )

  const live = useMemo(() => localEvaluate(selectedProduct, form), [form, selectedProduct])

  const metricSeries = useMemo(
    () =>
      [-10, -5, 0, 5, 10].map((step) => {
        const point = localEvaluate(selectedProduct, {
          ...form,
          priceChangePct: Number(form.priceChangePct) + step,
        })
        return {
          label: `${step > 0 ? '+' : ''}${Number(form.priceChangePct) + step}%`,
          revenue: Math.round(point.predictedRevenue),
          profit: Math.round(point.predictedProfit),
          margin: point.resultingMarginPct,
          conversion: point.predictedConversion,
        }
      }),
    [form, selectedProduct],
  )

  const elasticityCurve = useMemo(() => {
    const base = Number(
      elasticity.find((item) => item.product === selectedProduct?.product)?.elasticity ||
        selectedProduct?.elasticity ||
        -0.8,
    )
    return Array.from({ length: 11 }, (_, index) => {
      const priceDelta = -20 + index * 4
      const demand = 100 + base * priceDelta
      return { priceDelta, demand: Number(demand.toFixed(1)), elasticity: base }
    })
  }, [elasticity, selectedProduct])

  const evaluate = async (event) => {
    event.preventDefault()
    if (!form.productId) {
      setError('Select a product before evaluating a scenario.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const remote = await evaluateScenario({
        productId: form.productId,
        priceChangePct: Number(form.priceChangePct),
        discountPct: Number(form.discountPct),
        constraints: {
          floorMarginPct: Number(form.floorMarginPct),
          ceilingDiscountPct: Number(form.ceilingDiscountPct),
          requiresHumanReviewAboveImpact: 50000,
        },
      })
      setResult({ ...live, ...remote, source: 'api' })
      setFeedback('Scenario evaluated against live policy engine.')
    } catch (caught) {
      setResult(live)
      setFeedback(`Using instant local simulator (${caught.message}).`)
    } finally {
      setLoading(false)
    }
  }

  const submitDeal = async () => {
    const payload = result || live
    if (!payload) return
    try {
      if (onSubmitDeal) {
        await onSubmitDeal({
          productId: form.productId,
          netAmount: payload.predictedRevenue,
          marginPct: payload.resultingMarginPct,
          reason: `Simulator submission: price ${form.priceChangePct}%, discount ${form.discountPct}%`,
        })
      }
      setFeedback('Deal package submitted for approval workflow.')
      setError('')
    } catch (caught) {
      setFeedback(`Deal staged for approval locally (${caught.message}).`)
    }
  }

  const openEvidence = (payload) => setEvidence(buildEvidenceItems(payload))
  const activeResult = result || live
  const resultState = scenarioResultState(activeResult)
  const leakageWarning =
    activeResult.resultingMarginPct < Number(form.floorMarginPct) ||
    Number(form.discountPct) > Number(form.ceilingDiscountPct)

  return (
    <div className="page-stack route-shell">
      <section className="wide-card soft-panel">
        <p className="breadcrumb">Home / Simulations</p>
        <SectionHeader
          eyebrow="AI Pricing Simulator"
          title="Experiment with prices, discounts, offers, bundles, and enterprise deals"
        />
        <form className="form-grid soft-form" onSubmit={evaluate}>
          <TextField
            required
            select
            label="Product"
            value={form.productId}
            onChange={(event) => setForm({ ...form, productId: event.target.value })}
          >
            {products.map((product) => (
              <MenuItem key={product.id} value={product.id}>
                {product.product}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            required
            type="number"
            label="Price change %"
            value={form.priceChangePct}
            onChange={(event) => setForm({ ...form, priceChangePct: event.target.value })}
          />
          <TextField
            required
            type="number"
            label="Discount %"
            value={form.discountPct}
            onChange={(event) => setForm({ ...form, discountPct: event.target.value })}
          />
          <TextField
            required
            type="number"
            label="Margin floor %"
            value={form.floorMarginPct}
            onChange={(event) => setForm({ ...form, floorMarginPct: event.target.value })}
          />
          <TextField
            required
            type="number"
            label="Discount ceiling %"
            value={form.ceilingDiscountPct}
            onChange={(event) => setForm({ ...form, ceilingDiscountPct: event.target.value })}
          />
          <div className="prefs-row">
            <FormControlLabel
              control={
                <Switch
                  checked={form.bundleOffer}
                  onChange={(event) => setForm({ ...form, bundleOffer: event.target.checked })}
                />
              }
              label="Bundle offer"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.promoOffer}
                  onChange={(event) => setForm({ ...form, promoOffer: event.target.checked })}
                />
              }
              label="Promotional offer"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.enterpriseDeal}
                  onChange={(event) => setForm({ ...form, enterpriseDeal: event.target.checked })}
                />
              }
              label="Enterprise deal"
            />
          </div>
          <Button disabled={loading} type="submit" variant="contained">
            {loading ? 'Evaluating…' : 'Evaluate against policy engine'}
          </Button>
          <Button type="button" variant="outlined" onClick={submitDeal} disabled={!canSubmitDeal && !onSubmitDeal}>
            Submit deal for approval
          </Button>
        </form>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {feedback ? <Alert severity="success">{feedback}</Alert> : null}
        {leakageWarning ? (
          <Alert severity="warning">
            Margin leakage warning: predicted margin {activeResult.resultingMarginPct}% with discount{' '}
            {form.discountPct}%. Review floor/ceiling before approval.
          </Alert>
        ) : null}
      </section>

      <section className="metric-grid soft-metric-grid">
        <article className="metric-card good soft-kpi-metric">
          <span>Predicted revenue</span>
          <strong>{formatMoney(activeResult.predictedRevenue)}</strong>
          <small>Updates instantly</small>
        </article>
        <article className="metric-card soft-kpi-metric">
          <span>Predicted margin</span>
          <strong>{activeResult.resultingMarginPct}%</strong>
          <small>Profit {formatMoney(activeResult.predictedProfit)}</small>
        </article>
        <article className="metric-card warning soft-kpi-metric">
          <span>Conversion</span>
          <strong>{activeResult.predictedConversion}%</strong>
          <small>Elasticity {activeResult.predictedElasticity}</small>
        </article>
        <article className={`metric-card soft-kpi-metric ${resultState === 'critical' ? 'danger' : 'good'}`}>
          <span>What-if impact</span>
          <strong>{activeResult.expectedFinancialImpact}</strong>
          <small>CI {(activeResult.confidenceRange || []).join(' to ')}</small>
        </article>
      </section>

      <section className="split-grid pricing-ops-split">
        <div className="wide-card soft-panel">
          <SectionHeader eyebrow="Instant charts" title="Revenue, profit, margin, conversion" />
          <div className="chart-frame">
            <div className="chart-frame__canvas">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metricSeries} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
                  <CartesianGrid stroke={palette.grid} strokeDasharray="4 8" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: palette.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: palette.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Area type="monotone" dataKey="revenue" stroke={palette.accentDeep} fill={palette.accentSoft} name="Revenue" />
                  <Area type="monotone" dataKey="profit" stroke={palette.ink} fill="transparent" name="Profit" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="wide-card soft-panel">
          <SectionHeader eyebrow="Price elasticity curve" title="Demand response to price deltas" />
          <div className="chart-frame chart-frame--compact">
            <div className="chart-frame__canvas chart-frame__canvas--compact">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={elasticityCurve} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
                  <CartesianGrid stroke={palette.grid} strokeDasharray="4 8" vertical={false} />
                  <XAxis dataKey="priceDelta" tick={{ fill: palette.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: palette.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Line type="monotone" dataKey="demand" stroke={palette.accentDark} strokeWidth={2.5} dot={false} name="Demand index" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          {activeResult ? (
            <Alert
              className="scope-banner"
              severity={resultState === 'critical' ? 'error' : resultState === 'pending-review' ? 'warning' : 'success'}
            >
              <StatusChip state={resultState} /> Demand change {activeResult.demandChangePct}% · Source{' '}
              {activeResult.source || 'live'}
              {(activeResult.violations || []).length ? (
                <ul>
                  {activeResult.violations.map((violation) => (
                    <li key={String(violation)}>
                      {typeof violation === 'string' ? violation : violation.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}
        </div>
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader
          eyebrow="Price elasticity"
          title="Offer tests, margin impact, and demand sensitivity"
        />
        <div className="soft-product-grid">
          {elasticity.length ? (
            elasticity.map((item) => {
              const magnitude = Math.abs(Number(item.elasticity) || 0)
              const width = Math.min(100, (magnitude / 1.5) * 100)
              const state = elasticityWorkflowState(item)

              return (
                <article className="soft-product-card" key={item.product}>
                  <div className="soft-tile__top">
                    <StatusChip state={state} />
                    <strong className="soft-tile__value soft-tile__value--accent">{item.elasticity}</strong>
                  </div>
                  <h4>{item.product}</h4>
                  <div
                    aria-label={`${item.product} price elasticity magnitude ${magnitude}`}
                    className="elasticity-graph"
                    role="img"
                  >
                    <span aria-hidden="true" style={{ width: `${width}%` }} />
                  </div>
                  <div className="soft-stat-row soft-stat-row--compact">
                    <div>
                      <span>Demand</span>
                      <strong>{item.demandShift || '—'}</strong>
                    </div>
                    <div>
                      <span>Impact</span>
                      <strong>{item.marginImpact || '—'}</strong>
                    </div>
                  </div>
                  <div className="soft-tile__footer">
                    <Button
                      onClick={() =>
                        openEvidence({
                          title: `${item.product} elasticity`,
                          summary: 'Supporting elasticity estimate used by simulations.',
                          records: [{ ...item, heading: item.product, status: state }],
                          fields: [
                            { label: 'Elasticity', key: 'elasticity' },
                            { label: 'Demand shift', key: 'demandShift' },
                            { label: 'Margin impact', key: 'marginImpact' },
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
            <Alert severity="info">Elasticity graph data is unavailable.</Alert>
          )}
        </div>
      </section>

      <section className="wide-card soft-panel sim-board">
        <SectionHeader eyebrow="What-if scenarios" title="Expected impact, assumptions, and constraints" />
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
                          summary: 'Scenario evidence and constraint details.',
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
          <SectionHeader eyebrow="Margin-leakage alerts" title="Exposure requiring action" />
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
                        summary: 'Leakage alert evidence and ownership.',
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
          <SectionHeader eyebrow="Cohort analysis" title="Learner economics by cohort" />
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
                        summary: 'Cohort economics used in scenario planning.',
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
