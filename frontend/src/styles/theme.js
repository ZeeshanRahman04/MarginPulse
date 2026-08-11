import { createTheme } from '@mui/material/styles'
import { palette } from './palette.js'

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: palette.ink,
      dark: '#030712',
      light: palette.inkMuted,
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: palette.accentDark,
      contrastText: palette.ink,
    },
    success: { main: palette.success },
    warning: { main: palette.warning },
    error: { main: palette.danger },
    info: { main: '#64748B' },
    background: {
      default: palette.surfaceMuted,
      paper: palette.surface,
    },
    text: {
      primary: palette.ink,
      secondary: '#8B93A7',
    },
    divider: palette.border,
  },
  typography: {
    fontFamily: '"Plus Jakarta Sans", "Segoe UI", sans-serif',
    button: {
      textTransform: 'none',
      fontWeight: 700,
    },
  },
  shape: { borderRadius: 16 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderRadius: 999,
          paddingInline: 18,
        },
        containedPrimary: {
          backgroundColor: palette.ink,
          '&:hover': {
            backgroundColor: '#030712',
            boxShadow: '0 10px 24px rgba(17, 24, 39, 0.14)',
          },
        },
        containedSecondary: {
          backgroundColor: palette.accentDark,
          color: palette.ink,
          '&:hover': {
            backgroundColor: palette.accentDeep,
          },
        },
        outlined: {
          borderColor: palette.border,
          backgroundColor: palette.surface,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 700,
          borderRadius: 999,
        },
        colorSuccess: {
          backgroundColor: palette.accentSoft,
          color: '#3F6212',
        },
        colorWarning: {
          backgroundColor: '#FFF7ED',
          color: '#C2410C',
        },
        colorError: {
          backgroundColor: '#FFF1F2',
          color: '#BE123C',
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'filled',
        fullWidth: false,
      },
    },
    MuiFilledInput: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          backgroundColor: palette.surfaceChip,
          border: `1px solid ${palette.border}`,
          overflow: 'hidden',
          transition:
            'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
          '&:before, &:after': {
            display: 'none',
          },
          '&:hover': {
            backgroundColor: '#F3F5F9',
          },
          '&.Mui-focused': {
            backgroundColor: palette.surface,
            borderColor: palette.ink,
            boxShadow: `0 0 0 3px ${palette.accent}40`,
          },
          '&.Mui-error': {
            borderColor: palette.danger,
          },
          '&.Mui-error.Mui-focused': {
            boxShadow: `0 0 0 3px ${palette.danger}33`,
          },
        },
        input: {
          paddingTop: '22px',
          paddingBottom: '10px',
          fontWeight: 600,
          color: palette.ink,
        },
        inputSizeSmall: {
          paddingTop: '10px',
          paddingBottom: '10px',
        },
        multiline: {
          paddingTop: 8,
          paddingBottom: 8,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: palette.surface,
          borderRadius: 16,
          transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: palette.ink,
            borderWidth: 1,
          },
          '&.Mui-focused': {
            boxShadow: `0 0 0 3px ${palette.accent}40`,
          },
        },
        notchedOutline: {
          borderColor: palette.border,
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontWeight: 650,
          color: '#8B93A7',
          '&.Mui-focused': {
            color: palette.ink,
          },
          '&.Mui-error': {
            color: palette.danger,
          },
        },
        filled: {
          transform: 'translate(14px, 16px) scale(1)',
          '&.MuiInputLabel-shrink': {
            transform: 'translate(14px, 6px) scale(0.75)',
            fontWeight: 700,
            letterSpacing: '0.02em',
          },
        },
        sizeSmall: {
          transform: 'translate(14px, 9px) scale(1)',
          '&.MuiInputLabel-shrink': {
            transform: 'translate(14px, 4px) scale(0.75)',
          },
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          marginLeft: 6,
          marginTop: 6,
          fontWeight: 600,
          fontSize: '0.75rem',
          lineHeight: 1.35,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 18,
          animation: 'fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          height: 8,
          backgroundColor: palette.barIdle,
        },
        barColorPrimary: {
          backgroundColor: palette.accentDark,
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        filled: {
          backgroundColor: 'transparent',
        },
      },
    },
  },
})
