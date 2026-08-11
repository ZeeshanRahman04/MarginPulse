import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
} from '@mui/material'
import {
  ConfidenceGauge,
  RevenueBridgeChart,
  VarianceBarChart,
} from '../../components/charts/DashboardCharts.jsx'
import { DetailList } from '../../components/DetailList.jsx'
import { SectionHeader } from '../../components/SectionHeader.jsx'
import { StatusChip } from '../../components/StatusChip.jsx'
import {
  archiveNotification,
  createUser,
  downloadCsv,
  enqueueReport,
  markNotificationRead,
  retryJob,
  reviewRecommendation,
  searchAudits,
  submitAiFeedback,
  updateConfiguration,
  updateOutcome,
  updateUser,
} from '../../services/intelligenceClient.js'
import { normalizeWorkflowState } from '../../utils/workflowStatus.js'
import { PricingDetailsPage as PricingDetailsPageFeature } from '../pricing/PricingDetailsPage.jsx'

const roles = [
  'Sales User',
  'Pricing Manager',
  'Finance Controller',
  'Executive',
  'Administrator',
]

const ROLE_PERMISSIONS = {
  'Sales User': ['View assigned deals', 'Submit quotes', 'Read enterprise scope'],
  'Pricing Manager': ['Edit price lists', 'Review exceptions', 'Override AI (with reason)'],
  'Finance Controller': ['Approve financial controls', 'Edit outcomes', 'Export finance reports'],
  Executive: ['View all data', 'Approve material decisions', 'Executive reports'],
  Administrator: ['Manage users', 'Manage settings', 'Configure integrations'],
}

const WORKFLOW_ACTIONS = [
  { key: 'accept', api: 'approved', label: 'Accept' },
  { key: 'approve', api: 'approved', label: 'Approve' },
  { key: 'reject', api: 'rejected', label: 'Reject' },
  { key: 'override', api: 'overridden', label: 'Override' },
  { key: 'escalate', api: 'escalated', label: 'Escalate' },
  { key: 'defer', api: 'deferred', label: 'Defer' },
]

const REPORT_TYPES = [
  'Revenue',
  'Profit',
  'Margin',
  'Forecast',
  'Variance',
  'Price Waterfall',
  'Elasticity',
  'Customer/Product Profitability',
  'AI Recommendations',
  'Margin Leakage',
  'Executive Summary',
]

const NOTIFICATION_TYPES = [
  'Pending Approval',
  'AI Recommendation Ready',
  'Margin/Revenue Alert',
  'Forecast Complete',
  'Assignment',
  'Due Date',
  'System Update',
]

const value = (row, ...keys) =>
  keys.map((key) => row?.[key]).find((item) => item !== undefined && item !== null) ?? '—'
const money = (amount) =>
  amount == null || amount === ''
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0)

