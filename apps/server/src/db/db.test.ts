import Database from "better-sqlite3";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./index";

const realMigrations = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** A migrations folder that only contains the first migration, like an older release. */
function oldRelease(): string {
  const dir = mkdtempSync(join(tmpdir(), "lpd-old-"));
  mkdirSync(join(dir, "meta"));
  cpSync(join(realMigrations, "0000_init.sql"), join(dir, "0000_init.sql"));
  const journal = readJson(join(realMigrations, "meta", "_journal.json"));
  journal.entries = journal.entries.slice(0, 1);
  writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify(journal));
  return dir;
}
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const backups = (dir: string) => readdirSync(dir).filter((f) => f.includes(".bak-"));

afterEach(() => delete process.env.MIGRATIONS_DIR);

describe("upgrading an existing database", () => {
  it("keeps the data, adds the new tables and leaves a backup of the old file", () => {
    const dir = mkdtempSync(join(tmpdir(), "lpd-data-"));
    const file = join(dir, "lan-party.db");

    process.env.MIGRATIONS_DIR = oldRelease();
    const old = openDb(file);
    old.$client.prepare("INSERT INTO venues (id, name, doc, created_at, updated_at) VALUES ('v1','Basement','{}',1,1)").run();
    expect(old.$client.prepare("SELECT name FROM sqlite_master WHERE name='presets'").get()).toBeUndefined();
    old.$client.close();
    expect(backups(dir)).toEqual([]); // a fresh install needs no backup

    process.env.MIGRATIONS_DIR = realMigrations;
    const upgraded = openDb(file);
    expect(upgraded.$client.prepare("SELECT name FROM venues").all()).toEqual([{ name: "Basement" }]);
    expect(upgraded.$client.prepare("SELECT name FROM sqlite_master WHERE name='presets'").get()).toBeDefined();
    upgraded.$client.close();

    const [backup] = backups(dir);
    expect(backup).toBeDefined();
    // the backup is the database as it was before the upgrade
    const copy = new Database(join(dir, backup!), { readonly: true });
    expect(copy.prepare("SELECT name FROM venues").all()).toEqual([{ name: "Basement" }]);
    expect(copy.prepare("SELECT name FROM sqlite_master WHERE name='presets'").get()).toBeUndefined();
    copy.close();
  });

  it("does not make a backup when nothing is pending", () => {
    const dir = mkdtempSync(join(tmpdir(), "lpd-data-"));
    const file = join(dir, "lan-party.db");
    openDb(file).$client.close();
    openDb(file).$client.close();
    expect(backups(dir)).toEqual([]);
    expect(existsSync(file)).toBe(true);
  });
});
