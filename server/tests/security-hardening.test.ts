import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config.js";
import { errorResponse, sanitizeLogMeta } from "../src/lib/errors.js";
import fs from "node:fs";

describe("production security configuration", () => {
  const baseConfig = {
    databaseUrl: "postgresql://localhost/test",
    adminSecret: "development-admin-secret",
    cronSecret: "development-cron-secret",
    apiRateLimitPerMin: 60,
    messageTtlSeconds: 300,
    jobClaimTtlSeconds: 120,
    heartbeatTtlSeconds: 90,
    logLevel: "info",
    nodeEnv: "development",
    corsOrigins: [],
    port: 3000,
    registrationTokenTtlSeconds: 3600,
  } as const;

  it("accepts documented development configuration", () => {
    expect(() => validateConfig(baseConfig)).not.toThrow();
  });

  it("rejects missing or insecure production secrets", () => {
    expect(() =>
      validateConfig({ ...baseConfig, nodeEnv: "production", adminSecret: "" })
    ).toThrow(/ADMIN_SECRET/);
    expect(() =>
      validateConfig({
        ...baseConfig,
        nodeEnv: "production",
        adminSecret: "change-me-admin-secret",
      })
    ).toThrow(/ADMIN_SECRET/);
    expect(() =>
      validateConfig({
        ...baseConfig,
        nodeEnv: "production",
        adminSecret: "a".repeat(32),
        cronSecret: "b".repeat(32),
      })
    ).not.toThrow();
  });

  it("does not expose unexpected error details", () => {
    const response = errorResponse(new Error("database password and SQL details"));
    expect(response).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  });

  it("redacts sensitive structured log fields", () => {
    expect(
      sanitizeLogMeta({
        requestId: "request-1",
        apiKey: "secret-key",
        nested: { body: "sms body", authorization: "credential" },
      })
    ).toEqual({
      requestId: "request-1",
      apiKey: "[redacted]",
      nested: { body: "[redacted]", authorization: "[redacted]" },
    });
  });

  it("disables cleartext traffic in the production Android manifest", () => {
    const manifest = fs.readFileSync(
      new URL(
        "../../android/app/src/main/AndroidManifest.xml",
        import.meta.url
      ),
      "utf8"
    );
    expect(manifest).toMatch(/android:usesCleartextTraffic="false"/);
  });
});
