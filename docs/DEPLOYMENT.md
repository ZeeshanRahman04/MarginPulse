# Deployment

## Local development

1. Copy `.env.example` to `.env` and replace all placeholder secrets.
2. Start the API with `npm run server`.
3. Start the frontend with `npm run dev` (or both with `npm run dev:full`).
4. Verify the system with `npm run verify`.

The frontend reads `VITE_API_BASE_URL` (default `/api/v1`). In local DEV, keep it relative (`/api/v1`) so Vite proxies `/api` and `/health` to `http://localhost:4000` as same-origin traffic (no CORS). Pointing a local UI at a remote API with an absolute `VITE_API_BASE_URL` needs that API to allow your Vite origin — by default this demo allows `localhost` / `127.0.0.1` via `ALLOW_LOCAL_ORIGINS` (set `0` to disable). The backend requires `JWT_SECRET` when `NODE_ENV=production`. `GEMINI_API_KEY` is optional and must never be exposed through a `VITE_` variable.

## Host the API (Docker / Node)

Use Docker (`backend/Dockerfile`) on Railway, Render, Fly.io, or any Node host.

### Environment variables (API host)

| Variable | Required | Example |
| --- | --- | --- |
| `JWT_SECRET` | Yes | long random string |
| `ALLOWED_ORIGINS` | Yes | `https://app.example.com` |
| `PORT` | Usually set by host | `4000` |
| `DATABASE_PATH` | Recommended | `/data/margin-pulse.sqlite` |
| `GEMINI_API_KEY` | Optional | Gemini key |

### Railway

1. New project → Deploy from GitHub → select this repo.
2. Set builder to Dockerfile and `backend/Dockerfile` (Docker context `./backend`), or start command `node src/index.js` from the `backend` package with Node 22.
3. Attach a volume and set `DATABASE_PATH` to a path on that volume.
4. Set `ALLOWED_ORIGINS` to your frontend origin.
5. Deploy and copy the public URL (e.g. `https://margin-pulse-api.up.railway.app`).

### Render

1. New Web Service from this repo.
2. Runtime: Docker with `backend/Dockerfile`, or native Node with start command `npm run server` (or `node backend/src/index.js`).
3. Set the env vars above; add a persistent disk for SQLite if available.
4. Health check path: `/health`.

### Fly.io

```bash
fly launch --dockerfile backend/Dockerfile
fly secrets set JWT_SECRET=... ALLOWED_ORIGINS=https://app.example.com
fly volumes create margin_pulse_data --size 1
# set DATABASE_PATH to the mounted volume path in fly.toml
fly deploy
```

### Point the frontend at the API

1. Set `VITE_API_BASE_URL=https://<your-api-host>/api/v1` for the frontend build.
2. Rebuild/redeploy the frontend (Vite inlines env vars at build time).
3. Confirm the API `ALLOWED_ORIGINS` includes the frontend origin.

### Escape hatch (demo only)

Set `ALLOW_INSECURE_DEMO_JWT=1` only for temporary demos when `JWT_SECRET` is unset in production. Never use this for real tenant data.

## Container deployment (full stack)

```bash
export JWT_SECRET="$(openssl rand -base64 48)"
export BACKUP_ENCRYPTION_KEY="$(openssl rand -base64 48)"
docker compose up --build
```

The application is exposed at `http://localhost:8080`. The API is only reached through the reverse proxy. Terminate TLS at a trusted ingress, load balancer, or reverse proxy in production.

## Production checklist

- Use a managed secret store for JWT, Gemini, backup, database, and TLS secrets.
- Restrict `ALLOWED_ORIGINS` to production application origins.
- Mount the SQLite data directory on an encrypted persistent volume.
- Run at least daily encrypted backups and quarterly restore exercises.
- Forward container logs and security events to centralized monitoring.
- Restrict `/api/v1/security/*`, user administration, jobs, audit exports, and configuration routes to privileged roles.
- Scan container images and uploaded objects before release or use.
- Keep the web and API containers on a private application network when co-hosted.
- Use immutable image tags and a tested rollback target.

## Health and rollback

- API liveness: `GET /health`
- Frontend liveness: `GET /`
- Roll back by redeploying the previous immutable image and restoring a verified database backup only when schema/data rollback is required.
- Preserve audit logs and the failed release image during incident investigation.
