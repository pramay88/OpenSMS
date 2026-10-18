import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config.js";
import { errorResponse, sanitizeLogMeta } from "../src/lib/errors.js";
import fs from "node:fs";
import path from "node:path";
import { app } from "../src/index.js";
import { config } from "../src/config.js";

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

  it("validates configuration in the Vercel entry point", () => {
    const entryPoint = fs.readFileSync(
      path.resolve(process.cwd(), "api/index.ts"),
      "utf8"
    );
    expect(entryPoint).toContain("requireConfig");
    expect(entryPoint).toMatch(/requireConfig\(\)/);
  });

  it("schedules Vercel maintenance according to the deployment contract", () => {
    const vercelConfig = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8")
    ) as { crons?: Array<{ path: string; schedule: string }> };
    expect(vercelConfig.crons).toContainEqual({
      path: "/api/v1/maintenance",
      schedule: "*/5 * * * *",
    });
  });

  it("serves the setup dashboard only in development", async () => {
    const previousNodeEnv = config.nodeEnv;
    config.nodeEnv = "development";
    try {
      const response = await app.fetch(new Request("http://localhost/_dev/setup"));
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toMatch(/script-src 'nonce-/);
      expect(html).toContain("'/api/v1/admin/registration-tokens'");
      expect(html).toContain("Authorization: 'Bearer ' + value");
      expect(html).toContain("generate.disabled = true");
      expect(html).toContain("secret.value = ''");
      expect(html).not.toContain("localStorage");
      expect(html).not.toContain("sessionStorage");
      const addresses = await app.fetch(
        new Request("http://localhost/_dev/setup/network-interfaces")
      );
      expect(addresses.status).toBe(200);
      const addressBody = (await addresses.json()) as { addresses: string[] };
      expect(
        addressBody.addresses.every((address) =>
          /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(address)
        )
      ).toBe(true);
    } finally {
      config.nodeEnv = previousNodeEnv;
    }
  });

  it("hides the setup dashboard outside development", async () => {
    const previousNodeEnv = config.nodeEnv;
    config.nodeEnv = "production";
    try {
      const response = await app.fetch(new Request("http://localhost/_dev/setup"));
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("OpenSMS Local Setup");
      const addresses = await app.fetch(
        new Request("http://localhost/_dev/setup/network-interfaces")
      );
      expect(addresses.status).toBe(404);
    } finally {
      config.nodeEnv = previousNodeEnv;
    }
  });
});
