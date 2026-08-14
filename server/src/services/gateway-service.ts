// SPDX-License-Identifier: Apache-2.0
import { eq, and, sql, lte, inArray, isNull, or } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  apiClients,
  gateways,
  messages,
  messageEvents,
  registrationTokens,
  rateLimitBuckets,
  type Message,
  type Gateway,
} from "../db/schema.js";
import { config } from "../config.js";
import {
  generateApiKey,
  generateGatewaySecret,
  generateRegistrationToken,
  hashSecret,
  verifySecret,
  hashToken,
  generateId,
} from "../lib/crypto.js";
import { normalizePhoneNumber, PhoneValidationError } from "../lib/phone.js";
import { AppError } from "../lib/errors.js";

export async function createApiClient(db: Database, name: string) {
  const apiKey = generateApiKey();
  const apiKeyHash = await hashSecret(apiKey);
  const [client] = await db
    .insert(apiClients)
    .values({ name, apiKeyHash })
    .returning();
  return { client, apiKey };
}

export async function authenticateApiClient(
  db: Database,
  apiKey: string
): Promise<{ id: string; name: string }> {
  const clients = await db.select().from(apiClients).where(isNull(apiClients.revokedAt));
  for (const client of clients) {
    if (await verifySecret(apiKey, client.apiKeyHash)) {
      return { id: client.id, name: client.name };
    }
  }
  throw new AppError("UNAUTHORIZED", "Invalid API key", 401);
}

export async function createRegistrationToken(db: Database) {
  const token = generateRegistrationToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.registrationTokenTtlSeconds * 1000);
  await db.insert(registrationTokens).values({ tokenHash, expiresAt });
  return { token, expiresAt };
}

export async function registerGateway(
  db: Database,
  token: string,
  name: string
): Promise<{ gatewayId: string; secret: string }> {
  const tokenHash = hashToken(token);
  const [regToken] = await db
    .select()
    .from(registrationTokens)
    .where(eq(registrationTokens.tokenHash, tokenHash))
    .limit(1);

  if (!regToken) {
    throw new AppError("INVALID_TOKEN", "Registration token is invalid", 401);
  }
  if (regToken.usedAt) {
    throw new AppError("TOKEN_USED", "Registration token has already been used", 400);
  }
  if (regToken.expiresAt < new Date()) {
    throw new AppError("TOKEN_EXPIRED", "Registration token has expired", 400);
  }

  const secret = generateGatewaySecret();
  const secretHash = await hashSecret(secret);
  const gatewayId = generateId();

  await db.transaction(async (tx) => {
    await tx
      .update(registrationTokens)
      .set({ usedAt: new Date() })
      .where(eq(registrationTokens.id, regToken.id));

    await tx.insert(gateways).values({
      id: gatewayId,
      name,
      secretHash,
      status: "OFFLINE",
    });
  });

  return { gatewayId, secret };
}

export async function authenticateGateway(
  db: Database,
  gatewayId: string,
  secret: string
): Promise<Gateway> {
  const [gateway] = await db
    .select()
    .from(gateways)
    .where(eq(gateways.id, gatewayId))
    .limit(1);

  if (!gateway) {
    throw new AppError("UNAUTHORIZED", "Invalid gateway credentials", 401);
  }
  if (gateway.revokedAt) {
    throw new AppError("GATEWAY_REVOKED", "Gateway credentials have been revoked", 403);
  }
  if (!(await verifySecret(secret, gateway.secretHash))) {
    throw new AppError("UNAUTHORIZED", "Invalid gateway credentials", 401);
  }
  return gateway;
}

export async function revokeGateway(db: Database, gatewayId: string): Promise<void> {
  const [gateway] = await db
    .update(gateways)
    .set({ revokedAt: new Date(), status: "REVOKED" })
    .where(eq(gateways.id, gatewayId))
    .returning();
  if (!gateway) {
    throw new AppError("NOT_FOUND", "Gateway not found", 404);
  }
}

async function recordEvent(
  db: Database,
  messageId: string,
  fromStatus: Message["status"] | null,
  toStatus: Message["status"],
  metadata?: string
) {
  await db.insert(messageEvents).values({
    messageId,
    fromStatus: fromStatus ?? undefined,
    toStatus,
    metadata,
  });
}

export async function createMessage(
  db: Database,
  clientId: string,
  to: string,
  body: string,
  idempotencyKey?: string
) {
  if (!body.trim()) {
    throw new AppError("INVALID_MESSAGE", "Message body is required");
  }
  if (body.length > 1600) {
    throw new AppError("INVALID_MESSAGE", "Message body exceeds maximum length (1600)");
  }

  let normalizedTo: string;
  try {
    console.log("INPUT TO:", to);
    normalizedTo = normalizePhoneNumber(to);
    console.log("NORMALIZED TO:", normalizedTo);
  } catch (err) {
    if (err instanceof PhoneValidationError) {
      throw new AppError("INVALID_PHONE", err.message);
    }
    throw err;
  }

  if (idempotencyKey) {
    console.log("IDEMPOTENCY CHECK: key =", idempotencyKey);
    const [existing] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.clientId, clientId), eq(messages.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing) {
      console.log("IDEMPOTENCY HIT: returning cached message", existing.id, "to:", existing.to);
      return existing;
    }
  }

  const expiresAt = new Date(Date.now() + config.messageTtlSeconds * 1000);
  console.log("INSERTING TO:", normalizedTo);
  const [message] = await db
    .insert(messages)
    .values({
      clientId,
      to: normalizedTo,
      body,
      idempotencyKey: idempotencyKey ?? null,
      expiresAt,
    })
    .returning();

  console.log("DB RETURNED MESSAGE:", message);
  await recordEvent(db, message.id, null, "QUEUED");

  const assigned = await tryAssignMessage(db, message.id);
  return assigned ?? message;
}

