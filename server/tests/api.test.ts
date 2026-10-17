// SPDX-License-Identifier: Apache-2.0
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import pg from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/schema.js";
import { createApp } from "../src/index.js";
import { hashToken } from "../src/lib/crypto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.ADMIN_SECRET = "test-admin-secret";
process.env.CRON_SECRET = "test-cron-secret";
process.env.API_RATE_LIMIT_PER_MIN = "1000";
process.env.MESSAGE_TTL_SECONDS = "300";
process.env.JOB_CLAIM_TTL_SECONDS = "120";
process.env.HEARTBEAT_TTL_SECONDS = "90";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://smsgateway:smsgateway@localhost:5432/smsgateway_test";

function assertIsolatedTestDatabase(connectionString: string): void {
  const databaseName = new URL(connectionString).pathname.replace(/^\/+/, "");
  if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
    throw new Error("Refusing to run integration tests against a non-test database");
  }
}

let pool: pg.Pool;
let app: ReturnType<typeof createApp>;

async function resetDb() {
  await pool.query(`
    TRUNCATE TABLE rate_limit_buckets, message_events, messages, gateways, registration_tokens, api_clients CASCADE
  `);
}

async function seedClient(): Promise<{ apiKey: string; clientId: string }> {
  const res = await app.request("/api/v1/admin/clients", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-admin-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "test-client" }),
  });
  const data = await res.json();
  return { apiKey: data.apiKey, clientId: data.id };
}

async function seedRegistrationToken(): Promise<string> {
  const res = await app.request("/api/v1/admin/registration-tokens", {
    method: "POST",
    headers: { Authorization: "Bearer test-admin-secret" },
  });
  const data = await res.json();
  return data.token;
}

