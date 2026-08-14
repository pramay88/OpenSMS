# API Reference

Base URL: `https://your-gateway-server.com`

All responses use JSON. Errors follow:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

## Authentication

### External clients

```
Authorization: Bearer <api_key>
```

### Android gateways

```
Authorization: Gateway <gateway_id>:<secret>
```

---

## Health

### `GET /api/v1/health`

Public health check.

**Response 200:**

```json
{
  "status": "ok",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

---

## Messages (External Clients)

### `POST /api/v1/messages`

Queue an SMS message.

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| Authorization | Yes | Bearer API key |
| Idempotency-Key | No | Unique key per client; retries return same message |
| Content-Type | Yes | application/json |

**Body:**

```json
{
  "to": "+919876543210",
  "message": "Your verification code is 123456"
}
```

- `to`: E.164 phone number
- `message`: SMS body (max 1600 characters)

**Response 201/202:**

```json
{
  "id": "uuid",
  "to": "+919876543210",
  "status": "QUEUED",
  "gatewayId": null,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2026-01-01T00:05:00.000Z",
  "assignedAt": null,
  "sentAt": null,
  "failedAt": null,
  "errorCode": null,
  "errorMessage": null
}
```

**Error codes:** `INVALID_PHONE`, `INVALID_MESSAGE`, `UNAUTHORIZED`, `RATE_LIMITED`

### `GET /api/v1/messages/:id`

Get message status.

**Response 200:** Same shape as create response with updated status.

**Status values:** `QUEUED`, `ASSIGNED`, `SENDING`, `SENT`, `FAILED`, `EXPIRED`

---

## Gateways (Android App)

### `POST /api/v1/gateways/register`

Exchange registration token for device credentials. No auth required (token is the auth).

**Body:**

```json
{
  "token": "sgr_...",
  "name": "Office Phone"
}
```

**Response 201:**

```json
{
  "gatewayId": "uuid",
  "secret": "base64url-secret"
}
```

Store credentials securely. Secret is shown once.

### `POST /api/v1/gateways/heartbeat`

Report gateway status.

**Body:**

```json
{
  "appVersion": "1.0.0",
  "simInfo": "SIM ready",
  "networkInfo": "Wi-Fi connected",
  "paused": false
}
```

### `GET /api/v1/gateways/jobs`

Poll for assigned jobs. Atomically claims queued jobs.

**Response 200:**

```json
{
  "jobs": [
    {
      "id": "uuid",
      "to": "+919876543210",
      "message": "Hello",
      "expiresAt": "2026-01-01T00:05:00.000Z",
      "status": "ASSIGNED"
    }
  ]
}
```

### `POST /api/v1/gateways/jobs/:jobId/ack`

Acknowledge job before sending. Transitions to `SENDING`.

### `POST /api/v1/gateways/jobs/:jobId/result`

Report delivery result.

**Body (success):**

```json
{ "success": true }
```

**Body (failure):**

```json
{
  "success": false,
  "errorCode": "SMS_FAILED",
  "errorMessage": "No SIM"
}
```

Idempotent: duplicate success reports for already-`SENT` jobs are accepted.

---

## Admin

Requires `Authorization: Bearer <ADMIN_SECRET>`.

### `POST /api/v1/admin/clients`

Create API client. Returns API key once.

### `POST /api/v1/admin/registration-tokens`

Create single-use Android registration token.

### `POST /api/v1/admin/gateways/:id/revoke`

Revoke gateway credentials.

---

## Maintenance

Requires `Authorization: Bearer <CRON_SECRET>`.

### `GET|POST /api/v1/maintenance`

Expire old messages, fail stuck `SENDING` jobs, mark offline gateways.
