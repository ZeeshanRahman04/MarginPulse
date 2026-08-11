import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcrypt'
import initSqlJs from 'sql.js'
import { v4 as uuid } from 'uuid'
import { config } from '../config/env.js'
import { ensureRichDemoData } from './demoData.js'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const databasePath = config.databasePath ?? path.join(__dirname, 'margin-pulse.sqlite')
const sqlWasmDirectory = path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm'))

let database

async function loadSqlJs() {
  return initSqlJs({
    locateFile: (file) => path.join(sqlWasmDirectory, file),
  })
}

async function createFreshDatabase(SQL) {
  const db = new SQL.Database()
  await createSchema(db)
  await seedDatabase(db)
  return db
}

export async function initDatabase() {
  if (database) return database

  const SQL = await loadSqlJs()

  if (config.memoryDatabase || (config.nodeEnv === 'test' && config.databasePath)) {
    database = await createFreshDatabase(SQL)
    await saveDatabase(database)
  } else {
    try {
      const file = await fs.readFile(databasePath)
      database = new SQL.Database(file)
    } catch {
      database = await createFreshDatabase(SQL)
      await saveDatabase(database)
    }
  }

  database.exec('PRAGMA foreign_keys = ON;')
  await migrateDatabase(database)
  await saveDatabase(database)
  return database
}

export async function saveDatabase(db = database) {
  if (!db || config.memoryDatabase) return
  await fs.mkdir(path.dirname(databasePath), { recursive: true })
  await fs.writeFile(databasePath, Buffer.from(db.export()))
}

export function run(db, sql, params = []) {
  const statement = db.prepare(sql)
  try {
    statement.bind(params)
    statement.step()
  } finally {
    statement.free()
  }
}

export function all(db, sql, params = []) {
  const statement = db.prepare(sql)
  const rows = []

  try {
    statement.bind(params)
    while (statement.step()) {
      rows.push(statement.getAsObject())
    }
  } finally {
    statement.free()
  }

  return rows
}

export function get(db, sql, params = []) {
  return all(db, sql, params)[0] ?? null
}

