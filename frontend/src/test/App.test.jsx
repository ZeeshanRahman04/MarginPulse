import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../app/App.jsx'
import { pageCatalog } from '../data/pageCatalog.js'
import {
  IntelligenceApiError,
  intelligenceClient,
} from '../services/intelligenceClient.js'

const recommendationId = '11111111-1111-4111-8111-111111111111'

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function liveResponse(url) {
  if (url.startsWith('/notifications')) return { data: { data: [] } }
  if (url.startsWith('/products')) {
    return {
      data: {
        data: [{ id: 'product-1', name: 'Enterprise Licence', product_type: 'enterprise', status: 'active' }],
      },
    }
  }
  if (url.startsWith('/revenue-bridges')) {
    return {
      data: {
        data: [{
          productId: 'product-1',
          product: 'Enterprise Licence',
          productType: 'enterprise',
          actual: 100000,
          budget: 90000,
          forecast: 110000,
          varianceToBudget: 10000,
        }],
      },
    }
  }
  if (url.startsWith('/ai/revenue-intelligence')) {
    return {
      data: {
        modelVersion: 'MarginPulse-Test-v1',
        forecasts: [],
        elasticity: [],
        monitoring: { accuracyValue: 5.8 },
      },
    }
  }
  if (url.startsWith('/recommendations')) {
    return {
      data: {
        data: [{
          id: recommendationId,
          title: 'Enterprise floor price',
          expected_impact: 91000,
          confidence_low: 80,
          confidence_high: 94,
          rationale: 'Demand and margin support a controlled increase.',
          status: 'pending',
        }],
      },
    }
  }
  return { data: { data: [] } }
}

const roleCases = [
  ['Sales User', ['enterprise:read']],
  ['Pricing Manager', ['finance:read', 'pricing:write', 'deals:approve', 'ai:override']],
  ['Finance Controller', ['finance:read', 'deals:approve']],
  ['Executive', ['admin:manage']],
  ['Administrator', ['admin:manage', 'users:manage', 'configuration:manage']],
]

