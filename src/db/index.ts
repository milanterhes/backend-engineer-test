import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDb() first.");
  }
  return db;
}

export async function initializeDb(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  db = drizzle(pool, { schema });

  return db;
}

export { schema };