async function createSchema(db) {
  db.exec(`
    CREATE TABLE organisations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('active','suspended','archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE permissions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL
    );

    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organisation_id, name)
    );

    CREATE TABLE role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id),
      permission_id TEXT NOT NULL REFERENCES permissions(id),
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','disabled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE user_roles (
      user_id TEXT NOT NULL REFERENCES users(id),
      role_id TEXT NOT NULL REFERENCES roles(id),
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE learners (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      segment_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('prospect','active','paused','alumni')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE (organisation_id, email)
    );

    CREATE TABLE instructors (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      name TEXT NOT NULL,
      speciality TEXT NOT NULL,
      hourly_cost REAL NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE courses (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      instructor_id TEXT REFERENCES instructors(id),
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','published','retired')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE (organisation_id, code)
    );

    CREATE TABLE lessons (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id),
      title TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (course_id, sequence)
    );

    CREATE TABLE enrolments (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      learner_id TEXT NOT NULL REFERENCES learners(id),
      course_id TEXT NOT NULL REFERENCES courses(id),
      status TEXT NOT NULL CHECK (status IN ('enrolled','completed','withdrawn')),
      enrolled_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE (learner_id, course_id)
    );

    CREATE TABLE progress (
      id TEXT PRIMARY KEY,
      enrolment_id TEXT NOT NULL REFERENCES enrolments(id),
      lesson_id TEXT NOT NULL REFERENCES lessons(id),
      completion_pct REAL NOT NULL CHECK (completion_pct >= 0 AND completion_pct <= 100),
      updated_at TEXT NOT NULL,
      UNIQUE (enrolment_id, lesson_id)
    );

    CREATE TABLE assessments (
      id TEXT PRIMARY KEY,
      enrolment_id TEXT NOT NULL REFERENCES enrolments(id),
      assessment_type TEXT NOT NULL,
      score REAL NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('passed','failed','retake')),
      assessed_at TEXT NOT NULL
    );

    CREATE TABLE certificates (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL REFERENCES learners(id),
      course_id TEXT NOT NULL REFERENCES courses(id),
      status TEXT NOT NULL CHECK (status IN ('issued','revoked','expired')),
      issued_at TEXT NOT NULL,
      expires_at TEXT
    );

    CREATE TABLE audits (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      actor_user_id TEXT REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE segments (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organisation_id, name)
    );

    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      segment_id TEXT REFERENCES segments(id),
      name TEXT NOT NULL,
      customer_type TEXT NOT NULL CHECK (customer_type IN ('learner','enterprise')),
      status TEXT NOT NULL CHECK (status IN ('active','prospect','churned')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      product_type TEXT NOT NULL CHECK (product_type IN ('subscription','course','enterprise_licence','certification','service')),
      status TEXT NOT NULL CHECK (status IN ('active','inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE (organisation_id, sku)
    );

    CREATE TABLE price_lists (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      list_price REAL NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft','active','expired')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE cost_versions (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      version_label TEXT NOT NULL,
      direct_cost REAL NOT NULL,
      instructor_cost REAL NOT NULL,
      mentor_cost REAL NOT NULL,
      support_cost REAL NOT NULL,
      content_cost REAL NOT NULL,
      effective_from TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','superseded')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE discounts (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      name TEXT NOT NULL,
      discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage','fixed','scholarship','volume')),
      value REAL NOT NULL,
      floor_margin_pct REAL NOT NULL,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('active','inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE promotions (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      name TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('planned','active','ended')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE quotes (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      price_list_id TEXT NOT NULL REFERENCES price_lists(id),
      discount_id TEXT REFERENCES discounts(id),
      quote_number TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      net_amount REAL NOT NULL,
      margin_pct REAL NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','pending_approval','approved','rejected','contracted')),
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE (organisation_id, quote_number)
    );

    CREATE TABLE contracts (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      quote_id TEXT REFERENCES quotes(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      contract_number TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      floor_price REAL,
      ceiling_discount_pct REAL,
      status TEXT NOT NULL CHECK (status IN ('active','renewal','expired','terminated')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organisation_id, contract_number)
    );

    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      customer_id TEXT REFERENCES customers(id),
      product_id TEXT REFERENCES products(id),
      transaction_type TEXT NOT NULL CHECK (transaction_type IN ('invoice','payment','refund','credit')),
      amount REAL NOT NULL,
      cost_amount REAL NOT NULL DEFAULT 0,
      transaction_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('posted','void','pending')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE budgets (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      product_id TEXT REFERENCES products(id),
      period TEXT NOT NULL,
      amount REAL NOT NULL,
      margin_pct REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organisation_id, product_id, period)
    );

    CREATE TABLE forecasts (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      product_id TEXT REFERENCES products(id),
      period TEXT NOT NULL,
      amount REAL NOT NULL,
      confidence_low REAL NOT NULL,
      confidence_high REAL NOT NULL,
      model_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE model_versions (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      model_name TEXT NOT NULL,
      version_label TEXT NOT NULL,
      purpose TEXT NOT NULL,
      constraints_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','retired')),
      created_at TEXT NOT NULL,
      UNIQUE (organisation_id, model_name, version_label)
    );

    CREATE TABLE ai_runs (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      model_version_id TEXT NOT NULL REFERENCES model_versions(id),
      input_data_json TEXT NOT NULL,
      output_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      explanation TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('generated','reviewed','superseded')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE recommendations (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      ai_run_id TEXT REFERENCES ai_runs(id),
      title TEXT NOT NULL,
      recommendation_type TEXT NOT NULL CHECK (recommendation_type IN ('pricing','discount','forecast','margin','approval')),
      expected_impact REAL NOT NULL,
      confidence_low REAL NOT NULL,
      confidence_high REAL NOT NULL,
      assumptions_json TEXT NOT NULL,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','needs_review','approved','rejected','overridden','realised')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      reviewer_user_id TEXT REFERENCES users(id),
      decision TEXT NOT NULL CHECK (decision IN ('pending','approved','rejected','overridden')),
      override_reason TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );

    CREATE TABLE overrides (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      recommendation_id TEXT NOT NULL REFERENCES recommendations(id),
      reviewer_user_id TEXT NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE realised_outcomes (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      recommendation_id TEXT REFERENCES recommendations(id),
      actual_revenue REAL NOT NULL,
      actual_margin REAL NOT NULL,
      measured_at TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE model_monitoring_metrics (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      model_version_id TEXT NOT NULL REFERENCES model_versions(id),
      metric_name TEXT NOT NULL,
      metric_value REAL NOT NULL,
      measured_at TEXT NOT NULL
    );

    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      user_id TEXT REFERENCES users(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('unread','read','archived')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      owner_user_id TEXT REFERENCES users(id),
      access_policy TEXT NOT NULL,
      object_version TEXT NOT NULL,
      storage_reference TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE configurations (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      config_key TEXT NOT NULL,
      config_value_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organisation_id, config_key)
    );

    CREATE TABLE idempotency_keys (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      response_status INTEGER NOT NULL DEFAULT 200,
      UNIQUE (organisation_id, idempotency_key)
    );

    CREATE TABLE background_jobs (
      id TEXT PRIMARY KEY,
      organisation_id TEXT REFERENCES organisations(id),
      job_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','dead_letter')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      scheduled_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE dead_letters (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES background_jobs(id),
      reason TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_learners_org_status ON learners (organisation_id, status);
    CREATE INDEX idx_courses_org_status ON courses (organisation_id, status);
    CREATE INDEX idx_enrolments_org_status ON enrolments (organisation_id, status);
    CREATE INDEX idx_quotes_org_status ON quotes (organisation_id, status);
    CREATE INDEX idx_transactions_dashboard ON transactions (organisation_id, product_id, transaction_date, status);
    CREATE INDEX idx_budgets_period ON budgets (organisation_id, period);
    CREATE INDEX idx_forecasts_period ON forecasts (organisation_id, period);
    CREATE INDEX idx_recommendations_status ON recommendations (organisation_id, status, recommendation_type);
    CREATE INDEX idx_approvals_entity ON approvals (organisation_id, entity_type, entity_id, decision);
    CREATE INDEX idx_audits_entity_date ON audits (organisation_id, entity_type, entity_id, created_at);
    CREATE INDEX idx_notifications_user_status ON notifications (organisation_id, user_id, status);
    CREATE INDEX idx_jobs_status_schedule ON background_jobs (status, scheduled_at);
  `)
}

