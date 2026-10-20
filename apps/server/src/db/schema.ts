import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const venues = sqliteTable("venues", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  doc: text("doc", { mode: "json" }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  venueId: text("venue_id")
    .notNull()
    .references(() => venues.id),
  name: text("name").notNull(),
  date: text("date"),
  doc: text("doc", { mode: "json" }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const people = sqliteTable("people", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  handle: text("handle").notNull().default(""),
  devices: text("devices", { mode: "json" }).notNull(),
  needsEthernet: integer("needs_ethernet", { mode: "boolean" }).notNull().default(true),
  notes: text("notes").notNull().default(""),
});

export const deviceProfiles = sqliteTable("device_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  typicalW: real("typical_w").notNull(),
  peakW: real("peak_w").notNull(),
  ports: integer("ports").notNull().default(0),
});

export const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  blob: text("blob", { mode: "json" }).notNull(),
});
