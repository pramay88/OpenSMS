# Deployment Guide

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| DATABASE_URL | Yes | — | PostgreSQL connection string |
| ADMIN_SECRET | Yes | — | Admin API authentication |
| CRON_SECRET | Yes | — | Maintenance endpoint auth |
| API_RATE_LIMIT_PER_MIN | No | 60 | Requests per minute per API key |
| MESSAGE_TTL_SECONDS | No | 300 | Message expiration |
| JOB_CLAIM_TTL_SECONDS | No | 120 | Job claim timeout |
| HEARTBEAT_TTL_SECONDS | No | 90 | Gateway online threshold |
| REGISTRATION_TOKEN_TTL_SECONDS | No | 3600 | Setup token lifetime |
| LOG_LEVEL | No | info | Logging level |
| CORS_ORIGINS | No | — | Comma-separated explicit browser origins |
| PORT | No | 3000 | Server port (VPS/Docker) |

Copy `server/.env.example` to `server/.env` and configure.

---

## Docker Compose (Recommended for Self-Hosting)

```bash
# From repository root
export ADMIN_SECRET=$(openssl rand -hex 32)
export CRON_SECRET=$(openssl rand -hex 32)
export CORS_ORIGINS=https://admin.example.com

docker compose up -d
```

Services:
- **postgres** — PostgreSQL 16 on port 5432
- **server** — Gateway API on port 3000

Migrations run automatically on server start.

### Bootstrap

```bash
docker compose exec server node dist/db/migrate.js  # if needed
docker compose exec server npm run create-client -- "production"
docker compose exec server npm run create-registration-token
```

---

## Vercel

### Prerequisites

- External PostgreSQL (Neon, Supabase, Railway, etc.)
- Vercel account

### Steps

1. Connect repository to Vercel
2. Set root directory to `server/`
3. Configure environment variables:
   - `DATABASE_URL`
   - `ADMIN_SECRET`
   - `CRON_SECRET`
   - Other vars as needed

4. Deploy

### Cron

`vercel.json` configures maintenance cron every 5 minutes at `/api/v1/maintenance`.

Set `CRON_SECRET` in Vercel — Vercel automatically sends it as `Authorization: Bearer <CRON_SECRET>` to cron endpoints.

### Notes

- Use Neon serverless driver-compatible connection string
- No local filesystem or persistent process required
- Connection pooling: use `?pgbouncer=true` with Neon if needed

---

## VPS / Node.js

```bash
cd server
npm install
npm run build
npm run db:migrate

export DATABASE_URL=postgresql://...
export ADMIN_SECRET=...
export CRON_SECRET=...
npm start
```

### Cron (non-Vercel)

Add to crontab:

```cron
*/5 * * * * curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-server/api/v1/maintenance
```

### Reverse Proxy

Use nginx or Caddy with TLS in front of the Node server:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

## PostgreSQL

Minimum PostgreSQL 14+. Schema managed via Drizzle migrations in `server/drizzle/`.

```bash
cd server
npm run db:migrate
```

For new environments:

```bash
npm run db:generate  # after schema changes
npm run db:migrate
```

---

## Health Checks

```bash
curl https://your-server/api/v1/health
```

Docker Compose includes a healthcheck on the server service.

---

## Production Checklist

- [ ] Strong `ADMIN_SECRET` and `CRON_SECRET`
- [ ] HTTPS/TLS enabled
- [ ] `CORS_ORIGINS` is explicitly restricted, or unset when browser access is unnecessary
- [ ] PostgreSQL backups configured
- [ ] API keys created and stored securely
- [ ] Rate limits configured appropriately
- [ ] Maintenance cron running
- [ ] Android gateways registered and heartbeating
- [ ] Battery optimization disabled on gateway phones
