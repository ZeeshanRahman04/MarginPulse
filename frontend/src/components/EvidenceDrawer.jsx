import { Alert, Button, Drawer, IconButton } from '@mui/material'
import { StatusChip } from './StatusChip.jsx'

export function EvidenceDrawer({
  open,
  onClose,
  title = 'Supporting evidence',
  summary = '',
  records = [],
}) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { className: 'evidence-drawer' } }}
    >
      <div className="evidence-drawer__header">
        <div>
          <p className="eyebrow">Drill-down</p>
          <h3>{title}</h3>
          {summary ? <p>{summary}</p> : null}
        </div>
        <IconButton aria-label="Close evidence panel" onClick={onClose} size="small">
          ✕
        </IconButton>
      </div>

      <div className="evidence-drawer__body">
        {records.length ? (
          records.map((record) => (
            <article className="evidence-card" key={record.id}>
              <div className="evidence-card__top">
                <h4>{record.heading}</h4>
                <StatusChip state={record.status} />
              </div>
              <dl className="evidence-card__details">
                {(record.details || []).map((detail) => (
                  <div key={`${record.id}-${detail.label}`}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))
        ) : (
          <Alert severity="info">No underlying records are available for this summary.</Alert>
        )}
      </div>

      <div className="evidence-drawer__footer">
        <Button onClick={onClose} variant="outlined">
          Close
        </Button>
      </div>
    </Drawer>
  )
}
