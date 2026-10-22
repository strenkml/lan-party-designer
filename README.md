# LAN Party Designer

A self-hosted planner for LAN parties of 4 to 20 people. Lay out the room and tables, wire up power and ethernet, and see before the day whether a breaker will trip or you are short on cable.

## What it does

- **Venues** hold the reusable room: outline, doors, windows, garage doors, obstacles, outlets (with plug count and height off the floor), network jacks and which breaker each outlet is on. Doors, windows, outlets and jacks snap onto walls, and wall and opening dimensions can be shown. Upload a photo or sketch of the floor plan and calibrate its scale by marking two points a known distance apart.
- **Events** place zones (walkways, food, storage, stage), tables (6 ft, 8 ft, round, custom) with seats generated along the sides, plus power strips, extension cords, switches and routers. Start a new event from a previous event's layout. Items snap to each other and the walls while you drag (hold Alt to skip), shift-click selects several objects, and a group moves as one. Strips and switches rotate. Tables and power strips can be saved as named presets, and custom switches are saved as device profiles.
- **Cables** can be routed by hand: click any ethernet or power cable, then drag its bend points around furniture. Lengths follow the route, use each outlet's height for the drop at the wall, and feed the shopping list. Select a cable and press Delete (or use the panel or right-click menu) to remove it.
- **Disconnect everything** on a switch, power strip or outlet unplugs all of its connections in one step, and Ctrl+Z brings them back.
- **Right-click menus** in both editors: add items where you clicked, copy, paste, duplicate, rotate, group, disconnect, delete, seat a guest, flip a door, clone a door, window, garage door, outlet or network jack along its wall, set an outlet's breaker. **Wire to…** on a seat, switch, strip, outlet or wall jack lists only connections that make sense, nearest first: seats go to switches and strips, never to other seats; a TV with no network ports gets no ethernet options; a strip cannot plug into itself or loop back through a chain. Targets that are full (no free port, plug or socket) are shown greyed out with the reason. Shift + right-click opens the browser's own menu.
- **Power** is circuit aware: outlet, optional extension cord, power strip, devices. Each strip, cord, outlet and breaker is checked at 80% of its rating (typical draw) and 100% (peak draw). Daisy-chained strips, socket overflow and loads on outlets with an unknown breaker are flagged.
- **Cables across walkways** are flagged, following each cable's bend points, so you can reroute them before someone trips.
- **Network** maps every seat to a switch port, with uplinks between switches, and estimates cable lengths (Manhattan distance, 20% slack, 3 ft drop at each end, rounded up to standard lengths).
- **Roster** is a global people directory with their usual gear. Each event tracks RSVP, seat and per-event device changes. Drag guests onto seats on the plan or pick a seat from a list.
- **Reports** show breaker loads, strip status, room heat output in BTU/h, switch port maps with uplink and internet bandwidth shares, and a shopping list. Enter the cables, strips and switches you already own and they come off what you need to buy. Print the seat map from the browser. Count confirmed guests only, or confirmed and invited, and optionally fill empty seats with a placeholder PC and monitor for a worst case view.
- **Setup day** is a per-seat checklist (power, ethernet, tested) with overall progress.
- **Auto-wire** assigns every unwired seat, including empty ones, to the nearest strip with room and the nearest switch with a free port. It never changes wiring you set by hand and lists what it could not place.
- Export the whole plan as a PNG from the plan page.
- Undo and redo (Ctrl+Z, Ctrl+Shift+Z), autosave about one second after each change, named snapshots (restoring first saves a "Before restore" copy), JSON export and import.
- Light, dark or system theme. On phones and tablets the plan is a read-only seat map with guest lookup.

Units are feet and inches, power is 120 V with 15 A and 20 A breakers.

## Install

You need [Docker](https://docs.docker.com/get-docker/) with the Compose plugin on the machine that will host it (a laptop, home server, NAS or Raspberry Pi). Nothing else is required.

1. Get the Compose file. Either clone the repository, or download just the file:

   ```sh
   mkdir lan-party-designer && cd lan-party-designer
   curl -O https://raw.githubusercontent.com/strenkml/lan-party-designer/master/docker-compose.yml
   ```

2. Pull the image and start it:

   ```sh
   docker compose pull
   docker compose up -d
   ```

3. Open http://localhost:3000. From another device on the same network, use `http://<host ip>:3000` (the host's LAN or Tailscale address).

The container restarts on its own after a reboot. Stop it with `docker compose down`; your data stays in the `lan-party-data` volume. If the pull is refused, the package on GitHub is still private: run `docker login ghcr.io`, or make the package public in its settings.

To install from source instead, clone the repository and run `docker compose up -d --build`.

## Run with Docker

Use the published image (multi-architecture: amd64 and arm64, so it also runs on a Raspberry Pi or NAS):

```sh
docker run -d --name lan-party-designer -p 3000:3000 -v lan-party-data:/data ghcr.io/strenkml/lan-party-designer:latest
```

Or use Compose. It uses the published image, and can also build from the local source:

```sh
docker compose pull && docker compose up -d   # published image
docker compose up -d --build                  # build from this checkout instead
```

Open http://localhost:3000. Data lives in the `lan-party-data` volume, mounted at `/data` (SQLite database plus uploaded floor plan images). Back up by copying that directory.

**Upgrading:** pull the new image and restart. Database migrations run automatically at startup, and if an upgrade will change an existing database the app first saves a copy next to it (`lan-party.db.bak-<date>`). Saved events and venues from older versions load with sensible defaults for anything added since, and exports from older versions can still be imported. To go back to an older release, restore one of those backup files.

Build a multi-architecture image yourself:

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
pnpm typecheck      # all packages
pnpm build          # web build and server typecheck
pnpm test           # unit tests: shared logic, API, database upgrades, editor state
pnpm e2e            # builds the web app, then Playwright end to end tests
```

Playwright needs Chromium and its system libraries once: `pnpm exec playwright install --with-deps chromium`. `pnpm e2e` always rebuilds the web app first, because the tests run against the built files.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests, on pushes to `master` and on tags starting with `v`:

1. **Typecheck, build and unit tests.**
2. **End to end tests** with Playwright (traces are kept as an artifact when a test fails).
3. **Docker image:** built after both pass. Pull requests only check that it builds (amd64). Pushes to `master` publish `ghcr.io/<owner>/<repo>:latest` plus a `sha-` tag, and a tag like `v1.2.0` publishes `1.2.0` and `1.2`, all for amd64 and arm64.

The first publish creates the package as private. To let others pull it, open the package page on GitHub, go to Package settings and change the visibility to public.

Layout:

- `packages/shared`: Zod schemas and the pure logic (power load, cable lengths, auto-wire, seat layout). Test-first.
- `apps/server`: Hono API, SQLite through Drizzle (migrations in `apps/server/drizzle`, run on startup). In production it also serves the built web app.
- `apps/web`: React, Vite, react-konva canvas, Zustand.

Each venue and event is stored as one validated JSON document, so autosave, snapshots and export all use the same format (`EventBundle` in `packages/shared/src/bundle.ts`). Guest attendance (RSVP, seat, per-event devices) lives inside the event document so a snapshot restore brings back who sat where.