async function migrateDatabase(db) {
  const now = new Date().toISOString()
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      learner_id TEXT NOT NULL REFERENCES learners(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      status TEXT NOT NULL CHECK (status IN ('trial','active','paused','cancelled','expired')),
      started_at TEXT NOT NULL,
      ends_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_org_status
      ON subscriptions (organisation_id, status, learner_id);
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_user
      ON password_reset_tokens (organisation_id, user_id, expires_at);
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      remember_me INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
      ON refresh_tokens (organisation_id, user_id, expires_at);
  `)
  addColumnIfMissing(db, 'promotions', 'created_at', 'TEXT')
  addColumnIfMissing(db, 'promotions', 'updated_at', 'TEXT')
  addColumnIfMissing(db, 'ai_runs', 'updated_at', 'TEXT')
  addColumnIfMissing(db, 'ai_runs', 'completed_at', 'TEXT')
  addColumnIfMissing(db, 'idempotency_keys', 'response_status', 'INTEGER NOT NULL DEFAULT 200')
  run(db, 'UPDATE promotions SET created_at = COALESCE(created_at, starts_at), updated_at = COALESCE(updated_at, starts_at)')
  run(db, 'UPDATE ai_runs SET updated_at = COALESCE(updated_at, created_at), completed_at = COALESCE(completed_at, created_at)')

  const organisation = get(db, 'SELECT id FROM organisations ORDER BY created_at LIMIT 1')
  if (!organisation) return

  const learner = get(
    db,
    'SELECT id FROM learners WHERE organisation_id = ? AND deleted_at IS NULL LIMIT 1',
    [organisation.id],
  )
  const subscriptionProduct = get(
    db,
    "SELECT id FROM products WHERE organisation_id = ? AND product_type = 'subscription' AND deleted_at IS NULL LIMIT 1",
    [organisation.id],
  )
  if (
    learner &&
    subscriptionProduct &&
    !get(db, 'SELECT id FROM subscriptions WHERE organisation_id = ? LIMIT 1', [organisation.id])
  ) {
    run(
      db,
      `INSERT INTO subscriptions
       (id, organisation_id, learner_id, product_id, status, started_at, ends_at,
        created_at, updated_at, deleted_at, version)
       VALUES (?, ?, ?, ?, 'active', ?, NULL, ?, ?, NULL, 1)`,
      [uuid(), organisation.id, learner.id, subscriptionProduct.id, now, now, now],
    )
  }

  const permissionRows = [
    ['finance:read', 'Read revenue, margin, budget, and forecast data'],
    ['finance:write', 'Maintain transactions, budgets, forecasts, and outcomes'],
    ['commercial:write', 'Maintain customers, quotes, and contracts'],
    ['enterprise:read', 'Read enterprise-scoped customers, products, quotes, and revenue'],
    ['pricing:write', 'Create and update pricing data'],
    ['deals:approve', 'Approve high-impact quotes and AI recommendations'],
    ['ai:override', 'Override AI recommendations with reason'],
    ['admin:manage', 'Manage all tenant administration'],
    ['education:read', 'Read tenant EdTech operational records'],
    ['audits:read', 'Search tenant audit events'],
    ['jobs:manage', 'Enqueue and retry tenant background jobs'],
    ['users:manage', 'Administer tenant users and role assignments'],
    ['configuration:manage', 'Read and update tenant configuration'],
  ]
  for (const [code, description] of permissionRows) {
    run(db, 'INSERT OR IGNORE INTO permissions (id, code, description) VALUES (?, ?, ?)', [
      uuid(),
      code,
      description,
    ])
  }

  run(db, "UPDATE roles SET name = 'Sales User', updated_at = ? WHERE organisation_id = ? AND name = 'Revenue Analyst'", [
    now,
    organisation.id,
  ])
  run(db, "UPDATE roles SET name = 'Executive', updated_at = ? WHERE organisation_id = ? AND name = 'Platform Manager'", [
    now,
    organisation.id,
  ])

  const rolePermissions = {
    'Sales User': ['enterprise:read', 'commercial:write', 'education:read'],
    'Pricing Manager': ['finance:read', 'pricing:write', 'deals:approve', 'ai:override', 'education:read'],
    'Finance Controller': ['finance:read', 'finance:write', 'deals:approve', 'audits:read'],
    Executive: [
      'finance:read',
      'finance:write',
      'commercial:write',
      'deals:approve',
      'ai:override',
      'admin:manage',
      'education:read',
      'audits:read',
      'jobs:manage',
      'users:manage',
      'configuration:manage',
    ],
    Administrator: [
      'finance:read',
      'finance:write',
      'commercial:write',
      'enterprise:read',
      'pricing:write',
      'deals:approve',
      'ai:override',
      'admin:manage',
      'education:read',
      'audits:read',
      'jobs:manage',
      'users:manage',
      'configuration:manage',
    ],
  }
  const roleIds = {}
  for (const roleName of Object.keys(rolePermissions)) {
    let role = get(db, 'SELECT id FROM roles WHERE organisation_id = ? AND name = ?', [
      organisation.id,
      roleName,
    ])
    if (!role) {
      role = { id: uuid() }
      run(db, 'INSERT INTO roles (id, organisation_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
        role.id,
        organisation.id,
        roleName,
        now,
        now,
      ])
    }
    roleIds[roleName] = role.id
    run(db, 'DELETE FROM role_permissions WHERE role_id = ?', [role.id])
    for (const permissionCode of rolePermissions[roleName]) {
      const permission = get(db, 'SELECT id FROM permissions WHERE code = ?', [permissionCode])
      run(db, 'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [
        role.id,
        permission.id,
      ])
    }
  }

  const demoUsers = [
    ['analyst@edtech.example', 'Sales User', 'Sales User'],
    ['pricing@edtech.example', 'Pricing Manager', 'Pricing Manager'],
    ['finance@edtech.example', 'Finance Controller', 'Finance Controller'],
    ['manager@edtech.example', 'Executive', 'Executive'],
    ['admin@edtech.example', 'Administrator', 'Administrator'],
  ]
  const passwordHash = await bcrypt.hash('Revenue24', 10)
  for (const [email, displayName, roleName] of demoUsers) {
    let user = get(db, 'SELECT id FROM users WHERE email = ?', [email])
    if (!user) {
      user = { id: uuid() }
      run(
        db,
        `INSERT INTO users
         (id, organisation_id, email, password_hash, display_name, status, created_at, updated_at, deleted_at, version)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, 1)`,
        [user.id, organisation.id, email, passwordHash, displayName, now, now],
      )
    } else {
      run(db, 'UPDATE users SET display_name = ?, status = ?, deleted_at = NULL, updated_at = ? WHERE id = ?', [
        displayName,
        'active',
        now,
        user.id,
      ])
    }
    run(db, 'DELETE FROM user_roles WHERE user_id = ?', [user.id])
    run(db, 'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [user.id, roleIds[roleName]])
  }

  await ensureRichDemoData(db, { all, get, run })
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = all(db, `PRAGMA table_info(${table})`)
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

async function seedDatabase(db) {
  const now = new Date().toISOString()
  const organisationId = uuid()
  const revenueRoleId = uuid()
  const managerRoleId = uuid()
  const analystUserId = uuid()
  const managerUserId = uuid()
  const segmentId = uuid()
  const enterpriseSegmentId = uuid()
  const instructorId = uuid()
  const learnerId = uuid()
  const courseId = uuid()
  const lessonId = uuid()
  const enrolmentId = uuid()
  const customerId = uuid()
  const enterpriseCustomerId = uuid()
  const subscriptionProductId = uuid()
  const courseProductId = uuid()
  const enterpriseProductId = uuid()
  const priceListId = uuid()
  const enterprisePriceListId = uuid()
  const discountId = uuid()
  const quoteId = uuid()
  const modelVersionId = uuid()
  const aiRunId = uuid()
  const recommendationId = uuid()

  run(db, 'INSERT INTO organisations VALUES (?, ?, ?, ?, ?, ?, ?)', [
    organisationId,
    'Northstar Online Learning',
    'active',
    now,
    now,
    null,
    1,
  ])

  const permissionRows = [
    ['finance:read', 'Read revenue, margin, budget, and forecast data'],
    ['finance:write', 'Maintain transactions, budgets, forecasts, and outcomes'],
    ['commercial:write', 'Maintain customers, quotes, and contracts'],
    ['pricing:write', 'Create and update pricing data'],
    ['deals:approve', 'Approve high-impact quotes and AI recommendations'],
    ['ai:override', 'Override AI recommendations with reason'],
    ['admin:manage', 'Manage configuration and users'],
    ['education:read', 'Read tenant EdTech operational records'],
    ['audits:read', 'Search tenant audit events'],
    ['jobs:manage', 'Enqueue and retry tenant background jobs'],
    ['users:manage', 'Administer tenant users and role assignments'],
    ['configuration:manage', 'Read and update tenant configuration'],
  ]

  for (const [code, description] of permissionRows) {
    run(db, 'INSERT INTO permissions VALUES (?, ?, ?)', [uuid(), code, description])
  }

  run(db, 'INSERT INTO roles VALUES (?, ?, ?, ?, ?)', [
    revenueRoleId,
    organisationId,
    'Sales User',
    now,
    now,
  ])
  run(db, 'INSERT INTO roles VALUES (?, ?, ?, ?, ?)', [
    managerRoleId,
    organisationId,
    'Executive',
    now,
    now,
  ])

  const permissions = all(db, 'SELECT * FROM permissions')
  for (const permission of permissions) {
    if (['finance:read', 'commercial:write', 'education:read'].includes(permission.code)) {
      run(db, 'INSERT INTO role_permissions VALUES (?, ?)', [revenueRoleId, permission.id])
    }
    run(db, 'INSERT INTO role_permissions VALUES (?, ?)', [managerRoleId, permission.id])
  }

  run(db, 'INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    analystUserId,
    organisationId,
    'analyst@edtech.example',
    await bcrypt.hash('Revenue24', 10),
    'Sales User',
    'active',
    now,
    now,
    null,
    1,
  ])
  run(db, 'INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    managerUserId,
    organisationId,
    'manager@edtech.example',
    await bcrypt.hash('Revenue24', 10),
    'Executive',
    'active',
    now,
    now,
    null,
    1,
  ])
  run(db, 'INSERT INTO user_roles VALUES (?, ?)', [analystUserId, revenueRoleId])
  run(db, 'INSERT INTO user_roles VALUES (?, ?)', [managerUserId, managerRoleId])

  run(db, 'INSERT INTO segments VALUES (?, ?, ?, ?, ?, ?)', [
    segmentId,
    organisationId,
    'Career Switchers',
    'Learners changing careers through intensive courses',
    now,
    now,
  ])
  run(db, 'INSERT INTO segments VALUES (?, ?, ?, ?, ?, ?)', [
    enterpriseSegmentId,
    organisationId,
    'Enterprise Upskilling',
    'B2B learning programmes and licence cohorts',
    now,
    now,
  ])

  run(db, 'INSERT INTO learners VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    learnerId,
    organisationId,
    'learner@example.com',
    'Aarav Kumar',
    segmentId,
    'active',
    now,
    now,
    null,
    1,
  ])
  run(db, 'INSERT INTO instructors VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    instructorId,
    organisationId,
    'Dr. Meera Shah',
    'AI and Data Science',
    115,
    'active',
    now,
    now,
    null,
  ])
  run(db, 'INSERT INTO courses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    courseId,
    organisationId,
    instructorId,
    'AI-BOOT-101',
    'AI Career Bootcamp',
    'published',
    now,
    now,
    null,
    1,
  ])
  run(db, 'INSERT INTO lessons VALUES (?, ?, ?, ?, ?, ?, ?)', [
    lessonId,
    courseId,
    'Margin-aware AI product strategy',
    64,
    1,
    now,
    now,
  ])
  run(db, 'INSERT INTO enrolments VALUES (?, ?, ?, ?, ?, ?, ?)', [
    enrolmentId,
    organisationId,
    learnerId,
    courseId,
    'enrolled',
    now,
    null,
  ])
  run(db, 'INSERT INTO progress VALUES (?, ?, ?, ?, ?)', [uuid(), enrolmentId, lessonId, 42, now])
  run(db, 'INSERT INTO assessments VALUES (?, ?, ?, ?, ?, ?)', [
    uuid(),
    enrolmentId,
    'capstone',
    86,
    'passed',
    now,
  ])
  run(db, 'INSERT INTO certificates VALUES (?, ?, ?, ?, ?, ?)', [
    uuid(),
    learnerId,
    courseId,
    'issued',
    now,
    null,
  ])

  run(db, 'INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    customerId,
    organisationId,
    segmentId,
    'Aarav Kumar',
    'learner',
    'active',
    now,
    now,
    null,
  ])
  run(db, 'INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    enterpriseCustomerId,
    organisationId,
    enterpriseSegmentId,
    'Northstar Bank',
    'enterprise',
    'active',
    now,
    now,
    null,
  ])

  const products = [
    [subscriptionProductId, 'SUB-PRO', 'Professional Subscription', 'subscription'],
    [courseProductId, 'AI-BOOT', 'AI Career Bootcamp', 'course'],
    [enterpriseProductId, 'ENT-LIC', 'Enterprise Licence', 'enterprise_licence'],
  ]

  for (const [id, sku, name, type] of products) {
    run(db, 'INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id,
      organisationId,
      sku,
      name,
      type,
      'active',
      now,
      now,
      null,
      1,
    ])
  }

  run(db, 'INSERT INTO price_lists VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    priceListId,
    organisationId,
    courseProductId,
    'FY26 Course List',
    'USD',
    1899,
    '2026-01-01',
    null,
    'active',
    now,
    now,
    1,
  ])
  run(db, 'INSERT INTO price_lists VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    enterprisePriceListId,
    organisationId,
    enterpriseProductId,
    'FY26 Enterprise List',
    'USD',
    96000,
    '2026-01-01',
    null,
    'active',
    now,
    now,
    1,
  ])
  run(db, 'INSERT INTO cost_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    courseProductId,
    'course-cost-v3',
    120,
    420,
    160,
    65,
    95,
    '2026-01-01',
    'active',
    now,
  ])
  run(db, 'INSERT INTO discounts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    discountId,
    organisationId,
    'Need-based scholarship',
    'scholarship',
    18,
    48,
    1,
    'active',
    now,
    now,
  ])
  run(db, 'INSERT INTO quotes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    quoteId,
    organisationId,
    enterpriseCustomerId,
    enterpriseProductId,
    enterprisePriceListId,
    null,
    'Q-2026-001',
    3,
    276480,
    68,
    'pending_approval',
    managerUserId,
    now,
    now,
    null,
    1,
  ])
  run(db, 'INSERT INTO contracts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    quoteId,
    enterpriseCustomerId,
    'C-2026-009',
    '2026-09-01',
    '2027-08-31',
    90000,
    14,
    'renewal',
    now,
    now,
  ])

  for (const [productId, amount, cost, date] of [
    [subscriptionProductId, 2180000, 834000, '2026-07-31'],
    [courseProductId, 1740000, 800400, '2026-07-31'],
    [enterpriseProductId, 3020000, 966400, '2026-07-31'],
  ]) {
    run(db, 'INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      uuid(),
      organisationId,
      enterpriseCustomerId,
      productId,
      'invoice',
      amount,
      cost,
      date,
      'posted',
      now,
    ])
    run(db, 'INSERT INTO budgets VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      uuid(),
      organisationId,
      productId,
      '2026-Q3',
      amount * 0.94,
      58,
      now,
      now,
    ])
  }

  run(db, 'INSERT INTO forecasts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    enterpriseProductId,
    '2026-Q3',
    3360000,
    3180000,
    3540000,
    modelVersionId,
    now,
    now,
  ])
  run(db, 'INSERT INTO model_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    modelVersionId,
    organisationId,
    'MarginPulse-Guidance',
    'v2.4',
    'pricing profitability decision support',
    JSON.stringify({ marginFloorPct: 48, maxDiscountPct: 18, contractFloorEnforced: true }),
    'active',
    now,
  ])
  run(db, `INSERT INTO ai_runs
    (id, organisation_id, model_version_id, input_data_json, output_json, confidence, explanation,
     status, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    aiRunId,
    organisationId,
    modelVersionId,
    JSON.stringify({ quoteId, product: 'Enterprise Licence', elasticity: -0.39 }),
    JSON.stringify({ action: 'Raise cohort floor price by 6%', expectedImpact: 91000 }),
    0.92,
    'Low elasticity and high renewal intent support a controlled price lift.',
    'generated',
    now,
    now,
    now,
  ])
  run(db, 'INSERT INTO recommendations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    recommendationId,
    organisationId,
    aiRunId,
    'Enterprise licence floor-price adjustment',
    'pricing',
    91000,
    72000,
    146000,
    JSON.stringify(['Renewal rate remains above 92%', 'No SLA uplift required']),
    'Demand exceeds forecast and mentor capacity remains under policy thresholds.',
    'needs_review',
    now,
    now,
    1,
  ])
  run(db, 'INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    'recommendation',
    recommendationId,
    null,
    'pending',
    null,
    now,
    null,
  ])
  run(db, 'INSERT INTO realised_outcomes VALUES (?, ?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    recommendationId,
    0,
    0,
    now,
    'Pending realisation tracking',
  ])
  run(db, 'INSERT INTO model_monitoring_metrics VALUES (?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    modelVersionId,
    'forecast_mape',
    5.8,
    now,
  ])
  run(db, 'INSERT INTO configurations VALUES (?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    'policy.marginRules',
    JSON.stringify({ defaultFloorPct: 48, approvalThreshold: 50000 }),
    now,
    now,
  ])
  run(db, 'INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    'contract',
    quoteId,
    'enterprise-quote.pdf',
    'sha256:demo-checksum',
    managerUserId,
    'tenant-private',
    'v1',
    's3://rpm-demo/contracts/enterprise-quote.pdf',
    now,
  ])
  run(db, 'INSERT INTO background_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    'model-monitoring-refresh',
    JSON.stringify({ modelVersionId }),
    'queued',
    0,
    3,
    now,
    null,
    now,
    now,
  ])
  run(db, 'INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    managerUserId,
    'Quote awaiting approval',
    'Enterprise quote Q-2026-001 requires deal approval.',
    'unread',
    now,
  ])
}
