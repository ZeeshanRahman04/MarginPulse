/**
 * Header workspace-view shortcuts.
 * Each option maps to a real app route and is filtered by RBAC permissions.
 */
export const savedViewCatalog = [
  {
    id: 'executive-margin',
    label: 'Executive margin view',
    path: '/',
    permission: 'base',
  },
  {
    id: 'live-revenue',
    label: 'Live revenue view',
    path: '/dashboards',
    permission: ['financeData', 'enterpriseData'],
  },
  {
    id: 'pricing-review',
    label: 'Pricing review queue',
    path: '/recommendations-impact',
    permission: 'approveDeals',
  },
  {
    id: 'pricing-deals',
    label: 'Pricing & deals',
    path: '/pricing',
    permission: ['pricingData', 'enterpriseData'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    path: '/notifications-page',
    permission: 'base',
  },
]

export function getAccessibleSavedViews(hasPermission) {
  if (typeof hasPermission !== 'function') return []
  return savedViewCatalog.filter((view) => hasPermission(view.permission))
}

export function resolveSavedView(pathname, views = []) {
  return views.find((view) => view.path === pathname) || null
}

export const savedViewLabels = savedViewCatalog.map((view) => view.label)
