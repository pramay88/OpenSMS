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
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  port: parseInt(process.env.PORT ?? "3000", 10),
  registrationTokenTtlSeconds: parseInt(
    process.env.REGISTRATION_TOKEN_TTL_SECONDS ?? "3600",
    10
  ),
};

type ConfigValues = typeof config;

export function validateConfig(values: ConfigValues = config): void {
  if (!values.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (values.nodeEnv === "production") {
    for (const [name, value] of [
      ["ADMIN_SECRET", values.adminSecret],
      ["CRON_SECRET", values.cronSecret],
    ] as const) {
      if (!value || value.length < 32 || /^change-me-/i.test(value)) {
        throw new Error(`${name} must be set to a strong production secret`);
      }
    }
  }
}

export function requireConfig(): void {
  validateConfig();
}
