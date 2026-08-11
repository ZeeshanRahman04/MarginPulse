import { memo, useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { chartTooltipStyle, palette } from '../../styles/palette.js'

function moneyTick(value) {
  const absolute = Math.abs(Number(value) || 0)
  if (absolute >= 1000000) return `$${(absolute / 1000000).toFixed(1)}M`
  if (absolute >= 1000) return `$${Math.round(absolute / 1000)}K`
  return `$${absolute}`
}

export const RevenueBridgeChart = memo(function RevenueBridgeChart({ rows = [] }) {
  const data = useMemo(
    () =>
      rows
        .filter((row) => row.currency !== '$/learner')
        .slice(0, 6)
        .map((row) => ({
          name: String(row.stream || row.categoryLabel || 'Stream').split(' ')[0],
          actual: Number(row.actual) || 0,
          budget: Number(row.budget) || 0,
          forecast: Number(row.forecast) || 0,
        })),
    [rows],
  )

  if (!data.length) {
    return <div className="chart-empty">No revenue series available for this role.</div>
  }

  return (
    <div className="chart-frame">
      <div className="chart-frame__canvas">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
            <defs>
              <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.accentDark} stopOpacity={0.35} />
                <stop offset="100%" stopColor={palette.accentDark} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.ink} stopOpacity={0.16} />
                <stop offset="100%" stopColor={palette.ink} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={palette.grid} strokeDasharray="4 8" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: palette.textMuted, fontSize: 12, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={moneyTick}
              tick={{ fill: palette.textMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip formatter={(value) => moneyTick(value)} contentStyle={chartTooltipStyle} />
            <Area
              type="monotone"
              dataKey="budget"
              stroke={palette.border}
              strokeWidth={2}
              fill="transparent"
              strokeDasharray="5 5"
              name="Budget"
              animationDuration={700}
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke={palette.accentDeep}
              strokeWidth={2.5}
              fill="url(#actualFill)"
              name="Actual"
              animationDuration={700}
            />
            <Area
              type="monotone"
              dataKey="forecast"
              stroke={palette.ink}
              strokeWidth={2}
              fill="url(#forecastFill)"
              name="Forecast"
              animationDuration={700}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})

export const VarianceBarChart = memo(function VarianceBarChart({ rows = [] }) {
  const data = useMemo(
    () =>
      rows
        .filter((row) => row.currency !== '$/learner')
        .slice(0, 6)
        .map((row) => ({
          name: String(row.stream || 'Stream').slice(0, 12),
          variance: Number(row.variance) || 0,
        })),
    [rows],
  )

  if (!data.length) {
    return <div className="chart-empty">No variance data in scope.</div>
  }

  return (
    <div className="chart-frame chart-frame--compact">
      <div className="chart-frame__canvas chart-frame__canvas--compact">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 12, left: 4, bottom: 8 }} barCategoryGap="24%">
            <CartesianGrid stroke={palette.grid} strokeDasharray="4 8" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: palette.textMuted, fontSize: 11, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={moneyTick}
              tick={{ fill: palette.textMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip formatter={(value) => moneyTick(value)} contentStyle={chartTooltipStyle} />
            <Bar dataKey="variance" radius={[12, 12, 4, 4]} maxBarSize={40} animationDuration={650} name="Variance">
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.variance >= 0 ? palette.accentDark : palette.danger}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})

export const ConfidenceGauge = memo(function ConfidenceGauge({ value = 0 }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0))

  return (
    <div className="confidence-gauge" aria-label={`AI confidence ${clamped}%`}>
      <div className="confidence-gauge__track">
        <div className="confidence-gauge__fill" style={{ width: `${clamped}%` }} />
      </div>
      <div className="confidence-gauge__meta">
        <strong>{clamped}%</strong>
        <span>Model confidence</span>
      </div>
    </div>
  )
})

const FILL = {
  ink: palette.ink,
  accent: palette.accentDark,
  danger: palette.danger,
  warning: palette.warning,
}

