import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app";
import { openDb } from "./db";

const dataDir = process.env.DATA_DIR ?? "./data";
const webDir = process.env.WEB_DIR;
const port = Number(process.env.PORT ?? 3000);

mkdirSync(dataDir, { recursive: true });
const api = createApp(openDb(join(dataDir, "lan-party.db")), dataDir);

const app = new Hono();
app.route("/", api);

if (webDir && existsSync(webDir)) {
  const index = readFileSync(join(webDir, "index.html"), "utf8");
  app.use("/*", serveStatic({ root: webDir }));
  // Single page app: unknown non-API paths get index.html.
  app.get("*", (c) => c.html(index));
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`listening on :${port}, data in ${dataDir}`);
});
