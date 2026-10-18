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

**Status values:** `QUEUED`, `ASSIGNED`, `SENDING`, `DELIVERY_PENDING`, `SENT` (legacy submission status), `DELIVERED`, `FAILED`, `EXPIRED`.

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

Only `ASSIGNED` jobs are returned for processing. A job already in `SENDING`
is treated as an uncertain in-flight submission and is not automatically
resent after a gateway restart; maintenance expires its lease as
`DELIVERY_UNCERTAIN` to avoid duplicate SMS delivery.

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
The gateway must receive a successful response before invoking the SMS sender.

### `POST /api/v1/gateways/jobs/:jobId/result`

Report delivery result.

**Body (submission accepted):**

```json
{ "success": true, "deliveryStatus": "SUBMITTED" }
```

**Body (delivery confirmed):**

```json
{ "success": true, "deliveryStatus": "DELIVERED" }
```

Gateways persist unreported submission and delivery results locally and
replay them after a transient network or server failure. `DELIVERY_PENDING`
does not imply delivery confirmation, and an uncertain SMS submission is not
automatically retried.

**Body (failure):**

```json
{
  "success": false,
  "errorCode": "SMS_FAILED",
  "errorMessage": "No SIM"
}
```

`SUBMITTED` transitions the message to `DELIVERY_PENDING`; it does not confirm recipient delivery. Delivery callbacks are idempotent, and duplicate submission or delivery reports do not create duplicate transitions.

---

## Admin

Requires `Authorization: Bearer <ADMIN_SECRET>`.

### `POST /api/v1/admin/clients`

Create API client. Returns API key once.

### `POST /api/v1/admin/registration-tokens`

Create single-use Android registration token.

### Read-only local operator endpoints

These endpoints require `Authorization: Bearer <ADMIN_SECRET>` and are
currently intended for the development-only setup dashboard:

- `GET /api/v1/admin/summary` — message and gateway status counts plus recent
  failures.
- `GET /api/v1/admin/gateways` — up to 100 gateways without credential hashes.
- `GET /api/v1/admin/clients` — up to 100 clients without API key hashes.
- `GET /api/v1/admin/messages?status=...&offset=...` — up to 100 bounded message
  records, optionally filtered by `QUEUED`, `ASSIGNED`, `SENDING`,
  `DELIVERY_PENDING`, `SENT`, `DELIVERED`, `FAILED`, or `EXPIRED`.
- `GET /api/v1/admin/gateways/:id` — inspect one gateway.
- `GET /api/v1/admin/messages/:id` — inspect one message and its status events
  without returning the message body.
- `POST /api/v1/admin/clients/:id/revoke` — revoke an API client. This is
  irreversible for that key.

The local dashboard also uses the existing `POST /api/v1/admin/clients` and
`POST /api/v1/admin/gateways/:id/revoke` operations. Revocation requires an
explicit confirmation in the UI.

These endpoints do not provide message bodies, credential material, or
administrative mutation controls. A production browser console still requires
server-managed sessions, authorization roles, CSRF protection, and durable
audit logging before it should be enabled.

### `POST /api/v1/admin/gateways/:id/revoke`

Revoke gateway credentials.

---

## Maintenance

Requires `Authorization: Bearer <CRON_SECRET>`.

### `GET|POST /api/v1/maintenance`

Expire old messages, fail stuck `SENDING` jobs, mark offline gateways.
The gateway reports submission and delivery separately:

```json
{
  "success": true,
  "deliveryStatus": "SUBMITTED"
}
```

`SUBMITTED` means Android accepted the message for carrier submission; it is not confirmation that the recipient received it. A later delivery receipt may report `DELIVERED`. `DELIVERY_PENDING` remains honest when no receipt arrives. `DELIVERY_FAILED` reports a carrier/device delivery failure.
