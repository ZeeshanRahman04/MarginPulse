import { describe, expect, it } from 'vitest'
import {
  getAccessibleSavedViews,
  resolveSavedView,
  savedViewCatalog,
} from '../data/savedViews.js'
import { mapPermissions } from '../services/intelligenceClient.js'

function permissionChecker(codes) {
  const permissions = mapPermissions(codes)
  return (permission) => {
    if (Array.isArray(permission)) {
      return permission.some((item) => {
        if (item === 'base') return true
        return permissions.includes('allData') || permissions.includes(item)
      })
    }
    if (permission === 'base') return true
    return permissions.includes('allData') || permissions.includes(permission)
  }
}

const rolePermissionCodes = {
  'Sales User': ['enterprise:read'],
  'Pricing Manager': ['finance:read', 'pricing:write', 'deals:approve', 'ai:override'],
  'Finance Controller': ['finance:read', 'deals:approve'],
  Executive: ['admin:manage'],
  Administrator: ['admin:manage', 'users:manage', 'configuration:manage'],
}

describe('saved workspace views', () => {
  it('keeps a stable catalog of navigable workspace views', () => {
    expect(savedViewCatalog.map((view) => view.label)).toEqual([
      'Executive margin view',
      'Live revenue view',
      'Pricing review queue',
      'Pricing & deals',
      'Notifications',
    ])
  })

  it.each([
    [
      'Sales User',
      [
        'Executive margin view',
        'Live revenue view',
        'Pricing & deals',
        'Notifications',
      ],
    ],
    [
      'Pricing Manager',
      [
        'Executive margin view',
        'Live revenue view',
        'Pricing review queue',
        'Pricing & deals',
        'Notifications',
      ],
    ],
    [
      'Finance Controller',
      [
        'Executive margin view',
        'Live revenue view',
        'Pricing review queue',
        'Pricing & deals',
        'Notifications',
      ],
    ],
    [
      'Executive',
      [
        'Executive margin view',
        'Live revenue view',
        'Pricing review queue',
        'Pricing & deals',
        'Notifications',
      ],
    ],
    [
      'Administrator',
      [
        'Executive margin view',
        'Live revenue view',
        'Pricing review queue',
        'Pricing & deals',
        'Notifications',
      ],
    ],
  ])('filters dropdown options for %s', (role, expectedLabels) => {
    const views = getAccessibleSavedViews(permissionChecker(rolePermissionCodes[role]))
    expect(views.map((view) => view.label)).toEqual(expectedLabels)
  })

  it('resolves the active view from the current route', () => {
    const views = getAccessibleSavedViews(permissionChecker(rolePermissionCodes.Executive))
    expect(resolveSavedView('/', views)?.label).toBe('Executive margin view')
    expect(resolveSavedView('/dashboards', views)?.label).toBe('Live revenue view')
    expect(resolveSavedView('/recommendations-impact', views)?.label).toBe(
      'Pricing review queue',
    )
    expect(resolveSavedView('/notifications-page', views)?.label).toBe('Notifications')
    expect(resolveSavedView('/ai', views)).toBeNull()
  })
})
