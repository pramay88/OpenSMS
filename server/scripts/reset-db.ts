// SPDX-License-Identifier: Apache-2.0
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "../src/db/client.js";

async function main() {
  console.log("Connecting to database and resetting all runtime data...");
  const db = getDb();

  try {
    await db.execute(sql`
      TRUNCATE TABLE 
        message_events,
        messages,
        rate_limit_buckets,
        registration_tokens,
        gateways,
        api_clients
      CASCADE;
    `);

    console.log("✅ Database reset successful! All messages, gateways, clients, and tokens cleared.");
  } catch (error) {
    console.error("❌ Failed to reset database:", error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
