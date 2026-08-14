# Security Model

## Threat Model

The SMS Gateway protects against:

- Unauthorized message sending
- Compromised single devices affecting others
- Duplicate SMS delivery
- Credential theft from logs
- Direct exposure of Android devices to the internet

Out of scope: carrier network attacks, physical device compromise, external application vulnerabilities.

## Authentication Layers

### External API Clients

- Per-client API keys (bcrypt hashed at rest)
- Bearer token in `Authorization` header
- Revocable via database (set `revoked_at`)
- Rate limited per key

### Android Gateways

- Per-device credentials issued at registration
- Format: `Gateway <gateway_id>:<secret>`
- Secret bcrypt hashed at rest
- Revocable without affecting other gateways
- **No master secret in the Android app**

### Registration Tokens

- Single-use, short-lived (default 1 hour)
- SHA-256 hashed at rest
- Issued by admin only

### Admin & Cron

- Separate secrets (`ADMIN_SECRET`, `CRON_SECRET`)
- Environment variables only — never in source code

## Network Security

- Production: HTTPS/TLS only
- Android initiates outbound connections (no inbound to phone)
- Server never exposes Android device directly

## Duplicate SMS Prevention

1. Client-side idempotency keys
2. Server-side job state machine
3. Android local persistence before report
4. No automatic re-queue after uncertain delivery

## Data Handling

### Logged

- Message IDs, status transitions, gateway IDs
- Masked phone numbers (`+12***890`)
- Error codes

### Never Logged

- Message bodies
- API keys, gateway secrets, registration tokens
- Full phone numbers (in production logs)

## Android Credential Storage

- Android Keystore via EncryptedSharedPreferences
- Credentials cleared on re-register
- Diagnostic log redacts secrets

## Input Validation

- E.164 phone number validation
- Message length limits
- JSON schema validation (Zod)
- Consistent error responses (no stack traces to clients)

## Revocation

```bash
# Revoke gateway
curl -X POST https://server/api/v1/admin/gateways/{id}/revoke \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

Revoked gateways receive 403 on all authenticated requests.

## Recommendations

- Rotate API keys periodically
- Use short-lived registration tokens
- Monitor for unusual message volume
- Run server behind WAF/reverse proxy
- Keep Android app updated
- Report vulnerabilities per [SECURITY.md](../SECURITY.md)
