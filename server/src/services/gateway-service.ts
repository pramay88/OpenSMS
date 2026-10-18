// SPDX-License-Identifier: Apache-2.0
import { eq, and, sql, lte, gt, inArray, isNull, or, desc, count } from "drizzle-orm";
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

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

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
  const now = new Date();

  return db.transaction(async (tx) => {
    const [consumedToken] = await tx
      .update(registrationTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(registrationTokens.tokenHash, tokenHash),
          isNull(registrationTokens.usedAt),
          gt(registrationTokens.expiresAt, now)
        )
      )
      .returning();

    if (!consumedToken) {
      const [regToken] = await tx
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
      throw new AppError("TOKEN_EXPIRED", "Registration token has expired", 400);
    }

    const secret = generateGatewaySecret();
    const secretHash = await hashSecret(secret);
    const gatewayId = generateId();

    await tx.insert(gateways).values({
      id: gatewayId,
      name,
      secretHash,
      status: "OFFLINE",
    });

    return { gatewayId, secret };
  });
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

export async function getAdminSummary(db: Database) {
  const [messageCounts, gatewayCounts, recentFailures] = await Promise.all([
    db
      .select({ status: messages.status, count: count() })
      .from(messages)
      .groupBy(messages.status),
    db
      .select({ status: gateways.status, count: count() })
      .from(gateways)
      .groupBy(gateways.status),
    db
      .select({
        id: messages.id,
        status: messages.status,
        errorCode: messages.errorCode,
        errorMessage: messages.errorMessage,
        createdAt: messages.createdAt,
        failedAt: messages.failedAt,
      })
      .from(messages)
      .where(inArray(messages.status, ["FAILED", "EXPIRED"]))
      .orderBy(desc(messages.failedAt), desc(messages.createdAt))
      .limit(10),
  ]);

  return {
    messages: Object.fromEntries(messageCounts.map((row) => [row.status, Number(row.count)])),
    gateways: Object.fromEntries(gatewayCounts.map((row) => [row.status, Number(row.count)])),
    recentFailures,
  };
}

export async function listAdminGateways(db: Database) {
  return db
    .select({
      id: gateways.id,
      name: gateways.name,
      status: gateways.status,
      lastHeartbeatAt: gateways.lastHeartbeatAt,
      appVersion: gateways.appVersion,
      capabilities: gateways.capabilities,
      simInfo: gateways.simInfo,
      networkInfo: gateways.networkInfo,
      activeJobCount: gateways.activeJobCount,
      paused: gateways.paused,
      createdAt: gateways.createdAt,
      revokedAt: gateways.revokedAt,
    })
    .from(gateways)
    .orderBy(desc(gateways.lastHeartbeatAt), desc(gateways.createdAt))
    .limit(100);
}

export async function getAdminGateway(db: Database, gatewayId: string) {
  const [gateway] = await db
    .select({
      id: gateways.id,
      name: gateways.name,
      status: gateways.status,
      lastHeartbeatAt: gateways.lastHeartbeatAt,
      appVersion: gateways.appVersion,
      capabilities: gateways.capabilities,
      simInfo: gateways.simInfo,
      networkInfo: gateways.networkInfo,
      activeJobCount: gateways.activeJobCount,
      paused: gateways.paused,
      createdAt: gateways.createdAt,
      revokedAt: gateways.revokedAt,
    })
    .from(gateways)
    .where(eq(gateways.id, gatewayId))
    .limit(1);
  if (!gateway) throw new AppError("NOT_FOUND", "Gateway not found", 404);
  return gateway;
}

export async function listAdminClients(db: Database) {
  return db
    .select({
      id: apiClients.id,
      name: apiClients.name,
      createdAt: apiClients.createdAt,
      revokedAt: apiClients.revokedAt,
    })
    .from(apiClients)
    .orderBy(desc(apiClients.createdAt))
    .limit(100);
}

export async function listAdminMessages(
  db: Database,
  status?: Message["status"],
  offset = 0
) {
  const conditions = status ? eq(messages.status, status) : undefined;
  return db
    .select({
      id: messages.id,
      clientId: messages.clientId,
      to: messages.to,
      status: messages.status,
      gatewayId: messages.gatewayId,
      createdAt: messages.createdAt,
      expiresAt: messages.expiresAt,
      sentAt: messages.sentAt,
      failedAt: messages.failedAt,
      errorCode: messages.errorCode,
      errorMessage: messages.errorMessage,
      attemptCount: messages.attemptCount,
    })
    .from(messages)
    .where(conditions)
    .orderBy(desc(messages.createdAt))
    .limit(100)
    .offset(Math.max(0, Math.min(offset, 10_000)));
}

