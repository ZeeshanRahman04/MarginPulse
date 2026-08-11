/** Shared chart / UI accent palette — keep in sync with src/styles/index.css */
export const palette = Object.freeze({
  ink: '#111827',
  inkMuted: '#374151',
  accent: '#B6E63A',
  accentDark: '#84CC16',
  accentDeep: '#65A30D',
  accentSoft: '#F7FEE7',
  surface: '#FFFFFF',
  surfaceMuted: '#F0F2F5',
  surfaceChip: '#F7F8FB',
  border: '#E7EAEF',
  grid: '#EEF1F6',
  barIdle: '#E8ECF2',
  textMuted: '#9AA3AF',
  success: '#16A34A',
  danger: '#F43F5E',
  warning: '#F59E0B',
})

export const chartTooltipStyle = Object.freeze({
  borderRadius: 14,
  border: `1px solid ${palette.border}`,
  boxShadow: '0 12px 32px rgba(17, 24, 39, 0.08)',
  fontSize: 12,
  background: palette.surface,
  color: palette.ink,
})