describe('frontend API integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.spyOn(intelligenceClient, 'get').mockImplementation(async (url) => liveResponse(url))
  })

  it.each(roleCases)('derives the %s role from the authenticated backend user', async (role, permissions) => {
    vi.spyOn(intelligenceClient, 'post').mockResolvedValue({
      data: {
        token: `token-${role}`,
        user: { email: `${role.toLowerCase().replaceAll(' ', '.')}@example.com`, role },
        permissions,
      },
    })
    renderApp()

    await screen.findByRole('heading', { name: /sign in to continue/i })
    fireEvent.click(screen.getByRole('button', { name: /sign in securely/i }))

    expect(await screen.findByText(`Viewing as ${role}`, { exact: false })).toBeVisible()
    // Shell no longer exposes a demo "Role" switcher; /users may still label filters "Role".
    expect(screen.queryByLabelText('Switch demo role')).not.toBeInTheDocument()
  })

  it('shows backend authentication errors and completes an MFA challenge', async () => {
    const post = vi
      .spyOn(intelligenceClient, 'post')
      .mockRejectedValueOnce(
        new IntelligenceApiError('Invalid email or password.', {
          code: 'AUTH_INVALID_CREDENTIALS',
          status: 401,
        }),
      )
      .mockResolvedValueOnce({
        data: {
          token: 'executive-token',
          user: { email: 'manager@edtech.example', role: 'Executive' },
          permissions: ['admin:manage'],
        },
      })
    renderApp()
    await screen.findByRole('heading', { name: /sign in to continue/i })
    expect(screen.getByLabelText(/mfa code/i)).toHaveValue('123456')
    expect(screen.getByText(/demo mfa code: 123456/i)).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /sign in securely/i }))
    expect(await screen.findByText(/invalid email or password/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /sign in securely/i }))

    expect(await screen.findByText(/viewing as executive/i)).toBeVisible()
    expect(post).toHaveBeenLastCalledWith(
      '/auth/login',
      expect.objectContaining({ mfaCode: '123456' }),
      expect.objectContaining({ skipAuthRefresh: true, skipAuthHeader: true }),
    )
  })

  it('shows loading and an explicit demo fallback when the API is unavailable', async () => {
    let finishLogin
    vi.spyOn(intelligenceClient, 'post').mockReturnValueOnce(
      new Promise((resolve) => {
        finishLogin = resolve
      }),
    )
    renderApp()
    await screen.findByRole('heading', { name: /sign in to continue/i })
    fireEvent.click(screen.getByRole('button', { name: /sign in securely/i }))
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0)
    intelligenceClient.get.mockRejectedValue(
      new IntelligenceApiError('The MarginPulse API is unreachable.', { status: 0 }),
    )
    finishLogin({
      data: {
        token: 'token',
        user: { email: 'manager@edtech.example', role: 'Executive' },
        permissions: ['admin:manage'],
      },
    })

    expect(await screen.findByText(/demo fallback data is displayed/i)).toBeVisible()
    expect(screen.getByText(/overall health of the business/i)).toBeVisible()
  })

  it('guards privileged routes using backend permission codes', async () => {
    vi.spyOn(intelligenceClient, 'post').mockResolvedValue({
      data: {
        token: 'sales-token',
        user: { email: 'sales@example.com', role: 'Sales User' },
        permissions: ['enterprise:read'],
      },
    })
    renderApp('/users')
    await screen.findByRole('heading', { name: /sign in to continue/i })
    fireEvent.click(screen.getByRole('button', { name: /sign in securely/i }))

    expect(await screen.findByText(/overall health of the business/i)).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Users & Roles' })).not.toBeInTheDocument()
  })

  it('persists recommendation and AI decisions with reasons and idempotency keys', async () => {
    const post = vi.spyOn(intelligenceClient, 'post').mockImplementation(async (url) => {
      if (url === '/auth/login') {
        return {
          data: {
            token: 'executive-token',
            user: { email: 'manager@edtech.example', role: 'Executive' },
            permissions: ['admin:manage', 'deals:approve', 'ai:override'],
          },
        }
      }
      return { data: { saved: true } }
    })
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: /sign in to continue/i })
    await user.click(screen.getByRole('button', { name: /sign in securely/i }))
    await screen.findByText(/viewing as executive/i)

    await user.click(screen.getByRole('link', { name: 'Pricing Simulation & Deals' }))
    fireEvent.change(screen.getByLabelText(/decision reason/i), {
      target: { value: 'Approved after reviewing margin guardrails.' },
    })
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        `/recommendations/${recommendationId}/review`,
        {
          decision: 'approved',
          reason: 'Approved after reviewing margin guardrails.',
        },
        { headers: { 'Idempotency-Key': expect.any(String) } },
      ),
    )

    await user.click(screen.getByRole('link', { name: 'AI Governance' }))
    fireEvent.change(screen.getByLabelText(/ai review reason/i), {
      target: { value: 'Model evidence is consistent with the reviewed quote.' },
    })
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/ai/feedback',
        expect.objectContaining({
          recommendationId,
          decision: 'accepted',
        }),
        { headers: { 'Idempotency-Key': expect.any(String) } },
      ),
    )
  })

  it('restores persisted sessions through GET /me and keeps password controls accessible', async () => {
    window.localStorage.setItem('rpm-access-token', 'remembered-token')
    window.localStorage.setItem('rpm-session-user', JSON.stringify({ email: 'old@example.com' }))
    window.localStorage.setItem('rpm-session-permissions', '[]')
    intelligenceClient.get.mockImplementation(async (url, config) => {
      if (url === '/me') {
        expect(config).toEqual(
          expect.objectContaining({ skipAuthRefresh: true, suppressSessionExpiry: true }),
        )
        return {
          data: {
            user: { email: 'manager@edtech.example', role: 'Executive' },
            permissions: ['admin:manage'],
          },
        }
      }
      return liveResponse(url)
    })
    renderApp()
    expect(await screen.findByText(/viewing as executive/i)).toBeVisible()
    expect(window.localStorage.getItem('rpm-access-token')).toBe('remembered-token')
  })

  it('clears stale saved sessions quietly without a session-expired toast', async () => {
    window.localStorage.setItem('rpm-access-token', 'stale-token')
    window.localStorage.setItem('rpm-refresh-token', 'stale-refresh')
    window.localStorage.setItem('rpm-session-user', JSON.stringify({ email: 'old@example.com' }))
    window.localStorage.setItem('rpm-session-permissions', '[]')
    intelligenceClient.get.mockImplementation(async (url) => {
      if (url === '/me') {
        throw new IntelligenceApiError('Token invalid.', {
          code: 'AUTH_INVALID_TOKEN',
          status: 401,
        })
      }
      return liveResponse(url)
    })
    vi.spyOn(intelligenceClient, 'post').mockRejectedValue(
      new IntelligenceApiError('Refresh token is invalid or expired.', {
        code: 'AUTH_REFRESH_INVALID',
        status: 401,
      }),
    )
    renderApp()
    expect(await screen.findByRole('heading', { name: /sign in to continue/i })).toBeVisible()
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument()
    expect(await screen.findByText(/please sign in again to continue/i)).toBeVisible()
    expect(window.localStorage.getItem('rpm-access-token')).toBeNull()
  })

  it('redirects each role to its home dashboard after JWT sign-in', async () => {
    vi.spyOn(intelligenceClient, 'post').mockResolvedValue({
      data: {
        token: 'pricing-token',
        user: { email: 'pricing@edtech.example', role: 'Pricing Manager' },
        permissions: ['finance:read', 'pricing:write', 'deals:approve', 'ai:override'],
      },
    })
    renderApp('/')
    await screen.findByRole('heading', { name: /sign in to continue/i })
    fireEvent.click(screen.getByRole('button', { name: /sign in securely/i }))
    expect(await screen.findByText(/viewing as pricing manager/i)).toBeVisible()
    expect(await screen.findByText(/price simulations, leakage alerts, and quote decisions/i)).toBeVisible()
  })

  it('opens the Executive dashboard at `/` after sign-in instead of staying on SignIn', async () => {
    window.localStorage.setItem('rpm-access-token', 'stale-token')
    window.localStorage.setItem('rpm-refresh-token', 'stale-refresh')
    window.localStorage.setItem(
      'rpm-session-user',
      JSON.stringify({ email: 'stale@example.com', role: 'Executive' }),
    )
    window.localStorage.setItem('rpm-session-permissions', JSON.stringify(['admin:manage']))

    intelligenceClient.get.mockImplementation(async (url) => {
      if (url === '/me') {
        throw new IntelligenceApiError('Token invalid.', {
          code: 'AUTH_INVALID_TOKEN',
          status: 401,
        })
      }
      return liveResponse(url)
    })
    vi.spyOn(intelligenceClient, 'post').mockImplementation(async (url) => {
      if (url === '/auth/login') {
        return {
          data: {
            token: 'fresh-executive-token',
            refreshToken: 'fresh-refresh',
            user: { email: 'manager@edtech.example', role: 'Executive' },
            roles: ['Executive'],
            permissions: ['admin:manage', 'finance:read'],
          },
        }
      }
      if (url === '/auth/refresh') {
        throw new IntelligenceApiError('Refresh token is invalid or expired.', {
          code: 'AUTH_REFRESH_INVALID',
          status: 401,
        })
      }
      return { data: {} }
    })

    renderApp('/')
    expect(await screen.findByRole('heading', { name: /sign in to continue/i })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /sign in securely/i }))

    expect(await screen.findByText(/viewing as executive/i)).toBeVisible()
    expect(screen.queryByRole('heading', { name: /sign in to continue/i })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('rpm-access-token')).toBe('fresh-executive-token')
  })

  it('navigates role-filtered workspace views from the header dropdown', async () => {
    vi.spyOn(intelligenceClient, 'post').mockResolvedValue({
      data: {
        token: 'executive-token',
        user: { email: 'manager@edtech.example', role: 'Executive' },
        permissions: ['admin:manage', 'deals:approve'],
      },
    })
    renderApp()
    await screen.findByRole('heading', { name: /sign in to continue/i })
    fireEvent.click(screen.getByRole('button', { name: /sign in securely/i }))
    expect(await screen.findByText(/viewing as executive/i)).toBeVisible()

    const viewSelect = await screen.findByLabelText('Workspace view')
    expect(viewSelect).toHaveTextContent('Executive margin view')
    fireEvent.mouseDown(viewSelect)
    expect(screen.getByRole('option', { name: 'Live revenue view' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Pricing review queue' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Notifications' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Pricing & deals' })).toBeVisible()

    fireEvent.click(screen.getByRole('option', { name: 'Live revenue view' }))
    expect(await screen.findByRole('heading', { name: 'Live revenue view' })).toBeVisible()
    expect(screen.getByText(/revenue and profitability/i)).toBeVisible()

    fireEvent.mouseDown(screen.getByLabelText('Workspace view'))
    fireEvent.click(screen.getByRole('option', { name: 'Pricing review queue' }))
    expect(
      await screen.findByText('Recommendation Approval', { selector: '.breadcrumb', exact: false }),
    ).toBeVisible()

    fireEvent.mouseDown(screen.getByLabelText('Workspace view'))
    fireEvent.click(screen.getByRole('option', { name: 'Notifications' }))
    expect(
      await screen.findByText('Notifications', { selector: '.breadcrumb', exact: false }),
    ).toBeVisible()
  })

  it('hides the pricing review queue for Sales Users and routes Pricing & deals', async () => {
    vi.spyOn(intelligenceClient, 'post').mockResolvedValue({
      data: {
        token: 'sales-token',
        user: { email: 'analyst@edtech.example', role: 'Sales User' },
        permissions: ['enterprise:read'],
      },
    })
    renderApp()
    await screen.findByRole('heading', { name: /sign in to continue/i })
    fireEvent.click(screen.getByRole('button', { name: /sign in securely/i }))
    expect(await screen.findByText(/viewing as sales user/i)).toBeVisible()

    const viewSelect = await screen.findByLabelText('Workspace view')
    fireEvent.mouseDown(viewSelect)
    expect(screen.queryByRole('option', { name: 'Pricing review queue' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Pricing & deals' }))
    expect(
      await screen.findByText(/price simulations, leakage alerts, and quote decisions/i),
    ).toBeVisible()
  })

  it('runs the forgot-password flow with validation and success states', async () => {
    const post = vi.spyOn(intelligenceClient, 'post').mockResolvedValue({
      data: {
        message: 'If the account exists, password reset instructions have been queued.',
      },
    })
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: /sign in to continue/i })
    await user.click(screen.getByRole('button', { name: /forgot password/i }))
    expect(await screen.findByRole('heading', { name: /reset your password/i })).toBeVisible()
    await user.clear(screen.getByLabelText(/work email/i))
    await user.click(screen.getByRole('button', { name: /send reset instructions/i }))
    expect(await screen.findByText(/enter a valid work email/i)).toBeVisible()
    await user.type(screen.getByLabelText(/work email/i), 'finance@edtech.example')
    await user.click(screen.getByRole('button', { name: /send reset instructions/i }))
    expect(await screen.findByText(/password reset instructions have been queued/i)).toBeVisible()
    expect(post).toHaveBeenCalledWith(
      '/auth/forgot-password',
      { email: 'finance@edtech.example' },
      expect.objectContaining({ skipAuthRefresh: true, skipAuthHeader: true }),
    )
  })

  it.each(pageCatalog)('renders the $path workflow for an authorized user', async ({ path, label }) => {
    vi.spyOn(intelligenceClient, 'post').mockResolvedValue({
      data: {
        token: 'executive-token',
        user: { email: 'manager@edtech.example', role: 'Executive' },
        permissions: ['admin:manage', 'finance:read', 'finance:write', 'jobs:manage'],
      },
    })
    renderApp(path)
    await screen.findByRole('heading', { name: /sign in to continue/i })
    fireEvent.click(screen.getByRole('button', { name: /sign in securely/i }))
    expect(await screen.findByText(label, { selector: '.breadcrumb', exact: false })).toBeVisible()
  })
})
