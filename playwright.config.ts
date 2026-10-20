import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const dataDir = mkdtempSync(join(tmpdir(), "lpd-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure", viewport: { width: 1400, height: 900 } },
  webServer: {
    command: "pnpm --filter @lpd/server start",
    url: "http://localhost:3100/api/health",
    reuseExistingServer: false,
    env: { PORT: "3100", DATA_DIR: dataDir, WEB_DIR: join(process.cwd(), "apps/web/dist") },
  },
});
