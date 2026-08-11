import { memo } from 'react'

export const DetailList = memo(function DetailList({ items }) {
  return (
    <dl>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
})