async function registerGateway(token: string, name = "test-phone"): Promise<{ gatewayId: string; secret: string }> {
  const res = await app.request("/api/v1/gateways/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, name }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

function gatewayAuth(gatewayId: string, secret: string) {
  return `Gateway ${gatewayId}:${secret}`;
}

beforeAll(async () => {
  assertIsolatedTestDatabase(TEST_DB_URL);
  process.env.DATABASE_URL = TEST_DB_URL;
  pool = new pg.Pool({ connectionString: TEST_DB_URL });
  const db = drizzle(pool, { schema });
  const migrationsFolder = path.join(__dirname, "../drizzle");
  await migrate(db, { migrationsFolder });
  app = createApp();
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

describe("Authentication", () => {
  it("rejects missing API key", async () => {
    const res = await app.request("/api/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "+12025550100", message: "hi" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects invalid API key", async () => {
    const res = await app.request("/api/v1/messages", {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "+12025550100", message: "hi" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("Message creation", () => {
  it("queues a valid message", async () => {
    const { apiKey } = await seedClient();
    const res = await app.request("/api/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "+12025550100", message: "Hello" }),
    });
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.status).toBe("QUEUED");
    expect(data.id).toBeDefined();
  });

  it("rejects invalid phone number", async () => {
    const { apiKey } = await seedClient();
    const res = await app.request("/api/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "not-a-phone", message: "Hello" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("INVALID_PHONE");
  });

  it("rejects empty message", async () => {
    const { apiKey } = await seedClient();
    const res = await app.request("/api/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "+12025550100", message: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("returns same message for idempotent request", async () => {
    const { apiKey } = await seedClient();
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-123",
    };
    const body = JSON.stringify({ to: "+12025550100", message: "OTP 123456" });

    const res1 = await app.request("/api/v1/messages", { method: "POST", headers, body });
    const res2 = await app.request("/api/v1/messages", { method: "POST", headers, body });

    const data1 = await res1.json();
    const data2 = await res2.json();
    expect(data1.id).toBe(data2.id);
  });

  it("returns the same message for concurrent identical submissions", async () => {
    const { apiKey, clientId } = await seedClient();
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "concurrent-idem-123",
    };
    const body = JSON.stringify({ to: "+12025550100", message: "Concurrent OTP" });

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.request("/api/v1/messages", { method: "POST", headers, body })
      )
    );
    const payloads = await Promise.all(responses.map((response) => response.json()));
    const ids = new Set(payloads.map((payload) => payload.id));

    expect(responses.every((response) => [201, 202].includes(response.status))).toBe(true);
    expect(ids.size).toBe(1);

    const messageCount = await pool.query(
      "SELECT COUNT(*)::int AS count FROM messages WHERE client_id = $1",
      [clientId]
    );
    const eventCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM message_events
       WHERE message_id = $1 AND from_status IS NULL AND to_status = 'QUEUED'`,
      [payloads[0].id]
    );

    expect(messageCount.rows[0].count).toBe(1);
    expect(eventCount.rows[0].count).toBe(1);
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    const { apiKey } = await seedClient();
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "changed-payload-idem-123",
    };

    const first = await app.request("/api/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({ to: "+12025550100", message: "First payload" }),
    });
    expect([201, 202]).toContain(first.status);

    const second = await app.request("/api/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({ to: "+12025550100", message: "Changed payload" }),
    });
    const payload = await second.json();

    expect(second.status).toBe(409);
    expect(payload.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

});

describe("Gateway registration", () => {
  it("registers gateway with valid token", async () => {
    await seedClient();
    const token = await seedRegistrationToken();
    const result = await registerGateway(token);
    expect(result.gatewayId).toBeDefined();
    expect(result.secret).toBeDefined();
  });

  it("rejects reused registration token", async () => {
    await seedClient();
    const token = await seedRegistrationToken();
    await registerGateway(token);
    const res = await app.request("/api/v1/gateways/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name: "another" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects expired registration tokens", async () => {
    await seedClient();
    const token = await seedRegistrationToken();
    await pool.query(
      "UPDATE registration_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1",
      [hashToken(token)]
    );

    const res = await app.request("/api/v1/gateways/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name: "expired-phone" }),
    });
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.error.code).toBe("TOKEN_EXPIRED");

    const gateways = await pool.query("SELECT COUNT(*)::int AS count FROM gateways");
    expect(gateways.rows[0].count).toBe(0);
  });

  it("allows only one gateway for concurrent redemption", async () => {
    await seedClient();
    const token = await seedRegistrationToken();

    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        app.request("/api/v1/gateways/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, name: `concurrent-phone-${index}` }),
        })
      )
    );
    const payloads = await Promise.all(responses.map((response) => response.json()));
    const successful = responses.filter((response) => response.status === 201);
    const rejected = payloads.filter(
      (payload) => payload.error?.code === "TOKEN_USED"
    );

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    expect(successful[0]).toBeDefined();
    expect(payloads.find((payload) => payload.gatewayId)?.secret).toBeDefined();

    const gateways = await pool.query("SELECT COUNT(*)::int AS count FROM gateways");
    expect(gateways.rows[0].count).toBe(1);
  });

  it("rejects revoked gateway", async () => {
    await seedClient();
    const token = await seedRegistrationToken();
    const { gatewayId, secret } = await registerGateway(token);

    await app.request(`/api/v1/admin/gateways/${gatewayId}/revoke`, {
      method: "POST",
      headers: { Authorization: "Bearer test-admin-secret" },
    });

    const res = await app.request("/api/v1/gateways/heartbeat", {
      method: "POST",
      headers: {
        Authorization: gatewayAuth(gatewayId, secret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ appVersion: "1.0.0" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("Job delivery flow", () => {
  async function setupOnlineGateway() {
    await seedClient();
    const token = await seedRegistrationToken();
    const gw = await registerGateway(token);
    await app.request("/api/v1/gateways/heartbeat", {
      method: "POST",
      headers: {
        Authorization: gatewayAuth(gw.gatewayId, gw.secret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ appVersion: "1.0.0", paused: false }),
    });
    return gw;
  }

  it("assigns and delivers message through gateway", async () => {
    const { apiKey } = await seedClient();
    const gw = await setupOnlineGateway();

    const msgRes = await app.request("/api/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "+12025550100", message: "Test SMS" }),
    });
    const msg = await msgRes.json();

    const jobsRes = await app.request("/api/v1/gateways/jobs", {
      headers: { Authorization: gatewayAuth(gw.gatewayId, gw.secret) },
    });
    const jobs = await jobsRes.json();
    expect(jobs.jobs.length).toBeGreaterThan(0);

    const jobId = jobs.jobs[0].id;
    await app.request(`/api/v1/gateways/jobs/${jobId}/ack`, {
      method: "POST",
      headers: { Authorization: gatewayAuth(gw.gatewayId, gw.secret) },
    });

    const resultRes = await app.request(`/api/v1/gateways/jobs/${jobId}/result`, {
      method: "POST",
      headers: {
        Authorization: gatewayAuth(gw.gatewayId, gw.secret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success: true }),
    });
    expect(resultRes.status).toBe(200);

    const statusRes = await app.request(`/api/v1/messages/${msg.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const status = await statusRes.json();
    expect(status.status).toBe("SENT");
  });

  async function createQueuedMessage() {
    const { apiKey } = await seedClient();
    const res = await app.request("/api/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "+12025550100", message: "Queued for polling" }),
    });
    expect(res.status).toBe(202);
    return res.json() as Promise<{ id: string }>;
  }

  async function registerOfflineGateway(name: string) {
    const token = await seedRegistrationToken();
    return registerGateway(token, name);
  }

  it("claims a queued message only once when gateways poll concurrently", async () => {
    const first = await registerOfflineGateway("poller-one");
    const second = await registerOfflineGateway("poller-two");
    const message = await createQueuedMessage();

    await pool.query(
      "UPDATE gateways SET status = 'ONLINE', last_heartbeat_at = NOW() WHERE id = ANY($1::uuid[])",
      [[first.gatewayId, second.gatewayId]]
    );

    const responses = await Promise.all([
      app.request("/api/v1/gateways/jobs", {
        headers: { Authorization: gatewayAuth(first.gatewayId, first.secret) },
      }),
      app.request("/api/v1/gateways/jobs", {
        headers: { Authorization: gatewayAuth(second.gatewayId, second.secret) },
      }),
    ]);
    const payloads = await Promise.all(responses.map((response) => response.json()));
    const claimed = payloads.flatMap((payload) =>
      payload.jobs.filter((job: { id: string }) => job.id === message.id)
    );

    expect(claimed).toHaveLength(1);
    const count = await pool.query(
      "SELECT COUNT(*)::int AS count FROM messages WHERE id = $1 AND status = 'ASSIGNED'",
      [message.id]
    );
    const events = await pool.query(
      "SELECT COUNT(*)::int AS count FROM message_events WHERE message_id = $1 AND to_status = 'ASSIGNED'",
      [message.id]
    );
    expect(count.rows[0].count).toBe(1);
    expect(events.rows[0].count).toBe(1);
  });

  it("returns the same claimed job on repeated polling by one gateway", async () => {
    const gateway = await registerOfflineGateway("repeat-poller");
    const message = await createQueuedMessage();
    await pool.query(
      "UPDATE gateways SET status = 'ONLINE', last_heartbeat_at = NOW() WHERE id = $1",
      [gateway.gatewayId]
    );

    const headers = { Authorization: gatewayAuth(gateway.gatewayId, gateway.secret) };
    const first = await (await app.request("/api/v1/gateways/jobs", { headers })).json();
    const second = await (await app.request("/api/v1/gateways/jobs", { headers })).json();

    expect(first.jobs.map((job: { id: string }) => job.id)).toContain(message.id);
    expect(second.jobs.map((job: { id: string }) => job.id)).toContain(message.id);
    const events = await pool.query(
      "SELECT COUNT(*)::int AS count FROM message_events WHERE message_id = $1 AND to_status = 'ASSIGNED'",
      [message.id]
    );
    expect(events.rows[0].count).toBe(1);
  });

  it("does not claim expired messages or allow paused gateways to poll", async () => {
    const gateway = await registerOfflineGateway("paused-poller");
    const message = await createQueuedMessage();
    await pool.query(
      "UPDATE messages SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
      [message.id]
    );
    await pool.query(
      "UPDATE gateways SET status = 'ONLINE', last_heartbeat_at = NOW() WHERE id = $1",
      [gateway.gatewayId]
    );

    const headers = { Authorization: gatewayAuth(gateway.gatewayId, gateway.secret) };
    const expired = await (await app.request("/api/v1/gateways/jobs", { headers })).json();
    expect(expired.jobs).toHaveLength(0);

    await pool.query(
      "UPDATE gateways SET status = 'PAUSED', paused = TRUE WHERE id = $1",
      [gateway.gatewayId]
    );
    const paused = await app.request("/api/v1/gateways/jobs", { headers });
    expect(paused.status).toBe(200);
    expect((await paused.json()).jobs).toHaveLength(0);

    await pool.query(
      "UPDATE gateways SET status = 'REVOKED', revoked_at = NOW() WHERE id = $1",
      [gateway.gatewayId]
    );
    const revoked = await app.request("/api/v1/gateways/jobs", { headers });
    expect(revoked.status).toBe(403);
  });

  it("reports failed delivery", async () => {
    const { apiKey } = await seedClient();
    const gw = await setupOnlineGateway();

    await app.request("/api/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "+12025550100", message: "Fail test" }),
    });

    const jobsRes = await app.request("/api/v1/gateways/jobs", {
      headers: { Authorization: gatewayAuth(gw.gatewayId, gw.secret) },
    });
    const { jobs } = await jobsRes.json();
    const jobId = jobs[0].id;

    await app.request(`/api/v1/gateways/jobs/${jobId}/ack`, {
      method: "POST",
      headers: { Authorization: gatewayAuth(gw.gatewayId, gw.secret) },
    });

    await app.request(`/api/v1/gateways/jobs/${jobId}/result`, {
      method: "POST",
      headers: {
        Authorization: gatewayAuth(gw.gatewayId, gw.secret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success: false, errorCode: "SMS_FAILED", errorMessage: "No SIM" }),
    });

    const statusRes = await app.request(`/api/v1/messages/${jobs[0].id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const status = await statusRes.json();
    expect(status.status).toBe("FAILED");
    expect(status.errorCode).toBe("SMS_FAILED");
  });

  it("keeps message queued when gateway offline", async () => {
    const { apiKey } = await seedClient();
    const res = await app.request("/api/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "+12025550100", message: "Queued" }),
    });
    const data = await res.json();
    expect(data.status).toBe("QUEUED");
  });
});

describe("Expired messages", () => {
  it("expires old queued messages via maintenance", async () => {
    const { apiKey } = await seedClient();
    process.env.MESSAGE_TTL_SECONDS = "0";

    const res = await app.request("/api/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "+12025550100", message: "Expire me" }),
    });
    const msg = await res.json();

    await new Promise((r) => setTimeout(r, 100));

    await app.request("/api/v1/maintenance", {
      method: "POST",
      headers: { Authorization: "Bearer test-cron-secret" },
    });

    const statusRes = await app.request(`/api/v1/messages/${msg.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const status = await statusRes.json();
    expect(status.status).toBe("EXPIRED");

    process.env.MESSAGE_TTL_SECONDS = "300";
  });
});

describe("Rate limiting", () => {
  it("returns 429 when rate limit exceeded", async () => {
    process.env.API_RATE_LIMIT_PER_MIN = "2";
    const { apiKey } = await seedClient();

    for (let i = 0; i < 2; i++) {
      await app.request("/api/v1/messages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to: "+12025550100", message: `msg ${i}` }),
      });
    }

    const res = await app.request("/api/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "+12025550100", message: "over limit" }),
    });
    expect(res.status).toBe(429);

    process.env.API_RATE_LIMIT_PER_MIN = "1000";
  });
});

describe("Health check", () => {
  it("returns ok status", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });
});
