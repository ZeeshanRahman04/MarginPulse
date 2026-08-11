# MarginPulse

AI-assisted revenue, pricing, margin, and profitability intelligence for an online learning platform.

## Project Structure

Frontend lives in `frontend/`, backend in `backend/`. See `docs/PROJECT_STRUCTURE.md` for the full layout.

## Run

```bash
npm run dev
npm run server
```

Or run both together with `npm run dev:full`.

Backend runs on `http://localhost:4000`. Prefer `npm run dev:full` so Vite (`http://localhost:5173`) proxies `/api` and `/health` to the API as same-origin `/api/v1` (avoids CORS). Only set an absolute `VITE_API_BASE_URL` when intentionally calling a remote API; that host must allow your Vite origin (local loopback is allowed by default — see `ALLOW_LOCAL_ORIGINS` in `docs/DEPLOYMENT.md`).

## Seeded End-to-End Logins

Use password `Revenue24` for every demo account. Privileged roles use MFA code `123456`.

- `manager@edtech.example` — Executive
- `admin@edtech.example` — Administrator
- `finance@edtech.example` — Finance Controller
- `pricing@edtech.example` — Pricing Manager
- `analyst@edtech.example` — Sales User

The frontend authenticates through `POST /api/v1/auth/login`, restores sessions with
`GET /api/v1/me`, refreshes access tokens with `POST /api/v1/auth/refresh`, and derives
navigation and actions from backend permissions. Remember Me extends the refresh-token
lifetime and persists the session in local storage. Sessions auto-logout when refresh fails
or the access token expires without a valid refresh token.

## Backend Capabilities

- Node.js, Express.js, JWT authentication, bcrypt password hashing, Zod validation, and SQLite through `sql.js`.
- Tenant isolation by `organisation_id`, role and permission checks, structured JSON errors, and audit-event creation.
- Versioned REST APIs under `/api/v1`.
- Pagination, filtering, search, sorting, and idempotency support for critical write endpoints.
- Revenue bridge, contribution margin, price waterfall, variance analysis, deal approval, scenario evaluation, and AI recommendation review APIs.
- AI endpoints for price elasticity, deal scoring, margin anomaly detection, dynamic recommendations, forecasts, profitability, margin leakage, and variance narratives.
- Google Gemini API is optional and used only by the backend. Store the key as `GEMINI_API_KEY`; never place it in frontend code.
- SQLite schema covers EdTech learning entities, revenue/pricing entities, AI runs, approvals, realised outcomes, users, roles, permissions, organisations, notifications, comments, attachments, configuration, audit logs, jobs, and dead letters.
- Background job runner scaffold supports scheduled processing, retry tracking, dead-letter records, notifications, observability data, and `/health`.
- Object storage metadata is represented through the `attachments` table with checksum, owner, access policy, object version, and storage reference.
- Tenant-safe resource CRUD uses idempotency keys, optimistic concurrency, soft deletion, validation, and append-only audits.
- AI execution persists the tenant input snapshot, output, confidence, model version, generated recommendations, and reviewer feedback.

## AI Governance

- Training data boundary: tenant-scoped historical prices, quotes, enrolments, renewals, discounts, costs, budgets, forecasts, and realised outcomes.
- Excluded data: unauthorised tenant data, hidden notes, protected learner attributes, and child data unless governed.
- Offline metrics: MAPE, RMSE, AUC, precision at review, calibration error, and fairness disparity.
- Acceptance thresholds: forecast MAPE below 8%, drift PSI below 0.2, P95 latency below 750ms, and fairness disparity below 5%.
- Safety tests: policy floor compliance, contract floor compliance, discount fairness by segment, PII leakage checks, approval threshold enforcement, and rollback readiness.
- Production monitoring: accuracy, drift, latency, failures, reviewer overrides, realised impact, and model-version traceability.
- User-facing AI explanations are concise and based on observable inputs, rules, model factors, and cited evidence. Hidden chain-of-thought is not exposed.

## Security Operations

- Privileged roles require MFA in the backend prototype using demo code `123456`.
- Sensitive auth endpoints are rate-limited.
- Passwords are hashed with bcrypt. Short-lived JWT access tokens are paired with
  rotatable refresh tokens (Remember Me extends refresh lifetime).
- Server-side permissions enforce least privilege for reads, writes, approvals, overrides, exports, AI execution, and configuration.
- Append-only audit events cover login, data access, creation, modification, export, AI execution, approval, rejection, override, and configuration changes.
- Deployment should use TLS, encrypted storage volumes or managed database encryption, environment-managed secrets, upload scanning, backup verification, legal hold workflows, retention policies, incident response playbooks, and security monitoring.

See `docs/DEPLOYMENT.md` and `docs/SECURITY_OPERATIONS.md` for deployment, backup,
restore, retention, legal-hold, incident-response, and AI rollback procedures.

## Useful Commands

```bash
npm run test:run
npm run server:smoke
npm run server:edge
npm run server:compliance
npm run verify
npm run security:audit
```

API documentation is also exposed at `GET /api/v1/docs`.

Encrypted backups are created with `npm run backup`. Restores require
`CONFIRM_DATABASE_RESTORE=RESTORE npm run restore -- <backup-file>`.
