// SPDX-License-Identifier: Apache-2.0
import type { Context, Next } from "hono";
import { getDb } from "../db/client.js";
import { authenticateGateway } from "../services/gateway-service.js";
import { AppError, errorResponse } from "../lib/errors.js";
import type { AppEnv } from "../types.js";

export async function gatewayAuthMiddleware(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Gateway ")) {
    return c.json(
      errorResponse(new AppError("UNAUTHORIZED", "Missing or invalid Gateway Authorization header", 401)),
      401
    );
  }

  const credentials = authHeader.slice(8);
  const colonIndex = credentials.indexOf(":");
  if (colonIndex === -1) {
    return c.json(errorResponse(new AppError("UNAUTHORIZED", "Invalid gateway credential format", 401)), 401);
  }

  const gatewayId = credentials.slice(0, colonIndex);
  const secret = credentials.slice(colonIndex + 1);

  try {
    const db = getDb();
    const gateway = await authenticateGateway(db, gatewayId, secret);
    c.set("gateway", gateway);
    await next();
  } catch (err) {
    if (err instanceof AppError) {
      return c.json(errorResponse(err), err.status as 401 | 403);
    }
    throw err;
  }
}
