// SPDX-License-Identifier: Apache-2.0
import { serve } from "@hono/node-server";
import { app } from "./index.js";
import { config, requireConfig } from "./config.js";
import { logInfo } from "./lib/errors.js";

requireConfig();

serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: "0.0.0.0",
  },
  (info) => {
    logInfo(`SMS Gateway Server listening on port ${info.port}`);
  }
);
