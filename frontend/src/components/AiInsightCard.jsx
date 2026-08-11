import { memo } from 'react'
import { Chip } from '@mui/material'
import { StatusChip } from './StatusChip.jsx'

export const AiInsightCard = memo(function AiInsightCard({
  title = 'AI insight',
  impact,
  confidence,
  reason,
  guardrail,
  status = 'pending-review',
  children,
}) {
  return (
    <article className="ai-insight-card">
      <div className="ai-insight-card__glow" aria-hidden="true" />
      <div className="ai-insight-card__top">
        <div>
          <p className="eyebrow">AI-powered insight</p>
          <h3>{title}</h3>
        </div>
        <div className="ai-insight-card__badges">
          {impact ? <Chip color="success" label={impact} size="small" /> : null}
          <StatusChip state={status} />
        </div>
      </div>
      {reason ? <p className="ai-insight-card__reason">{reason}</p> : null}
      <div className="ai-insight-card__footer">
        <div>
          <span>Confidence</span>
          <strong>{Math.min(100, Number(confidence) || 0)}%</strong>
        </div>
        <small>{guardrail || 'Human approval required before material pricing changes.'}</small>
      </div>
      {children}
    </article>
  )
})