async function findOnlineGateway(db: Database): Promise<Gateway | null> {
  const heartbeatCutoff = new Date(Date.now() - config.heartbeatTtlSeconds * 1000);
  const [gateway] = await db
    .select()
    .from(gateways)
    .where(
      and(
        isNull(gateways.revokedAt),
        eq(gateways.paused, false),
        sql`${gateways.lastHeartbeatAt} >= ${heartbeatCutoff}`
      )
    )
    .orderBy(gateways.activeJobCount)
    .limit(1);
  return gateway ?? null;
}

export async function tryAssignMessage(db: Database, messageId: string): Promise<Message | null> {
  const gateway = await findOnlineGateway(db);
  if (!gateway) return null;

  const now = new Date();
  const [updated] = await db
    .update(messages)
    .set({
      status: "ASSIGNED",
      gatewayId: gateway.id,
      assignedAt: now,
    })
    .where(and(eq(messages.id, messageId), eq(messages.status, "QUEUED")))
    .returning();

  if (updated) {
    await db
      .update(gateways)
      .set({ activeJobCount: sql`${gateways.activeJobCount} + 1` })
      .where(eq(gateways.id, gateway.id));
    await recordEvent(db, messageId, "QUEUED", "ASSIGNED", JSON.stringify({ gatewayId: gateway.id }));
  }
  return updated ?? null;
}

export async function getMessage(db: Database, messageId: string, clientId: string) {
  const [message] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.clientId, clientId)))
    .limit(1);
  if (!message) {
    throw new AppError("NOT_FOUND", "Message not found", 404);
  }
  return message;
}

export async function updateHeartbeat(
  db: Database,
  gatewayId: string,
  data: {
    appVersion?: string;
    capabilities?: string;
    simInfo?: string;
    networkInfo?: string;
    paused?: boolean;
  }
) {
  const now = new Date();
  await db
    .update(gateways)
    .set({
      lastHeartbeatAt: now,
      status: data.paused ? "PAUSED" : "ONLINE",
      appVersion: data.appVersion,
      capabilities: data.capabilities,
      simInfo: data.simInfo,
      networkInfo: data.networkInfo,
      paused: data.paused ?? false,
    })
    .where(eq(gateways.id, gatewayId));

  await assignQueuedMessages(db);
}

async function assignQueuedMessages(db: Database) {
  const queued = await db
    .select()
    .from(messages)
    .where(and(eq(messages.status, "QUEUED"), sql`${messages.expiresAt} > NOW()`))
    .limit(10);

  for (const msg of queued) {
    await tryAssignMessage(db, msg.id);
  }
}

export async function pollJobs(db: Database, gatewayId: string): Promise<Message[]> {
  const now = new Date();
  const claimExpiresAt = new Date(now.getTime() + config.jobClaimTtlSeconds * 1000);

  const assigned = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.gatewayId, gatewayId),
        inArray(messages.status, ["ASSIGNED", "SENDING"]),
        sql`${messages.expiresAt} > NOW()`
      )
    )
    .limit(5);

  const claimed: Message[] = [...assigned];

  const [newJob] = await db
    .update(messages)
    .set({
      status: "ASSIGNED",
      gatewayId,
      assignedAt: now,
      claimedAt: now,
      claimExpiresAt,
    })
    .where(
      and(
        eq(messages.status, "QUEUED"),
        sql`${messages.expiresAt} > NOW()`,
        or(isNull(messages.gatewayId), eq(messages.gatewayId, gatewayId))
      )
    )
    .returning();

  if (newJob && !claimed.find((j) => j.id === newJob.id)) {
    claimed.push(newJob);
  }

  return claimed.slice(0, 5);
}

export async function ackJob(db: Database, gatewayId: string, jobId: string): Promise<Message> {
  const now = new Date();
  const claimExpiresAt = new Date(now.getTime() + config.jobClaimTtlSeconds * 1000);

  const [message] = await db
    .update(messages)
    .set({
      status: "SENDING",
      claimedAt: now,
      claimExpiresAt,
    })
    .where(
      and(
        eq(messages.id, jobId),
        eq(messages.gatewayId, gatewayId),
        inArray(messages.status, ["ASSIGNED", "SENDING"])
      )
    )
    .returning();

  if (!message) {
    throw new AppError("NOT_FOUND", "Job not found or not assigned to this gateway", 404);
  }

  if (message.status === "ASSIGNED") {
    await recordEvent(db, jobId, "ASSIGNED", "SENDING");
  }

  return message;
}

