# LAN Party Designer

A self-hosted planner for LAN parties of 4 to 20 people. Lay out the room and tables, wire up power and ethernet, and see before the day whether a breaker will trip or you are short on cable.

## What it does

- **Venues** hold the reusable room: outline, doors, obstacles, outlets and which breaker each outlet is on. Upload a photo or sketch of the floor plan and calibrate its scale by marking two points a known distance apart.
- **Events** place tables (6 ft, 8 ft, round, custom) with seats generated along the sides, plus power strips, extension cords, switches and routers. Start a new event from a previous event's layout.
- **Power** is circuit aware: outlet, optional extension cord, power strip, devices. Each strip, cord, outlet and breaker is checked at 80% of its rating (typical draw) and 100% (peak draw). Daisy-chained strips, socket overflow and loads on outlets with an unknown breaker are flagged.
- **Network** maps every seat to a switch port, with uplinks between switches, and estimates cable lengths (Manhattan distance, 20% slack, 3 ft drop at each end, rounded up to standard lengths).
- **Roster** is a global people directory with their usual gear. Each event tracks RSVP, seat and per-event device changes. Drag guests onto seats on the plan or pick a seat from a list.
- **Reports** show breaker loads, strip status, switch port maps and a shopping list. Print the seat map from the browser. Count confirmed guests only, or confirmed and invited, and optionally fill empty seats with a placeholder PC for a worst case view.
- **Setup day** is a per-seat checklist (power, ethernet, tested) with overall progress.
- **Auto-wire** assigns unwired seats to the nearest strip with room and the nearest switch with a free port. It never changes wiring you set by hand and lists what it could not place.
- Undo and redo (Ctrl+Z, Ctrl+Shift+Z), autosave about one second after each change, named snapshots (restoring first saves a "Before restore" copy), JSON export and import.
- Light, dark or system theme. On phones and tablets the plan is a read-only seat map with guest lookup.

Units are feet and inches, power is 120 V with 15 A and 20 A breakers.

## Run with Docker

```sh
docker compose up -d --build
```

Open http://localhost:3000. Data lives in the `lan-party-data` volume, mounted at `/data` (SQLite database plus uploaded floor plan images). Back up by copying that directory.

Build a multi-architecture image (for a Raspberry Pi or NAS):

```sh
docker buildx build --platform linux/amd64,linux/arm64 -t lan-party-designer .
```

> **There is no login.** Anyone who can reach the port can read and change everything. Run it on a trusted LAN or behind Tailscale or a VPN, and do not expose it to the internet.

## Develop

Tool versions are pinned in `mise.toml`.

```sh
mise install        # node and pnpm
pnpm install
pnpm dev            # API on :3000, web on :5173 (proxies /api)
pnpm test           # unit tests: shared logic, API, editor state
pnpm e2e            # Playwright (needs a Chromium: pnpm exec playwright install chromium)
```

Layout:

- `packages/shared`: Zod schemas and the pure logic (power load, cable lengths, auto-wire, seat layout). Test-first.
- `apps/server`: Hono API, SQLite through Drizzle (migrations in `apps/server/drizzle`, run on startup). In production it also serves the built web app.
- `apps/web`: React, Vite, react-konva canvas, Zustand.

Each venue and event is stored as one validated JSON document, so autosave, snapshots and export all use the same format (`EventBundle` in `packages/shared/src/bundle.ts`). Guest attendance (RSVP, seat, per-event devices) lives inside the event document so a snapshot restore brings back who sat where.
