import { memo } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

/**
 * Guards authenticated app routes and optional permission requirements.
 */
export const ProtectedRoute = memo(function ProtectedRoute({
  children,
  hasPermission,
  permission,
  fallbackTo = '/',
}) {
  const location = useLocation()

  if (typeof hasPermission === 'function' && permission != null) {
    if (!hasPermission(permission)) {
      return <Navigate replace state={{ from: location }} to={fallbackTo} />
    }
  }

  return children
})