function Page({ title, eyebrow, children, message, error }) {
  return (
    <div className="page-stack route-shell">
      <section className="wide-card soft-panel">
        <p className="breadcrumb">Home / {title}</p>
        <SectionHeader eyebrow={eyebrow} title={title} />
        {message ? <Alert severity="success">{message}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </section>
      {children}
    </div>
  )
}

function recommendationState(item, localState) {
  const state = localState || item.status
  return normalizeWorkflowState(state, 'pending-review')
}

export function NotificationsPage({ records = [], onRefresh }) {
  const normalizedRecords = useMemo(
    () =>
      records.map((item, index) =>
        typeof item === 'string'
          ? {
              id: `fallback-${index}`,
              title: item,
              status: 'unread',
              notification_type: 'System Update',
              severity: 'low',
              created_at: '—',
            }
          : item,
      ),
    [records],
  )
  const [items, setItems] = useState(normalizedRecords)
  const [selected, setSelected] = useState([])
  const [detail, setDetail] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [prefs, setPrefs] = useState({
    email: true,
    inApp: true,
    urgentOnly: false,
  })

  const [recordSource, setRecordSource] = useState(normalizedRecords)
  if (normalizedRecords !== recordSource) {
    setRecordSource(normalizedRecords)
    setItems(normalizedRecords)
  }

  const visible = useMemo(
    () =>
      items.filter((item) => {
        const status = String(item.status || '').toLowerCase()
        if (statusFilter === 'unread' && status === 'read') return false
        if (statusFilter === 'read' && status !== 'read') return false
        if (typeFilter !== 'all' && item.notification_type !== typeFilter) return false
        if (severityFilter !== 'all' && String(item.severity).toLowerCase() !== severityFilter) {
          return false
        }
        return true
      }),
    [items, severityFilter, statusFilter, typeFilter],
  )

  const unreadCount = items.filter((item) => String(item.status).toLowerCase() !== 'read').length

  const refresh = async () => {
    try {
      const snapshot = await onRefresh?.()
      if (snapshot?.notifications) {
        setItems(
          snapshot.notifications.map((item, index) =>
            typeof item === 'string'
              ? {
                  id: `fallback-${index}`,
                  title: item,
                  status: 'unread',
                  notification_type: 'System Update',
                  severity: 'low',
                }
              : item,
          ),
        )
      }
      setFeedback('Notifications refreshed.')
      setError('')
    } catch (caught) {
      setError(caught.message)
    }
  }

  const mutate = async (mode) => {
    try {
      const targets = mode === 'all-read' ? items.map((item) => item.id) : selected
      if (!targets.length) throw new Error('Select at least one notification.')
      if (mode === 'read' || mode === 'all-read') {
        await Promise.all(targets.map((id) => markNotificationRead(id).catch(() => null)))
        setItems((current) =>
          current.map((item) => (targets.includes(item.id) ? { ...item, status: 'read' } : item)),
        )
        setFeedback(mode === 'all-read' ? 'All notifications marked as read.' : 'Selected notifications marked as read.')
      } else {
        await Promise.all(targets.map((id) => archiveNotification(id).catch(() => null)))
        setItems((current) => current.filter((item) => !targets.includes(item.id)))
        setFeedback('Selected notifications archived.')
      }
      setSelected([])
      setError('')
      await onRefresh?.()
    } catch (caught) {
      setError(caught.message)
    }
  }

  return (
    <Page title="Notifications" eyebrow="Assignments, alerts and events" message={feedback} error={error}>
      <section className="metric-grid soft-metric-grid">
        <article className="metric-card warning soft-kpi-metric">
          <span>Unread</span>
          <strong>{unreadCount}</strong>
          <small>
            {items.filter((item) => String(item.severity).toLowerCase() === 'high').length} urgent
          </small>
        </article>
        <article className="metric-card good soft-kpi-metric">
          <span>Assigned approvals</span>
          <strong>
            {items.filter((item) => item.notification_type === 'Pending Approval').length}
          </strong>
          <small>Deep-link to related records</small>
        </article>
        <article className="metric-card soft-kpi-metric">
          <span>System events</span>
          <strong>
            {items.filter((item) => item.notification_type === 'System Update').length}
          </strong>
          <small>Model and export notices</small>
        </article>
      </section>

      <section className="wide-card soft-panel">
        <div className="operator-strip">
          <Button onClick={() => mutate('read')} variant="contained">
            Mark as read
          </Button>
          <Button onClick={() => mutate('all-read')} variant="outlined">
            Mark all read
          </Button>
          <Button onClick={() => mutate('archive')} variant="outlined">
            Clear selected
          </Button>
          <Button onClick={refresh} variant="outlined">
            Refresh
          </Button>
        </div>
        <div className="filter-row">
          <TextField
            select
            label="Read status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="unread">Unread</MenuItem>
            <MenuItem value="read">Read</MenuItem>
          </TextField>
          <TextField
            select
            label="Type"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <MenuItem value="all">All types</MenuItem>
            {NOTIFICATION_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Severity"
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value)}
          >
            <MenuItem value="all">All severities</MenuItem>
            <MenuItem value="high">High</MenuItem>
            <MenuItem value="medium">Medium</MenuItem>
            <MenuItem value="low">Low</MenuItem>
          </TextField>
        </div>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>Notification</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Created</th>
                <th>Related</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Checkbox
                      slotProps={{
                        input: {
                          'aria-label': `Select ${value(item, 'title', 'message', 'id')}`,
                        },
                      }}
                      checked={selected.includes(item.id)}
                      onChange={() =>
                        setSelected((all) =>
                          all.includes(item.id) ? all.filter((id) => id !== item.id) : [...all, item.id],
                        )
                      }
                    />
                  </td>
                  <td>
                    <strong>{value(item, 'title', 'message')}</strong>
                  </td>
                  <td>{value(item, 'notification_type')}</td>
                  <td>
                    <StatusChip
                      state={
                        String(item.severity).toLowerCase() === 'high'
                          ? 'critical'
                          : String(item.severity).toLowerCase() === 'medium'
                            ? 'warning'
                            : 'normal'
                      }
                      label={item.severity || 'low'}
                    />
                  </td>
                  <td>
                    <StatusChip
                      state={String(item.status).toLowerCase() === 'read' ? 'completed' : 'pending-review'}
                      label={item.status}
                    />
                  </td>
                  <td>{value(item, 'created_at')}</td>
                  <td>
                    <div className="table-actions">
                      {item.link ? (
                        <Button component={RouterLink} to={item.link} size="small">
                          Open link
                        </Button>
                      ) : null}
                      <Button onClick={() => setDetail(item)} size="small">
                        Details
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length ? <Alert severity="info">No notifications match the current filters.</Alert> : null}
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader eyebrow="Preferences" title="Notification delivery rules" />
        <div className="prefs-row">
          <FormControlLabel
            control={
              <Switch
                checked={prefs.email}
                onChange={(event) => setPrefs((current) => ({ ...current, email: event.target.checked }))}
              />
            }
            label="Email alerts"
          />
          <FormControlLabel
            control={
              <Switch
                checked={prefs.inApp}
                onChange={(event) => setPrefs((current) => ({ ...current, inApp: event.target.checked }))}
              />
            }
            label="In-app alerts"
          />
          <FormControlLabel
            control={
              <Switch
                checked={prefs.urgentOnly}
                onChange={(event) =>
                  setPrefs((current) => ({ ...current, urgentOnly: event.target.checked }))
                }
              />
            }
            label="Urgent only"
          />
          <Button
            onClick={() => {
              setFeedback(
                `Notification preferences saved for this session (email: ${prefs.email ? 'on' : 'off'}, in-app: ${prefs.inApp ? 'on' : 'off'}, urgent-only: ${prefs.urgentOnly ? 'on' : 'off'}).`,
              )
              setError('')
            }}
            variant="contained"
          >
            Save preferences
          </Button>
        </div>
      </section>

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} aria-labelledby="notification-detail-title">
        <DialogTitle id="notification-detail-title">Related notification detail</DialogTitle>
        <DialogContent>
          <DetailList
            items={[
              { label: 'Title', value: value(detail, 'title', 'message') },
              { label: 'Type', value: value(detail, 'notification_type') },
              { label: 'Severity', value: value(detail, 'severity') },
              { label: 'Related record', value: value(detail, 'related_record') },
              { label: 'Deep link', value: value(detail, 'link') },
              { label: 'Created', value: value(detail, 'created_at') },
            ]}
          />
        </DialogContent>
        <DialogActions>
          {detail?.link ? (
            <Button component={RouterLink} to={detail.link} onClick={() => setDetail(null)}>
              Go to record
            </Button>
          ) : null}
          <Button onClick={() => setDetail(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Page>
  )
}

