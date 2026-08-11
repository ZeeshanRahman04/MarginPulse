import { Chip } from '@mui/material'
import { normalizeWorkflowState, workflowChipColor, workflowLabel } from '../utils/workflowStatus.js'

export function StatusChip({ state, label, size = 'small', ...props }) {
  const normalized = normalizeWorkflowState(state)
  return (
    <Chip
      className={`status-chip status-chip--${normalized}`}
      color={workflowChipColor(normalized)}
      label={label || workflowLabel(normalized)}
      size={size}
      variant={normalized === 'normal' ? 'outlined' : 'filled'}
      {...props}
    />
  )
}
