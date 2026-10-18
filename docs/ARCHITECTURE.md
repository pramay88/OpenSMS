# Architecture

## Overview

The SMS Gateway separates message orchestration (server) from message transport (Android + SIM). External applications never communicate directly with Android devices.

## Message Flow

```mermaid
sequenceDiagram
    participant Client as ExternalClient
    participant Server as GatewayServer
    participant Android as AndroidGateway
    participant SIM as SIM_Network

    Client->>Server: POST /messages
    Server->>Server: Validate, queue, assign gateway
    Server-->>Client: message id, status QUEUED

    loop Poll every 15s
        Android->>Server: GET /gateways/jobs
        Server-->>Android: assigned jobs
        Android->>Server: POST /jobs/:id/ack
        Android->>SIM: Send SMS
        Android->>Server: POST /jobs/:id/result
    end

    Client->>Server: GET /messages/:id
    Server-->>Client: status DELIVERY_PENDING or DELIVERED
```

## Message Lifecycle

```mermaid
stateDiagram-v2
    [*] --> QUEUED: POST /messages
    QUEUED --> ASSIGNED: gateway poll claims
    ASSIGNED --> SENDING: Android ack
    SENDING --> DELIVERY_PENDING: Android submission accepted
    DELIVERY_PENDING --> DELIVERED: delivery receipt
    DELIVERY_PENDING --> FAILED: delivery failure
    SENDING --> FAILED: result failure
    QUEUED --> EXPIRED: maintenance cron
    ASSIGNED --> EXPIRED: maintenance cron
    SENDING --> FAILED: claim timeout
```

## Duplicate Delivery Prevention

Critical scenario: Android sends SMS successfully but network fails before reporting to server.

1. **Ack before send:** Job moves to `SENDING` before SMS attempt
2. **Local persistence:** Android stores result in Room before/at send
3. **Replay on restart:** Unreported results are POSTed before polling new jobs
4. **No auto re-send:** Stuck `SENDING` jobs become `FAILED` with `DELIVERY_UNCERTAIN` — never re-queued automatically
5. **Idempotency:** Client `Idempotency-Key` prevents duplicate message creation

## Registration Flow

```mermaid
sequenceDiagram
    participant Admin as Administrator
    participant Server as GatewayServer
    participant Android as AndroidApp

    Admin->>Server: Create registration token
    Admin->>Android: Provide token + server URL
    Android->>Server: POST /gateways/register
    Server-->>Android: gatewayId + secret
    Android->>Android: Store in Keystore
    Android->>Server: POST /heartbeat
    Android->>Server: GET /jobs (poll loop)
```

## Multi-Gateway

Each Android phone is a gateway with its own credential. The server tracks:

- Gateway ID (device identity, not phone number)
- Status (ONLINE/OFFLINE/PAUSED/REVOKED)
- Last heartbeat
- Active job count

Simple selection: first online gateway with lowest active job count.

## Server Design (Vercel-Compatible)

- Stateless HTTP handlers (Hono)
- PostgreSQL for all persistent state
- Database-backed job queue (no in-memory queues)
- Postgres-backed rate limiting
- Vercel Cron for maintenance (expire, stuck jobs, offline detection)
- Same code runs on VPS via `node dist/server.js`

## Android Design

- Foreground Service for reliable polling
- HTTPS outbound only (phone initiates connections)
- WorkManager + BootReceiver for recovery
- FakeSmsSender for dev/test builds

## Boundaries

| Responsibility | Owner |
|----------------|-------|
| OTP generation | External app |
| OTP verification | External app |
| Message queuing | Gateway Server |
| SMS transport | Android Gateway |
| Phone number validation | Gateway Server |
| Credential management | Gateway Server + Android Keystore |
