// SPDX-License-Identifier: Apache-2.0
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const messageStatusEnum = pgEnum("message_status", [
  "QUEUED",
  "ASSIGNED",
  "SENDING",
  "DELIVERY_PENDING",
  "SENT",
  "DELIVERED",
  "FAILED",
  "EXPIRED",
]);

export const gatewayStatusEnum = pgEnum("gateway_status", [
  "ONLINE",
  "OFFLINE",
  "PAUSED",
  "REVOKED",
]);

export const apiClients = pgTable("api_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  apiKeyHash: text("api_key_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const registrationTokens = pgTable("registration_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gateways = pgTable("gateways", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  secretHash: text("secret_hash").notNull(),
  status: gatewayStatusEnum("status").notNull().default("OFFLINE"),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  appVersion: text("app_version"),
  capabilities: text("capabilities"),
  simInfo: text("sim_info"),
  networkInfo: text("network_info"),
  activeJobCount: integer("active_job_count").notNull().default(0),
  paused: boolean("paused").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => apiClients.id),
    to: text("to").notNull(),
    body: text("body").notNull(),
    status: messageStatusEnum("status").notNull().default("QUEUED"),
    idempotencyKey: text("idempotency_key"),
    gatewayId: uuid("gateway_id").references(() => gateways.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attemptCount: integer("attempt_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("messages_client_idempotency_idx").on(table.clientId, table.idempotencyKey),
    index("messages_status_expires_idx").on(table.status, table.expiresAt),
    index("messages_gateway_status_idx").on(table.gatewayId, table.status),
  ]
);

export const messageEvents = pgTable("message_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id")
    .notNull()
    .references(() => messages.id),
  fromStatus: messageStatusEnum("from_status"),
  toStatus: messageStatusEnum("to_status").notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucketKey: text("bucket_key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(0),
  },
  (table) => [uniqueIndex("rate_limit_bucket_key_window_idx").on(table.bucketKey, table.windowStart)]
);

export type ApiClient = typeof apiClients.$inferSelect;
export type Gateway = typeof gateways.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageStatus = (typeof messageStatusEnum.enumValues)[number];
