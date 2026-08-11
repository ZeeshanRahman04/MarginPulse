export function filterBySearch(rows, query, fields) {
  if (!query.trim()) return rows

  const normalizedQuery = query.toLowerCase()
  return rows.filter((row) =>
    fields.some((field) => String(row[field]).toLowerCase().includes(normalizedQuery)),
  )
}

export function formatMoney(value, unit = '$') {
  const absolute = Math.abs(value)
  const formatted =
    absolute >= 1000000
      ? `${(absolute / 1000000).toFixed(2)}M`
      : absolute >= 1000
        ? `${(absolute / 1000).toFixed(0)}K`
        : absolute.toLocaleString()
  const prefix = value < 0 ? '-' : ''
  return unit === '$/learner' ? `${prefix}$${formatted}/learner` : `${prefix}${unit}${formatted}`
}
