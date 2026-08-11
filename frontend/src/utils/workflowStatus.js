export const WORKFLOW_STATES = Object.freeze([
  'normal',
  'warning',
  'critical',
  'pending-review',
  'approved',
  'rejected',
  'completed',
])

const STATE_ALIASES = Object.freeze({
  normal: 'normal',
  ok: 'normal',
  healthy: 'normal',
  active: 'normal',
  draft: 'normal',
  warning: 'warning',
  medium: 'warning',
  caution: 'warning',
  deferred: 'warning',
  escalated: 'warning',
  critical: 'critical',
  high: 'critical',
  danger: 'critical',
  error: 'critical',
  'pending-review': 'pending-review',
  pending_review: 'pending-review',
  pending: 'pending-review',
  needs_review: 'pending-review',
  'needs-review': 'pending-review',
  awaiting: 'pending-review',
  pending_approval: 'pending-review',
  'pending-approval': 'pending-review',
  approved: 'approved',
  success: 'approved',
  implemented: 'approved',
  rejected: 'rejected',
  failed: 'rejected',
  overridden: 'rejected',
  completed: 'completed',
  realised: 'completed',
  realized: 'completed',
  contracted: 'completed',
  closed: 'completed',
})

export function normalizeWorkflowState(value, fallback = 'normal') {
  if (value == null || value === '') return fallback
  const key = String(value).trim().toLowerCase().replace(/\s+/g, '-')
  return STATE_ALIASES[key] || STATE_ALIASES[key.replace(/_/g, '-')] || fallback
}

export function workflowChipColor(state) {
  switch (normalizeWorkflowState(state)) {
    case 'approved':
    case 'completed':
    case 'normal':
      return 'success'
    case 'warning':
    case 'pending-review':
      return 'warning'
    case 'critical':
    case 'rejected':
      return 'error'
    default:
      return 'default'
  }
}

export function workflowLabel(state) {
  return normalizeWorkflowState(state)
}

export function dealWorkflowState(deal = {}) {
  return normalizeWorkflowState(deal.status, 'pending-review')
}

export function recommendationWorkflowState(
  recommendation = {},
  approvedActions = [],
  decisions = {},
) {
  const localDecision =
    decisions[recommendation.id] ||
    decisions[recommendation.segment] ||
    (typeof approvedActions === 'object' && !Array.isArray(approvedActions)
      ? approvedActions[recommendation.id] || approvedActions[recommendation.segment]
      : null)

  if (localDecision) {
    return normalizeWorkflowState(localDecision, 'pending-review')
  }

  const approvedList = Array.isArray(approvedActions) ? approvedActions : []
  if (approvedList.includes(recommendation.segment) || recommendation.status === 'approved') {
    return 'approved'
  }
  if (recommendation.status === 'rejected' || recommendation.status === 'overridden') {
    return 'rejected'
  }
  if (recommendation.status === 'realised') return 'completed'
  if (recommendation.confidence != null && Number(recommendation.confidence) < 70) {
    return 'warning'
  }
  const status = String(recommendation.status || '').toLowerCase()
  if (!status || ['draft', 'needs_review', 'pending', 'pending_review', 'pending_approval'].includes(status)) {
    return 'pending-review'
  }
  return normalizeWorkflowState(recommendation.status, 'pending-review')
}

export function withLocalDealStatus(deal = {}, dealDecisions = {}) {
  const decision = dealDecisions[deal.id] || dealDecisions[deal.quote_number]
  if (!decision) return deal
  return { ...deal, status: decision }
}

export function leakageWorkflowState(alert = {}) {
  const severity = String(alert.severity || '').toLowerCase()
  if (severity === 'high' || severity === 'critical') return 'critical'
  if (severity === 'medium' || severity === 'warning') return 'warning'
  return 'normal'
}

export function elasticityWorkflowState(item = {}) {
  const magnitude = Math.abs(Number(item.elasticity) || 0)
  if (magnitude >= 1.1) return 'critical'
  if (magnitude >= 0.7) return 'warning'
  return 'normal'
}

export function simulationWorkflowState(scenario = {}) {
  const text = `${scenario.expectedImpact || ''} ${scenario.constraints || ''}`.toLowerCase()
  if (text.includes('critical') || text.includes('breach')) return 'critical'
  if (text.includes('review') || text.includes('pending')) return 'pending-review'
  if (text.includes('approved') || text.includes('complete')) return 'completed'
  return 'normal'
}

export function cohortWorkflowState(cohort = {}) {
  const margin = Number(String(cohort.margin || '').replace(/[^\d.-]/g, ''))
  if (Number.isFinite(margin) && margin < 50) return 'critical'
  if (Number.isFinite(margin) && margin < 58) return 'warning'
  return 'normal'
}

export function scenarioResultState(result) {
  if (!result) return 'normal'
  if ((result.violations || []).length) return 'critical'
  if (result.requiresHumanReview) return 'pending-review'
  return 'normal'
}

export function buildEvidenceItems({ title, summary, records = [], fields = [] }) {
  return {
    title,
    summary,
    records: records.map((record, index) => ({
      id: record.id || `${title}-${index}`,
      heading:
        record.heading ||
        record.title ||
        record.name ||
        record.product ||
        record.quote_number ||
        record.segment ||
        record.cohort ||
        `Record ${index + 1}`,
      status: normalizeWorkflowState(
        record.status || record.severity || record.state || record.approvalStatus,
        'normal',
      ),
      details: fields.length
        ? fields
            .map((field) => ({
              label: field.label,
              value: record[field.key] ?? record[field.label] ?? '—',
            }))
            .filter((item) => item.value !== undefined && item.value !== null && item.value !== '')
        : Object.entries(record)
            .filter(([key, value]) => !['id', 'heading'].includes(key) && value != null && value !== '')
            .slice(0, 8)
            .map(([key, value]) => ({
              label: key.replace(/[_-]+/g, ' '),
              value: Array.isArray(value) ? value.join(', ') : String(value),
            })),
    })),
  }
}
