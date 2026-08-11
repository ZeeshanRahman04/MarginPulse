const text = (required = true) => ({ type: 'string', required })
const number = (required = true) => ({ type: 'number', required })
const integer = (required = true) => ({ type: 'integer', required })
const boolean = (required = true) => ({ type: 'boolean', required })

export const resources = {
  customers: resource('customers', ['name', 'customer_type', 'status'], {
    segment_id: text(false), name: text(), customer_type: text(), status: text(),
  }, {
    softDelete: true,
    writePermission: 'commercial:write',
    readPermission: ['finance:read', 'enterprise:read'],
    enterpriseScope: 'customer_type',
  }),
  segments: resource('segments', ['name', 'description'], {
    name: text(), description: text(false),
  }),
  products: resource('products', ['sku', 'name', 'product_type'], {
    sku: text(), name: text(), product_type: text(), status: text(),
  }, {
    softDelete: true,
    versioned: true,
    readPermission: ['finance:read', 'enterprise:read'],
    enterpriseScope: 'product_type',
  }),
  'price-lists': resource('price_lists', ['name', 'currency', 'status'], {
    product_id: text(), name: text(), currency: text(), list_price: number(),
    effective_from: text(), effective_to: text(false), status: text(),
  }, {
    versioned: true,
    readPermission: ['finance:read', 'enterprise:read'],
    enterpriseScope: 'product_id',
  }),
  costs: resource('cost_versions', ['version_label', 'status'], {
    product_id: text(), version_label: text(), direct_cost: number(), instructor_cost: number(),
    mentor_cost: number(), support_cost: number(), content_cost: number(),
    effective_from: text(), status: text(),
  }, { readPermission: ['finance:read', 'enterprise:read'], enterpriseScope: 'product_id' }),
  discounts: resource('discounts', ['name', 'discount_type', 'status'], {
    name: text(), discount_type: text(), value: number(), floor_margin_pct: number(),
    requires_approval: boolean(false), status: text(),
  }, { readPermission: ['finance:read', 'enterprise:read'] }),
  promotions: resource('promotions', ['name', 'status'], {
    name: text(), starts_at: text(), ends_at: text(), status: text(),
  }, { defaultSort: 'starts_at DESC', readPermission: ['finance:read', 'enterprise:read'] }),
  quotes: resource('quotes', ['quote_number', 'status'], {
    customer_id: text(), product_id: text(), price_list_id: text(), discount_id: text(false),
    quote_number: text(), quantity: integer(), net_amount: number(), margin_pct: number(),
    status: text(),
  }, {
    softDelete: true,
    versioned: true,
    writePermission: 'commercial:write',
    readPermission: ['finance:read', 'enterprise:read'],
    enterpriseScope: 'product_id',
  }),
  contracts: resource('contracts', ['contract_number', 'status'], {
    quote_id: text(false), customer_id: text(), contract_number: text(), starts_at: text(),
    ends_at: text(), floor_price: number(false), ceiling_discount_pct: number(false), status: text(),
  }, {
    writePermission: 'commercial:write',
    readPermission: ['finance:read', 'enterprise:read'],
    enterpriseScope: 'quote_id',
  }),
  transactions: resource('transactions', ['transaction_type', 'status'], {
    customer_id: text(false), product_id: text(false), transaction_type: text(), amount: number(),
    cost_amount: number(false), transaction_date: text(), status: text(),
  }, { writePermission: 'finance:write' }),
  budgets: resource('budgets', ['period'], {
    product_id: text(false), period: text(), amount: number(), margin_pct: number(),
  }, { writePermission: 'finance:write' }),
  forecasts: resource('forecasts', ['period'], {
    product_id: text(false), period: text(), amount: number(), confidence_low: number(),
    confidence_high: number(), model_version_id: text(false),
  }, { writePermission: 'finance:write' }),
  recommendations: resource('recommendations', ['title', 'status'], {
    ai_run_id: text(false), title: text(), recommendation_type: text(), expected_impact: number(),
    confidence_low: number(), confidence_high: number(), assumptions_json: text(),
    rationale: text(), status: text(),
  }, { versioned: true, writePermission: 'ai:override' }),
  approvals: resource('approvals', ['entity_type', 'decision'], {}, {
    readPermission: 'deals:approve', writable: false, defaultSort: 'created_at DESC',
  }),
}

export const educationResources = {
  learners: education('learners', ['email', 'name', 'status'], 'organisation_id'),
  instructors: education('instructors', ['name', 'speciality', 'status'], 'organisation_id'),
  courses: education('courses', ['code', 'title', 'status'], 'organisation_id'),
  enrolments: education('enrolments', ['status'], 'organisation_id', 'enrolled_at DESC'),
  lessons: education('lessons', ['title'], null, 'sequence ASC', {
    tenantJoin: 'JOIN courses tenant_parent ON tenant_parent.id = lessons.course_id',
    tenantColumn: 'tenant_parent.organisation_id',
  }),
  progress: education('progress', [], null, 'updated_at DESC', {
    tenantJoin: `JOIN enrolments tenant_parent ON tenant_parent.id = progress.enrolment_id`,
    tenantColumn: 'tenant_parent.organisation_id',
  }),
  assessments: education('assessments', ['assessment_type', 'status'], null, 'assessed_at DESC', {
    tenantJoin: `JOIN enrolments tenant_parent ON tenant_parent.id = assessments.enrolment_id`,
    tenantColumn: 'tenant_parent.organisation_id',
  }),
  certificates: education('certificates', ['status'], null, 'issued_at DESC', {
    tenantJoin: `JOIN learners tenant_parent ON tenant_parent.id = certificates.learner_id`,
    tenantColumn: 'tenant_parent.organisation_id',
  }),
  subscriptions: education(
    'subscriptions',
    ['status'],
    'organisation_id',
    'started_at DESC',
  ),
}

function resource(table, searchColumns, fields, options = {}) {
  return {
    table,
    searchColumns,
    fields,
    readPermission: 'finance:read',
    writePermission: 'pricing:write',
    writable: true,
    defaultSort: 'created_at DESC',
    ...options,
  }
}

function education(table, searchColumns, tenantColumn, defaultSort = 'created_at DESC', options = {}) {
  return {
    table,
    searchColumns,
    tenantColumn,
    defaultSort,
    readPermission: 'education:read',
    ...options,
  }
}
