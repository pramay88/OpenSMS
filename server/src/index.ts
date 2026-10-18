// SPDX-License-Identifier: Apache-2.0
import { Hono } from "hono";
import { cors } from "hono/cors";
import { health } from "./routes/health.js";
import { messages } from "./routes/messages.js";
import { gateways, admin, maintenance } from "./routes/gateways.js";
import { errorHandler } from "./middleware/error-handler.js";
import type { AppEnv } from "./types.js";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { devSetup } from "./routes/dev-setup.js";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("requestId", randomUUID());
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin) =>
        config.corsOrigins.includes(origin) ? origin : undefined,
    })
  );

  app.route("/api/v1/health", health);
  app.route("/api/v1/messages", messages);
  app.route("/api/v1/gateways", gateways);
  app.route("/api/v1/admin", admin);
  app.route("/api/v1/maintenance", maintenance);
  app.route("/_dev/setup", devSetup);

  app.onError((err, c) => errorHandler(err, c));

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404)
  );

  return app;
}

export const app = createApp();

export default app;
