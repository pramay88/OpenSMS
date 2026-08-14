// SPDX-License-Identifier: Apache-2.0
import type { Context, Next } from "hono";
import { getDb } from "../db/client.js";
import { authenticateApiClient, checkRateLimit } from "../services/gateway-service.js";
import { config } from "../config.js";
import { AppError, errorResponse } from "../lib/errors.js";
import type { AppEnv } from "../types.js";

export async function clientAuthMiddleware(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(errorResponse(new AppError("UNAUTHORIZED", "Missing or invalid Authorization header", 401)), 401);
  }

  const apiKey = authHeader.slice(7);
  const db = getDb();

  const allowed = await checkRateLimit(
    db,
    `client:${apiKey.slice(0, 16)}`,
    config.apiRateLimitPerMin
  );
  if (!allowed) {
    return c.json(errorResponse(new AppError("RATE_LIMITED", "Rate limit exceeded", 429)), 429);
  }

  try {
    const client = await authenticateApiClient(db, apiKey);
    c.set("clientId", client.id);
    c.set("clientName", client.name);
    await next();
  } catch (err) {
    if (err instanceof AppError) {
      return c.json(errorResponse(err), err.status as 401);
    }
    throw err;
  }
}
