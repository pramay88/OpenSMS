// SPDX-License-Identifier: Apache-2.0
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { createMessage, getMessage } from "../services/gateway-service.js";
import { clientAuthMiddleware } from "../middleware/auth-client.js";
import { toMessageResponse } from "../lib/serializers.js";
import { AppError, errorResponse, logInfo } from "../lib/errors.js";
import type { AppEnv } from "../types.js";

const createMessageSchema = z.object({
  to: z.string().min(1),
  message: z.string().min(1),
});

const messages = new Hono<AppEnv>();

messages.post("/", clientAuthMiddleware, async (c) => {
  const clientId = c.get("clientId");
  const body = await c.req.json();
  const parsed = createMessageSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      errorResponse(new AppError("VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten())),
      400
    );
  }

  const idempotencyKey = c.req.header("Idempotency-Key") ?? undefined;
  const db = getDb();
  const message = await createMessage(
    db,
    clientId,
    parsed.data.to,
    parsed.data.message,
    idempotencyKey
  );

  logInfo("Message queued", {
    requestId: c.get("requestId"),
    messageId: message.id,
    clientId,
    status: message.status,
  });

  return c.json(toMessageResponse(message), message.status === "QUEUED" ? 202 : 201);
});

messages.get("/:id", clientAuthMiddleware, async (c) => {
  const clientId = c.get("clientId");
  const messageId = c.req.param("id")!;
  const db = getDb();
  const message = await getMessage(db, messageId, clientId);
  return c.json(toMessageResponse(message));
});

export { messages };
