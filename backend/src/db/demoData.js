import { v4 as uuid } from 'uuid'

export const DEMO_DATASET_VERSION = '2026.08.07-revenue-dash'

/**
 * Idempotently expands the tenant demo dataset so every major product surface
 * has realistic records for local end-to-end testing.
 */
export async function ensureRichDemoData(db, { all, get, run }) {
  const organisation = get(db, 'SELECT id FROM organisations ORDER BY created_at LIMIT 1')
  if (!organisation) return

  const organisationId = organisation.id
  const now = new Date().toISOString()
  const existing = get(
    db,
    `SELECT config_value_json FROM configurations
     WHERE organisation_id = ? AND config_key = 'demo.datasetVersion'`,
    [organisationId],
  )
  if (existing?.config_value_json) {
    try {
      if (JSON.parse(existing.config_value_json) === DEMO_DATASET_VERSION) return
    } catch {
      // continue and refresh
    }
  }

  const users = Object.fromEntries(
    all(db, 'SELECT id, email FROM users WHERE organisation_id = ? AND deleted_at IS NULL', [
      organisationId,
    ]).map((user) => [user.email, user.id]),
  )
  const managerUserId = users['manager@edtech.example']
  const financeUserId = users['finance@edtech.example']
  const pricingUserId = users['pricing@edtech.example']

  const products = Object.fromEntries(
    all(
      db,
      `SELECT id, sku, name, product_type FROM products
       WHERE organisation_id = ? AND deleted_at IS NULL`,
      [organisationId],
    ).map((product) => [product.sku, product]),
  )

  const segments = all(db, 'SELECT id, name FROM segments WHERE organisation_id = ?', [
    organisationId,
  ])
  const careerSegmentId =
    segments.find((item) => /career|switch/i.test(item.name))?.id || segments[0]?.id
  const enterpriseSegmentId =
    segments.find((item) => /enterprise/i.test(item.name))?.id || segments[0]?.id

  let certificationProduct = products['CERT-REN']
  if (!certificationProduct) {
    const id = uuid()
    run(db, 'INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id,
      organisationId,
      'CERT-REN',
      'Certification Renewal',
      'certification',
      'active',
      now,
      now,
      null,
      1,
    ])
    certificationProduct = {
      id,
      sku: 'CERT-REN',
      name: 'Certification Renewal',
      product_type: 'certification',
    }
    products['CERT-REN'] = certificationProduct
  } else if (certificationProduct.product_type !== 'certification') {
    run(db, 'UPDATE products SET product_type = ?, updated_at = ? WHERE id = ?', [
      'certification',
      now,
      certificationProduct.id,
    ])
    certificationProduct = { ...certificationProduct, product_type: 'certification' }
    products['CERT-REN'] = certificationProduct
  }

  const subscription = products['SUB-PRO']
  const bootcamp = products['AI-BOOT']
  const enterprise = products['ENT-LIC']

  ensurePriceList(db, run, get, organisationId, subscription?.id, 'FY26 Subscription List', 49, now)
  ensurePriceList(db, run, get, organisationId, certificationProduct.id, 'FY26 Certification List', 149, now)
  ensureCostVersion(db, run, get, organisationId, subscription?.id, 'sub-cost-v2', {
    direct: 9,
    instructor: 0,
    mentor: 0,
    support: 4,
    content: 6,
  }, now)
  ensureCostVersion(db, run, get, organisationId, enterprise?.id, 'enterprise-cost-v2', {
    direct: 11000,
    instructor: 0,
    mentor: 0,
    support: 5000,
    content: 7000,
  }, now)
  ensureCostVersion(db, run, get, organisationId, certificationProduct.id, 'cert-cost-v1', {
    direct: 22,
    instructor: 0,
    mentor: 0,
    support: 0,
    content: 13,
  }, now)

  if (
    !get(db, `SELECT id FROM discounts WHERE organisation_id = ? AND name = ?`, [
      organisationId,
      'Enterprise volume band',
    ])
  ) {
    run(db, 'INSERT INTO discounts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      uuid(),
      organisationId,
      'Enterprise volume band',
      'volume',
      12,
      62,
      0,
      'active',
      now,
      now,
    ])
  }

  if (
    !get(db, `SELECT id FROM promotions WHERE organisation_id = ? AND name = ?`, [
      organisationId,
      'Q3 Renewal Bundle',
    ])
  ) {
    run(db, 'INSERT INTO promotions VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      uuid(),
      organisationId,
      'Q3 Renewal Bundle',
      '2026-07-01',
      '2026-09-30',
      'active',
      now,
      now,
    ])
  }

  const instructorPool = [
    ['Dr. Meera Shah', 'AI and Data Science'],
    ['Jordan Blake', 'Cloud Engineering'],
    ['Priya Nair', 'Product Analytics'],
  ]
  for (const [name, specialty] of instructorPool) {
    if (
      !get(
        db,
        `SELECT id FROM instructors WHERE organisation_id = ? AND name = ? AND deleted_at IS NULL`,
        [organisationId, name],
      )
    ) {
      run(db, 'INSERT INTO instructors VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        uuid(),
        organisationId,
        name,
        specialty,
        90 + Math.round(Math.random() * 40),
        'active',
        now,
        now,
        null,
      ])
    }
  }

  const learnerPool = [
    ['learner@example.com', 'Aarav Kumar', careerSegmentId],
    ['sofia.reyes@example.com', 'Sofia Reyes', careerSegmentId],
    ['chen.wei@example.com', 'Chen Wei', enterpriseSegmentId],
    ['amelia.brooks@example.com', 'Amelia Brooks', careerSegmentId],
    ['noah.patel@example.com', 'Noah Patel', enterpriseSegmentId],
  ]
  const learnerIds = []
  for (const [email, name, segmentId] of learnerPool) {
    let learner = get(
      db,
      `SELECT id FROM learners WHERE organisation_id = ? AND email = ? AND deleted_at IS NULL`,
      [organisationId, email],
    )
    if (!learner) {
      const id = uuid()
      run(db, 'INSERT INTO learners VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        id,
        organisationId,
        email,
        name,
        segmentId,
        'active',
        now,
        now,
        null,
        1,
      ])
      learner = { id }
    }
    learnerIds.push(learner.id)
  }

  const courseDefs = [
    ['AI-BOOT-101', 'AI Career Bootcamp'],
    ['CLOUD-201', 'Cloud Engineering Intensive'],
    ['ANALYTICS-110', 'Product Analytics Foundations'],
  ]
  const instructorRows = all(
    db,
    `SELECT id FROM instructors WHERE organisation_id = ? AND deleted_at IS NULL`,
    [organisationId],
  )
  const courseIds = []
  courseDefs.forEach(([code, title], index) => {
    let course = get(
      db,
      `SELECT id FROM courses WHERE organisation_id = ? AND code = ? AND deleted_at IS NULL`,
      [organisationId, code],
    )
    if (!course) {
      const id = uuid()
      run(db, 'INSERT INTO courses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        id,
        organisationId,
        instructorRows[index % instructorRows.length]?.id || null,
        code,
        title,
        'published',
        now,
        now,
        null,
        1,
      ])
      course = { id }
      run(db, 'INSERT INTO lessons VALUES (?, ?, ?, ?, ?, ?, ?)', [
        uuid(),
        id,
        `${title} — Module 1`,
        45 + index * 8,
        1,
        now,
        now,
      ])
    }
    courseIds.push(course.id)
  })

  learnerIds.forEach((learnerId, index) => {
    const courseId = courseIds[index % courseIds.length]
    if (
      !get(
        db,
        `SELECT id FROM enrolments WHERE organisation_id = ? AND learner_id = ? AND course_id = ?`,
        [organisationId, learnerId, courseId],
      )
    ) {
      const enrolmentId = uuid()
      run(db, 'INSERT INTO enrolments VALUES (?, ?, ?, ?, ?, ?, ?)', [
        enrolmentId,
        organisationId,
        learnerId,
        courseId,
        index % 2 === 0 ? 'enrolled' : 'completed',
        now,
        index % 2 === 0 ? null : now,
      ])
      const lesson = get(db, 'SELECT id FROM lessons WHERE course_id = ? LIMIT 1', [courseId])
      if (lesson) {
        run(db, 'INSERT INTO progress VALUES (?, ?, ?, ?, ?)', [
          uuid(),
          enrolmentId,
          lesson.id,
          35 + index * 12,
          now,
        ])
      }
      run(db, 'INSERT INTO assessments VALUES (?, ?, ?, ?, ?, ?)', [
        uuid(),
        enrolmentId,
        'capstone',
        70 + index * 4,
        index % 3 === 0 ? 'failed' : 'passed',
        now,
      ])
      if (index % 2 === 1) {
        run(db, 'INSERT INTO certificates VALUES (?, ?, ?, ?, ?, ?)', [
          uuid(),
          learnerId,
          courseId,
          'issued',
          now,
          null,
        ])
      }
    }
    if (
      subscription &&
      !get(
        db,
        `SELECT id FROM subscriptions WHERE organisation_id = ? AND learner_id = ? AND product_id = ?`,
        [organisationId, learnerId, subscription.id],
      )
    ) {
      run(
        db,
        `INSERT INTO subscriptions
         (id, organisation_id, learner_id, product_id, status, started_at, ends_at,
          created_at, updated_at, deleted_at, version)
         VALUES (?, ?, ?, ?, 'active', ?, NULL, ?, ?, NULL, 1)`,
        [uuid(), organisationId, learnerId, subscription.id, now, now, now],
      )
    }
  })

  const enterpriseCustomer =
    get(
      db,
      `SELECT id FROM customers WHERE organisation_id = ? AND customer_type = 'enterprise' LIMIT 1`,
      [organisationId],
    ) ||
    (() => {
      const id = uuid()
      run(db, 'INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        id,
        organisationId,
        enterpriseSegmentId,
        'Northstar Bank Academy',
        'enterprise',
        'active',
        now,
        now,
        null,
      ])
      return { id }
    })()

  const enterprisePriceList = get(
    db,
    `SELECT id FROM price_lists
     WHERE organisation_id = ? AND product_id = ? AND status = 'active'
     ORDER BY effective_from DESC LIMIT 1`,
    [organisationId, enterprise?.id],
  )
  const bootcampPriceList = get(
    db,
    `SELECT id FROM price_lists
     WHERE organisation_id = ? AND product_id = ? AND status = 'active'
     ORDER BY effective_from DESC LIMIT 1`,
    [organisationId, bootcamp?.id],
  )
  const certPriceList = get(
    db,
    `SELECT id FROM price_lists
     WHERE organisation_id = ? AND product_id = ? AND status = 'active'
     ORDER BY effective_from DESC LIMIT 1`,
    [organisationId, certificationProduct.id],
  )

  const quoteDefs = [
    ['Q-2026-002', enterprise?.id, enterprisePriceList?.id, 2, 184320, 66, 'pending_approval'],
    ['Q-2026-003', bootcamp?.id, bootcampPriceList?.id, 40, 62320, 54, 'pending_approval'],
    ['Q-2026-004', enterprise?.id, enterprisePriceList?.id, 1, 90240, 71, 'approved'],
    ['Q-2026-005', certificationProduct.id, certPriceList?.id, 200, 27400, 72, 'draft'],
  ]
  for (const [number, productId, priceListId, qty, net, margin, status] of quoteDefs) {
    if (!productId || !priceListId) continue
    if (
      get(db, `SELECT id FROM quotes WHERE organisation_id = ? AND quote_number = ?`, [
        organisationId,
        number,
      ])
    ) {
      continue
    }
    run(db, 'INSERT INTO quotes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      uuid(),
      organisationId,
      enterpriseCustomer.id,
      productId,
      priceListId,
      null,
      number,
      qty,
      net,
      margin,
      status,
      managerUserId || null,
      now,
      now,
      null,
      1,
    ])
  }

  for (const product of [subscription, bootcamp, enterprise, certificationProduct]) {
    if (!product) continue
    if (
      !get(
        db,
        `SELECT id FROM budgets WHERE organisation_id = ? AND product_id = ? AND period = '2026-Q3'`,
        [organisationId, product.id],
      )
    ) {
      const amount =
        product.sku === 'CERT-REN'
          ? 466000
          : product.sku === 'SUB-PRO'
            ? 2050000
            : product.sku === 'AI-BOOT'
              ? 1820000
              : 2770000
      run(db, 'INSERT INTO budgets VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        uuid(),
        organisationId,
        product.id,
        '2026-Q3',
        amount,
        product.sku === 'ENT-LIC' ? 68 : 58,
        now,
        now,
      ])
    }
    if (
      !get(
        db,
        `SELECT id FROM forecasts WHERE organisation_id = ? AND product_id = ? AND period = '2026-Q3'`,
        [organisationId, product.id],
      )
    ) {
      const amount =
        product.sku === 'CERT-REN'
          ? 510000
          : product.sku === 'SUB-PRO'
            ? 2310000
            : product.sku === 'AI-BOOT'
              ? 1690000
              : 3360000
      const model = get(
        db,
        `SELECT id FROM model_versions WHERE organisation_id = ? AND status = 'active' LIMIT 1`,
        [organisationId],
      )
      run(db, 'INSERT INTO forecasts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        uuid(),
        organisationId,
        product.id,
        '2026-Q3',
        amount,
        amount * 0.92,
        amount * 1.08,
        model?.id || null,
        now,
        now,
      ])
    }
  }

  if (
    certificationProduct &&
    !get(
      db,
      `SELECT id FROM transactions WHERE organisation_id = ? AND product_id = ? AND status = 'posted' LIMIT 1`,
      [organisationId, certificationProduct.id],
    )
  ) {
    run(db, 'INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      uuid(),
      organisationId,
      enterpriseCustomer.id,
      certificationProduct.id,
      'invoice',
      466000,
      130480,
      '2026-07-31',
      'posted',
      now,
    ])
  }

  const model = get(
    db,
    `SELECT id FROM model_versions WHERE organisation_id = ? AND status = 'active' LIMIT 1`,
    [organisationId],
  )
  const recommendationDefs = [
    [
      'AI Career Bootcamp: Tighten discount approval and move to targeted offers',
      94000,
      78000,
      118000,
      'needs_review',
      'Conversion risk is concentrated in price-sensitive learners with high completion scores.',
      0.87,
    ],
    [
      'Professional Subscription: Test a 2% controlled price increase',
      42000,
      28000,
      54000,
      'draft',
      'Demand is resilient and support cost per subscriber remains under the policy ceiling.',
      0.84,
    ],
    [
      'Certification Renewal: Bundle assessment retake with mentor office hours',
      31000,
      18000,
      44000,
      'needs_review',
      'Learners with mentor access renew 1.6x more often after failed assessments.',
      0.81,
    ],
  ]
  for (const [title, impact, low, high, status, rationale, confidence] of recommendationDefs) {
    if (
      get(db, `SELECT id FROM recommendations WHERE organisation_id = ? AND title = ?`, [
        organisationId,
        title,
      ])
    ) {
      continue
    }
    const aiRunId = uuid()
    const recommendationId = uuid()
    if (model) {
      run(
        db,
        `INSERT INTO ai_runs
         (id, organisation_id, model_version_id, input_data_json, output_json, confidence, explanation,
          status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?)`,
        [
          aiRunId,
          organisationId,
          model.id,
          JSON.stringify({ title, source: 'demo-seed' }),
          JSON.stringify({ expectedImpact: impact, confidencePct: Math.round(confidence * 100) }),
          confidence,
          rationale,
          now,
          now,
          now,
        ],
      )
    }
    run(db, 'INSERT INTO recommendations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      recommendationId,
      organisationId,
      model ? aiRunId : null,
      title,
      'pricing',
      impact,
      low,
      high,
      JSON.stringify(['Policy margin floor', 'Human approval', 'Fairness review']),
      rationale,
      status,
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
      status === 'draft' ? 0 : impact * 0.35,
      status === 'draft' ? 0 : 2.4,
      now,
      status === 'draft'
        ? 'Pending realisation tracking'
        : 'Partial realisation measured in Q3 cohort.',
    ])
    if (financeUserId || pricingUserId) {
      run(db, 'INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?)', [
        uuid(),
        organisationId,
        'recommendation',
        recommendationId,
        pricingUserId || financeUserId,
        'Demo review note: validate mentor capacity before approving.',
        now,
      ])
    }
  }

  // Prefer AI-run confidence for the original seeded enterprise recommendation.
  const enterpriseRecommendation = get(
    db,
    `SELECT id, ai_run_id FROM recommendations
     WHERE organisation_id = ? AND title LIKE 'Enterprise licence%' LIMIT 1`,
    [organisationId],
  )
  if (enterpriseRecommendation?.ai_run_id) {
    run(db, 'UPDATE ai_runs SET confidence = ?, updated_at = ? WHERE id = ?', [
      0.92,
      now,
      enterpriseRecommendation.ai_run_id,
    ])
  }

  if (model) {
    for (const [metric, value] of [
      ['forecast_mape', 5.8],
      ['rmse', 41000],
      ['drift_psi', 0.11],
      ['p95_latency_ms', 420],
      ['fairness_disparity_pct', 3.2],
    ]) {
      if (
        !get(
          db,
          `SELECT id FROM model_monitoring_metrics
           WHERE organisation_id = ? AND model_version_id = ? AND metric_name = ?`,
          [organisationId, model.id, metric],
        )
      ) {
        run(db, 'INSERT INTO model_monitoring_metrics VALUES (?, ?, ?, ?, ?, ?)', [
          uuid(),
          organisationId,
          model.id,
          metric,
          value,
          now,
        ])
      }
    }
  }

  const notificationDefs = [
    ['Quote awaiting approval', 'Enterprise quote Q-2026-002 requires deal approval.'],
    ['Scholarship spend alert', 'Bootcamp scholarship spend is at 82% of monthly cap.'],
    ['Simulation completed', 'Certification renewal offer simulation completed.'],
    ['Model refresh ready', 'MarginPulse-Guidance v2.4 monitoring checks completed.'],
  ]
  for (const [title, body] of notificationDefs) {
    if (
      !get(db, `SELECT id FROM notifications WHERE organisation_id = ? AND title = ?`, [
        organisationId,
        title,
      ])
    ) {
      run(db, 'INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?)', [
        uuid(),
        organisationId,
        managerUserId || null,
        title,
        body,
        'unread',
        now,
      ])
    }
  }

  for (const [jobType, payload] of [
    ['report-generation', { reportName: 'Q3 margin bridge', format: 'csv', userId: financeUserId }],
    ['compliance-refresh', { source: 'demo' }],
    ['model-monitoring-refresh', { modelVersionId: model?.id }],
  ]) {
    const existingJob = get(
      db,
      `SELECT id FROM background_jobs WHERE organisation_id = ? AND job_type = ? AND status IN ('queued','completed') LIMIT 1`,
      [organisationId, jobType],
    )
    if (!existingJob) {
      run(db, 'INSERT INTO background_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        uuid(),
        organisationId,
        jobType,
        JSON.stringify(payload),
        'queued',
        0,
        3,
        now,
        null,
        now,
        now,
      ])
    }
  }

  for (const [action, entityType] of [
    ['auth.login', 'user'],
    ['recommendation.reviewed', 'recommendation'],
    ['quote.approved', 'quote'],
    ['configuration.updated', 'configuration'],
    ['ai.execute', 'ai_run'],
  ]) {
    run(db, 'INSERT INTO audits VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      uuid(),
      organisationId,
      managerUserId || financeUserId || null,
      action,
      entityType,
      null,
      JSON.stringify({ source: 'demo-seed', at: now }),
      now,
    ])
  }

  const configRows = [
    ['policy.marginRules', { defaultFloorPct: 48, approvalThreshold: 50000 }],
    ['policy.discountCeiling', { maxDiscountPct: 18, scholarshipCapPct: 11 }],
    ['ai.acceptanceThresholds', { forecastMapeMax: 8, driftPsiMax: 0.2, fairnessMaxPct: 5 }],
    ['demo.datasetVersion', DEMO_DATASET_VERSION],
  ]
  for (const [key, value] of configRows) {
    const row = get(db, `SELECT id FROM configurations WHERE organisation_id = ? AND config_key = ?`, [
      organisationId,
      key,
    ])
    if (row) {
      run(db, 'UPDATE configurations SET config_value_json = ?, updated_at = ? WHERE id = ?', [
        JSON.stringify(value),
        now,
        row.id,
      ])
    } else {
      run(db, 'INSERT INTO configurations VALUES (?, ?, ?, ?, ?, ?)', [
        uuid(),
        organisationId,
        key,
        JSON.stringify(value),
        now,
        now,
      ])
    }
  }
}

function ensurePriceList(db, run, get, organisationId, productId, name, listPrice, now) {
  if (!productId) return
  if (
    get(db, `SELECT id FROM price_lists WHERE organisation_id = ? AND product_id = ? AND name = ?`, [
      organisationId,
      productId,
      name,
    ])
  ) {
    return
  }
  run(db, 'INSERT INTO price_lists VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    productId,
    name,
    'USD',
    listPrice,
    '2026-01-01',
    null,
    'active',
    now,
    now,
    1,
  ])
}

function ensureCostVersion(db, run, get, organisationId, productId, label, costs, now) {
  if (!productId) return
  if (
    get(
      db,
      `SELECT id FROM cost_versions WHERE organisation_id = ? AND product_id = ? AND version_label = ?`,
      [organisationId, productId, label],
    )
  ) {
    return
  }
  run(db, 'INSERT INTO cost_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    uuid(),
    organisationId,
    productId,
    label,
    costs.direct,
    costs.instructor,
    costs.mentor,
    costs.support,
    costs.content,
    '2026-01-01',
    'active',
    now,
  ])
}
