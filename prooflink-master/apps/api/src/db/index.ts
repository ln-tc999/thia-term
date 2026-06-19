import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema.js";

const { Pool } = pg;

function getConnectionConfig(): pg.PoolConfig {
  const connectionString = process.env["DATABASE_URL"];
  if (connectionString) {
    return { connectionString, max: 20 };
  }

  const password = process.env["DB_PASSWORD"];
  if (!password) {
    throw new Error("DB_PASSWORD environment variable is required when DATABASE_URL is not set.");
  }

  return {
    host: process.env["DB_HOST"] ?? "localhost",
    port: Number(process.env["DB_PORT"] ?? 5432),
    database: process.env["DB_NAME"] ?? "prooflink",
    user: process.env["DB_USER"] ?? "prooflink",
    password,
    max: 20,
  };
}

let poolInstance: pg.Pool | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getPool(): pg.Pool {
  if (!poolInstance) {
    poolInstance = new Pool(getConnectionConfig());
  }
  return poolInstance;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

export type Database = ReturnType<typeof getDb>;

export async function closeDb(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
    dbInstance = null;
  }
}
