// SPDX-License-Identifier: Apache-2.0
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  adminSecret: process.env.ADMIN_SECRET ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  apiRateLimitPerMin: parseInt(process.env.API_RATE_LIMIT_PER_MIN ?? "60", 10),
  messageTtlSeconds: parseInt(process.env.MESSAGE_TTL_SECONDS ?? "300", 10),
  jobClaimTtlSeconds: parseInt(process.env.JOB_CLAIM_TTL_SECONDS ?? "120", 10),
  heartbeatTtlSeconds: parseInt(process.env.HEARTBEAT_TTL_SECONDS ?? "90", 10),
  logLevel: process.env.LOG_LEVEL ?? "info",
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parseInt(process.env.PORT ?? "3000", 10),
  registrationTokenTtlSeconds: parseInt(
    process.env.REGISTRATION_TOKEN_TTL_SECONDS ?? "3600",
    10
  ),
};

export function requireConfig(): void {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
}
