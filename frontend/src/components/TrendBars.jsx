import { memo } from 'react'

export const TrendBars = memo(function TrendBars({ values }) {
  const normalizedValues = Array.isArray(values)
    ? values.map((value) => {
        const numericValue = Number(value)
        return Number.isFinite(numericValue) ? Math.min(100, Math.max(0, numericValue)) : 0
      })
    : []
  const label = normalizedValues.length
    ? `Trend values ${normalizedValues.join(', ')} percent`
    : 'Trend unavailable'

  return (
    <div
      className={`trend-bars${normalizedValues.length ? '' : ' trend-bars--empty'}`}
      aria-label={label}
      role="img"
    >
      {normalizedValues.map((value, index) => (
        <span aria-hidden="true" key={`${value}-${index}`} style={{ height: `${value}%` }} />
      ))}
    </div>
  )
})