export const MarginWaterfallChart = memo(function MarginWaterfallChart({ steps = [] }) {
  const data = useMemo(() => {
    let running = 0
    return steps.map((step) => {
      const value = Number(step.value) || 0
      const fill = FILL[step.fill] || palette.accentDark

      if (step.isTotal) {
        return {
          name: step.name,
          value,
          base: 0,
          rise: Math.abs(value),
          fill,
        }
      }

      const start = value >= 0 ? running : running + value
      const end = value >= 0 ? running + value : running
      running += value
      return {
        name: step.name,
        value,
        base: Math.min(start, end),
        rise: Math.abs(value),
        fill,
      }
    })
  }, [steps])

  if (!data.length) {
    return <div className="chart-empty">No margin waterfall available.</div>
  }

  return (
    <div className="chart-frame chart-frame--compact">
      <div className="chart-frame__canvas chart-frame__canvas--compact">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 12, left: 4, bottom: 8 }} barCategoryGap="28%">
            <CartesianGrid stroke={palette.grid} strokeDasharray="4 8" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: palette.textMuted, fontSize: 11, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={moneyTick}
              tick={{ fill: palette.textMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              formatter={(_value, _name, item) => moneyTick(item?.payload?.value ?? 0)}
              contentStyle={chartTooltipStyle}
            />
            <Bar
              dataKey="base"
              stackId="waterfall"
              fill="transparent"
              stroke="none"
              legendType="none"
              isAnimationActive={false}
              maxBarSize={40}
            />
            <Bar
              dataKey="rise"
              stackId="waterfall"
              maxBarSize={40}
              isAnimationActive={false}
              name="Amount"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})

export const GeoInsightsChart = memo(function GeoInsightsChart({ rows = [] }) {
  const data = useMemo(
    () =>
      rows.map((row) => ({
        name: String(row.region || 'Region')
          .replace(' Hub', '')
          .replace('Digital', 'Global')
          .slice(0, 14),
        revenue: Number(row.revenue) || 0,
        variance: Number(row.variance) || 0,
      })),
    [rows],
  )

  if (!data.length) {
    return <div className="chart-empty">No geographic revenue in scope.</div>
  }

  return (
    <div className="chart-frame chart-frame--compact">
      <div className="chart-frame__canvas chart-frame__canvas--compact">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid stroke={palette.grid} strokeDasharray="4 8" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={moneyTick}
              tick={{ fill: palette.textMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={78}
              tick={{ fill: palette.textMuted, fontSize: 11, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip formatter={(value) => moneyTick(value)} contentStyle={chartTooltipStyle} />
            <Bar dataKey="revenue" radius={[0, 12, 12, 0]} maxBarSize={22} animationDuration={650} name="Revenue">
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.variance >= 0 ? palette.accentDark : palette.ink}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})

export const RevenueTrendChart = memo(function RevenueTrendChart({ rows = [] }) {
  if (!rows.length) {
    return <div className="chart-empty">No revenue trend for the selected filters.</div>
  }

  return (
    <div className="chart-frame">
      <div className="chart-frame__canvas">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
            <defs>
              <linearGradient id="execActualFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.accentDark} stopOpacity={0.35} />
                <stop offset="100%" stopColor={palette.accentDark} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={palette.grid} strokeDasharray="4 8" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: palette.textMuted, fontSize: 12, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={moneyTick}
              tick={{ fill: palette.textMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip formatter={(value) => moneyTick(value)} contentStyle={chartTooltipStyle} />
            <Area
              type="monotone"
              dataKey="budget"
              stroke={palette.border}
              strokeWidth={2}
              fill="transparent"
              strokeDasharray="5 5"
              name="Budget"
              animationDuration={700}
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke={palette.accentDeep}
              strokeWidth={2.5}
              fill="url(#execActualFill)"
              name="Actual"
              animationDuration={700}
            />
            <Area
              type="monotone"
              dataKey="forecast"
              stroke={palette.ink}
              strokeWidth={2}
              fill="transparent"
              name="Forecast"
              animationDuration={700}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})
