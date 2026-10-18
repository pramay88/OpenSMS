# SMS Gateway

A production-quality, open-source, self-hosted SMS Gateway. External applications send SMS through a REST API; connected Android phones with SIM cards deliver messages via the mobile network.


## Architecture

```
External Application
        |
        | HTTPS API (API key)
        v
Gateway Server (Node.js + PostgreSQL)
        |
        | HTTPS polling (per-device credentials)
        v
Android Gateway App
        |
        | Android SMS API
        v
SIM / Mobile Network → Recipient
```

## Components

| Component | Path | Description |
|-----------|------|-------------|
| Gateway Server | `server/` | REST API, job queue, auth, gateway management |
| Android Gateway | `android/` | Kotlin app that sends SMS via device SIM |
| Example Client | `examples/client/` | Minimal TypeScript demo for integrators |

## Quick Start

### 1. Start the server (Docker)

```bash
cp server/.env.example server/.env
# Edit ADMIN_SECRET and CRON_SECRET in server/.env. Never use these development
# values in production.

docker compose up -d
```

Server runs at `http://localhost:3000` for local development. Production
deployments must terminate HTTPS before reaching the server.

### 2. Create credentials

```bash
cd server
npm install
npm run db:migrate

# Create API client for your external app
npm run create-client -- "my-app"

# Create registration token for Android setup
npm run create-registration-token
```

### 3. Install Android app

Open `android/` in Android Studio, build the `dev` flavor for testing (uses FakeSmsSender) or `prod` for real SMS.

On the phone:
1. Enter Gateway Server URL (e.g. `https://your-server.com`)
2. Enter registration token
3. Enter gateway name
4. Grant permissions

### 4. Send a test message

```bash
cd examples/client
cp .env.example .env
# Set GATEWAY_URL and API_KEY
npm install && npm start
```

Or via curl:

```bash
curl -X POST http://localhost:3000/api/v1/messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"+1234567890","message":"Hello"}'
```

### Local operator dashboard

When running with `NODE_ENV=development`, open
`http://localhost:3000/_dev/setup` for the local setup dashboard. It checks
backend/database health, helps identify a phone-facing LAN URL, generates
single-use Android registration tokens, and can load authenticated read-only
gateway, client, message, and status summaries. The dashboard is unavailable
outside development and never stores the admin secret in browser storage.

## API Usage

```http
POST /api/v1/messages
Authorization: Bearer <api_key>
Idempotency-Key: optional-unique-key
Content-Type: application/json

{"to":"+1234567890","message":"Your verification code is 123456"}
```

```http
GET /api/v1/messages/:id
Authorization: Bearer <api_key>
```

See [docs/API.md](docs/API.md) for full reference.

## Authentication

- **External clients:** `Authorization: Bearer <api_key>`
- **Android gateways:** `Authorization: Gateway <gateway_id>:<secret>`
- **Admin:** `Authorization: Bearer <ADMIN_SECRET>`
- **Cron/maintenance:** `Authorization: Bearer <CRON_SECRET>`

## Security Model

- Per-client API keys and per-device gateway credentials
- Single-use registration tokens for Android setup
- Android Keystore for credential storage
- No shared master secret on devices
- Revocable credentials per gateway
- Idempotency keys prevent duplicate SMS
- Message expiration and claim timeouts

See [docs/SECURITY.md](docs/SECURITY.md).

## Deployment

- **Vercel:** See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **Docker / VPS:** `docker compose up -d`
- **Android:** See [docs/ANDROID-SETUP.md](docs/ANDROID-SETUP.md)

## Adding Another Phone

1. Run `npm run create-registration-token` on the server
2. Install the Android app on the new phone
3. Register with a new token and unique gateway name
4. The server assigns jobs to available online gateways

## Troubleshooting

| Issue | Check |
|-------|-------|
| Messages stay QUEUED | Gateway online? Heartbeat recent? Not paused? |
| SMS not sent | SEND_SMS permission, SIM ready, not airplane mode |
| Android stops polling | Battery optimization — exempt the app |
| 401 errors | API key or gateway credentials correct? Revoked? |
| Duplicate SMS concerns | Use Idempotency-Key; gateway replays unreported results only |

## Limitations

- `DELIVERY_PENDING` means Android accepted the SMS submission but no carrier delivery receipt has arrived; only `DELIVERED` confirms a receipt
- Requires an Android phone with active SIM and SMS plan
- Vercel deployment requires external PostgreSQL (Neon, Supabase, etc.)
- Rate limits and carrier restrictions apply

## Production Considerations

- Use HTTPS everywhere
- Production startup rejects missing or `change-me-*` admin/cron secrets.
- Set `CORS_ORIGINS` to an explicit comma-separated allowlist only when browser
  access is required; CORS is not authentication.
- Rotate API keys and registration tokens
- Monitor gateway heartbeats
- Set up cron/maintenance (automatic on Vercel)
- Exempt Android app from battery optimization
- Use strong `ADMIN_SECRET` and `CRON_SECRET`

## Documentation

- [API Reference](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Android Setup](docs/ANDROID-SETUP.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Security](docs/SECURITY.md)

## License

Apache License 2.0 — see [LICENSE](LICENSE).

## Security Reporting

See [SECURITY.md](SECURITY.md).
