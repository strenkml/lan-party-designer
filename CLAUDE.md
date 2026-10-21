# LAN Party Designer

Self-hosted planner for small LAN parties (4 to 20 people). TypeScript everywhere. One Docker image serves the API and the built web app on port 3000. Single user, no auth, meant for a LAN or Tailscale.

## Commands

Tool versions are pinned in `mise.toml` (node, pnpm). Run `mise install` first.

```sh
pnpm install
pnpm dev          # API on :3000, web on :5173 (proxies /api)
pnpm typecheck    # all packages
pnpm test         # unit tests in all packages (Vitest)
pnpm e2e          # builds the web app, then runs Playwright against a throwaway server on :3100
pnpm build        # web build plus server typecheck
docker compose up -d --build   # build from source; without --build compose uses the published image
```

`pnpm e2e` serves `apps/web/dist`. Running `playwright test` directly uses whatever was built last, so a stale build gives confusing failures. Always use `pnpm e2e` (or build first).

Playwright needs Chromium and its system libraries: `pnpm exec playwright install --with-deps chromium`.

## Layout

- `packages/shared`: Zod schemas and all pure domain logic (power load, cable lengths and routes, auto-wire, seat layout, geometry, connections). No React, no DB.
- `apps/server`: Hono API, SQLite through Drizzle. Migrations live in `apps/server/drizzle` and run at startup. In production it also serves `apps/web/dist`.
- `apps/web`: React, Vite, react-konva canvas, Zustand. Plain CSS in `src/styles.css` with theme tokens.
- `e2e`: Playwright tests (`planning.spec.ts`).

## How things work

- Units: 1 canvas unit is 1 foot. `PPF` (24 px per foot) in `apps/web/src/canvas/FloorPlan.tsx`. Angles are degrees, clockwise.
- A venue and an event are each stored as one JSON document validated by Zod (`VenueDoc`, `EventDoc` in `packages/shared/src/schema.ts`). Guest attendance lives inside the event document. Export, import and snapshots all use `EventBundle`.
- Editor state is `createDocStore` in `apps/web/src/store/docStore.ts` (immer, undo and redo, merge keys for typing). Autosave is `useAutosave` (about 1 s debounce, last write wins).
- Pure edit operations for events are in `apps/web/src/store/eventOps.ts` (tables, groups, copy and paste, disconnect, delete cable). Prefer adding logic there or in `packages/shared` over putting it in components.
- Cable routes are keyed strings in `EventDoc.routes`: `eth:<seat id>`, `eth:<uplink id>`, `eth:jack-<device id>`, `pwr:strip:<id>`, `pwr:dev:<id>`, `pwr:seat:<id>`, `pwr:cord:<id>`. `cableConnections` in shared lists them all.
- Which connections are allowed lives in `packages/shared/src/wiring.ts` (`wireOptions` lists legal targets, `applyWire` makes the connection or refuses). Change the rules there, with tests, not in the menu code.
- Canvas shapes carry `name="ctx:<kind>:<id>"`. The right-click handler walks up from the clicked node to find it. New clickable shapes need that name.

## Rules

- Test first for logic. Write the failing test, then the code. Put logic in `packages/shared` or `eventOps.ts` so it can be tested without a browser.
- Saved documents must keep loading. Any field added to `VenueDoc` or `EventDoc` needs a `.default(...)` so older saved data and old exports still parse. `packages/shared/src/compat.test.ts` covers this. Renaming or removing a field needs a real conversion step.
- Database changes: edit `apps/server/src/db/schema.ts`, run `pnpm exec drizzle-kit generate --name <name>` in `apps/server`, commit the new SQL and journal. Startup backs the database up before applying pending migrations.
- Never use `crypto.randomUUID` in the web app. It only exists on https and localhost, and people open this over `http://<lan ip>:3000`. Use `newId` from `apps/web/src/lib/id.ts`.
- Cross-platform image: the Docker build must work for linux/amd64 and linux/arm64. `better-sqlite3` is native, so the build stage installs python, make and g++.
- Do not use dashes as punctuation in code comments, docs, READMEs or commit messages. Use commas, colons, semicolons or two sentences.
- Commit with the configured git identity. No co-author trailers unless asked.

## Testing notes

- Canvas tests click by feet using a measured mapping of the fitted 24 by 16 ft room. See the `ft(x, y)` helpers in `e2e/planning.spec.ts`. Wait about 900 ms after loading a plan so the view has fitted before clicking.
- The top bar must not wrap at 1400 px wide. If it does, the canvas shrinks and coordinate based tests miss.
- Konva double click fires for any two clicks within 400 ms, anywhere. Do not use it to finish a drawing.
- `getByLabel("Name")` can match both the event name box in the top bar and a dialog field. Scope to `page.getByRole("dialog")`.
- Floating point noise: round coordinates after moving things (`translateObjects` does).

## Docker and CI

- `Dockerfile` is multi-stage: build with pnpm, then a slim runtime that runs the server with `tsx`. Data is in `/data` (SQLite file and `uploads`).
- `.github/workflows/ci.yml` typechecks, builds, runs unit and e2e tests, and on pushes to the default branch and `v*` tags publishes a multi-arch image to GitHub Container Registry.
