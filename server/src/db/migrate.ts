// SPDX-License-Identifier: Apache-2.0
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, closeDb } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const db = getDb();
  const migrationsFolder = path.join(__dirname, "../../drizzle");
  console.log("Running migrations from", migrationsFolder);
  await migrate(db, { migrationsFolder });
  console.log("Migrations complete");
  await closeDb();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
