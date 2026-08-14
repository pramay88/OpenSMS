// SPDX-License-Identifier: Apache-2.0
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";

const health = new Hono();

health.get("/", async (c) => {
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch {
    return c.json({ status: "degraded", timestamp: new Date().toISOString() }, 503);
  }
});

export { health };
