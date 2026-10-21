import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DEFAULT_PROFILES } from "@lpd/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deviceProfiles } from "./schema";
import * as schema from "./schema";

export type Db = ReturnType<typeof openDb>;

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** True when this database has already been migrated before, but this release brings newer migrations. */
function upgradePending(sqlite: Database.Database, folder: string): boolean {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
  const tracked = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = '__drizzle_migrations'").get();
  if (!tracked) return false;
  const applied = (sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number }).n;
  return applied > 0 && applied < journal.entries.length;
}

/** A consistent copy of the database next to it, named like lan-party.db.bak-20261021-093000. */
function backUp(sqlite: Database.Database, file: string) {
  const t = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const target = `${file}.bak-${t}`;
  sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  console.log(`Database upgrade pending. Backed up the current data to ${target}`);
}

export function openDb(file: string) {
  const sqlite = new Database(file);
  const folder = process.env.MIGRATIONS_DIR ?? migrationsFolder;
  if (file !== ":memory:" && upgradePending(sqlite, folder)) backUp(sqlite, file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: folder });
  const existing = db.select().from(deviceProfiles).limit(1).all();
  if (existing.length === 0) db.insert(deviceProfiles).values(DEFAULT_PROFILES).run();
  return db;
}
