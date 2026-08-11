import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TrendBars } from '../components/TrendBars.jsx'
import { pageCatalog } from '../data/pageCatalog.js'
import { ConfiguredPage } from '../features/pages/ConfiguredPage.jsx'
import { ScenarioLab } from '../features/scenarios/ScenarioLab.jsx'
import { filterBySearch, formatMoney } from '../utils/formatters.js'

const page = {
  label: 'Test Page',
  eyebrow: 'Testing',
  title: 'Edge-case controls',
  api: '/api/v1/test',
  filters: ['Status'],
  actions: ['Approve', 'Export CSV', 'Generate report'],
  cards: [['Records', '1', 'stable']],
  rows: [['Record A', '$10', 'Pending', 'Evidence']],
}

describe('ConfiguredPage', () => {
  it('blocks unauthorized approval and export actions', async () => {
    const user = userEvent.setup()
    render(
      <ConfiguredPage
        canApprove={false}
        canExport={false}
        globalSearch=""
        page={page}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(screen.getByText(/requires reviewer approval permission/i)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(screen.getByText(/export is restricted/i)).toBeVisible()
  })

  it('shows an empty state when global search has no matches', () => {
    render(
      <ConfiguredPage
        canApprove
        canExport
        globalSearch="missing record"
        page={page}
      />,
    )

    expect(screen.getByText(/no records match/i)).toBeVisible()
  })

  it('reports pending and successful action states', async () => {
    const user = userEvent.setup()
    render(
      <ConfiguredPage canApprove canExport globalSearch="" page={page} />,
    )

    await user.click(screen.getByRole('button', { name: 'Generate report' }))
    expect(screen.getByText('pending-review')).toBeVisible()
    expect(screen.getByText(/generate report completed/i)).toBeVisible()
  })

  it('opens drill-down evidence for a record', async () => {
    const user = userEvent.setup()
    render(<ConfiguredPage canApprove canExport globalSearch="" page={page} />)

    await user.click(screen.getByRole('button', { name: 'Drill down' }))
    expect(screen.getByText(/opened drill-down for record a/i)).toBeVisible()
    expect(screen.getByText(/test page record detail/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Close' })).toBeVisible()
  })
})

describe('formatting and search utilities', () => {
  const rows = [
    { name: 'Enterprise Licence', status: 'Approved' },
    { name: 'Career Bootcamp', status: 'Pending' },
  ]

  it('returns all rows for blank search and matches case-insensitively', () => {
    expect(filterBySearch(rows, '  ', ['name'])).toHaveLength(2)
    expect(filterBySearch(rows, 'enterprise', ['name'])).toEqual([rows[0]])
    expect(filterBySearch(rows, 'PENDING', ['status'])).toEqual([rows[1]])
  })

  it('formats positive, negative, million, thousand, and LTV values', () => {
    expect(formatMoney(2180000)).toBe('$2.18M')
    expect(formatMoney(820000)).toBe('$820K')
    expect(formatMoney(-80000)).toBe('-$80K')
    expect(formatMoney(1660, '$/learner')).toBe('$2K/learner')
  })
})

describe('navigation and graph integrity', () => {
  it('uses unique absolute paths and labels for every configured route', () => {
    const paths = pageCatalog.map(({ path }) => path)
    const labels = pageCatalog.map(({ label }) => label)

    expect(new Set(paths).size).toBe(paths.length)
    expect(new Set(labels).size).toBe(labels.length)
    expect(paths.every((path) => /^\/[a-z0-9-]+$/.test(path))).toBe(true)
  })

  it('clamps trend values and exposes an accessible graph description', () => {
    const { container } = render(<TrendBars values={[-20, 50, 120, Number.NaN]} />)
    const graph = screen.getByRole('img', {
      name: 'Trend values 0, 50, 100, 0 percent',
    })
    const bars = container.querySelectorAll('.trend-bars span')

    expect(graph).toBeVisible()
    expect([...bars].map((bar) => bar.style.height)).toEqual(['0%', '50%', '100%', '0%'])
  })

  it('renders an accessible empty trend state', () => {
    render(<TrendBars />)
    expect(screen.getByRole('img', { name: 'Trend unavailable' })).toBeVisible()
  })

  it('renders elasticity graphs and graph empty states', () => {
    const { rerender } = render(
      <ScenarioLab
        cohorts={[]}
        elasticity={[
          {
            product: 'Enterprise Licence',
            elasticity: -0.39,
            demandShift: '-1.7%',
            marginImpact: '+$118K',
          },
        ]}
        leakageAlerts={[]}
        simulations={[]}
      />,
    )

    expect(
      screen.getByRole('img', {
        name: 'Enterprise Licence price elasticity magnitude 0.39',
      }),
    ).toBeVisible()
    expect(screen.getByText(/no simulation results/i)).toBeVisible()

    rerender(
      <ScenarioLab
        cohorts={[]}
        elasticity={[]}
        leakageAlerts={[]}
        simulations={[]}
      />,
    )
    expect(screen.getByText(/elasticity graph data is unavailable/i)).toBeVisible()
  })

  it('normalises workflow states used by pricing simulation and deal approval', async () => {
    const { normalizeWorkflowState, dealWorkflowState, recommendationWorkflowState } = await import(
      '../utils/workflowStatus.js'
    )
    expect(normalizeWorkflowState('pending_approval')).toBe('pending-review')
    expect(normalizeWorkflowState('needs_review')).toBe('pending-review')
    expect(dealWorkflowState({ status: 'approved' })).toBe('approved')
    expect(recommendationWorkflowState({ status: 'draft', confidence: 65 }, [])).toBe('warning')
    expect(recommendationWorkflowState({ segment: 'Enterprise', status: 'draft' }, ['Enterprise'])).toBe(
      'approved',
    )
  })
})
