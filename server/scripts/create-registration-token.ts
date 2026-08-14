// SPDX-License-Identifier: Apache-2.0
import "dotenv/config";
import { getDb, closeDb } from "../src/db/client.js";
import { createRegistrationToken } from "../src/services/gateway-service.js";

async function main() {
  const db = getDb();
  const { token, expiresAt } = await createRegistrationToken(db);
  console.log("Registration token created (single-use, save this):");
  console.log("  Token:", token);
  console.log("  Expires:", expiresAt.toISOString());
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
