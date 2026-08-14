// SPDX-License-Identifier: Apache-2.0
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client.js";
import {
  registerGateway,
  updateHeartbeat,
  pollJobs,
  ackJob,
  reportJobResult,
  createApiClient,
  createRegistrationToken,
  revokeGateway,
} from "../services/gateway-service.js";
import { gatewayAuthMiddleware } from "../middleware/auth-gateway.js";
import { adminAuthMiddleware, cronAuthMiddleware } from "../middleware/auth-admin.js";
import { toJobResponse } from "../lib/serializers.js";
import { runMaintenance } from "../services/gateway-service.js";
import { AppError, errorResponse, logInfo } from "../lib/errors.js";
import type { AppEnv } from "../types.js";

const registerSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(100),
});

const heartbeatSchema = z.object({
  appVersion: z.string().optional(),
  capabilities: z.string().optional(),
  simInfo: z.string().optional(),
  networkInfo: z.string().optional(),
  paused: z.boolean().optional(),
});

const resultSchema = z.object({
  success: z.boolean(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

const gateways = new Hono<AppEnv>();

gateways.post("/register", async (c) => {
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      errorResponse(new AppError("VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten())),
      400
    );
  }

  const db = getDb();
  const result = await registerGateway(db, parsed.data.token, parsed.data.name);
  logInfo("Gateway registered", { gatewayId: result.gatewayId });
  return c.json(result, 201);
});

gateways.post("/heartbeat", gatewayAuthMiddleware, async (c) => {
  const gateway = c.get("gateway");
  const body = await c.req.json();
  const parsed = heartbeatSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      errorResponse(new AppError("VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten())),
      400
    );
  }

  const db = getDb();
  await updateHeartbeat(db, gateway.id, parsed.data);
  return c.json({ status: "ok", gatewayId: gateway.id });
});

gateways.get("/jobs", gatewayAuthMiddleware, async (c) => {
  const gateway = c.get("gateway");
  const db = getDb();
  const jobs = await pollJobs(db, gateway.id);
  return c.json({ jobs: jobs.map(toJobResponse) });
});

gateways.post("/jobs/:jobId/ack", gatewayAuthMiddleware, async (c) => {
  const gateway = c.get("gateway");
  const jobId = c.req.param("jobId")!;
  const db = getDb();
  const job = await ackJob(db, gateway.id, jobId);
  return c.json(toJobResponse(job));
});

gateways.post("/jobs/:jobId/result", gatewayAuthMiddleware, async (c) => {
  const gateway = c.get("gateway");
  const jobId = c.req.param("jobId")!;
  const body = await c.req.json();
  const parsed = resultSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      errorResponse(new AppError("VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten())),
      400
    );
  }

  const db = getDb();
  const result = await reportJobResult(
    db,
    gateway.id,
    jobId,
    parsed.data.success,
    parsed.data.errorCode,
    parsed.data.errorMessage
  );
  logInfo("Job result reported", { jobId, success: parsed.data.success, status: result.status });
  return c.json({ id: result.id, status: result.status });
});

const admin = new Hono();

admin.post("/clients", adminAuthMiddleware, async (c) => {
  const body = await c.req.json();
  const name = body.name as string;
  if (!name?.trim()) {
    return c.json(errorResponse(new AppError("VALIDATION_ERROR", "Client name is required")), 400);
  }
  const db = getDb();
  const { client, apiKey } = await createApiClient(db, name);
  return c.json({ id: client.id, name: client.name, apiKey }, 201);
});

admin.post("/registration-tokens", adminAuthMiddleware, async (c) => {
  const db = getDb();
  const { token, expiresAt } = await createRegistrationToken(db);
  return c.json({ token, expiresAt: expiresAt.toISOString() }, 201);
});

admin.post("/gateways/:id/revoke", adminAuthMiddleware, async (c) => {
  const gatewayId = c.req.param("id")!;
  const db = getDb();
  await revokeGateway(db, gatewayId);
  return c.json({ status: "revoked", gatewayId });
});

const maintenance = new Hono();

maintenance.get("/", cronAuthMiddleware, async (c) => {
  const db = getDb();
  const result = await runMaintenance(db);
  logInfo("Maintenance completed", result);
  return c.json({ status: "ok", ...result });
});

maintenance.post("/", cronAuthMiddleware, async (c) => {
  const db = getDb();
  const result = await runMaintenance(db);
  logInfo("Maintenance completed", result);
  return c.json({ status: "ok", ...result });
});

export { gateways, admin, maintenance };