export async function getAdminMessage(db: Database, messageId: string) {
  const [message] = await db
    .select({
      id: messages.id,
      clientId: messages.clientId,
      to: messages.to,
      status: messages.status,
      gatewayId: messages.gatewayId,
      createdAt: messages.createdAt,
      expiresAt: messages.expiresAt,
      assignedAt: messages.assignedAt,
      claimedAt: messages.claimedAt,
      sentAt: messages.sentAt,
      failedAt: messages.failedAt,
      errorCode: messages.errorCode,
      errorMessage: messages.errorMessage,
      attemptCount: messages.attemptCount,
    })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!message) throw new AppError("NOT_FOUND", "Message not found", 404);
  const events = await db
    .select({
      id: messageEvents.id,
      fromStatus: messageEvents.fromStatus,
      toStatus: messageEvents.toStatus,
      createdAt: messageEvents.createdAt,
    })
    .from(messageEvents)
    .where(eq(messageEvents.messageId, messageId))
    .orderBy(messageEvents.createdAt);
  return { message, events };
}

export async function revokeApiClient(db: Database, clientId: string): Promise<void> {
  const [client] = await db
    .update(apiClients)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiClients.id, clientId), isNull(apiClients.revokedAt)))
    .returning({ id: apiClients.id });
  if (!client) {
    const [existing] = await db
      .select({ id: apiClients.id })
      .from(apiClients)
      .where(eq(apiClients.id, clientId))
      .limit(1);
    if (!existing) throw new AppError("NOT_FOUND", "API client not found", 404);
  }
}

async function recordEvent(
  db: Database | DatabaseTransaction,
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
    normalizedTo = normalizePhoneNumber(to);
  } catch (err) {
    if (err instanceof PhoneValidationError) {
      throw new AppError("INVALID_PHONE", err.message);
    }
    throw err;
  }

  const expiresAt = new Date(Date.now() + config.messageTtlSeconds * 1000);
  const message = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(messages)
      .values({
        clientId,
        to: normalizedTo,
        body,
        idempotencyKey: idempotencyKey ?? null,
        expiresAt,
      })
      .onConflictDoNothing({
        target: [messages.clientId, messages.idempotencyKey],
      })
      .returning();

    if (inserted[0]) {
      await recordEvent(tx, inserted[0].id, null, "QUEUED");
      return inserted[0];
    }

    const [existing] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.clientId, clientId),
          eq(messages.idempotencyKey, idempotencyKey!)
        )
      )
      .limit(1);

    if (!existing) {
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        "The message could not be resolved after an idempotency conflict",
        409
      );
    }

    if (existing.to !== normalizedTo || existing.body !== body) {
      throw new AppError(
        "IDEMPOTENCY_KEY_REUSED",
        "The idempotency key was already used with a different message",
        409
      );
    }

    return existing;
  });

  const assigned = await tryAssignMessage(db, message.id);
  return assigned ?? message;
}

