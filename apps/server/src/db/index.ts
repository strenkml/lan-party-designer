import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DEFAULT_PROFILES } from "@lpd/shared";
import { fileURLToPath } from "node:url";
import { deviceProfiles } from "./schema";
import * as schema from "./schema";

export type Db = ReturnType<typeof openDb>;

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export function openDb(file: string) {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR ?? migrationsFolder });
  const existing = db.select().from(deviceProfiles).limit(1).all();
  if (existing.length === 0) db.insert(deviceProfiles).values(DEFAULT_PROFILES).run();
  return db;
}
