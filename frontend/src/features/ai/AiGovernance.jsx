import { memo, useMemo, useState } from 'react'
import { Alert, Button, TextField } from '@mui/material'
import { ConfidenceGauge } from '../../components/charts/DashboardCharts.jsx'
import { SectionHeader } from '../../components/SectionHeader.jsx'
import { StatusChip } from '../../components/StatusChip.jsx'
import { normalizeWorkflowState } from '../../utils/workflowStatus.js'

const ACTIONS = [
  { key: 'approved', label: 'Approve' },
  { key: 'accepted', label: 'Accept' },
  { key: 'rejected', label: 'Reject' },
  { key: 'overridden', label: 'Override' },
  { key: 'escalated', label: 'Escalate' },
  { key: 'deferred', label: 'Defer' },
]

export const AiGovernance = memo(function AiGovernance({
  aiDecisions,
  aiOutputs = [],
  recommendations = [],
  canApprove,
  canOverride,
  onDecision,
}) {
  const [reason, setReason] = useState('')
  const [pendingId, setPendingId] = useState('')
  const [actionError, setActionError] = useState('')
  const [localDecisions, setLocalDecisions] = useState({})

  const cards = useMemo(() => {
    if (aiOutputs.length) {
      return aiOutputs.map((output) => {
        const matched = recommendations.find((item) => item.id === output.id)
        return {
          id: output.id,
          title: output.title,
          type: matched?.type || 'Optimal Price',
          explanation: output.explanation,
          sourceData: output.sourceData,
          confidence: output.confidence,
          range: output.range,
          timestamp: output.timestamp,
          model: output.model,
          impact: matched?.impact || output.range,
          constraints: matched?.constraints || matched?.guardrail || 'Human approval required',
          assumptions: matched?.assumptions || 'Based on tenant-scoped commercial history',
          previousValue: matched?.previousValue,
          newValue: matched?.newValue,
        }
      })
    }
    return recommendations.map((item) => ({
      id: item.id,
      title: item.action || item.segment,
      type: item.type || 'AI Recommendation',
      explanation: item.reason,
      sourceData: 'Pricing, revenue, cost and forecast records',
      confidence: item.confidence,
      range: item.impact,
      timestamp: item.decidedAt || 'Pending',
      model: 'MarginPulse-Guidance v2.4',
      impact: item.impact,
      constraints: item.constraints || item.guardrail,
      assumptions: item.assumptions,
      previousValue: item.previousValue,
      newValue: item.newValue,
    }))
  }, [aiOutputs, recommendations])

  const settledDecisions = [
    'approved',
    'accepted',
    'rejected',
    'overridden',
    'completed',
    'escalated',
    'deferred',
  ]

  const pendingCards = cards.filter((card) => {
    const decision = localDecisions[card.id] || aiDecisions[card.id]
    return !decision || !settledDecisions.includes(decision)
  })
  const decidedCards = cards.filter((card) => {
    const decision = localDecisions[card.id] || aiDecisions[card.id]
    return decision && settledDecisions.includes(decision)
  })

  async function decide(id, decision) {
    if (!reason.trim()) {
      setActionError('Enter a reason before submitting an AI review decision.')
      return
    }
    if (decision === 'overridden' && !canOverride) {
      setActionError('Override requires pricing override permission.')
      return
    }
    if (!canApprove && decision !== 'overridden') {
      setActionError('This action requires reviewer approval permission.')
      return
    }
    const normalized = decision === 'accepted' || decision === 'approved' ? 'approved' : decision
    setPendingId(id)
    const saved = onDecision ? await onDecision(id, normalized, reason) : true
    setPendingId('')
    if (saved || !onDecision) {
      setLocalDecisions((current) => ({ ...current, [id]: normalized }))
      setActionError('')
      setReason('')
    }
  }

  const renderCard = (output, decided = false) => {
    const decision =
      localDecisions[output.id] || aiDecisions[output.id] || (decided ? 'approved' : 'pending')
    const state = normalizeWorkflowState(decision, 'pending-review')
    return (
      <article
        className={`soft-copilot-card ${decided ? 'soft-copilot-card--approved' : ''}`}
        key={output.id}
      >
        <div className="soft-copilot-card__ai">
          <span className="eyebrow">{decided ? 'Business decision' : 'AI suggestion'}</span>
          <StatusChip state={state} label={decision === 'pending' ? 'pending-review' : decision} />
        </div>
        <div className="detail-chip-row">
          <StatusChip state="normal" label={output.type} />
          <StatusChip state="normal" label={output.model} />
        </div>
        <h4>{output.title}</h4>
        <p className="soft-copilot-card__reason">{output.explanation}</p>
        <ConfidenceGauge value={output.confidence} />
        <div className="soft-copilot-card__stats">
          <div>
            <span>Impact</span>
            <strong>{output.impact || '—'}</strong>
          </div>
          <div>
            <span>Range</span>
            <strong>{output.range || '—'}</strong>
          </div>
        </div>
        <dl className="soft-meta-list">
          <div>
            <dt>Constraints</dt>
            <dd>{output.constraints || '—'}</dd>
          </div>
          <div>
            <dt>Assumptions</dt>
            <dd>{output.assumptions || '—'}</dd>
          </div>
          <div>
            <dt>Previous → New</dt>
            <dd>
              {output.previousValue || output.newValue
                ? `${output.previousValue || '—'} → ${output.newValue || '—'}`
                : '—'}
            </dd>
          </div>
        </dl>
        <p className="soft-copilot-card__guard">
          {output.sourceData} · {output.timestamp}
        </p>
        <div className="soft-copilot-card__actions soft-copilot-card__actions--wrap">
          {!decided ? (
            ACTIONS.map((action) => (
              <Button
                key={action.key}
                disabled={
                  pendingId === output.id ||
                  (action.key === 'overridden' ? !canOverride : !canApprove)
                }
                onClick={() => decide(output.id, action.key)}
                size="small"
                variant={action.key === 'approved' || action.key === 'accepted' ? 'contained' : 'outlined'}
              >
                {action.label}
              </Button>
            ))
          ) : (
            <StatusChip state={state} label={`Decision: ${decision}`} />
          )}
        </div>
      </article>
    )
  }

  return (
    <div className="page-stack route-shell">
      <section className="wide-card soft-panel">
        <p className="breadcrumb">Home / AI Governance</p>
        <SectionHeader
          eyebrow="AI Recommendation Center"
          title="Optimal price, discounts, contract terms, and offers with full evidence"
        />
        <div className="soft-reason-bar">
          <TextField
            fullWidth
            helperText={reason.trim() ? ' ' : 'Required for the audit trail'}
            label="AI review reason"
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </div>
        {actionError ? <Alert severity="error">{actionError}</Alert> : null}
      </section>

      <section className="wide-card soft-panel soft-panel--ai">
        <SectionHeader
          eyebrow="AI recommendations"
          title="Model suggestions — not yet business decisions"
        />
        <p className="section-lead">
          Visually separated from approved business decisions. Accept, reject, override, escalate, or
          defer with a recorded reason.
        </p>
        <div className="soft-copilot-grid">
          {pendingCards.length ? (
            pendingCards.map((card) => renderCard(card, false))
          ) : (
            <Alert severity="success">No open AI recommendations awaiting review.</Alert>
          )}
        </div>
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader
          eyebrow="Approved business decisions"
          title="Human-authorised outcomes recorded for audit"
        />
        <div className="soft-copilot-grid">
          {decidedCards.length ? (
            decidedCards.map((card) => renderCard(card, true))
          ) : (
            <Alert severity="info">No approved or rejected decisions yet in this session.</Alert>
          )}
        </div>
      </section>
    </div>
  )
})
