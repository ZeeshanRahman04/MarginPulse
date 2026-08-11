import { v4 as uuid } from 'uuid'
import { get, run, saveDatabase } from '../db/database.js'

export function startJobRunner(db) {
  const timer = setInterval(async () => {
    const job = get(
      db,
      `SELECT * FROM background_jobs
       WHERE status = 'queued' AND scheduled_at <= ?
       ORDER BY scheduled_at ASC LIMIT 1`,
      [new Date().toISOString()],
    )
    if (!job) return

    try {
      run(db, 'UPDATE background_jobs SET status = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?', [
        'running',
        new Date().toISOString(),
        job.id,
      ])
      processJob(db, job)
      run(db, 'UPDATE background_jobs SET status = ?, updated_at = ? WHERE id = ?', [
        'completed',
        new Date().toISOString(),
        job.id,
      ])
      await saveDatabase(db)
    } catch (error) {
      const attempts = job.attempts + 1
      const status = attempts >= job.max_attempts ? 'dead_letter' : 'queued'
      run(db, 'UPDATE background_jobs SET status = ?, attempts = ?, last_error = ?, updated_at = ? WHERE id = ?', [
        status,
        attempts,
        error.message,
        new Date().toISOString(),
        job.id,
      ])
      if (status === 'dead_letter') {
        run(db, 'INSERT INTO dead_letters VALUES (?, ?, ?, ?, ?)', [
          uuid(),
          job.id,
          error.message,
          job.payload_json,
          new Date().toISOString(),
        ])
      }
      await saveDatabase(db)
    }
  }, 30000)
  timer.unref()
}

function processJob(db, job) {
  const payload = JSON.parse(job.payload_json || '{}')
  const supportedJobs = new Set([
    'compliance-refresh',
    'model-refresh',
    'model-monitoring-refresh',
    'password-reset-email',
    'report-generation',
  ])
  if (!supportedJobs.has(job.job_type)) {
    throw new Error(`Unsupported job type: ${job.job_type}`)
  }

  if (job.job_type === 'password-reset-email' && (!payload.email || !payload.resetId)) {
    throw new Error('Password-reset job payload is incomplete.')
  }

  if (job.job_type === 'report-generation') {
    run(db, 'INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?)', [
      uuid(),
      job.organisation_id,
      payload.userId ?? null,
      'Report generation completed',
      `${payload.reportName ?? 'Revenue and margin report'} is ready for export.`,
      'unread',
      new Date().toISOString(),
    ])
  }

  if (job.job_type === 'model-monitoring-refresh' || job.job_type === 'model-refresh') {
    run(db, 'INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?)', [
      uuid(),
      job.organisation_id,
      payload.userId ?? null,
      'Model monitoring refreshed',
      `Model version ${payload.modelVersionId ?? 'current'} monitoring checks completed.`,
      'unread',
      new Date().toISOString(),
    ])
  }
}
