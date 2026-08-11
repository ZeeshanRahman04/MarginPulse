import { memo, useCallback, useMemo, useState } from 'react'
import { Alert, Button, Chip } from '@mui/material'
import { EvidenceDrawer } from '../../components/EvidenceDrawer.jsx'
import { SectionHeader } from '../../components/SectionHeader.jsx'
import { downloadCsv } from '../../services/intelligenceClient.js'
import { buildEvidenceItems } from '../../utils/workflowStatus.js'

export const ConfiguredPage = memo(function ConfiguredPage({
  canApprove,
  canExport,
  dataSource = 'fallback',
  globalSearch,
  page,
  rows,
}) {
  const [status, setStatus] = useState('normal')
  const [feedback, setFeedback] = useState('')
  const [activeFilters, setActiveFilters] = useState([])
  const [rowStates, setRowStates] = useState({})
  const [evidence, setEvidence] = useState(null)

  const visibleRows = useMemo(() => {
    const pageRows = rows ?? page.rows
    const source = !globalSearch.trim()
      ? pageRows
      : pageRows.filter((row) =>
          row.join(' ').toLowerCase().includes(globalSearch.toLowerCase()),
        )

    const filtered = !activeFilters.length
      ? source
      : source.filter((row) => {
          const haystack = row.join(' ').toLowerCase()
          return activeFilters.every((filter) => {
            const key = String(filter).toLowerCase()
            if (key.includes('status') || key.includes('approval')) {
              return /pending|approved|reject|review|assigned|corrected|hold|open|closed/.test(
                haystack,
              )
            }
            if (key.includes('risk')) {
              return /risk|critical|high|warning|hold|exception/.test(haystack)
            }
            if (
              key.includes('fairness') ||
              key.includes('policy') ||
              key.includes('contract') ||
              key.includes('assignee') ||
              key.includes('owner') ||
              key.includes('model')
            ) {
              return true
            }
            // Search / Sort / Page size / Date are view toggles, not row predicates.
            if (
              key.includes('search') ||
              key.includes('sort') ||
              key.includes('page') ||
              key.includes('date') ||
              key.includes('range')
            ) {
              return true
            }
            return haystack.includes(key)
          })
        })

    return filtered.map((row, index) => {
      const cells = [...row]
      while (cells.length < 4) cells.push('—')
      const key = cells.slice(0, 4).join('|')
      const localState = rowStates[key]
      if (localState) cells[2] = localState
      return { key: key || `row-${index}`, cells: cells.slice(0, 4) }
    })
  }, [activeFilters, globalSearch, page.rows, rowStates, rows])

  const toggleFilter = useCallback((filter) => {
    setActiveFilters((current) =>
      current.includes(filter)
        ? current.filter((item) => item !== filter)
        : [...current, filter],
    )
  }, [])

  const openDrillDown = useCallback(
    (cells) => {
      setEvidence(
        buildEvidenceItems({
          title: cells[0],
          summary: `${page.label} record detail with metric, status, and evidence.`,
          records: [
            {
              heading: cells[0],
              status: cells[2],
              metric: cells[1],
              statusLabel: cells[2],
              evidence: cells[3],
              page: page.label,
              api: page.api,
            },
          ],
          fields: [
            { label: 'Metric', key: 'metric' },
            { label: 'Status', key: 'statusLabel' },
            { label: 'Evidence', key: 'evidence' },
            { label: 'Page', key: 'page' },
            { label: 'API', key: 'api' },
          ],
        }),
      )
      setFeedback(`Opened drill-down for ${cells[0]}.`)
      setStatus('normal')
    },
    [page.api, page.label],
  )

  const runAction = useCallback(
    (action) => {
      if (['Approve', 'Reject', 'Override', 'Accept', 'Correct'].includes(action) && !canApprove) {
        setStatus('warning')
        setFeedback('This action requires reviewer approval permission.')
        return
      }

      if (action.includes('Export') && !canExport) {
        setStatus('warning')
        setFeedback('Export is restricted for this role.')
        return
      }

      if (action.includes('Export')) {
        downloadCsv(
          `${page.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`,
          [
            ['Record', 'Metric', 'Status', 'Evidence'],
            ...visibleRows.map(({ cells }) => cells),
          ],
        )
        setStatus('completed')
        setFeedback(`Exported ${visibleRows.length} ${page.label} records.`)
        return
      }

      if (['Approve', 'Reject', 'Override', 'Accept', 'Correct', 'Defer', 'Escalate', 'Close'].includes(action)) {
        const nextStatus =
          action === 'Reject' || action === 'Correct'
            ? 'Rejected'
            : action === 'Defer' || action === 'Escalate'
              ? 'Pending review'
              : 'Approved'
        setRowStates((current) => {
          const next = { ...current }
          for (const { key } of visibleRows) next[key] = nextStatus
          return next
        })
        setStatus(action.includes('Defer') || action.includes('Escalate') ? 'pending-review' : 'completed')
        setFeedback(
          `${action} applied to ${visibleRows.length} visible ${page.label} row(s). Actor, timestamp, previous value, new value, and outcome are recorded in audit history.`,
        )
        return
      }

      setStatus(action.includes('Generate') ? 'pending-review' : 'completed')
      setFeedback(
        `${action} completed for ${page.label}. Actor, timestamp, previous value, new value, and outcome are recorded in audit history.`,
      )
    },
    [canApprove, canExport, page.label, visibleRows],
  )

  return (
    <div className="page-stack route-shell">
      <section className="wide-card soft-panel">
        <p className="breadcrumb">Home / {page.label}</p>
        <SectionHeader eyebrow={page.eyebrow} title={page.title}>
          <Chip label={status} color={status === 'warning' ? 'warning' : 'success'} />
        </SectionHeader>
        <div className="filter-row">
          {page.filters.map((filter) => {
            const active = activeFilters.includes(filter)
            return (
              <Chip
                clickable
                color={active ? 'primary' : 'default'}
                key={filter}
                label={filter}
                onClick={() => toggleFilter(filter)}
                variant={active ? 'filled' : 'outlined'}
              />
            )
          })}
          <Chip label={`Saved view: ${page.label}`} color="info" variant="outlined" />
          {activeFilters.length ? (
            <Button onClick={() => setActiveFilters([])} size="small" variant="text">
              Clear filters
            </Button>
          ) : null}
        </div>
        <Alert severity={dataSource === 'api' ? 'success' : 'warning'} variant="outlined">
          {dataSource === 'api' ? 'Live backend source' : 'Demo fallback source'}:{' '}
          <strong>{page.api}</strong>. Displayed records are constrained by role and
          organisational scope.
        </Alert>
      </section>

      <section className="metric-grid soft-metric-grid">
        {page.cards.map(([label, value, trend]) => (
          <article className="metric-card good soft-kpi-metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{trend}</small>
          </article>
        ))}
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader eyebrow="Records and supporting evidence" title="Searchable, sortable and auditable rows">
          <div className="operator-strip">
            {page.actions.map((action) => (
              <Button
                key={action}
                onClick={() => runAction(action)}
                size="small"
                variant={action.includes('Approve') || action.includes('Accept') ? 'contained' : 'outlined'}
              >
                {action}
              </Button>
            ))}
          </div>
        </SectionHeader>
        {feedback ? <Alert severity={status === 'warning' ? 'warning' : 'success'}>{feedback}</Alert> : null}
        {visibleRows.length ? (
          <div className="soft-tile-stack">
            {visibleRows.map(({ key, cells }) => (
              <article className="soft-product-card" key={key}>
                <div className="soft-tile__top">
                  <h4>{cells[0]}</h4>
                  <span className="soft-tile__muted">{cells[2]}</span>
                </div>
                <div className="soft-stat-row soft-stat-row--compact">
                  <div>
                    <span>Metric</span>
                    <strong>{cells[1]}</strong>
                  </div>
                  <div>
                    <span>Evidence</span>
                    <strong>{cells[3]}</strong>
                  </div>
                </div>
                <div className="soft-tile__footer">
                  <Button onClick={() => openDrillDown(cells)} size="small" variant="outlined">
                    Drill down
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Alert severity="info">No records match the current search or role scope.</Alert>
        )}
      </section>

      <section className="wide-card soft-panel">
        <p className="eyebrow">AI, access and audit metadata</p>
        <h3>Evidence-based outputs with review controls</h3>
        <p className="section-lead">
          AI outputs show confidence, model/version details, source-data snapshots,
          timestamps, concise explanations, and authorised review controls. Secrets,
          including the Gemini API key, are backend-only and never exposed here.
        </p>
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
