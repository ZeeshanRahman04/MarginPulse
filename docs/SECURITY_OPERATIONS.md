# Security and Data Operations

## Access and secrets

- Backend permissions are authoritative; frontend route visibility is only a usability control.
- Privileged accounts require MFA. Replace the demo challenge with TOTP, WebAuthn, or enterprise identity before production.
- Rotate JWT and Gemini credentials through a managed secret store. Never commit `.env`.
- Disable users centrally and use short token lifetimes to limit stale permission exposure.

## Data handling

- Classify learner identity, assessment, child, contract, pricing, and payment data before ingestion.
- Minimize protected learner attributes used by pricing models and exclude them from recommendation features unless explicitly approved.
- Require content-rights metadata before publishing learning assets.
- Record assessment modifications and certificate issuance in append-only audit events.
- Store object data outside SQLite; retain checksum, owner, policy, scan status, version, and storage reference.

## Retention and legal hold

- Configuration must define retention by entity class and organisation.
- A legal hold suspends deletion and archival for matching records and attachments.
- Retention jobs must soft-delete eligible operational records first, then purge only after the configured recovery window.
- Audit events and approval evidence must never be altered by normal application users.

## Backup and restore

Create an encrypted backup:

```bash
BACKUP_ENCRYPTION_KEY="<32-or-more-random-characters>" npm run backup
```

Restore after validation in an isolated environment:

```bash
BACKUP_ENCRYPTION_KEY="<same-key>" \
CONFIRM_DATABASE_RESTORE=RESTORE \
npm run restore -- backend/backups/<backup>.sqlite.enc
```

Backups use AES-256-GCM and include a plaintext-database SHA-256 checksum inside the authenticated encrypted payload. Store encryption keys separately from backups. Test restoration quarterly and after material schema changes.

## Incident response

1. Contain: disable affected accounts, revoke/rotate secrets, and block suspicious origins.
2. Preserve: retain audit logs, database snapshots, object metadata, application logs, and model versions.
3. Assess: identify exposed tenants, records, approvals, AI outputs, and downstream actions.
4. Recover: restore a verified backup or deploy the last known-good image.
5. Notify: follow contractual, privacy, child-protection, and regulatory timelines.
6. Improve: document root cause, corrective controls, tests, and evidence of closure.

## AI safety operations

- Persist the exact tenant-scoped input snapshot, model version, output, confidence, and constraints for each run.
- Block material recommendations that violate cost, contract, fairness, or policy thresholds.
- Require a reviewer reason for rejection, correction, or override.
- Monitor accuracy, drift, latency, failures, fairness disparity, reviewer adoption, and realised impact.
- Roll back a model version when an acceptance threshold fails.
