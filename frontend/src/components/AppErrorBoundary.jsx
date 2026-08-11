import { Component } from 'react'
import { Alert, Button } from '@mui/material'

export class AppErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Application render failure', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="error-screen" role="alert">
        <Alert severity="error">
          The application could not render this page. No data was changed.
        </Alert>
        <Button onClick={() => window.location.assign('/')} variant="contained">
          Return to dashboard
        </Button>
      </main>
    )
  }
}