async function findOnlineGateway(
  db: Database | DatabaseTransaction
): Promise<Gateway | null> {
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
  return db.transaction(async (tx) => {
    const gateway = await findOnlineGateway(tx);
    if (!gateway) return null;

    const [lockedGateway] = await tx
      .select()
      .from(gateways)
      .where(
        and(
          eq(gateways.id, gateway.id),
          eq(gateways.status, "ONLINE"),
          isNull(gateways.revokedAt),
          eq(gateways.paused, false),
          sql`${gateways.lastHeartbeatAt} >= ${new Date(
            Date.now() - config.heartbeatTtlSeconds * 1000
          )}`
        )
      )
      .for("update");
    if (!lockedGateway) return null;

    const now = new Date();
    const [updated] = await tx
      .update(messages)
      .set({
        status: "ASSIGNED",
        gatewayId: lockedGateway.id,
        assignedAt: now,
      })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.status, "QUEUED"),
          sql`${messages.expiresAt} > ${now}`
        )
      )
      .returning();

    if (!updated) return null;

    await tx
      .update(gateways)
      .set({ activeJobCount: sql`${gateways.activeJobCount} + 1` })
      .where(eq(gateways.id, lockedGateway.id));
    await recordEvent(
      tx,
      messageId,
      "QUEUED",
      "ASSIGNED",
      JSON.stringify({ gatewayId: lockedGateway.id })
    );
    return updated;
  });
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
  return db.transaction(async (tx) => {
    const now = new Date();
    const heartbeatCutoff = new Date(
      now.getTime() - config.heartbeatTtlSeconds * 1000
    );
    const [gateway] = await tx
      .select()
      .from(gateways)
      .where(
        and(
          eq(gateways.id, gatewayId),
          eq(gateways.status, "ONLINE"),
          isNull(gateways.revokedAt),
          eq(gateways.paused, false),
          sql`${gateways.lastHeartbeatAt} >= ${heartbeatCutoff}`
        )
      )
      .for("update");

    if (!gateway) return [];

    const assigned = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.gatewayId, gatewayId),
          inArray(messages.status, ["ASSIGNED", "SENDING"]),
          sql`${messages.expiresAt} > ${now}`
        )
      )
      .limit(5);

    const claimed: Message[] = [...assigned];
    const claimExpiresAt = new Date(
      now.getTime() + config.jobClaimTtlSeconds * 1000
    );

    while (claimed.length < 5) {
      const [queued] = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.status, "QUEUED"),
            sql`${messages.expiresAt} > ${now}`,
            or(isNull(messages.gatewayId), eq(messages.gatewayId, gatewayId))
          )
        )
        .orderBy(messages.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });

      if (!queued) break;

      const [updated] = await tx
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
            eq(messages.id, queued.id),
            eq(messages.status, "QUEUED"),
            sql`${messages.expiresAt} > ${now}`
          )
        )
        .returning();

      if (!updated) continue;

      claimed.push(updated);
      await tx
        .update(gateways)
        .set({ activeJobCount: sql`${gateways.activeJobCount} + 1` })
        .where(eq(gateways.id, gatewayId));
      await recordEvent(
        tx,
        updated.id,
        "QUEUED",
        "ASSIGNED",
        JSON.stringify({ gatewayId })
      );
    }

    return claimed;
  });
}

export async function ackJob(db: Database, gatewayId: string, jobId: string): Promise<Message> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.id, jobId), eq(messages.gatewayId, gatewayId)))
      .for("update");

    if (!existing) {
      throw new AppError("NOT_FOUND", "Job not found or not assigned to this gateway", 404);
    }

    const now = new Date();
    if (
      ["SENT", "FAILED", "EXPIRED"].includes(existing.status) ||
      (existing.claimExpiresAt && existing.claimExpiresAt <= now)
    ) {
      throw new AppError("INVALID_STATE", "Job claim is no longer valid", 409);
    }

    if (existing.status === "SENDING") {
      return existing;
    }
    if (existing.status !== "ASSIGNED") {
      throw new AppError("INVALID_STATE", `Job cannot be acknowledged from ${existing.status}`, 409);
    }

    const claimExpiresAt = new Date(now.getTime() + config.jobClaimTtlSeconds * 1000);
    const [message] = await tx
      .update(messages)
      .set({
        status: "SENDING",
        claimedAt: now,
        claimExpiresAt,
        attemptCount: sql`${messages.attemptCount} + 1`,
      })
      .where(
        and(
          eq(messages.id, jobId),
          eq(messages.gatewayId, gatewayId),
          eq(messages.status, "ASSIGNED"),
          sql`${messages.expiresAt} > ${now}`
        )
      )
      .returning();

    if (!message) {
      throw new AppError("INVALID_STATE", "Job claim is no longer valid", 409);
    }

    await recordEvent(tx, jobId, "ASSIGNED", "SENDING");
    return message;
  });
}

