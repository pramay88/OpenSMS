// SPDX-License-Identifier: Apache-2.0
import { Hono } from "hono";
import { cors } from "hono/cors";
import { health } from "./routes/health.js";
import { messages } from "./routes/messages.js";
import { gateways, admin, maintenance } from "./routes/gateways.js";
import { errorHandler } from "./middleware/error-handler.js";
import type { AppEnv } from "./types.js";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", cors());

  app.route("/api/v1/health", health);
  app.route("/api/v1/messages", messages);
  app.route("/api/v1/gateways", gateways);
  app.route("/api/v1/admin", admin);
  app.route("/api/v1/maintenance", maintenance);

  app.onError((err, c) => errorHandler(err, c));

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404)
  );

  return app;
}

export const app = createApp();

export default app;
