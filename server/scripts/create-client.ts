// SPDX-License-Identifier: Apache-2.0
import "dotenv/config";
import { getDb, closeDb } from "../src/db/client.js";
import { createApiClient } from "../src/services/gateway-service.js";

async function main() {
  const name = process.argv[2] ?? "default-client";
  const db = getDb();
  const { client, apiKey } = await createApiClient(db, name);
  console.log("API client created:");
  console.log("  ID:", client.id);
  console.log("  Name:", client.name);
  console.log("  API Key (save this, shown once):", apiKey);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