export async function reportJobResult(
  db: Database,
  gatewayId: string,
  jobId: string,
  success: boolean,
  errorCode?: string,
  errorMessage?: string
): Promise<Message> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.id, jobId), eq(messages.gatewayId, gatewayId)))
      .for("update");

    if (!existing) {
      throw new AppError("NOT_FOUND", "Job not found or not assigned to this gateway", 404);
    }

    if (existing.status === "SENT" && success) return existing;
    if (existing.status === "FAILED" && !success) return existing;
    if (["SENT", "FAILED", "EXPIRED"].includes(existing.status)) {
      throw new AppError("INVALID_STATE", `Job is already in terminal state: ${existing.status}`, 409);
    }

    const now = new Date();
    if (
      existing.status !== "SENDING" ||
      (existing.claimExpiresAt && existing.claimExpiresAt <= now) ||
      existing.expiresAt <= now
    ) {
      throw new AppError("INVALID_STATE", "Job claim is no longer valid", 409);
    }

    const fromStatus = existing.status;
    const [updated] = await tx
      .update(messages)
      .set(
        success
          ? {
              status: "SENT",
              sentAt: now,
              claimExpiresAt: null,
              errorCode: null,
              errorMessage: null,
            }
          : {
              status: "FAILED",
              failedAt: now,
              claimExpiresAt: null,
              errorCode: errorCode ?? "SEND_FAILED",
              errorMessage: errorMessage ?? "SMS send failed",
            }
      )
      .where(
        and(
          eq(messages.id, jobId),
          eq(messages.gatewayId, gatewayId),
          eq(messages.status, "SENDING")
        )
      )
      .returning();

    if (!updated) {
      throw new AppError("INVALID_STATE", "Job state changed before the result was recorded", 409);
    }

    await tx
      .update(gateways)
      .set({ activeJobCount: sql`GREATEST(0, ${gateways.activeJobCount} - 1)` })
      .where(eq(gateways.id, gatewayId));
    await recordEvent(
      tx,
      jobId,
      fromStatus,
      success ? "SENT" : "FAILED",
      success ? undefined : JSON.stringify({ errorCode, errorMessage })
    );
    return updated;
  });
}

export async function runMaintenance(db: Database) {
  const now = new Date();

  const { expired, stuck } = await db.transaction(async (tx) => {
    const expired = await tx
      .select()
      .from(messages)
      .where(
        and(
          inArray(messages.status, ["QUEUED", "ASSIGNED"]),
          lte(messages.expiresAt, now)
        )
      )
      .for("update", { skipLocked: true });

    for (const msg of expired) {
      await tx
        .update(messages)
        .set({ status: "EXPIRED", claimExpiresAt: null })
        .where(and(eq(messages.id, msg.id), inArray(messages.status, ["QUEUED", "ASSIGNED"])));
      await recordEvent(tx, msg.id, msg.status, "EXPIRED");
      if (msg.gatewayId) {
        await tx
          .update(gateways)
          .set({ activeJobCount: sql`GREATEST(0, ${gateways.activeJobCount} - 1)` })
          .where(eq(gateways.id, msg.gatewayId));
      }
    }

    const stuck = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.status, "SENDING"), lte(messages.claimExpiresAt, now)))
      .for("update", { skipLocked: true });

    for (const msg of stuck) {
      await tx
        .update(messages)
        .set({
          status: "FAILED",
          failedAt: now,
          claimExpiresAt: null,
          errorCode: "DELIVERY_UNCERTAIN",
          errorMessage: "Job claim expired without delivery confirmation",
        })
        .where(and(eq(messages.id, msg.id), eq(messages.status, "SENDING")));
      await recordEvent(
        tx,
        msg.id,
        "SENDING",
        "FAILED",
        JSON.stringify({ errorCode: "DELIVERY_UNCERTAIN" })
      );
      if (msg.gatewayId) {
        await tx
          .update(gateways)
          .set({ activeJobCount: sql`GREATEST(0, ${gateways.activeJobCount} - 1)` })
          .where(eq(gateways.id, msg.gatewayId));
      }
    }

    return { expired, stuck };
  });

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
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(rateLimitBuckets)
      .values({
        bucketKey,
        windowStart,
        requestCount: 1,
      })
      .onConflictDoNothing({
        target: [rateLimitBuckets.bucketKey, rateLimitBuckets.windowStart],
      })
      .returning({ requestCount: rateLimitBuckets.requestCount });

    if (inserted) {
      return true;
    }

    const [bucket] = await tx
      .select({
        requestCount: rateLimitBuckets.requestCount,
      })
      .from(rateLimitBuckets)
      .where(
        and(
          eq(rateLimitBuckets.bucketKey, bucketKey),
          eq(rateLimitBuckets.windowStart, windowStart)
        )
      )
      .for("update");

    if (bucket.requestCount >= limit) {
      return false;
    }

    await tx
      .update(rateLimitBuckets)
      .set({ requestCount: bucket.requestCount + 1 })
      .where(
        and(
          eq(rateLimitBuckets.bucketKey, bucketKey),
          eq(rateLimitBuckets.windowStart, windowStart)
        )
      );
    return true;
  });
}
