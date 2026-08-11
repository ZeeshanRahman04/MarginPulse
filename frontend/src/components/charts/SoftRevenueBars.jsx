import { memo, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { palette } from '../../styles/palette.js'

function compactMoney(value) {
  const absolute = Math.abs(Number(value) || 0)
  if (absolute >= 1000000) return `${(absolute / 1000000).toFixed(1)}m`
  if (absolute >= 1000) return `${Math.round(absolute / 1000)}k`
  return String(Math.round(absolute))
}

function SoftTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  return (
    <div className="soft-chart-tooltip">
      <strong>${compactMoney(point?.actual)}</strong>
      <span>{point?.fullName}</span>
    </div>
  )
}

function ActiveValueLabel(props) {
  const { x, y, width, value, index, activeIndex } = props
  if (index !== activeIndex || value == null || x == null || y == null) return null
  return (
    <text
      x={x + width / 2}
      y={y - 10}
      textAnchor="middle"
      className="soft-chart-label"
    >
      {compactMoney(value)}
    </text>
  )
}

export const SoftRevenueBars = memo(function SoftRevenueBars({
  rows = [],
  activeKey,
  onSelect,
}) {
  const data = useMemo(
    () =>
      rows
        .filter((row) => row.currency !== '$/learner')
        .slice(0, 8)
        .map((row) => ({
          key: row.id,
          name: String(row.stream || 'Stream')
            .replace(/licences?/i, 'Lic.')
            .split(' ')
            .slice(0, 2)
            .join(' '),
          fullName: row.stream,
          actual: Number(row.actual) || 0,
          variance: Number(row.variance) || 0,
        })),
    [rows],
  )
  const [hoverKey, setHoverKey] = useState(null)
  const selectedKey = activeKey || hoverKey || data[Math.min(2, Math.max(data.length - 1, 0))]?.key
  const activeIndex = data.findIndex((row) => row.key === selectedKey)
  const total = data.reduce((sum, row) => sum + row.actual, 0)
  const maxActual = Math.max(...data.map((row) => row.actual), 1)

  if (!data.length) {
    return <div className="chart-empty">No revenue bars available for this role.</div>
  }

  return (
    <div className="soft-chart">
      <div className="soft-chart__watermark" aria-hidden="true">
        ${compactMoney(total)}
      </div>
      <div className="soft-chart__canvas">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 36, right: 12, left: 4, bottom: 8 }}
            barCategoryGap="28%"
            onMouseLeave={() => setHoverKey(null)}
          >
            <defs>
              <linearGradient id="softBarActive" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.accent} />
                <stop offset="100%" stopColor={palette.accentDark} />
              </linearGradient>
            </defs>
            <YAxis hide domain={[0, maxActual * 1.18]} />
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              interval={0}
              tick={{ fill: palette.textMuted, fontSize: 11, fontWeight: 600 }}
              height={36}
            />
            <Tooltip
              cursor={{ fill: 'rgba(17, 24, 39, 0.03)', radius: 12 }}
              content={<SoftTooltip />}
              wrapperStyle={{ outline: 'none' }}
            />
            <Bar
              dataKey="actual"
              radius={[16, 16, 16, 16]}
              maxBarSize={48}
              isAnimationActive
              animationDuration={650}
              animationEasing="ease-out"
              onMouseEnter={(_, index) => setHoverKey(data[index]?.key)}
              onClick={(_, index) => onSelect?.(data[index]?.key)}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.key}
                  cursor="pointer"
                  fill={entry.key === selectedKey ? 'url(#softBarActive)' : palette.barIdle}
                />
              ))}
              <LabelList
                dataKey="actual"
                content={(props) => (
                  <ActiveValueLabel {...props} activeIndex={activeIndex} />
                )}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})
