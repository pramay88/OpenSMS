// SPDX-License-Identifier: Apache-2.0
import type { Context } from "hono";
import { AppError, errorResponse, logError } from "../lib/errors.js";

export function errorHandler(err: Error, c: Context) {
  if (err instanceof AppError) {
    return c.json(errorResponse(err), err.status as 400);
  }
  logError("Unhandled error", {
    requestId: c.get("requestId"),
    errorType: err.name,
  });
  return c.json(errorResponse(err), 500);
}
