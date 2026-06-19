import { migrate } from "drizzle-orm/node-postgres/migrator";

import { closeDb, getDb } from "./index.js";

async function runMigrations(): Promise<void> {
  const db = getDb();

  console.info("[migrate] Running migrations...");

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.info("[migrate] Migrations completed successfully.");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[migrate] Migration failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

runMigrations();
