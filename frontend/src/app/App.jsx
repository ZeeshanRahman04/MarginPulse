import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  MenuItem,
  Snackbar,
  TextField,
} from '@mui/material'
import { ProtectedRoute } from '../components/ProtectedRoute.jsx'
import { pageCatalog } from '../data/pageCatalog.js'
import { getAccessibleSavedViews, resolveSavedView } from '../data/savedViews.js'
import {
  AiGovernance,
  AuditSettingsPage,
  AuthLoading,
  CommandCenter,
  ConfiguredPage,
  DecisionsPage,
  ForecastsPage,
  NotificationsPage,
  OutcomesPage,
  PricingDetailsPage,
  PricingGuidance,
  ReportsPage,
  RevenueDashboards,
  ScenarioLab,
  SignIn,
  UsersPage,
} from '../features/index.js'
import {
  approveDeal,
  downloadCsv,
  getStoredSession,
  loadIntelligenceData,
  login,
  logout,
  mapPermissions,
  muteSessionExpiryNotifications,
  onSessionExpired,
  restoreSession,
  reviewRecommendation,
  roleHomePath,
  submitAiFeedback,
} from '../services/intelligenceClient.js'
import { APP_NAME, APP_NAME_SHORT } from '../brand.js'
import './App.css'

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [snapshot, setSnapshot] = useState(null)
  const [dataSource, setDataSource] = useState('')
  const [dataError, setDataError] = useState('')
  const [activeSegment, setActiveSegment] = useState('Enterprise Upskilling')
  const [approvedActions, setApprovedActions] = useState([])
  const [recommendationDecisions, setRecommendationDecisions] = useState({})
  const [dealDecisions, setDealDecisions] = useState({})
  const [currentUser, setCurrentUser] = useState(null)
  const [permissionCodes, setPermissionCodes] = useState([])
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [authSuccess, setAuthSuccess] = useState('')
  const [mfaRequired, setMfaRequired] = useState(false)
  const [globalSearch, setGlobalSearch] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [aiDecisions, setAiDecisions] = useState({})
  const [toast, setToast] = useState({ open: false, severity: 'info', message: '' })
  const [signingIn, setSigningIn] = useState(false)
  const authenticatedRef = useRef(false)
  const authBootstrapIdRef = useRef(0)

  useEffect(() => {
    authenticatedRef.current = Boolean(currentUser)
  }, [currentUser])

  const showToast = useCallback((message, severity = 'info') => {
    if (!message) return
    // Hard block: never surface session-expiry toasts on the unauthenticated SignIn screen.
    if (!authenticatedRef.current && /session expired|access token expired/i.test(message)) {
      return
    }
    setToast({ open: true, severity, message })
  }, [])

  const closeToast = useCallback((_event, reason) => {
    if (reason === 'clickaway') return
    setToast((current) => ({ ...current, open: false }))
  }, [])

  const clearAuthenticatedState = useCallback(() => {
    setCurrentUser(null)
    setPermissionCodes([])
    setSnapshot(null)
    setMfaRequired(false)
    setApprovedActions([])
    setRecommendationDecisions({})
    setDealDecisions({})
    setAiDecisions({})
  }, [])

  const refreshData = useCallback(async () => {
    const { snapshot: nextSnapshot, source, error } = await loadIntelligenceData(permissionCodes)
    setSnapshot(nextSnapshot)
    setDataSource(source)
    setDataError(error?.message || '')
    return nextSnapshot
  }, [permissionCodes])

  useEffect(() => {
    let active = true
    const bootstrapId = ++authBootstrapIdRef.current
    const unmute = muteSessionExpiryNotifications()
    const hadStoredSession = Boolean(getStoredSession()?.token)
    restoreSession()
      .then((session) => {
        if (!active || bootstrapId !== authBootstrapIdRef.current) return
        // Interactive sign-in already won — never clobber it with a late restore.
        if (authenticatedRef.current) return
        if (session) {
          authenticatedRef.current = true
          setCurrentUser(session.user)
          setPermissionCodes(session.permissions)
          return
        }
        // Soft one-time info only — never toast "session expired" on the login form.
        if (hadStoredSession) {
          setAuthError('Please sign in again to continue.')
        }
      })
      .catch(() => {
        // restoreSession clears stale tokens quietly; ignore unexpected errors.
      })
      .finally(() => {
        unmute()
        if (active && bootstrapId === authBootstrapIdRef.current) {
          setAuthLoading(false)
        }
      })
    return () => {
      active = false
      unmute()
    }
  }, [])

  useEffect(() => {
    return onSessionExpired((reason) => {
      const wasAuthenticated = authenticatedRef.current
      clearAuthenticatedState()
      authenticatedRef.current = false
      setAuthLoading(false)
      setAuthSuccess('')
      setSigningIn(false)
      setMfaRequired(false)
      // Unauthenticated SignIn must stay quiet — no "session expired" toast/alert.
      if (wasAuthenticated) {
        setAuthError('Please sign in again to continue.')
        showToast(reason, 'warning')
      } else {
        setAuthError('')
      }
      navigate('/', { replace: true })
    })
  }, [clearAuthenticatedState, navigate, showToast])

  useEffect(() => {
    if (!currentUser) return
    let active = true
    loadIntelligenceData(permissionCodes)
      .then(({ snapshot: nextSnapshot, source, error }) => {
        if (!active) return
        setSnapshot(nextSnapshot)
        setDataSource(source)
        setDataError(error?.message || '')
      })
      .catch((error) => {
        if (active) setDataError(error.message)
      })
    return () => {
      active = false
    }
  }, [currentUser, permissionCodes])

  const selectedRecommendation = useMemo(() => {
    return (
      snapshot?.recommendations.find(({ segment }) => segment === activeSegment) ??
      snapshot?.recommendations[0] ??
      null
    )
  }, [activeSegment, snapshot])

  const handleRecommendationReview = useCallback(async (recommendation, decision, reason) => {
    const applyLocal = () => {
      setRecommendationDecisions((current) => ({
        ...current,
        [recommendation.id]: decision,
        ...(recommendation.segment ? { [recommendation.segment]: decision } : {}),
      }))
      if (decision === 'approved') {
        setApprovedActions((current) =>
          [...new Set([...current, recommendation.segment].filter(Boolean))],
        )
      } else {
        setApprovedActions((current) =>
          current.filter((segment) => segment !== recommendation.segment),
        )
      }
    }

    try {
      await reviewRecommendation(recommendation.id, decision, reason)
      applyLocal()
      setDataError('')
      showToast('Recommendation review saved.', 'success')
      return true
    } catch (error) {
      applyLocal()
      setDataError(error.message)
      showToast(`Recommendation ${decision} locally (${error.message}).`, 'warning')
      return true
    }
  }, [showToast])

  const handleAiDecision = useCallback(async (id, decision, reason) => {
    const feedbackDecision =
      decision === 'approved' ? 'accepted' : decision === 'rejected' ? 'corrected' : 'overridden'
    const applyLocal = () => {
      setAiDecisions((current) => ({ ...current, [id]: decision }))
      setRecommendationDecisions((current) => ({ ...current, [id]: decision }))
    }

    try {
      await submitAiFeedback(id, feedbackDecision, reason)
      applyLocal()
      setDataError('')
      showToast('AI feedback recorded.', 'success')
      return true
    } catch (error) {
      applyLocal()
      setDataError(error.message)
      showToast(`AI decision staged locally (${error.message}).`, 'warning')
      return true
    }
  }, [showToast])

  const handleDealDecision = useCallback(async (quoteId, decision, reason) => {
    const applyLocal = () => {
      setDealDecisions((current) => ({ ...current, [quoteId]: decision }))
    }

    try {
      await approveDeal(quoteId, decision, reason)
      applyLocal()
      setDataError('')
      showToast(`Deal ${decision}.`, 'success')
      return true
    } catch (error) {
      applyLocal()
      setDataError(error.message)
      showToast(`Deal ${decision} locally (${error.message}).`, 'warning')
      return true
    }
  }, [showToast])

  const hasPermission = useCallback(
    (permission) => {
      const permissions = mapPermissions(permissionCodes)
      if (Array.isArray(permission)) {
        return permission.some((item) => {
          if (item === 'base') return true
          return permissions.includes('allData') || permissions.includes(item)
        })
      }
      if (permission === 'base') return true
      if (!currentUser) return false
      return permissions.includes('allData') || permissions.includes(permission)
    },
    [currentUser, permissionCodes],
  )

  const filteredDomainRecords = useMemo(() => {
    if (!snapshot) return []

    return snapshot.domainRecords.filter((record) => {
      return record.permission === 'allData' || hasPermission(record.permission)
    })
  }, [hasPermission, snapshot])
  const visibleRevenueStreams = useMemo(() => {
    return snapshot?.revenueStreams.filter((record) => hasPermission(record.permission)) ?? []
  }, [hasPermission, snapshot])
  const visiblePricingRows = useMemo(() => {
    return snapshot?.pricingRows.filter((record) => hasPermission(record.permission)) ?? []
  }, [hasPermission, snapshot])
  const livePageRows = useMemo(() => {
    if (!snapshot) return {}
    const recommendations = snapshot.recommendations.map((item) => [
      item.title || item.segment,
      item.impact,
      item.status || 'Pending review',
      item.reason,
    ])
    return {
      '/pricing-details': visiblePricingRows.map((item) => [
        item.product,
        item.priceList,
        item.approvalStatus,
        item.costs,
      ]),
      '/recommendations-impact': recommendations,
      '/discount-recommendations': recommendations,
      '/forecasts': (snapshot.liveAi?.forecasts || []).map((item) => [
        item.product,
        item.revenueForecast,
        `${item.marginForecastPct}% margin`,
        `${item.confidenceInterval?.[0]}–${item.confidenceInterval?.[1]}`,
      ]),
      '/model-performance': snapshot.liveAi?.monitoring
        ? Object.entries(snapshot.liveAi.monitoring)
            .filter(([, value]) => typeof value !== 'object')
            .map(([metric, value]) => [metric, String(value), 'Live', snapshot.liveAi.modelVersion])
        : [],
      '/reports': visibleRevenueStreams.map((item) => [
        item.stream,
        item.actual,
        item.variance,
        item.forecast,
      ]),
      '/notifications-page': snapshot.notifications.map((item) => [
        typeof item === 'string' ? item : item.title || item.message || item.type,
        typeof item === 'string' ? 'Notice' : item.status,
        typeof item === 'string' ? 'System' : item.notification_type || item.type,
        typeof item === 'string' ? 'Open' : item.created_at,
      ]),
    }
  }, [snapshot, visiblePricingRows, visibleRevenueStreams])

  const savedViews = useMemo(
    () => getAccessibleSavedViews(hasPermission),
    [hasPermission],
  )
  const activeSavedView = useMemo(
    () => resolveSavedView(location.pathname, savedViews),
    [location.pathname, savedViews],
  )

  const exportSnapshot = useCallback(() => {
    downloadCsv('revenue-intelligence.csv', [
      ['Type', 'Title', 'Status', 'Exported by', 'Saved view'],
      ...filteredDomainRecords.map((record) => [
        record.type,
        record.title,
        record.status,
        currentUser?.email,
        activeSavedView?.label || 'Workspace',
      ]),
    ])
    showToast('Export downloaded.', 'success')
  }, [activeSavedView, currentUser, filteredDomainRecords, showToast])

  const handleSavedViewChange = useCallback(
    (event) => {
      const nextView = savedViews.find((view) => view.id === event.target.value)
      if (!nextView) return
      navigate(nextView.path)
    },
    [navigate, savedViews],
  )

  const handleSignIn = useCallback(async ({ email, password, mfaCode, rememberMe }) => {
    const normalizedEmail = String(email || '').trim()
    if (!normalizedEmail.includes('@') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setAuthError('Use a valid work email address.')
      setAuthSuccess('')
      return
    }

    if (!password || password.length < 8) {
      setAuthError('Password must be at least 8 characters.')
      setAuthSuccess('')
      return
    }

    // Keep SignIn mounted while credentials are checked. Swapping to AuthLoading
    // via authLoading drops in-flight navigate() updates under MemoryRouter/RR7.
    setSigningIn(true)
    setAuthError('')
    setAuthSuccess('')
    // Invalidate any in-flight restoreSession UI handler before credential exchange.
    authBootstrapIdRef.current += 1
    try {
      const session = await login(
        { email: normalizedEmail, password, ...(mfaCode ? { mfaCode } : {}) },
        rememberMe,
      )
      if (session.mfaRequired) {
        setMfaRequired(true)
        setAuthError(session.message || 'Enter your multi-factor authentication code.')
        return
      }
      if (!session?.user) {
        throw new Error('Sign-in succeeded but no user profile was returned.')
      }
      const role = session.user?.role || 'Viewer'
      const homePath = roleHomePath(role)
      const successMessage = `Signed in successfully. Opening your ${role} dashboard…`
      // Mark authenticated before any state flush so late 401 handlers don't treat
      // this as a logged-out bootstrap and leave the success toast on SignIn.
      authenticatedRef.current = true
      // Commit auth state before navigate so ProtectedRoute sees permissions on first paint.
      flushSync(() => {
        setCurrentUser(session.user)
        setPermissionCodes(session.permissions || [])
        setMfaRequired(false)
        setAuthLoading(false)
        setAuthSuccess(successMessage)
        setNotificationsOpen(true)
      })
      showToast(successMessage, 'success')
      // Always navigate to the role home (including `/`) so demos leave SignIn.
      navigate(homePath, { replace: true })
    } catch (error) {
      authenticatedRef.current = false
      const message = error.message || 'Authentication failed. Check your email and password.'
      setAuthError(message)
      setAuthSuccess('')
    } finally {
      setSigningIn(false)
    }
  }, [navigate, showToast])

  const handleSignOut = useCallback(async () => {
    await logout()
    authenticatedRef.current = false
    clearAuthenticatedState()
    setAuthSuccess('')
    setAuthError('')
    showToast('Signed out successfully.', 'success')
    navigate('/', { replace: true })
  }, [clearAuthenticatedState, navigate, showToast])

  const canApprove = useMemo(() => hasPermission('approveDeals'), [hasPermission])
  const canOverride = useMemo(() => hasPermission('overrideAI'), [hasPermission])
  const navigation = useMemo(() => {
    const coreNavigation = [
      { to: '/', label: 'Executive Dashboard', permission: 'base' },
      {
        to: '/dashboards',
        label: 'Revenue & Profitability',
        permission: ['financeData', 'enterpriseData'],
      },
      {
        to: '/pricing',
        label: 'Pricing Simulation & Deals',
        permission: ['pricingData', 'enterpriseData'],
      },
      { to: '/scenarios', label: 'Simulations', permission: 'financeData' },
      { to: '/ai', label: 'AI Governance', permission: 'financeData' },
    ]

    const catalogNavigation = pageCatalog.map(({ path, label, permission }) => ({
      to: path,
      label,
      permission,
    }))

    return [...coreNavigation, ...catalogNavigation].filter((item) =>
      hasPermission(item.permission),
    )
  }, [hasPermission])
  const workspaceTitle = useMemo(() => {
    if (activeSavedView) return activeSavedView.label
    return (
      navigation.find((item) => item.to === location.pathname)?.label || 'Workspace'
    )
  }, [activeSavedView, location.pathname, navigation])
  const notificationMessage = useMemo(() => {
    return (
      snapshot?.notifications
        .map((notification) =>
          typeof notification === 'string'
            ? notification
            : notification.message || notification.title || notification.type,
        )
        .join(' ') ?? ''
    )
  }, [snapshot])

  const toastSnackbar = (
    <Snackbar
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      autoHideDuration={4500}
      onClose={closeToast}
      open={toast.open}
    >
      <Alert onClose={closeToast} severity={toast.severity} variant="filled">
        {toast.message}
      </Alert>
    </Snackbar>
  )

  if (authLoading && !currentUser) {
    return (
      <>
        <AuthLoading
          message={authSuccess || 'Verifying JWT credentials and restoring your role workspace…'}
          title={authSuccess ? 'Signed in' : 'Securing your session'}
        />
        {toastSnackbar}
      </>
    )
  }

  if (!currentUser) {
    return (
      <>
        <SignIn
          authError={authError}
          authLoading={signingIn}
          authSuccess={authSuccess}
          handleSignIn={handleSignIn}
          mfaRequired={mfaRequired}
        />
        {toastSnackbar}
      </>
    )
  }

  if (!snapshot) {
    return (
      <>
        <AuthLoading
          message={
            authSuccess ||
            `Loading ${currentUser.role || 'role'}-aware revenue intelligence…`
          }
          title="Preparing dashboard"
        />
        {toastSnackbar}
      </>
    )
  }

  return (
    <main className="app-shell app-shell--soft">
      <aside className="sidebar sidebar--soft">
        <div className="sidebar-brand">
          <div className="brand-mark brand-mark--soft" aria-hidden="true">
            {APP_NAME_SHORT}
          </div>
          <div className="sidebar-brand__copy">
            <p className="eyebrow">EdTech</p>
            <h1>{APP_NAME}</h1>
          </div>
        </div>

        <nav aria-label="Primary">
          {navigation.map((item) => (
            <NavLink end={item.to === '/'} key={item.to} to={item.to}>
              <span className="nav-ico" aria-hidden="true" />
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-session">
          <div className="sidebar-session__meta">
            <strong>{currentUser.role}</strong>
            <small>{currentUser.email}</small>
          </div>
          <button className="sidebar-session__signout" onClick={handleSignOut} type="button">
            Sign out
          </button>
        </div>
      </aside>

      <section className="workspace workspace--soft">
        {dataSource === 'fallback' ? (
          <Alert className="data-source-alert" severity="warning">
            Demo fallback data is displayed because the API is unavailable.
          </Alert>
        ) : null}
        {dataError && dataSource !== 'fallback' ? (
          <Alert className="data-source-alert" severity="error">
            Some live data could not be loaded: {dataError}
          </Alert>
        ) : null}
        <header className="topbar topbar--soft">
          <div className="topbar-title">
            <div>
              <h2>{workspaceTitle}</h2>
              <small>
                Viewing as {currentUser.role} · {currentUser.team}
              </small>
            </div>
          </div>
          <div className="topbar-actions topbar-actions--soft">
            <TextField
              className="soft-search"
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search anything…"
              size="small"
              value={globalSearch}
            />
            <TextField
              className="soft-select"
              onChange={handleSavedViewChange}
              select
              size="small"
              slotProps={{
                select: {
                  displayEmpty: true,
                  'aria-label': 'Workspace view',
                  inputProps: { 'aria-label': 'Workspace view' },
                },
              }}
              value={activeSavedView?.id || ''}
            >
              {!activeSavedView ? (
                <MenuItem disabled value="">
                  {workspaceTitle}
                </MenuItem>
              ) : null}
              {savedViews.map((view) => (
                <MenuItem key={view.id} value={view.id}>
                  {view.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              className="soft-create"
              disabled={!hasPermission('exportData')}
              onClick={exportSnapshot}
              variant="contained"
            >
              Export
            </Button>
            <Button
              className="soft-icon-btn"
              onClick={() => setNotificationsOpen(true)}
              variant="outlined"
            >
              Alerts
            </Button>
            <span className="topbar-avatar" aria-hidden="true">
              {(currentUser.role || 'U').slice(0, 1)}
            </span>
          </div>
        </header>

        <Routes>
          <Route
            path="/"
            element={
              <CommandCenter
                activeSegment={activeSegment}
                cohorts={snapshot.cohorts || []}
                deals={snapshot.deals || []}
                domainRecords={filteredDomainRecords}
                elasticity={snapshot.elasticity || []}
                globalSearch={globalSearch}
                leakageAlerts={snapshot.leakageAlerts || []}
                lifecycle={snapshot.lifecycle}
                metrics={snapshot.metrics}
                pricingRows={visiblePricingRows}
                recommendations={snapshot.recommendations}
                revenueStreams={visibleRevenueStreams}
                selectedRecommendation={selectedRecommendation}
                setActiveSegment={setActiveSegment}
              />
            }
          />
          <Route
            path="/dashboards"
            element={
              <ProtectedRoute hasPermission={hasPermission} permission={['financeData', 'enterpriseData']}>
                <RevenueDashboards
                  canExport={hasPermission('exportData')}
                  globalSearch={globalSearch}
                  organisationScope={
                    currentUser?.organisationName ||
                    currentUser?.organisation_id ||
                    'Current organisation'
                  }
                  revenueStreams={visibleRevenueStreams}
                  role={currentUser?.role || 'Viewer'}
                />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pricing"
            element={
              <ProtectedRoute hasPermission={hasPermission} permission={['pricingData', 'enterpriseData']}>
                <PricingGuidance
                  approvedActions={approvedActions}
                  canApprove={canApprove}
                  cohorts={snapshot.cohorts || []}
                  dealDecisions={dealDecisions}
                  deals={snapshot.deals || []}
                  elasticity={snapshot.elasticity || []}
                  globalSearch={globalSearch}
                  leakageAlerts={snapshot.leakageAlerts || []}
                  onDealDecision={handleDealDecision}
                  pricingRows={visiblePricingRows}
                  recommendationDecisions={recommendationDecisions}
                  recommendations={snapshot.recommendations}
                  reviewRecommendation={handleRecommendationReview}
                  simulations={snapshot.simulations || []}
                />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scenarios"
            element={
              <ProtectedRoute hasPermission={hasPermission} permission="financeData">
                <ScenarioLab
                  canSubmitDeal={canApprove}
                  cohorts={snapshot.cohorts}
                  elasticity={snapshot.elasticity}
                  leakageAlerts={snapshot.leakageAlerts}
                  onSubmitDeal={async (payload) => {
                    const quoteKey = `sim-${payload.productId || 'deal'}`
                    setDealDecisions((current) => ({
                      ...current,
                      [quoteKey]: 'pending_approval',
                    }))
                    showToast(
                      `Deal package staged for approval (${payload.reason}).`,
                      'success',
                    )
                    return true
                  }}
                  products={visiblePricingRows}
                  simulations={snapshot.simulations}
                />
              </ProtectedRoute>
            }
          />
          <Route
            path="/ai"
            element={
              <ProtectedRoute hasPermission={hasPermission} permission="financeData">
                <AiGovernance
                  aiDecisions={aiDecisions}
                  aiOutputs={snapshot.aiOutputs}
                  canApprove={canApprove}
                  canOverride={canOverride}
                  onDecision={handleAiDecision}
                  recommendations={snapshot.recommendations}
                />
              </ProtectedRoute>
            }
          />
          {pageCatalog.map((catalogPage) => (
            <Route
              key={catalogPage.path}
              path={catalogPage.path}
              element={
                <ProtectedRoute hasPermission={hasPermission} permission={catalogPage.permission}>
                  {catalogPage.path === '/notifications-page' ? (
                    <NotificationsPage records={snapshot.notifications} onRefresh={refreshData} />
                  ) : catalogPage.path === '/users' ? (
                    <UsersPage records={snapshot.users || []} onRefresh={refreshData} />
                  ) : catalogPage.path === '/audit-settings' ? (
                    <AuditSettingsPage
                      audits={snapshot.audits || []}
                      canEdit={hasPermission(['manageSettings'])}
                      configurations={snapshot.configurations || []}
                    />
                  ) : catalogPage.path === '/reports' ? (
                    <ReportsPage
                      elasticity={snapshot.elasticity || []}
                      jobs={snapshot.jobs || []}
                      leakageAlerts={snapshot.leakageAlerts || []}
                      recommendations={snapshot.recommendations || []}
                      rows={visibleRevenueStreams}
                      templates={snapshot.reportTemplates || []}
                    />
                  ) : catalogPage.path === '/model-performance' ? (
                    <OutcomesPage
                      canEdit={hasPermission(['editOutcomes', 'allData'])}
                      monitoring={snapshot.liveAi?.monitoring || {}}
                      records={snapshot.outcomes || []}
                    />
                  ) : catalogPage.path === '/recommendations-impact' || catalogPage.path === '/discount-recommendations' ? (
                    <DecisionsPage
                      canApprove={canApprove}
                      canOverride={canOverride}
                      recommendations={snapshot.recommendations}
                      title={catalogPage.label}
                    />
                  ) : catalogPage.path === '/forecasts' ? (
                    <ForecastsPage ai={snapshot.liveAi} />
                  ) : catalogPage.path === '/pricing-details' ? (
                    <PricingDetailsPage
                      canExport={hasPermission('exportData')}
                      organisationScope={
                        currentUser?.organisationName ||
                        currentUser?.organisation_id ||
                        'Current organisation'
                      }
                      records={visiblePricingRows}
                      role={currentUser?.role || 'Viewer'}
                    />
                  ) : (
                    <ConfiguredPage
                      canApprove={canApprove}
                      canExport={hasPermission('exportData')}
                      dataSource={dataSource}
                      globalSearch={globalSearch}
                      page={catalogPage}
                      rows={livePageRows[catalogPage.path]}
                    />
                  )}
                </ProtectedRoute>
              }
            />
          ))}
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </section>
      <Snackbar
        autoHideDuration={5000}
        onClose={() => setNotificationsOpen(false)}
        open={notificationsOpen}
      >
        <Alert severity="warning" variant="filled">
          {notificationMessage}
        </Alert>
      </Snackbar>
      {toastSnackbar}
    </main>
  )
}

export default App