export async function reportJobResult(
  db: Database,
  gatewayId: string,
  jobId: string,
  success: boolean,
  errorCode?: string,
  errorMessage?: string
): Promise<Message> {
  const [existing] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, jobId), eq(messages.gatewayId, gatewayId)))
    .limit(1);

  if (!existing) {
    throw new AppError("NOT_FOUND", "Job not found or not assigned to this gateway", 404);
  }

  if (existing.status === "SENT" && success) {
    return existing;
  }
  if (existing.status === "FAILED" && !success) {
    return existing;
  }
  if (["SENT", "FAILED", "EXPIRED"].includes(existing.status)) {
    throw new AppError("INVALID_STATE", `Job is already in terminal state: ${existing.status}`, 409);
  }

  const now = new Date();
  const fromStatus = existing.status;

  if (success) {
    const [updated] = await db
      .update(messages)
      .set({ status: "SENT", sentAt: now, errorCode: null, errorMessage: null })
      .where(eq(messages.id, jobId))
      .returning();
    await db
      .update(gateways)
      .set({ activeJobCount: sql`GREATEST(0, ${gateways.activeJobCount} - 1)` })
      .where(eq(gateways.id, gatewayId));
    await recordEvent(db, jobId, fromStatus, "SENT");
    return updated;
  }

  const [updated] = await db
    .update(messages)
    .set({
      status: "FAILED",
      failedAt: now,
      errorCode: errorCode ?? "SEND_FAILED",
      errorMessage: errorMessage ?? "SMS send failed",
    })
    .where(eq(messages.id, jobId))
    .returning();
  await db
    .update(gateways)
    .set({ activeJobCount: sql`GREATEST(0, ${gateways.activeJobCount} - 1)` })
    .where(eq(gateways.id, gatewayId));
  await recordEvent(db, jobId, fromStatus, "FAILED", JSON.stringify({ errorCode, errorMessage }));
  return updated;
}

export async function runMaintenance(db: Database) {
  const now = new Date();

  const expired = await db
    .update(messages)
    .set({ status: "EXPIRED" })
    .where(
      and(
        inArray(messages.status, ["QUEUED", "ASSIGNED"]),
        lte(messages.expiresAt, now)
      )
    )
    .returning();

  for (const msg of expired) {
    await recordEvent(db, msg.id, msg.status === "EXPIRED" ? null : msg.status, "EXPIRED");
    if (msg.gatewayId) {
      await db
        .update(gateways)
        .set({ activeJobCount: sql`GREATEST(0, ${gateways.activeJobCount} - 1)` })
        .where(eq(gateways.id, msg.gatewayId));
    }
  }

  const stuck = await db
    .update(messages)
    .set({
      status: "FAILED",
      failedAt: now,
      errorCode: "DELIVERY_UNCERTAIN",
      errorMessage: "Job claim expired without delivery confirmation",
    })
    .where(
      and(
        eq(messages.status, "SENDING"),
        lte(messages.claimExpiresAt, now)
      )
    )
    .returning();

  for (const msg of stuck) {
    await recordEvent(db, msg.id, "SENDING", "FAILED", JSON.stringify({ errorCode: "DELIVERY_UNCERTAIN" }));
    if (msg.gatewayId) {
      await db
        .update(gateways)
        .set({ activeJobCount: sql`GREATEST(0, ${gateways.activeJobCount} - 1)` })
        .where(eq(gateways.id, msg.gatewayId));
    }
  }

  const heartbeatCutoff = new Date(now.getTime() - config.heartbeatTtlSeconds * 1000);
  await db
    .update(gateways)
    .set({ status: "OFFLINE" })
    .where(
      and(
        isNull(gateways.revokedAt),
        eq(gateways.paused, false),
        or(
          isNull(gateways.lastHeartbeatAt),
          sql`${gateways.lastHeartbeatAt} < ${heartbeatCutoff}`
        )
      )
    );

  const oldBuckets = new Date(now.getTime() - 3600_000);
  await db.delete(rateLimitBuckets).where(lte(rateLimitBuckets.windowStart, oldBuckets));

  return { expired: expired.length, stuck: stuck.length };
}

export async function checkRateLimit(
  db: Database,
  bucketKey: string,
  limit: number
): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 60000) * 60000);

  const [bucket] = await db
    .select()
    .from(rateLimitBuckets)
    .where(
      and(
        eq(rateLimitBuckets.bucketKey, bucketKey),
        eq(rateLimitBuckets.windowStart, windowStart)
      )
    )
    .limit(1);

  if (!bucket) {
    await db.insert(rateLimitBuckets).values({
      bucketKey,
      windowStart,
      requestCount: 1,
    });
    return true;
  }

  if (bucket.requestCount >= limit) {
    return false;
  }

  await db
    .update(rateLimitBuckets)
    .set({ requestCount: bucket.requestCount + 1 })
    .where(eq(rateLimitBuckets.id, bucket.id));

  return true;
}
