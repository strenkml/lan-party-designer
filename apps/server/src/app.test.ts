import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { openDb } from "./db";

let app: ReturnType<typeof createApp>;

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "lpd-"));
  app = createApp(openDb(":memory:"), dir);
});

async function makeEvent() {
  const venue = (await call("POST", "/api/venues", { name: "Basement" })).body;
  const event = (await call("POST", "/api/events", { name: "Fall LAN", venueId: venue.id })).body;
  return { venue, event };
}

describe("api", () => {
  it("seeds the device profile catalog on first run", async () => {
    const { body } = await call("GET", "/api/profiles");
    expect(body.length).toBeGreaterThan(5);
  });

  it("saves and reloads an event document", async () => {
    const { event } = await makeEvent();
    const doc = { ...event.doc, tables: [{ id: "t1", x: 1, y: 2, width: 6, depth: 2.5, seats: 2 }] };
    expect((await call("PUT", `/api/events/${event.id}`, { doc })).status).toBe(200);
    const loaded = (await call("GET", `/api/events/${event.id}`)).body;
    expect(loaded.doc.tables[0].id).toBe("t1");
  });

  it("rejects an invalid document", async () => {
    const { event } = await makeEvent();
    const res = await call("PUT", `/api/events/${event.id}`, { doc: { tables: [{ id: "t1" }] } });
    expect(res.status).toBe(400);
  });

  it("clones a layout but not the guest list", async () => {
    const { venue, event } = await makeEvent();
    const doc = {
      ...event.doc,
      tables: [{ id: "t1", x: 1, y: 2, width: 6, depth: 2.5, seats: 2 }],
      attendance: [{ personId: "p1", rsvp: "confirmed", seatId: null }],
    };
    await call("PUT", `/api/events/${event.id}`, { doc });
    const copy = (await call("POST", "/api/events", { name: "Spring", venueId: venue.id, cloneFrom: event.id })).body;
    expect(copy.doc.tables).toHaveLength(1);
    expect(copy.doc.attendance).toEqual([]);
  });

  it("round-trips through export and import", async () => {
    const { event } = await makeEvent();
    const exported = (await call("GET", `/api/events/${event.id}/export`)).body;
    expect(exported.version).toBe(1);
    const imported = await call("POST", "/api/import", exported);
    expect(imported.status).toBe(201);
    expect((await call("GET", "/api/events")).body).toHaveLength(2);
  });

  it("restores a snapshot and keeps a before-restore snapshot", async () => {
    const { event } = await makeEvent();
    const snap = (await call("POST", `/api/events/${event.id}/snapshots`, { name: "Empty" })).body;
    const doc = { ...event.doc, tables: [{ id: "t1", x: 0, y: 0, width: 6, depth: 2.5, seats: 2 }] };
    await call("PUT", `/api/events/${event.id}`, { doc });

    expect((await call("POST", `/api/snapshots/${snap.id}/restore`)).status).toBe(200);

    expect((await call("GET", `/api/events/${event.id}`)).body.doc.tables).toEqual([]);
    const names = (await call("GET", `/api/events/${event.id}/snapshots`)).body.map((s: any) => s.name);
    expect(names).toContain("Before restore");
    // the safety copy still has the table we just replaced
    const before = (await call("GET", `/api/events/${event.id}/snapshots`)).body.find((s: any) => s.name === "Before restore");
    const restored = await call("POST", `/api/snapshots/${before.id}/restore`);
    expect(restored.status).toBe(200);
    expect((await call("GET", `/api/events/${event.id}`)).body.doc.tables).toHaveLength(1);
  });

  it("refuses to delete a venue that still has events", async () => {
    const { venue } = await makeEvent();
    expect((await call("DELETE", `/api/venues/${venue.id}`)).status).toBe(409);
  });

  it("manages the people directory", async () => {
    const created = (await call("POST", "/api/people", { name: "Ann", devices: [{ profileId: "pc-high" }] })).body;
    expect(created.id).toBeTruthy();
    await call("PUT", `/api/people/${created.id}`, { name: "Ann B", devices: [] });
    expect((await call("GET", "/api/people")).body[0].name).toBe("Ann B");
  });

  it("saves, lists, renames and deletes custom table and strip presets", async () => {
    const table = await call("POST", "/api/presets", {
      kind: "table",
      name: "Kitchen island",
      spec: { shape: "rect", width: 7, depth: 3, seats: 3, seatSides: "far" },
    });
    expect(table.status).toBe(201);
    const strip = (await call("POST", "/api/presets", { kind: "strip", name: "Orange cube", spec: { sockets: 3, amps: 10 } })).body;
    const list = (await call("GET", "/api/presets")).body;
    expect(list.map((p: any) => p.name).sort()).toEqual(["Kitchen island", "Orange cube"]);
    expect(list.find((p: any) => p.name === "Kitchen island").spec.seatWidthIn).toBe(36);

    await call("PUT", `/api/presets/${strip.id}`, { kind: "strip", name: "Orange cube v2", spec: { sockets: 4, amps: 10 } });
    expect((await call("GET", "/api/presets")).body.some((p: any) => p.name === "Orange cube v2")).toBe(true);

    await call("DELETE", `/api/presets/${table.body.id}`);
    expect((await call("GET", "/api/presets")).body).toHaveLength(1);
  });

  it("rejects a preset whose spec does not match its kind", async () => {
    const res = await call("POST", "/api/presets", { kind: "strip", name: "Bad", spec: { width: 3 } });
    expect(res.status).toBe(400);
  });

  it("carries presets through export and import", async () => {
    const { event } = await makeEvent();
    await call("POST", "/api/presets", { kind: "strip", name: "Long bar", spec: { sockets: 10, amps: 15 } });
    const exported = (await call("GET", `/api/events/${event.id}/export`)).body;
    expect(exported.presets).toHaveLength(1);
    expect((await call("POST", "/api/import", exported)).status).toBe(201);
  });
});

