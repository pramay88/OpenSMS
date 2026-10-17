// SPDX-License-Identifier: Apache-2.0
import type { Context, Next } from "hono";
import { config } from "../config.js";
import { AppError, errorResponse } from "../lib/errors.js";
import { createHash, timingSafeEqual } from "node:crypto";

function secretsEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export async function adminAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(errorResponse(new AppError("UNAUTHORIZED", "Admin authentication required", 401)), 401);
  }

  const secret = authHeader.slice(7);
  if (!config.adminSecret || !secretsEqual(secret, config.adminSecret)) {
    return c.json(errorResponse(new AppError("UNAUTHORIZED", "Invalid admin credentials", 401)), 401);
  }

  await next();
}

export async function cronAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(errorResponse(new AppError("UNAUTHORIZED", "Cron authentication required", 401)), 401);
  }

  const secret = authHeader.slice(7);
  if (!config.cronSecret || !secretsEqual(secret, config.cronSecret)) {
    return c.json(errorResponse(new AppError("UNAUTHORIZED", "Invalid cron credentials", 401)), 401);
  }

  await next();
}