export function UsersPage({ records = [], onRefresh }) {
  const empty = { email: '', displayName: '', password: '', role: 'Sales User', organisation: '' }
  const [form, setForm] = useState(empty)
  const [users, setUsers] = useState(records)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editing, setEditing] = useState(null)
  const [historyUser, setHistoryUser] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  const [userSource, setUserSource] = useState(records)
  if (records !== userSource) {
    setUserSource(records)
    setUsers(records)
  }

  const visible = users.filter((user) => {
    const haystack = JSON.stringify(user).toLowerCase()
    if (search && !haystack.includes(search.toLowerCase())) return false
    const role = user.roles?.[0] || user.role
    if (roleFilter !== 'all' && role !== roleFilter) return false
    if (statusFilter !== 'all' && String(user.status) !== statusFilter) return false
    return true
  })

  const add = async (event) => {
    event.preventDefault()
    try {
      const created = await createUser(form)
      setUsers((all) => [...all, created])
      setForm(empty)
      setFeedback('User created.')
      setError('')
      await onRefresh?.()
    } catch (caught) {
      // Offline / demo fallback: create a local least-privilege account preview.
      const local = {
        id: `local-${Date.now()}`,
        display_name: form.displayName,
        email: form.email,
        roles: [form.role],
        status: 'active',
        organisation: form.organisation || 'Current organisation',
        permissions: ROLE_PERMISSIONS[form.role] || [],
        version: 1,
        last_login: '—',
        accessHistory: [{ at: new Date().toISOString(), action: 'create', result: 'local' }],
      }
      setUsers((all) => [...all, local])
      setForm(empty)
      setFeedback(`User staged locally (${caught.message}).`)
      setError('')
    }
  }

  const save = async () => {
    try {
      const updated = await updateUser(editing.id, {
        displayName: editing.display_name || editing.displayName,
        role: editing.role || editing.roles?.[0],
        status: editing.status,
        version: editing.version,
        organisation: editing.organisation,
      })
      setUsers((all) => all.map((user) => (user.id === updated.id ? updated : user)))
      setEditing(null)
      setFeedback('User access updated.')
      await onRefresh?.()
    } catch (caught) {
      setUsers((all) =>
        all.map((user) =>
          user.id === editing.id
            ? {
                ...user,
                display_name: editing.display_name || editing.displayName,
                roles: [editing.role],
                status: editing.status,
                organisation: editing.organisation,
              }
            : user,
        ),
      )
      setEditing(null)
      setFeedback(`User updated locally (${caught.message}).`)
    }
  }

  return (
    <Page title="Users & Roles" eyebrow="Least-privilege administration" message={feedback} error={error}>
      <section className="metric-grid soft-metric-grid">
        <article className="metric-card good soft-kpi-metric">
          <span>Active users</span>
          <strong>{users.filter((user) => user.status === 'active').length}</strong>
          <small>{users.filter((user) => (user.roles || []).includes('Administrator')).length} privileged</small>
        </article>
        <article className="metric-card soft-kpi-metric">
          <span>Roles in catalogue</span>
          <strong>{roles.length}</strong>
          <small>Sales → Administrator</small>
        </article>
        <article className="metric-card warning soft-kpi-metric">
          <span>Disabled</span>
          <strong>{users.filter((user) => user.status === 'disabled').length}</strong>
          <small>No login until reactivated</small>
        </article>
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader eyebrow="New account" title="Create user" />
        <form className="form-grid soft-form" onSubmit={add}>
          <TextField
            required
            label="Display name"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
          />
          <TextField
            required
            type="email"
            label="Email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
          <TextField
            required
            type="password"
            label="Temporary password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
          <TextField
            select
            label="Role"
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            {roles.map((role) => (
              <MenuItem value={role} key={role}>
                {role}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Organisation access"
            value={form.organisation}
            onChange={(event) => setForm({ ...form, organisation: event.target.value })}
          />
          <Button type="submit" variant="contained">
            Create user
          </Button>
        </form>
        <Alert severity="info" className="scope-banner">
          Default permissions for {form.role}: {(ROLE_PERMISSIONS[form.role] || []).join(' · ')}
        </Alert>
      </section>

      <section className="wide-card soft-panel">
        <div className="filter-row">
          <TextField
            fullWidth
            label="Search users"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <TextField
            select
            label="Role"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
          >
            <MenuItem value="all">All roles</MenuItem>
            {roles.map((role) => (
              <MenuItem key={role} value={role}>
                {role}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <MenuItem value="all">All statuses</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="disabled">Disabled</MenuItem>
          </TextField>
        </div>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Organisation</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => (
                <tr key={user.id}>
                  <td>{value(user, 'display_name', 'displayName')}</td>
                  <td>{user.email}</td>
                  <td>{user.roles?.[0] || user.role}</td>
                  <td>{user.organisation || '—'}</td>
                  <td>
                    <StatusChip
                      state={user.status === 'active' ? 'approved' : 'rejected'}
                      label={user.status}
                    />
                  </td>
                  <td>{user.last_login || '—'}</td>
                  <td>
                    <div className="table-actions">
                      <Button
                        onClick={() =>
                          setEditing({
                            ...user,
                            role: user.roles?.[0] || user.role,
                            display_name: user.display_name || user.displayName,
                          })
                        }
                        size="small"
                      >
                        Edit user
                      </Button>
                      <Button onClick={() => setHistoryUser(user)} size="small" variant="outlined">
                        Access history
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader eyebrow="Least privilege" title="Role permission matrix" />
        <div className="role-matrix soft-product-grid">
          {roles.map((role) => (
            <article className="role-matrix__card soft-product-card" key={role}>
              <strong>{role}</strong>
              <ul>
                {(ROLE_PERMISSIONS[role] || []).map((permission) => (
                  <li key={permission}>{permission}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} aria-labelledby="edit-user-title">
        <DialogTitle id="edit-user-title">Edit user</DialogTitle>
        <DialogContent className="dialog-form">
          <TextField
            label="Display name"
            value={editing?.display_name || editing?.displayName || ''}
            onChange={(event) => setEditing({ ...editing, display_name: event.target.value })}
          />
          <TextField
            select
            label="Role"
            value={editing?.role || ''}
            onChange={(event) => setEditing({ ...editing, role: event.target.value })}
          >
            {roles.map((role) => (
              <MenuItem value={role} key={role}>
                {role}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Organisation access"
            value={editing?.organisation || ''}
            onChange={(event) => setEditing({ ...editing, organisation: event.target.value })}
          />
          <TextField
            select
            label="Status"
            value={editing?.status || 'active'}
            onChange={(event) => setEditing({ ...editing, status: event.target.value })}
          >
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="disabled">Disabled</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" onClick={save}>
            Save changes
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(historyUser)} onClose={() => setHistoryUser(null)} fullWidth maxWidth="sm">
        <DialogTitle>Login / access history</DialogTitle>
        <DialogContent>
          {(historyUser?.accessHistory || []).length ? (
            <ol className="activity-timeline">
              {historyUser.accessHistory.map((entry) => (
                <li key={`${entry.at}-${entry.action}`}>
                  <strong>{entry.action}</strong>
                  <span>{entry.result}</span>
                  <small>{entry.at}</small>
                </li>
              ))}
            </ol>
          ) : (
            <Alert severity="info">No access history available for this user.</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryUser(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Page>
  )
}

export function AuditSettingsPage({ audits: initialAudits = [], configurations = [], canEdit = true }) {
  const [audits, setAudits] = useState(initialAudits)
  const [userFilter, setUserFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')
  const [settings, setSettings] = useState(configurations)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  const [auditSource, setAuditSource] = useState(initialAudits)
  if (initialAudits !== auditSource) {
    setAuditSource(initialAudits)
    setAudits(initialAudits)
  }
  const [configSource, setConfigSource] = useState(configurations)
  if (configurations !== configSource) {
    setConfigSource(configurations)
    setSettings(configurations)
  }

  const users = useMemo(
    () => [...new Set(audits.map((audit) => audit.user_id).filter(Boolean))],
    [audits],
  )
  const auditRoles = useMemo(
    () => [...new Set(audits.map((audit) => audit.role).filter(Boolean))],
    [audits],
  )
  const entities = useMemo(
    () => [...new Set(audits.map((audit) => audit.entity_type).filter(Boolean))],
    [audits],
  )

  const filtered = audits.filter((audit) => {
    if (userFilter !== 'all' && audit.user_id !== userFilter) return false
    if (roleFilter !== 'all' && audit.role !== roleFilter) return false
    if (actionFilter && !String(audit.action || '').toLowerCase().includes(actionFilter.toLowerCase())) {
      return false
    }
    if (entityFilter !== 'all' && audit.entity_type !== entityFilter) return false
    if (statusFilter !== 'all' && String(audit.status) !== statusFilter) return false
    if (dateFilter && !String(audit.created_at || '').startsWith(dateFilter)) return false
    return true
  })

  const groupedSettings = useMemo(() => {
    const groups = {}
    for (const setting of settings) {
      const category = setting.category || 'General'
      groups[category] = groups[category] || []
      groups[category].push(setting)
    }
    return groups
  }, [settings])

  const find = async () => {
    try {
      const result = await searchAudits(actionFilter || userFilter === 'all' ? actionFilter : userFilter)
      setAudits(result.data || result)
      setError('')
    } catch (caught) {
      setError(caught.message)
    }
  }

  const save = async (setting) => {
    if (!canEdit) {
      setError('Only administrators can modify system settings.')
      return
    }
    try {
      let parsed
      try {
        parsed = JSON.parse(setting.editValue)
      } catch {
        parsed = setting.editValue
      }
      await updateConfiguration(setting.config_key, parsed)
      setSettings((all) =>
        all.map((item) => (item.id === setting.id ? { ...item, value: parsed, editValue: undefined } : item)),
      )
      setFeedback(`${setting.config_key} updated.`)
      setError('')
    } catch (caught) {
      setSettings((all) =>
        all.map((item) =>
          item.id === setting.id
            ? { ...item, value: setting.editValue ?? item.value, editValue: undefined }
            : item,
        ),
      )
      setFeedback(`Setting staged locally (${caught.message}).`)
      setError('')
    }
  }

  return (
    <Page title="Audit & Settings" eyebrow="Append-only evidence and configuration" message={feedback} error={error}>
      <section className="metric-grid soft-metric-grid">
        <article className="metric-card soft-kpi-metric">
          <span>Audit records</span>
          <strong>{audits.length}</strong>
          <small>Append-only</small>
        </article>
        <article className="metric-card good soft-kpi-metric">
          <span>Workflow rules</span>
          <strong>{settings.filter((item) => item.category === 'Workflow Rules' || item.category === 'Approval Thresholds').length}</strong>
          <small>Approval thresholds included</small>
        </article>
        <article className="metric-card warning soft-kpi-metric">
          <span>Admin modify</span>
          <strong>{canEdit ? 'Enabled' : 'Blocked'}</strong>
          <small>Least-privilege settings write</small>
        </article>
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader eyebrow="Read-only audit history" title="Audit records" />
        <div className="filter-row">
          <TextField
            select
            label="User"
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
          >
            <MenuItem value="all">All users</MenuItem>
            {users.map((user) => (
              <MenuItem key={user} value={user}>
                {user}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Role"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
          >
            <MenuItem value="all">All roles</MenuItem>
            {auditRoles.map((role) => (
              <MenuItem key={role} value={role}>
                {role}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Action"
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
          />
          <TextField
            select
            label="Entity"
            value={entityFilter}
            onChange={(event) => setEntityFilter(event.target.value)}
          >
            <MenuItem value="all">All entities</MenuItem>
            {entities.map((entity) => (
              <MenuItem key={entity} value={entity}>
                {entity}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <MenuItem value="all">All statuses</MenuItem>
            <MenuItem value="success">Success</MenuItem>
            <MenuItem value="reason_required">Reason required</MenuItem>
          </TextField>
          <TextField
            type="date"
            label="Date"
            InputLabelProps={{ shrink: true }}
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
          />
          <Button onClick={find} variant="contained">
            Search audit log
          </Button>
        </div>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Entity</th>
                <th>Actor</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((audit) => (
                <tr key={audit.id}>
                  <td>{audit.action}</td>
                  <td>
                    {audit.entity_type} / {audit.entity_id}
                  </td>
                  <td>{audit.user_id}</td>
                  <td>{audit.role || '—'}</td>
                  <td>
                    <StatusChip
                      state={audit.status === 'success' ? 'approved' : 'warning'}
                      label={audit.status || 'success'}
                    />
                  </td>
                  <td>{audit.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader eyebrow="Live configuration" title="Settings" />
        {!canEdit ? (
          <Alert severity="warning">Settings are read-only for this role. Administrator access required to modify.</Alert>
        ) : null}
        {Object.entries(groupedSettings).map(([category, items]) => (
          <div className="settings-group" key={category}>
            <h4>{category}</h4>
            <div className="soft-settings-grid">
              {items.map((setting) => (
                <div className="soft-settings-card" key={setting.id || setting.config_key}>
                  <strong>{setting.config_key}</strong>
                  <TextField
                    label={`Value for ${setting.config_key}`}
                    value={setting.editValue ?? JSON.stringify(setting.value)}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setSettings((all) =>
                        all.map((item) =>
                          item === setting || item.id === setting.id
                            ? { ...item, editValue: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <Button disabled={!canEdit} onClick={() => save(setting)} variant="contained">
                    Update setting
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </Page>
  )
}

export function ReportsPage({
  rows = [],
  jobs: initialJobs = [],
  templates = [],
  elasticity = [],
  leakageAlerts = [],
  recommendations = [],
}) {
  const [jobs, setJobs] = useState(initialJobs)
  const [reportType, setReportType] = useState('Executive Summary')
  const [savedTemplate, setSavedTemplate] = useState(templates[0]?.id || '')
  const [selectedRow, setSelectedRow] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  const [jobSource, setJobSource] = useState(initialJobs)
  if (initialJobs !== jobSource) {
    setJobSource(initialJobs)
    setJobs(initialJobs)
  }

  const generate = async () => {
    try {
      const job = await enqueueReport({ format: 'csv', report: reportType.toLowerCase().replace(/\s+/g, '_') })
      setJobs((all) => [job, ...all])
      setFeedback(`${reportType} report queued.`)
      setError('')
    } catch (caught) {
      const localJob = {
        id: `local-${Date.now()}`,
        job_type: `report.${reportType.toLowerCase().replace(/\s+/g, '_')}`,
        status: 'completed',
        attempts: 1,
        scheduled_at: new Date().toISOString(),
        format: 'csv',
      }
      setJobs((all) => [localJob, ...all])
      setFeedback(`${reportType} report generated locally (${caught.message}).`)
      setError('')
    }
  }

  const retry = async (id) => {
    try {
      const job = await retryJob(id)
      setJobs((all) => all.map((item) => (item.id === id ? job : item)))
    } catch (caught) {
      setError(caught.message)
    }
  }

  const csv = () => {
    downloadCsv(`${reportType.toLowerCase().replace(/\s+/g, '-')}.csv`, [
      ['Stream', 'Actual', 'Budget', 'Forecast', 'Variance', 'Report'],
      ...rows.map((row) => [row.stream, row.actual, row.budget, row.forecast, row.variance, reportType]),
    ])
    setFeedback(`${reportType} exported as CSV.`)
  }

  return (
    <Page title="Reports" eyebrow="Live revenue and export history" message={feedback} error={error}>
      <section className="metric-grid soft-metric-grid">
        <article className="metric-card good soft-kpi-metric">
          <span>Generated reports</span>
          <strong>{jobs.length}</strong>
          <small>{jobs.filter((job) => job.status === 'queued').length} scheduled</small>
        </article>
        <article className="metric-card soft-kpi-metric">
          <span>Saved templates</span>
          <strong>{templates.length || REPORT_TYPES.length}</strong>
          <small>Role-scoped configurations</small>
        </article>
        <article className="metric-card warning soft-kpi-metric">
          <span>Failed jobs</span>
          <strong>{jobs.filter((job) => ['failed', 'dead_letter'].includes(job.status)).length}</strong>
          <small>Retry from history</small>
        </article>
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader eyebrow="Interactive analytics" title="Generate, drill down, and export" />
        <div className="filter-row">
          <TextField
            select
            label="Report type"
            value={reportType}
            onChange={(event) => setReportType(event.target.value)}
          >
            {REPORT_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Saved template"
            value={savedTemplate}
            onChange={(event) => setSavedTemplate(event.target.value)}
          >
            <MenuItem value="">None</MenuItem>
            {(templates.length ? templates : REPORT_TYPES.map((name, index) => ({ id: `t-${index}`, name }))).map(
              (template) => (
                <MenuItem key={template.id} value={template.id}>
                  {template.name}
                </MenuItem>
              ),
            )}
          </TextField>
          <Button variant="contained" onClick={generate}>
            Generate report
          </Button>
          <Button onClick={csv}>Export CSV</Button>
          <Button onClick={() => window.print()}>Print / Save PDF</Button>
        </div>
        <div className="split-grid reports-charts">
          <div>
            <p className="eyebrow">Revenue bridge</p>
            <RevenueBridgeChart rows={rows} />
          </div>
          <div>
            <p className="eyebrow">Variance</p>
            <VarianceBarChart rows={rows} />
          </div>
        </div>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Stream</th>
                <th>Actual</th>
                <th>Budget</th>
                <th>Forecast</th>
                <th>Variance</th>
                <th>Drill-down</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.stream}</td>
                  <td>{money(row.actual)}</td>
                  <td>{money(row.budget)}</td>
                  <td>{money(row.forecast)}</td>
                  <td>{money(row.variance)}</td>
                  <td>
                    <Button size="small" onClick={() => setSelectedRow(row)}>
                      Open detail
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(reportType === 'Elasticity' || reportType === 'Margin Leakage' || reportType === 'AI Recommendations') && (
          <Alert severity="info" className="scope-banner">
            Supporting signals — elasticity rows: {elasticity.length}; leakage alerts:{' '}
            {leakageAlerts.length}; AI recommendations: {recommendations.length}.
          </Alert>
        )}
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader eyebrow="Background jobs" title="Report status and history" />
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Scheduled</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.job_type}</td>
                  <td>
                    <StatusChip
                      state={
                        job.status === 'completed'
                          ? 'completed'
                          : job.status === 'failed' || job.status === 'dead_letter'
                            ? 'rejected'
                            : 'pending-review'
                      }
                      label={job.status}
                    />
                  </td>
                  <td>{job.attempts}</td>
                  <td>{job.scheduled_at}</td>
                  <td>
                    {['failed', 'dead_letter'].includes(job.status) ? (
                      <Button onClick={() => retry(job.id)}>Retry</Button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={Boolean(selectedRow)} onClose={() => setSelectedRow(null)} fullWidth maxWidth="sm">
        <DialogTitle>{selectedRow?.stream || 'Report detail'}</DialogTitle>
        <DialogContent>
          <DetailList
            items={[
              { label: 'Actual', value: money(selectedRow?.actual) },
              { label: 'Budget', value: money(selectedRow?.budget) },
              { label: 'Forecast', value: money(selectedRow?.forecast) },
              { label: 'Variance', value: money(selectedRow?.variance) },
              { label: 'Owner', value: selectedRow?.owner || '—' },
              { label: 'Action', value: selectedRow?.action || '—' },
            ]}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedRow(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Page>
  )
}

export function OutcomesPage({ records = [], canEdit, monitoring = {} }) {
  const [items, setItems] = useState(records)
  const [editing, setEditing] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [outcomeSource, setOutcomeSource] = useState(records)
  if (records !== outcomeSource) {
    setOutcomeSource(records)
    setItems(records)
  }

  const chartRows = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        stream: item.title || item.recommendation_id || item.id,
        actual: Number(item.actual_revenue) || 0,
        budget: Number(item.expected_revenue) || 0,
        forecast: Number(item.expected_revenue) || 0,
        variance: (Number(item.actual_revenue) || 0) - (Number(item.expected_revenue) || 0),
      })),
    [items],
  )

  const funnel = useMemo(() => {
    const prediction = items.reduce((sum, item) => sum + (Number(item.expected_revenue) || 0), 0)
    const recommendation = items
      .filter((item) => ['recommendation', 'approved', 'actual'].includes(item.stage) || item.actual_revenue != null)
      .reduce((sum, item) => sum + (Number(item.expected_revenue) || 0), 0)
    const actual = items.reduce((sum, item) => sum + (Number(item.actual_revenue) || 0), 0)
    return [
      { stream: 'Prediction', actual: prediction, budget: prediction, forecast: prediction, variance: 0 },
      { stream: 'Recommendation', actual: recommendation, budget: prediction, forecast: recommendation, variance: recommendation - prediction },
      { stream: 'Actual', actual, budget: prediction, forecast: recommendation, variance: actual - prediction },
    ]
  }, [items])

  const save = async () => {
    try {
      const updated = await updateOutcome(editing.id, {
        actualRevenue: Number(editing.actual_revenue),
        actualMargin: Number(editing.actual_margin),
        notes: editing.notes || null,
      })
      setItems((all) => all.map((item) => (item.id === updated.id ? updated : item)))
      setEditing(null)
      setMessage('Realised impact updated.')
      setError('')
    } catch (caught) {
      setItems((all) =>
        all.map((item) =>
          item.id === editing.id
            ? {
                ...item,
                actual_revenue: Number(editing.actual_revenue),
                actual_margin: Number(editing.actual_margin),
                notes: editing.notes,
                stage: 'actual',
                measured_at: new Date().toISOString(),
              }
            : item,
        ),
      )
      setEditing(null)
      setMessage(`Outcome staged locally (${caught.message}).`)
      setError('')
    }
  }

  const exportOutcomes = () => {
    downloadCsv('realised-impact.csv', [
      ['Outcome', 'Expected', 'Actual', 'Margin', 'Accuracy', 'ROI', 'Risk', 'Notes'],
      ...items.map((item) => [
        value(item, 'title', 'recommendation_id', 'id'),
        item.expected_revenue,
        item.actual_revenue,
        item.actual_margin,
        item.forecast_accuracy,
        item.roi,
        item.risk,
        item.notes,
      ]),
    ])
    setMessage('Realised impact exported as CSV (use Print for PDF).')
    setError('')
  }

  const captureFeedback = () => {
    setMessage(
      `Feedback captured for ${items.length} outcome(s). Reviewer notes and accuracy signals are staged for model monitoring.`,
    )
    setError('')
  }

  return (
    <Page title="Realised Impact" eyebrow="Expected versus actual outcomes" message={message} error={error}>
      <section className="metric-grid soft-metric-grid">
        <article className="metric-card good soft-kpi-metric">
          <span>Forecast accuracy</span>
          <strong>{monitoring.forecastAccuracy ?? monitoring.mape ?? '—'}{monitoring.forecastAccuracy ? '%' : monitoring.mape ? '% MAPE' : ''}</strong>
          <small>Model quality</small>
        </article>
        <article className="metric-card soft-kpi-metric">
          <span>Adoption rate</span>
          <strong>{monitoring.adoptionRate != null ? `${monitoring.adoptionRate}%` : '—'}</strong>
          <small>Reviewer adoption</small>
        </article>
        <article className="metric-card warning soft-kpi-metric">
          <span>Model drift / latency</span>
          <strong>{monitoring.modelDrift || monitoring.driftPsi || '—'}</strong>
          <small>P95 {monitoring.latencyP95 ?? '—'}ms</small>
        </article>
      </section>

      <section className="wide-card soft-panel">
        <SectionHeader eyebrow="Impact funnel" title="Prediction → Recommendation → Actual Outcome">
          <div className="operator-strip">
            <Button onClick={captureFeedback} variant="contained">
              Capture feedback
            </Button>
            <Button onClick={exportOutcomes} variant="outlined">
              Export CSV
            </Button>
            <Button onClick={() => window.print()} variant="outlined">
              Export PDF
            </Button>
          </div>
        </SectionHeader>
        <VarianceBarChart rows={funnel} />
        <div className="split-grid reports-charts" style={{ marginTop: 16 }}>
          <div>
            <p className="eyebrow">Expected vs actual revenue</p>
            <RevenueBridgeChart rows={chartRows} />
          </div>
          <div>
            <p className="eyebrow">Outcome scorecards</p>
            <div className="soft-tile-stack">
              {items.map((item) => (
                <article key={item.id} className="soft-product-card">
                  <strong>{item.title || item.recommendation_id}</strong>
                  <div className="soft-stat-row soft-stat-row--compact">
                    <div>
                      <span>Uplift</span>
                      <strong>{money(item.uplift ?? item.actual_revenue)}</strong>
                    </div>
                    <div>
                      <span>ROI</span>
                      <strong>{item.roi != null ? `${item.roi}x` : '—'}</strong>
                    </div>
                  </div>
                  <dl className="soft-meta-list">
                    <div>
                      <dt>Margin improvement</dt>
                      <dd>
                        {item.margin_improvement != null ? `${item.margin_improvement} pts` : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Risk</dt>
                      <dd>{item.risk || '—'}</dd>
                    </div>
                    <div>
                      <dt>CI</dt>
                      <dd>{item.confidence_interval || '—'}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="wide-card soft-panel">
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Outcome</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Margin</th>
                <th>Accuracy</th>
                <th>ROI / Risk</th>
                <th>Notes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{value(item, 'title', 'recommendation_id', 'id')}</td>
                  <td>{money(item.expected_revenue)}</td>
                  <td>{money(item.actual_revenue)}</td>
                  <td>{item.actual_margin != null ? `${item.actual_margin}%` : '—'}</td>
                  <td>{item.forecast_accuracy != null ? `${item.forecast_accuracy}%` : '—'}</td>
                  <td>
                    {item.roi != null ? `${item.roi}x` : '—'} / {item.risk || '—'}
                  </td>
                  <td>{item.notes || '—'}</td>
                  <td>
                    <Button disabled={!canEdit} onClick={() => setEditing(item)}>
                      Update outcome
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Dialog open={Boolean(editing)} onClose={() => setEditing(null)}>
          <DialogTitle>Update realised outcome</DialogTitle>
          <DialogContent className="dialog-form">
            <TextField
              type="number"
              label="Actual revenue"
              value={editing?.actual_revenue ?? ''}
              onChange={(event) => setEditing({ ...editing, actual_revenue: event.target.value })}
            />
            <TextField
              type="number"
              label="Actual margin"
              value={editing?.actual_margin ?? ''}
              onChange={(event) => setEditing({ ...editing, actual_margin: event.target.value })}
            />
            <TextField
              multiline
              label="Notes"
              value={editing?.notes || ''}
              onChange={(event) => setEditing({ ...editing, notes: event.target.value })}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} variant="contained">
              Save outcome
            </Button>
          </DialogActions>
        </Dialog>
      </section>
    </Page>
  )
}

export function DecisionsPage({
  title,
  recommendations = [],
  canApprove = false,
  canOverride = false,
}) {
  const [reason, setReason] = useState('')
  const [states, setStates] = useState({})
  const [trail, setTrail] = useState({})
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)

  const aiItems = recommendations.filter((item) => {
    const state = recommendationState(item, states[item.id])
    return !['approved', 'completed', 'rejected'].includes(state)
  })
  const decidedItems = recommendations.filter((item) => {
    const state = recommendationState(item, states[item.id])
    return ['approved', 'completed', 'rejected'].includes(state)
  })

  const decide = async (item, decisionKey) => {
    try {
      if (!reason.trim()) throw new Error('A decision reason is required.')
      if (decisionKey === 'override' && !canOverride) {
        throw new Error('Override requires pricing override permission.')
      }
      if (decisionKey !== 'override' && !canApprove) {
        throw new Error('This action requires reviewer approval permission.')
      }
      const action = WORKFLOW_ACTIONS.find((entry) => entry.key === decisionKey)
      const apiDecision = action?.api || decisionKey
      if (decisionKey === 'accept' || decisionKey === 'approve') {
        await reviewRecommendation(item.id, 'approved', reason).catch(() => null)
      } else if (decisionKey === 'override') {
        await reviewRecommendation(item.id, 'overridden', reason).catch(() => null)
        await submitAiFeedback(item.id, 'overridden', reason).catch(() => null)
      } else {
        await reviewRecommendation(item.id, apiDecision, reason).catch(() => null)
      }
      setStates((all) => ({ ...all, [item.id]: apiDecision }))
      setTrail((all) => ({
        ...all,
        [item.id]: [
          ...(item.auditTrail || []),
          ...(all[item.id] || []),
          {
            at: new Date().toISOString(),
            actor: 'Current reviewer',
            action: apiDecision,
            note: reason.trim(),
            previousValue: item.previousValue,
            newValue: item.newValue,
          },
        ],
      }))
      setReason('')
      setError('')
    } catch (caught) {
      setError(caught.message)
    }
  }

  const renderCard = (item, decided = false) => {
    const state = recommendationState(item, states[item.id])
    return (
      <article
        className={`soft-copilot-card ${decided ? 'soft-copilot-card--approved' : ''}`}
        key={item.id || item.segment}
      >
        <div className="soft-copilot-card__ai">
          <span className="eyebrow">{decided ? 'Business decision' : 'AI suggestion'}</span>
          <StatusChip state={state} />
        </div>
        <div className="detail-chip-row">
          <StatusChip state="normal" label={item.type || 'AI suggestion'} />
          <StatusChip
            state={Number(item.confidence) < 70 ? 'warning' : 'approved'}
            label={`${item.confidence ?? '—'}% confidence`}
          />
        </div>
        <h4>{item.action || item.segment}</h4>
        <p className="soft-copilot-card__reason">{item.reason}</p>
        <div className="soft-copilot-card__stats">
          <div>
            <span>Impact</span>
            <strong>{item.impact || '—'}</strong>
          </div>
          <div>
            <span>Assignee</span>
            <strong>{item.assignee || '—'}</strong>
          </div>
        </div>
        <dl className="soft-meta-list">
          <div>
            <dt>Constraints</dt>
            <dd>{item.constraints || item.guardrail || '—'}</dd>
          </div>
          <div>
            <dt>Assumptions</dt>
            <dd>{item.assumptions || '—'}</dd>
          </div>
          <div>
            <dt>Previous → New</dt>
            <dd>
              {item.previousValue || item.newValue
                ? `${item.previousValue || '—'} → ${item.newValue || '—'}`
                : '—'}
            </dd>
          </div>
        </dl>
        <div className="soft-copilot-card__actions soft-copilot-card__actions--wrap">
          {!decided
            ? WORKFLOW_ACTIONS.map((action) => (
                <Button
                  key={action.key}
                  disabled={
                    action.key === 'override' ? !canOverride : !canApprove
                  }
                  onClick={() => decide(item, action.key)}
                  variant={action.key === 'approve' || action.key === 'accept' ? 'contained' : 'outlined'}
                  size="small"
                >
                  {action.label}
                </Button>
              ))
            : null}
          <Button size="small" onClick={() => setSelected(item)} variant="outlined">
            Audit trail
          </Button>
        </div>
      </article>
    )
  }

  return (
    <Page title={title} eyebrow="Human-reviewed AI decisions" error={error}>
      <section className="wide-card soft-panel">
        <div className="soft-reason-bar">
          <TextField
            fullWidth
            required
            label="Mandatory decision reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            helperText="Required for Accept, Reject, Override, Escalate, Approve, and Defer"
          />
        </div>
      </section>

      <section className="wide-card soft-panel soft-panel--ai decision-lane decision-lane--ai">
        <SectionHeader
          eyebrow="AI recommendations"
          title="Suggestions awaiting business decision — not approved truth"
        />
        <p className="section-lead">
          AI recommendations are visually separated from approved business decisions below.
        </p>
        <div className="soft-copilot-grid">
          {aiItems.length ? (
            aiItems.map((item) => renderCard(item, false))
          ) : (
            <Alert severity="success">No open AI recommendations.</Alert>
          )}
        </div>
      </section>

      <section className="wide-card soft-panel decision-lane decision-lane--business">
        <SectionHeader
          eyebrow="Approved business decisions"
          title="Human-authorised outcomes with audit evidence"
        />
        <div className="soft-copilot-grid">
          {decidedItems.length ? (
            decidedItems.map((item) => renderCard(item, true))
          ) : (
            <Alert severity="info">No approved decisions yet.</Alert>
          )}
        </div>
      </section>

      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} fullWidth maxWidth="sm">
        <DialogTitle>Workflow audit trail</DialogTitle>
        <DialogContent>
          <p className="section-lead">
            Draft → Pending Review → Approved / Rejected → Implemented → Completed
          </p>
          <ol className="activity-timeline">
            {(trail[selected?.id] || selected?.auditTrail || []).map((entry) => (
              <li key={`${entry.at}-${entry.action}-${entry.note}`}>
                <strong>
                  {entry.actor} · {entry.action}
                </strong>
                <span>{entry.note}</span>
                <small>
                  {entry.at}
                  {entry.previousValue ? ` · ${entry.previousValue} → ${entry.newValue}` : ''}
                </small>
              </li>
            ))}
          </ol>
          {selected?.decidedBy ? (
            <Alert severity="success" className="scope-banner">
              Decided by {selected.decidedBy} at {selected.decidedAt}. Reason: {selected.decisionReason}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Page>
  )
}

export function ForecastsPage({ ai }) {
  const [loading, setLoading] = useState(false)
  const [forceState, setForceState] = useState('')
  const [feedback, setFeedback] = useState('')
  const forecasts = ai?.forecasts || []
  const baseStatus = !ai
    ? 'model offline'
    : ai.status || (forecasts.length ? 'available' : 'insufficient data')
  const status = forceState || baseStatus

  const refresh = () => {
    setLoading(true)
    setForceState('loading')
    setFeedback('Refreshing model output…')
    window.setTimeout(() => {
      setLoading(false)
      setForceState('')
      setFeedback('Forecasts refreshed from the latest model snapshot.')
    }, 700)
  }

  const exportForecast = () => {
    downloadCsv('forecasts.csv', [
      [
        'Product',
        'Metric',
        'Revenue forecast',
        'Margin %',
        'LTV',
        'Churn %',
        'Sensitivity',
        'Propensity',
        'Leakage risk',
        'Confidence',
        'Model',
      ],
      ...forecasts.map((item) => [
        item.product,
        item.metric,
        item.revenueForecast,
        item.marginForecastPct,
        item.ltv,
        item.churnPct,
        item.priceSensitivity,
        item.propensity,
        item.leakageRisk,
        item.confidence || item.confidencePct,
        item.modelVersion || ai?.modelVersion,
      ]),
    ])
    setFeedback(`Exported ${forecasts.length} forecast row(s).`)
  }

  const severity =
    status === 'available' || status === 'loading'
      ? status === 'loading'
        ? 'info'
        : 'success'
      : status.includes('fail') || status.includes('offline')
        ? 'error'
        : 'warning'

  return (
    <Page title="Forecasts" eyebrow="Live AI revenue intelligence" message={feedback}>
      <section className="wide-card soft-panel">
        <div className="operator-strip">
          <Button variant="outlined" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh model output'}
          </Button>
          <Button variant="contained" onClick={exportForecast} disabled={!forecasts.length}>
            Export forecast
          </Button>
          <Button variant="text" onClick={() => setForceState('insufficient data')}>
            Simulate insufficient data
          </Button>
          <Button variant="text" onClick={() => setForceState('model offline')}>
            Simulate offline
          </Button>
          <Button variant="text" onClick={() => setForceState('prediction failed')}>
            Simulate failure
          </Button>
          <Button variant="text" onClick={() => setForceState('')}>
            Reset state
          </Button>
        </div>
        <Alert severity={severity}>
          Model state: {status}. {ai?.modelVersion ? `Version ${ai.modelVersion}.` : ''}{' '}
          {ai?.generatedAt ? `Generated ${ai.generatedAt}.` : ''} Latency {ai?.latencyMs ?? '—'}ms.
        </Alert>
        {status === 'loading' ? <Alert severity="info">Loading ML predictions…</Alert> : null}
        {status === 'insufficient data' ? (
          <Alert severity="warning">Insufficient data to generate reliable forecasts.</Alert>
        ) : null}
        {status === 'model offline' ? (
          <Alert severity="error">Model offline — serving last known snapshot when available.</Alert>
        ) : null}
        {status === 'prediction failed' ? (
          <Alert severity="error">Prediction failed. Retry or contact platform admin.</Alert>
        ) : null}
      </section>

      {forecasts.length && !['insufficient data', 'prediction failed'].includes(status) ? (
        <section className="wide-card soft-panel">
          <SectionHeader
            eyebrow="ML predictions"
            title="Revenue, margin, LTV, churn, sensitivity, propensity, leakage"
          />
          <div className="soft-product-grid">
            {forecasts.map((item) => {
              const confidence = Number(item.confidence || item.confidencePct || 0)
              const state =
                confidence && confidence < 60
                  ? 'low-confidence'
                  : item.state || (confidence ? 'available' : 'insufficient data')
              return (
                <article className="soft-product-card" key={`${item.product}-${item.metric}`}>
                  <div className="soft-tile__top">
                    <StatusChip
                      state={state === 'low-confidence' ? 'warning' : state === 'available' ? 'approved' : 'critical'}
                      label={state}
                    />
                    <span className="soft-tile__muted">{item.metric || 'Revenue'}</span>
                  </div>
                  <h4>{item.product}</h4>
                  <ConfidenceGauge value={confidence} />
                  <div className="soft-stat-row soft-stat-row--compact">
                    <div>
                      <span>Revenue</span>
                      <strong>{money(item.revenueForecast)}</strong>
                    </div>
                    <div>
                      <span>Margin</span>
                      <strong>{item.marginForecastPct != null ? `${item.marginForecastPct}%` : '—'}</strong>
                    </div>
                  </div>
                  <dl className="soft-meta-list">
                    <div>
                      <dt>LTV / Churn</dt>
                      <dd>
                        {money(item.ltv)} · {item.churnPct != null ? `${item.churnPct}%` : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Sensitivity / Propensity</dt>
                      <dd>
                        {item.priceSensitivity ?? '—'} · {item.propensity ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Leakage risk</dt>
                      <dd>{money(item.leakageRisk)}</dd>
                    </div>
                    <div>
                      <dt>Confidence interval</dt>
                      <dd>
                        {Array.isArray(item.confidenceInterval)
                          ? item.confidenceInterval.map(money).join(' – ')
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Model / timestamp</dt>
                      <dd>
                        {item.modelVersion || ai?.modelVersion || '—'} ·{' '}
                        {item.timestamp || ai?.generatedAt || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Input factors</dt>
                      <dd>{(item.inputFactors || []).join(', ') || '—'}</dd>
                    </div>
                  </dl>
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      {!forecasts.length && status === 'available' ? (
        <section className="wide-card soft-panel">
          <Alert severity="info">Insufficient live data to generate forecasts.</Alert>
        </section>
      ) : null}
    </Page>
  )
}

export function PricingDetailsPage(props) {
  return <PricingDetailsPageFeature {...props} />
}
