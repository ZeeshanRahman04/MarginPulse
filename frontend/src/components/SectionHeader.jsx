import { memo } from 'react'

export const SectionHeader = memo(function SectionHeader({ eyebrow, title, children }) {
  return (
    <div className="section-heading">
      <div className="section-heading__copy">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h3>{title}</h3>
      </div>
      {children ? <div className="section-heading__actions">{children}</div> : null}
    </div>
  )
})
