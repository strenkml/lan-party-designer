import {
  DeviceProfile,
  EventBundle,
  EventDoc,
  Person,
  VenueDoc,
  type EventBundle as EventBundleT,
} from "@lpd/shared";
import { eq, desc } from "drizzle-orm";
import { Hono } from "hono";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { z } from "zod";
import type { Db } from "./db";
import { deviceProfiles, events, people, snapshots, venues } from "./db/schema";

const now = () => Date.now();
const newId = () => crypto.randomUUID();

const NameBody = z.object({ name: z.string().min(1) });
const VenueUpdate = z.object({ name: z.string().min(1).optional(), doc: VenueDoc.optional() });
const EventCreate = z.object({
  name: z.string().min(1),
  venueId: z.string().min(1),
  date: z.string().nullable().optional(),
  /** Copy the layout from this event. */
  cloneFrom: z.string().optional(),
});
const EventUpdate = z.object({
  name: z.string().min(1).optional(),
  date: z.string().nullable().optional(),
  venueId: z.string().min(1).optional(),
  doc: EventDoc.optional(),
});
const PersonBody = Person.omit({ id: true });
const ProfileBody = DeviceProfile.omit({ id: true });

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export function createApp(db: Db, dataDir: string) {
  const uploadDir = join(dataDir, "uploads");
  mkdirSync(uploadDir, { recursive: true });
  const app = new Hono();

  const bad = (c: { json: (b: unknown, s: 400) => Response }, error: z.ZodError) =>
    c.json({ error: z.prettifyError(error) }, 400);

  app.get("/api/health", (c) => c.json({ ok: true }));

  // ----- venues -----
  app.get("/api/venues", (c) =>
    c.json(db.select({ id: venues.id, name: venues.name, updatedAt: venues.updatedAt }).from(venues).orderBy(desc(venues.updatedAt)).all()),
  );
  app.post("/api/venues", async (c) => {
    const body = NameBody.safeParse(await c.req.json());
    if (!body.success) return bad(c, body.error);
    const row = { id: newId(), name: body.data.name, doc: VenueDoc.parse({}), createdAt: now(), updatedAt: now() };
    db.insert(venues).values(row).run();
    return c.json(row, 201);
  });
  app.get("/api/venues/:id", (c) => {
    const row = db.select().from(venues).where(eq(venues.id, c.req.param("id"))).get();
    return row ? c.json(row) : c.json({ error: "not found" }, 404);
  });
  app.put("/api/venues/:id", async (c) => {
    const body = VenueUpdate.safeParse(await c.req.json());
    if (!body.success) return bad(c, body.error);
    const res = db.update(venues).set({ ...body.data, updatedAt: now() }).where(eq(venues.id, c.req.param("id"))).run();
    return res.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });
  app.delete("/api/venues/:id", (c) => {
    const id = c.req.param("id");
    if (db.select().from(events).where(eq(events.venueId, id)).limit(1).get()) {
      return c.json({ error: "venue still has events" }, 409);
    }
    db.delete(venues).where(eq(venues.id, id)).run();
    return c.json({ ok: true });
  });

  // ----- background images -----
  app.post("/api/venues/:id/background", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
    const ext = extname(file.name).toLowerCase();
    if (!IMAGE_TYPES[ext]) return c.json({ error: "unsupported image type" }, 400);
    const name = `${newId()}${ext}`;
    writeFileSync(join(uploadDir, name), Buffer.from(await file.arrayBuffer()));
    return c.json({ file: name }, 201);
  });
  app.get("/api/uploads/:file", (c) => {
    const name = c.req.param("file");
    const type = IMAGE_TYPES[extname(name).toLowerCase()];
    const path = join(uploadDir, name);
    if (!type || name.includes("/") || name.includes("..") || !existsSync(path)) {
      return c.json({ error: "not found" }, 404);
    }
    return new Response(readFileSync(path), { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
  });

  // ----- events -----
  app.get("/api/events", (c) =>
    c.json(
      db
        .select({ id: events.id, name: events.name, date: events.date, venueId: events.venueId, updatedAt: events.updatedAt })
        .from(events)
        .orderBy(desc(events.updatedAt))
        .all(),
    ),
  );
  app.post("/api/events", async (c) => {
    const body = EventCreate.safeParse(await c.req.json());
    if (!body.success) return bad(c, body.error);
    if (!db.select().from(venues).where(eq(venues.id, body.data.venueId)).get()) {
      return c.json({ error: "venue not found" }, 404);
    }
    let doc = EventDoc.parse({});
    if (body.data.cloneFrom) {
      const source = db.select().from(events).where(eq(events.id, body.data.cloneFrom)).get();
      if (!source) return c.json({ error: "source event not found" }, 404);
      // Keep the physical layout, drop who sits where and setup progress.
      const src = EventDoc.parse(source.doc);
      doc = {
        ...src,
        attendance: [],
        checklist: {},
        seats: src.seats.map((s) => ({ ...s })),
      };
    }
    const row = {
      id: newId(),
      venueId: body.data.venueId,
      name: body.data.name,
      date: body.data.date ?? null,
      doc,
      createdAt: now(),
      updatedAt: now(),
    };
    db.insert(events).values(row).run();
    return c.json(row, 201);
  });
  app.get("/api/events/:id", (c) => {
    const row = db.select().from(events).where(eq(events.id, c.req.param("id"))).get();
    return row ? c.json(row) : c.json({ error: "not found" }, 404);
  });
  app.put("/api/events/:id", async (c) => {
    const body = EventUpdate.safeParse(await c.req.json());
    if (!body.success) return bad(c, body.error);
    const res = db.update(events).set({ ...body.data, updatedAt: now() }).where(eq(events.id, c.req.param("id"))).run();
    return res.changes ? c.json({ ok: true, updatedAt: now() }) : c.json({ error: "not found" }, 404);
  });
  app.delete("/api/events/:id", (c) => {
    db.delete(events).where(eq(events.id, c.req.param("id"))).run();
    return c.json({ ok: true });
  });

  // ----- export / import -----
  const buildBundle = (eventId: string): EventBundleT | null => {
    const ev = db.select().from(events).where(eq(events.id, eventId)).get();
    if (!ev) return null;
    const venue = db.select().from(venues).where(eq(venues.id, ev.venueId)).get();
    if (!venue) return null;
    return EventBundle.parse({
      version: 1,
      event: { name: ev.name, date: ev.date, doc: ev.doc },
      venue: { name: venue.name, doc: venue.doc },
      people: db.select().from(people).all(),
      profiles: db.select().from(deviceProfiles).all(),
    });
  };
  app.get("/api/events/:id/export", (c) => {
    const bundle = buildBundle(c.req.param("id"));
    return bundle ? c.json(bundle) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/import", async (c) => {
    const body = EventBundle.safeParse(await c.req.json());
    if (!body.success) return bad(c, body.error);
    const b = body.data;
    const venueId = newId();
    const eventId = newId();
    db.transaction((tx) => {
      tx.insert(venues).values({ id: venueId, name: b.venue.name, doc: b.venue.doc, createdAt: now(), updatedAt: now() }).run();
      tx.insert(events).values({ id: eventId, venueId, name: b.event.name, date: b.event.date, doc: b.event.doc, createdAt: now(), updatedAt: now() }).run();
      for (const p of b.people) tx.insert(people).values(p).onConflictDoNothing().run();
      for (const p of b.profiles) tx.insert(deviceProfiles).values(p).onConflictDoNothing().run();
    });
    return c.json({ eventId, venueId }, 201);
  });

  // ----- snapshots -----
  const saveSnapshot = (eventId: string, name: string) => {
    const bundle = buildBundle(eventId);
    if (!bundle) return null;
    const row = { id: newId(), eventId, name, createdAt: now(), blob: bundle };
    db.insert(snapshots).values(row).run();
    return { id: row.id, name, createdAt: row.createdAt };
  };
  app.get("/api/events/:id/snapshots", (c) =>
    c.json(
      db
        .select({ id: snapshots.id, name: snapshots.name, createdAt: snapshots.createdAt })
        .from(snapshots)
        .where(eq(snapshots.eventId, c.req.param("id")))
        .orderBy(desc(snapshots.createdAt))
        .all(),
    ),
  );
  app.post("/api/events/:id/snapshots", async (c) => {
    const body = NameBody.safeParse(await c.req.json());
    if (!body.success) return bad(c, body.error);
    const snap = saveSnapshot(c.req.param("id"), body.data.name);
    return snap ? c.json(snap, 201) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/snapshots/:id/restore", (c) => {
    const snap = db.select().from(snapshots).where(eq(snapshots.id, c.req.param("id"))).get();
    if (!snap) return c.json({ error: "not found" }, 404);
    const blob = EventBundle.parse(snap.blob);
    // Restoring can never lose work: capture the current state first.
    saveSnapshot(snap.eventId, "Before restore");
    db.update(events)
      .set({ name: blob.event.name, date: blob.event.date, doc: blob.event.doc, updatedAt: now() })
      .where(eq(events.id, snap.eventId))
      .run();
    return c.json({ ok: true });
  });
  app.delete("/api/snapshots/:id", (c) => {
    db.delete(snapshots).where(eq(snapshots.id, c.req.param("id"))).run();
    return c.json({ ok: true });
  });

  // ----- people -----
  app.get("/api/people", (c) => c.json(db.select().from(people).all()));
  app.post("/api/people", async (c) => {
    const body = PersonBody.safeParse(await c.req.json());
    if (!body.success) return bad(c, body.error);
    const row = { id: newId(), ...body.data };
    db.insert(people).values(row).run();
    return c.json(row, 201);
  });
  app.put("/api/people/:id", async (c) => {
    const body = PersonBody.safeParse(await c.req.json());
    if (!body.success) return bad(c, body.error);
    const res = db.update(people).set(body.data).where(eq(people.id, c.req.param("id"))).run();
    return res.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });
  app.delete("/api/people/:id", (c) => {
    db.delete(people).where(eq(people.id, c.req.param("id"))).run();
    return c.json({ ok: true });
  });

  // ----- device profiles -----
  app.get("/api/profiles", (c) => c.json(db.select().from(deviceProfiles).all()));
  app.post("/api/profiles", async (c) => {
    const body = ProfileBody.safeParse(await c.req.json());
    if (!body.success) return bad(c, body.error);
    const row = { id: newId(), ...body.data };
    db.insert(deviceProfiles).values(row).run();
    return c.json(row, 201);
  });
  app.put("/api/profiles/:id", async (c) => {
    const body = ProfileBody.safeParse(await c.req.json());
    if (!body.success) return bad(c, body.error);
    const res = db.update(deviceProfiles).set(body.data).where(eq(deviceProfiles.id, c.req.param("id"))).run();
    return res.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });
  app.delete("/api/profiles/:id", (c) => {
    db.delete(deviceProfiles).where(eq(deviceProfiles.id, c.req.param("id"))).run();
    return c.json({ ok: true });
  });

  return app;
}
