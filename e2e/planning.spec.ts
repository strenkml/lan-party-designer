import { expect, test, type APIRequestContext } from "@playwright/test";

async function seed(request: APIRequestContext) {
  const venue = await (await request.post("/api/venues", { data: { name: "Basement" } })).json();
  await request.put(`/api/venues/${venue.id}`, {
    data: {
      doc: {
        room: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }],
        circuits: [{ id: "cb1", label: "Kitchen breaker", amps: 15 }],
        outlets: [{ id: "o1", label: "North wall", x: 1, y: 1, circuitId: "cb1", amps: 15 }],
      },
    },
  });
  const event = await (await request.post("/api/events", { data: { name: "Fall LAN", venueId: venue.id } })).json();
  await request.put(`/api/events/${event.id}`, {
    data: {
      doc: {
        tables: [{ id: "t1", label: "Table 1", x: 12, y: 8, width: 6, depth: 2.5, seats: 2 }],
        seats: ["a0", "a1", "b0", "b1"].map((s, i) => ({ id: `t1-${s}`, tableId: "t1", x: 10 + i, y: 6, stripId: "st1" })),
        strips: [{ id: "st1", label: "Strip 1", x: 3, y: 3, sockets: 12, amps: 15, pluggedInto: { kind: "outlet", id: "o1" } }],
      },
    },
  });
  return { venue, event };
}

const person = (request: APIRequestContext, name: string, devices: string[]) =>
  request.post("/api/people", { data: { name, handle: "", devices: devices.map((profileId) => ({ profileId })), needsEthernet: false, notes: "" } });

test("create a venue and an event from the home page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New venue" }).click();
  await page.getByLabel("Name").fill("Garage");
  await page.getByRole("button", { name: "Create venue" }).click();
  await expect(page.getByLabel("Venue name")).toHaveValue("Garage");
  await expect(page.locator("canvas").first()).toBeVisible();

  await page.getByRole("link", { name: /LAN Party/ }).click();
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Name").fill("Spring LAN");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByLabel("Event name")).toHaveValue("Spring LAN");
});

test("overloading a breaker shows a red problem on the reports page", async ({ page, request }) => {
  const { event } = await seed(request);
  // 3 high-end PCs peak at 1950 W, over the 1800 W a 15A breaker allows
  for (const n of ["Ann", "Bob", "Cy"]) await person(request, n, ["pc-high"]);

  await page.goto(`/#/event/${event.id}/roster`);
  for (const [i, n] of ["Ann", "Bob", "Cy"].entries()) {
    await page.getByLabel("Add from people").selectOption({ label: n });
    await page.getByRole("button", { name: "Add to event" }).click();
    await page.getByLabel(`RSVP for ${n}`).selectOption("confirmed");
    await page.getByLabel(`Seat for ${n}`).selectOption(`t1-${["a0", "a1", "b0"][i]}`);
  }

  await page.goto(`/#/event/${event.id}/reports`);
  await expect(page.getByText("Overloaded").first()).toBeVisible();
  await expect(page.getByText("Problem").first()).toBeVisible();
  await expect(page.getByText(/Kitchen breaker \(breaker\) peaks at/)).toBeVisible();

  // switching to confirmed only does not change anything here, but declining one guest clears it
  await page.goto(`/#/event/${event.id}/roster`);
  await page.getByLabel("RSVP for Cy").selectOption("declined");
  await page.goto(`/#/event/${event.id}/reports`);
  await expect(page.getByText(/Kitchen breaker \(breaker\) peaks at/)).toHaveCount(0);
});

test("restoring a snapshot brings back the saved plan and keeps a safety copy", async ({ page, request }) => {
  const { event } = await seed(request);
  await page.goto(`/#/event/${event.id}/plan`);
  await page.getByRole("button", { name: "Snapshots" }).click();
  await page.getByLabel("Snapshot name").fill("Before changes");
  await page.getByRole("button", { name: "Save snapshot" }).click();
  await expect(page.getByText("Before changes")).toBeVisible();
  await page.keyboard.press("Escape");

  // change the plan on the server, as an autosave would
  await request.put(`/api/events/${event.id}`, { data: { doc: { tables: [], seats: [], strips: [] } } });
  await page.reload();
  await page.getByRole("button", { name: "Snapshots" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Restore" }).first().click();
  await page.waitForLoadState("load");

  const restored = await (await request.get(`/api/events/${event.id}`)).json();
  expect(restored.doc.tables).toHaveLength(1);
  const snaps = await (await request.get(`/api/events/${event.id}/snapshots`)).json();
  expect(snaps.map((s: { name: string }) => s.name)).toContain("Before restore");
});

test("narrow screens get a read-only seat lookup", async ({ page, request }) => {
  const { event } = await seed(request);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/#/event/${event.id}/plan`);
  await expect(page.getByText("Editing the plan needs a larger screen.")).toBeVisible();
  await expect(page.getByLabel("Seat map")).toBeVisible();
});

test("placing items on the canvas autosaves, and undo takes them back", async ({ page, request }) => {
  const { event } = await seed(request);
  await request.put(`/api/events/${event.id}`, { data: { doc: {} } });
  await page.goto(`/#/event/${event.id}/plan`);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.width * fx, y: box.height * fy });

  await page.getByRole("button", { name: "Table", exact: true }).click();
  await canvas.click({ position: at(0.5, 0.5) });
  await page.getByRole("button", { name: "Strip", exact: true }).click();
  await canvas.click({ position: at(0.3, 0.5) });
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await canvas.click({ position: at(0.5, 0.2) });

  await expect.poll(async () => {
    const doc = (await (await request.get(`/api/events/${event.id}`)).json()).doc;
    return [doc.tables.length, doc.seats.length, doc.strips.length, doc.devices.length];
  }).toEqual([1, 4, 1, 1]);

  // the new table is selected after placing; undo removes the last placement first
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await (await request.get(`/api/events/${event.id}`)).json()).doc.devices.length).toBe(0);
});

test("auto-wire assigns seats to a strip and a switch port", async ({ page, request }) => {
  const { event } = await seed(request);
  const person = await (await request.post("/api/people", { data: { name: "Ann", handle: "", devices: [{ profileId: "pc-mid" }], needsEthernet: true, notes: "" } })).json();
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    tables: [{ id: "t1", label: "Table 1", x: 12, y: 8, width: 6, depth: 2.5, seats: 1 }],
    seats: [{ id: "t1-a0", tableId: "t1", x: 12, y: 6 }],
    strips: [{ id: "st1", label: "Strip 1", x: 3, y: 3, sockets: 6, amps: 15, pluggedInto: { kind: "outlet", id: "o1" } }],
    devices: [{ id: "sw1", label: "Switch 1", profileId: "switch-16", x: 10, y: 3 }],
    attendance: [{ personId: person.id, rsvp: "confirmed", seatId: "t1-a0" }],
  } } });
  await page.goto(`/#/event/${event.id}/plan`);
  await page.getByRole("button", { name: "Auto-wire seats" }).click();
  await expect.poll(async () => {
    const seat = (await (await request.get(`/api/events/${event.id}`)).json()).doc.seats[0];
    return [seat.stripId, seat.netDeviceId, seat.netPort];
  }).toEqual(["st1", "sw1", 0]);
});

test("setup day checklist tracks progress per seat", async ({ page, request }) => {
  const { event } = await seed(request);
  const person = await (await request.post("/api/people", { data: { name: "Ann", handle: "", devices: [], needsEthernet: false, notes: "" } })).json();
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    tables: [{ id: "t1", label: "Table 1", x: 12, y: 8, width: 6, depth: 2.5, seats: 1 }],
    seats: [{ id: "t1-a0", tableId: "t1", x: 12, y: 6, stripId: "st1" }],
    strips: [{ id: "st1", label: "Strip 1", x: 3, y: 3, pluggedInto: { kind: "outlet", id: "o1" } }],
    attendance: [{ personId: person.id, rsvp: "confirmed", seatId: "t1-a0" }],
  } } });
  await page.goto(`/#/event/${event.id}/setup`);
  await expect(page.getByText("0% ready")).toBeVisible();
  await page.getByLabel("Power connected at Table 1 A1").check();
  await page.getByLabel("Tested at Table 1 A1").check();
  await expect(page.getByText("100% ready")).toBeVisible();
});

test.describe("venue editor placement", () => {
  async function openVenue(page: import("@playwright/test").Page, request: APIRequestContext) {
    const venue = await (await request.post("/api/venues", { data: { name: "Den" } })).json();
    await page.goto(`/#/venue/${venue.id}`);
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    return { venue, canvas, at: (fx: number, fy: number) => ({ x: box.width * fx, y: box.height * fy }) };
  }
  const doc = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/venues/${id}`)).json()).doc;

  test("places an outlet and a door by clicking", async ({ page, request }) => {
    const { venue, canvas, at } = await openVenue(page, request);
    await page.getByRole("button", { name: "Outlet", exact: true }).click();
    await canvas.click({ position: at(0.4, 0.4) });
    await page.getByRole("button", { name: "Door", exact: true }).click();
    await canvas.click({ position: at(0.6, 0.5) });
    await expect.poll(async () => {
      const d = await doc(request, venue.id);
      return [d.outlets.length, d.doors.length];
    }).toEqual([1, 1]);
  });

  test("draws a room, then places an outlet on its edge and a door", async ({ page, request }) => {
    const { venue, canvas, at } = await openVenue(page, request);
    await page.getByRole("button", { name: "Room", exact: true }).click();
    for (const [x, y] of [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]] as const) await canvas.click({ position: at(x, y) });
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await doc(request, venue.id)).room.length).toBe(4);

    await page.getByRole("button", { name: "Outlet", exact: true }).click();
    await canvas.click({ position: at(0.5, 0.3) });
    await canvas.click({ position: at(0.5, 0.5) });
    await page.getByRole("button", { name: "Door", exact: true }).click();
    await canvas.click({ position: at(0.3, 0.5) });
    await expect.poll(async () => {
      const d = await doc(request, venue.id);
      return [d.outlets.length, d.doors.length];
    }).toEqual([2, 1]);
  });

  test("places items with slow, human-style mouse input on a drawn room", async ({ page, request }) => {
    const { venue, canvas, at } = await openVenue(page, request);
    const box = (await canvas.boundingBox())!;
    const click = async (fx: number, fy: number) => {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 6 });
      await page.mouse.down();
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.waitForTimeout(450);
    };
    await page.getByRole("button", { name: "Room", exact: true }).click();
    for (const [x, y] of [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]] as const) await click(x, y);
    await click(0.3, 0.3); // close by clicking the first corner
    await expect.poll(async () => (await doc(request, venue.id)).room.length).toBe(4);

    await page.getByRole("button", { name: "Outlet", exact: true }).click();
    await click(0.5, 0.3);
    await click(0.7, 0.5);
    await page.getByRole("button", { name: "Door", exact: true }).click();
    await click(0.3, 0.5);
    await expect.poll(async () => {
      const d = await doc(request, venue.id);
      return [d.outlets.length, d.doors.length];
    }).toEqual([2, 1]);
    void at;
  });

  test("a door and an outlet snap onto the nearest wall", async ({ page, request }) => {
    const { venue, canvas, at } = await openVenue(page, request);
    await request.put(`/api/venues/${venue.id}`, { data: { doc: { room: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }] } } });
    await page.reload();
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(500);
    const b = (await canvas.boundingBox())!;
    void at;
    // room fits the canvas with margin: its top wall sits near 10% of the height, 1 ft below is inside
    await page.getByRole("button", { name: "Door", exact: true }).click();
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.12);
    await page.getByRole("button", { name: "Outlet", exact: true }).click();
    await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.12);
    await expect.poll(async () => {
      const d = await doc(request, venue.id);
      return [d.doors[0]?.y, d.doors[0]?.rotation, d.outlets[0]?.y];
    }).toEqual([0, 0, 0]);
  });

  test("places items on a plain http origin where crypto.randomUUID does not exist", async ({ page, request }) => {
    // Browsers only expose randomUUID on https and localhost. A LAN address like http://10.1.10.25:3000 has none.
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true });
    });
    const { venue, canvas, at } = await openVenue(page, request);
    await page.getByRole("button", { name: "Obstacle", exact: true }).click();
    await canvas.click({ position: at(0.5, 0.5) });
    await page.getByRole("button", { name: "Outlet", exact: true }).click();
    await canvas.click({ position: at(0.3, 0.3) });
    await expect.poll(async () => {
      const d = await doc(request, venue.id);
      return [d.obstacles.length, d.outlets.length];
    }).toEqual([1, 1]);
  });

  test("a door can be flipped to swing the other way and hinge on the other side", async ({ page, request }) => {
    const { venue, canvas } = await openVenue(page, request);
    await request.put(`/api/venues/${venue.id}`, { data: { doc: { room: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }] } } });
    await page.reload();
    await page.waitForTimeout(500);
    const b = (await canvas.boundingBox())!;
    await page.getByRole("button", { name: "Door", exact: true }).click();
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.12);
    await expect(page.getByText("Currently swings into the room, hinged on the left.")).toBeVisible();
    await page.getByRole("button", { name: "Swing out of the room" }).click();
    await page.getByRole("button", { name: "Move hinge to right" }).click();
    await expect(page.getByText("Currently swings out of the room, hinged on the right.")).toBeVisible();
    await expect.poll(async () => {
      const d = (await doc(request, venue.id)).doors[0];
      return [d?.flipSwing, d?.flipHinge];
    }).toEqual([true, true]);
  });

  test("windows and garage doors snap onto walls and can be resized", async ({ page, request }) => {
    const { venue, canvas } = await openVenue(page, request);
    await request.put(`/api/venues/${venue.id}`, { data: { doc: { room: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }] } } });
    await page.reload();
    await page.waitForTimeout(500);
    const b = (await canvas.boundingBox())!;
    await page.getByRole("button", { name: "Window", exact: true }).click();
    await page.mouse.click(b.x + b.width * 0.2, b.y + b.height * 0.12);
    await page.getByRole("button", { name: "Garage", exact: true }).click();
    await page.mouse.click(b.x + b.width * 0.45, b.y + b.height * 0.12);
    await page.getByRole("button", { name: "Double (16 ft)" }).click();
    await expect.poll(async () => {
      const d = await doc(request, venue.id);
      return [d.windows[0]?.y, d.windows[0]?.width, d.garageDoors[0]?.y, d.garageDoors[0]?.width];
    }).toEqual([0, 4, 0, 16]);
  });

  test("a network jack snaps to a wall, and a router can uplink to it for the shopping list", async ({ page, request }) => {
    const { venue, canvas } = await openVenue(page, request);
    await request.put(`/api/venues/${venue.id}`, { data: { doc: { room: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }] } } });
    await page.reload();
    await page.waitForTimeout(500);
    const b = (await canvas.boundingBox())!;
    await page.getByRole("button", { name: "Net jack", exact: true }).click();
    await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.12);
    await page.getByLabel("Label").fill("Router closet jack");
    await expect.poll(async () => {
      const j = (await doc(request, venue.id)).jacks[0];
      return [j?.label, j?.y];
    }).toEqual(["Router closet jack", 0]);

    // now an event in this venue with a router pointed at the jack
    const event = await (await request.post("/api/events", { data: { name: "Jack LAN", venueId: venue.id } })).json();
    await request.put(`/api/events/${event.id}`, { data: { doc: {
      devices: [{ id: "rt", label: "Router", profileId: "router", x: 10, y: 0, jackId: (await doc(request, venue.id)).jacks[0].id }],
    } } });
    await page.goto(`/#/event/${event.id}/reports`);
    await expect(page.getByText(/Ethernet cable, \d+ ft/)).toBeVisible();
    await page.getByText(/Ethernet runs \(1\)/).click();
    await expect(page.getByRole("cell", { name: "Router closet jack" })).toBeVisible();
  });

  test("an outlet has a height off the floor", async ({ page, request }) => {
    const { venue, canvas, at } = await openVenue(page, request);
    await page.getByRole("button", { name: "Outlet", exact: true }).click();
    await canvas.click({ position: at(0.5, 0.5) });
    await expect(page.getByLabel("Height off the floor (in)")).toHaveValue("12");
    await page.getByLabel("Height off the floor (in)").fill("42");
    await expect.poll(async () => (await doc(request, venue.id)).outlets[0]?.heightIn).toBe(42);
  });

  test("an outlet can have more than two plugs", async ({ page, request }) => {
    const { venue, canvas, at } = await openVenue(page, request);
    await page.getByRole("button", { name: "Outlet", exact: true }).click();
    await canvas.click({ position: at(0.5, 0.5) });
    await expect(page.getByLabel("Plugs")).toHaveValue("2");
    await page.getByLabel("Plugs").fill("4");
    await expect.poll(async () => (await doc(request, venue.id)).outlets[0]?.sockets).toBe(4);
  });
});

test("plugging more strips into an outlet than it has plugs raises a problem", async ({ page, request }) => {
  const { venue, event } = await seed(request);
  await request.put(`/api/venues/${venue.id}`, { data: { doc: {
    circuits: [{ id: "cb1", label: "Kitchen breaker", amps: 15 }],
    outlets: [{ id: "o1", label: "North wall", x: 1, y: 1, circuitId: "cb1", amps: 15, sockets: 1 }],
  } } });
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    strips: [
      { id: "st1", label: "Strip 1", x: 3, y: 3, pluggedInto: { kind: "outlet", id: "o1" } },
      { id: "st2", label: "Strip 2", x: 5, y: 3, pluggedInto: { kind: "outlet", id: "o1" } },
    ],
  } } });
  await page.goto(`/#/event/${event.id}/reports`);
  await expect(page.getByText("North wall (outlet) needs 2 sockets but has 1")).toBeVisible();
});

test("a table can seat one side only", async ({ page, request }) => {
  const { event } = await seed(request);
  await page.goto(`/#/event/${event.id}/plan`);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await expect(page.getByLabel("Seats on")).toHaveValue("both");
  await page.getByLabel("Seats on").selectOption("far");
  await expect.poll(async () => {
    const doc = (await (await request.get(`/api/events/${event.id}`)).json()).doc;
    const added = doc.tables.find((t: { id: string }) => t.id !== "t1");
    return [added?.seatSides, doc.seats.filter((s: { tableId: string }) => s.tableId === added?.id).length];
  }).toEqual(["far", 2]);
});

test("auto-wire also wires seats that have no guest", async ({ page, request }) => {
  const { event } = await seed(request);
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    tables: [{ id: "t1", label: "Table 1", x: 12, y: 8, width: 6, depth: 2.5, seats: 1 }],
    seats: [{ id: "t1-a0", tableId: "t1", x: 12, y: 6 }],
    strips: [{ id: "st1", label: "Strip 1", x: 3, y: 3, sockets: 6, amps: 15, pluggedInto: { kind: "outlet", id: "o1" } }],
    devices: [{ id: "sw1", label: "Switch 1", profileId: "switch-16", x: 10, y: 3 }],
  } } });
  await page.goto(`/#/event/${event.id}/plan`);
  await page.getByRole("button", { name: "Auto-wire seats" }).click();
  await expect.poll(async () => {
    const seat = (await (await request.get(`/api/events/${event.id}`)).json()).doc.seats[0];
    return [seat.stripId, seat.netDeviceId, seat.netPort];
  }).toEqual(["st1", "sw1", 0]);
});

test("a custom table and strip can be saved, placed by name and managed", async ({ page, request }) => {
  const { event } = await seed(request);
  await request.post("/api/presets", { data: { kind: "table", name: "Kitchen island", spec: { shape: "rect", width: 7, depth: 3, seats: 3, seatSides: "far" } } });
  await request.post("/api/presets", { data: { kind: "strip", name: "Orange cube", spec: { sockets: 3, amps: 10 } } });
  await request.put(`/api/events/${event.id}`, { data: { doc: {} } });
  await page.goto(`/#/event/${event.id}/plan`);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;

  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByLabel("Table to place").selectOption({ label: "Kitchen island" });
  await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await page.getByRole("button", { name: "Strip", exact: true }).click();
  await page.getByLabel("Power strip to place").selectOption({ label: "Orange cube" });
  await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });

  await expect.poll(async () => {
    const doc = (await (await request.get(`/api/events/${event.id}`)).json()).doc;
    return [doc.tables[0]?.label, doc.tables[0]?.seats, doc.seats.length, doc.strips[0]?.label, doc.strips[0]?.sockets, doc.strips[0]?.amps];
  }).toEqual(["Kitchen island", 3, 3, "Orange cube", 3, 10]);

  // save the placed strip under a new name, then see it listed on the People & devices page
  await page.getByRole("button", { name: "Save as a custom strip…" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Orange cube mk2");
  await page.getByRole("button", { name: "Save strip" }).click();
  await page.getByRole("link", { name: "People & devices" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Orange cube mk2" });
  await expect(row).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
});

test("power strips and switches can be rotated", async ({ page, request }) => {
  const { event } = await seed(request);
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    strips: [{ id: "st1", label: "Strip 1", x: 12, y: 8, pluggedInto: { kind: "outlet", id: "o1" } }],
    devices: [{ id: "sw1", label: "Switch 1", profileId: "switch-16", x: 16, y: 8 }],
  } } });
  await page.goto(`/#/event/${event.id}/plan`);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(500);
  const box = (await canvas.boundingBox())!;
  // click the strip, then the switch; the fit puts the 24 x 16 ft room in the left part of the canvas
  const ft = (x: number, y: number) => ({ x: box.width * (0.078 + (x / 24) * 0.625), y: box.height * (0.1 + (y / 16) * 0.5) });
  await canvas.click({ position: ft(12, 8) });
  await page.getByRole("button", { name: "Rotate 90°" }).click();
  await expect.poll(async () => (await (await request.get(`/api/events/${event.id}`)).json()).doc.strips[0].rotation).toBe(90);
  await canvas.click({ position: ft(16, 8) });
  await page.getByRole("button", { name: "Rotate 90°" }).click();
  await page.getByRole("button", { name: "Rotate 90°" }).click();
  await expect.poll(async () => (await (await request.get(`/api/events/${event.id}`)).json()).doc.devices[0].rotation).toBe(180);
});

test("a cable can be selected and routed around the room with bends", async ({ page, request }) => {
  const { event } = await seed(request);
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    tables: [{ id: "t1", label: "Table 1", x: 8, y: 9, width: 6, depth: 2.5, seats: 1 }],
    seats: [{ id: "t1-a0", tableId: "t1", x: 12, y: 6, netDeviceId: "sw1", netPort: 0 }],
    devices: [{ id: "sw1", label: "Switch 1", profileId: "switch-16", x: 4, y: 6 }],
  } } });
  await page.goto(`/#/event/${event.id}/plan`);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(900);
  const box = (await canvas.boundingBox())!;
  const ft = (x: number, y: number) => ({ x: box.width * (0.078 + (x / 24) * 0.625), y: box.height * (0.1035 + (y / 16) * 0.502) });
  const routes = async () => (await (await request.get(`/api/events/${event.id}`)).json()).doc.routes;

  await canvas.click({ position: ft(8, 6) }); // on the straight cable between the seat and the switch
  await expect(page.getByRole("heading", { name: "Ethernet cable" })).toBeVisible();
  await expect(page.getByText("Straight across the floor.")).toBeVisible();
  await page.getByRole("button", { name: "Add a bend" }).click();
  await expect.poll(async () => (await routes())["eth:t1-a0"]?.length).toBe(1);
  await expect(page.getByText("1 bend.")).toBeVisible();

  await page.getByRole("button", { name: "Clear route" }).click();
  await expect.poll(async () => Object.keys(await routes())).toEqual([]);
});

test("zones can be placed and a table in a walkway raises a warning", async ({ page, request }) => {
  const { event } = await seed(request);
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    tables: [{ id: "t1", label: "Table 1", x: 12, y: 8, width: 6, depth: 2.5, seats: 1 }],
    seats: [{ id: "t1-a0", tableId: "t1", x: 12, y: 6 }],
  } } });
  await page.goto(`/#/event/${event.id}/plan`);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(900);
  const box = (await canvas.boundingBox())!;
  const ft = (x: number, y: number) => ({ x: box.width * (0.078 + (x / 24) * 0.625), y: box.height * (0.1035 + (y / 16) * 0.502) });

  await page.getByRole("button", { name: "Zone", exact: true }).click();
  await page.getByLabel("Kind of zone").selectOption("walkway");
  await canvas.click({ position: ft(12, 8) }); // lands on the table
  await expect.poll(async () => (await (await request.get(`/api/events/${event.id}`)).json()).doc.zones.map((z: { kind: string }) => z.kind)).toEqual(["walkway"]);
  await expect(page.getByText("Table 1 is in the way of Walkway")).toBeVisible();

  await page.getByLabel("Kind").selectOption("food");
  await expect(page.getByText("is in the way of")).toHaveCount(0);
  await expect.poll(async () => (await (await request.get(`/api/events/${event.id}`)).json()).doc.zones[0].kind).toBe("food");
});

test("dragging a table snaps it flush against another table", async ({ page, request }) => {
  const { event } = await seed(request);
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    tables: [
      { id: "ta", label: "A", x: 8, y: 9, width: 6, depth: 2.5, seats: 1, seatSides: "far" },
      { id: "tb", label: "B", x: 18, y: 9, width: 6, depth: 2.5, seats: 1, seatSides: "far" },
    ],
  } } });
  await page.goto(`/#/event/${event.id}/plan`);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(900);
  const box = (await canvas.boundingBox())!;
  const pxPerFt = (box.width * 0.625) / 24;
  const at = (x: number, y: number) => ({ x: box.x + box.width * (0.078 + (x / 24) * 0.625), y: box.y + box.height * (0.1035 + (y / 16) * 0.502) });

  // pick B up in its middle and set it down so its left edge is about 0.3 ft off A's right edge (at x = 11)
  const from = at(18, 9);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 3.7 * pxPerFt, from.y, { steps: 12 });
  await page.mouse.move(from.x - 3.7 * pxPerFt - 0.3 * pxPerFt, from.y, { steps: 3 });
  await page.mouse.up();

  await expect.poll(async () => {
    const t = (await (await request.get(`/api/events/${event.id}`)).json()).doc.tables.find((x: { id: string }) => x.id === "tb");
    return Math.round(t.x * 100) / 100;
  }).toBe(14);
});

test("shift-click objects, group them, and they move together", async ({ page, request }) => {
  const { event } = await seed(request);
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    tables: [{ id: "ta", label: "Pod table", x: 8, y: 9, width: 6, depth: 2.5, seats: 1, seatSides: "far" }],
    seats: [{ id: "ta-a0", tableId: "ta", x: 8, y: 7.4 }],
    strips: [{ id: "st1", label: "Pod strip", x: 15, y: 9, pluggedInto: { kind: "outlet", id: "o1" } }],
  } } });
  await page.goto(`/#/event/${event.id}/plan`);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(900);
  const box = (await canvas.boundingBox())!;
  const pxPerFt = (box.width * 0.625) / 24;
  const ft = (x: number, y: number) => ({ x: box.width * (0.078 + (x / 24) * 0.625), y: box.height * (0.1035 + (y / 16) * 0.502) });
  const doc = async () => (await (await request.get(`/api/events/${event.id}`)).json()).doc;

  await canvas.click({ position: ft(8, 9) });
  await page.keyboard.down("Shift");
  await canvas.click({ position: ft(15, 9) });
  await page.keyboard.up("Shift");
  await expect(page.getByText("2 objects selected")).toBeVisible();
  await page.getByRole("button", { name: "Group these objects" }).click();
  await expect.poll(async () => (await doc()).groups.length).toBe(1);

  // the group is selected when one member is clicked
  await canvas.click({ position: ft(8, 9) });
  await expect(page.getByText("2 objects move together")).toBeVisible();
  await page.getByLabel("Group name").fill("Pod A");

  // drag the table 3 ft to the right; the strip should follow by the same amount
  const from = ft(8, 9);
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + from.x + 3 * pxPerFt, box.y + from.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => {
    const d = await doc();
    return [d.tables[0].x - 8 > 1, d.strips[0].x - 15 === d.tables[0].x - 8, d.seats[0].x - 8 === d.tables[0].x - 8, d.groups[0].label];
  }).toEqual([true, true, true, "Pod A"]);

  await page.getByRole("button", { name: "Ungroup" }).click();
  await expect.poll(async () => (await doc()).groups.length).toBe(0);
});

test("a strip, a switch and an outlet can be fully disconnected, and undo brings it back", async ({ page, request }) => {
  const { event } = await seed(request);
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    seats: [
      { id: "s1", x: 12, y: 6, stripId: "st1", netDeviceId: "sw1", netPort: 0 },
      { id: "s2", x: 14, y: 6, stripId: "st1", netDeviceId: "sw1", netPort: 1 },
    ],
    strips: [{ id: "st1", label: "Strip 1", x: 8, y: 9, pluggedInto: { kind: "outlet", id: "o1" } }],
    devices: [{ id: "sw1", label: "Switch 1", profileId: "switch-16", x: 16, y: 9, pluggedInto: { kind: "strip", id: "st1" } }],
  } } });
  await page.goto(`/#/event/${event.id}/plan`);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(900);
  const box = (await canvas.boundingBox())!;
  const ft = (x: number, y: number) => ({ x: box.width * (0.078 + (x / 24) * 0.625), y: box.height * (0.1035 + (y / 16) * 0.502) });
  const doc = async () => (await (await request.get(`/api/events/${event.id}`)).json()).doc;

  // the switch: two seats and its power plug
  await canvas.click({ position: ft(16, 9) });
  await page.getByRole("button", { name: "Disconnect everything (3)" }).click();
  await expect(page.getByText("Disconnected 3 connections. Press Ctrl+Z to undo.")).toBeVisible();
  await expect.poll(async () => {
    const d = await doc();
    return [d.seats.map((s: { netDeviceId: string | null }) => s.netDeviceId), d.devices[0].pluggedInto];
  }).toEqual([[null, null], null]);
  await expect(page.getByRole("button", { name: "Disconnect everything" })).toBeDisabled();

  // undo restores them
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await doc()).seats.map((s: { netDeviceId: string | null }) => s.netDeviceId)).toEqual(["sw1", "sw1"]);

  // the strip: its outlet plug, two seats and the switch plugged into it
  await canvas.click({ position: ft(8, 9) });
  await page.getByRole("button", { name: /Disconnect everything \(4\)/ }).click();
  await expect.poll(async () => {
    const d = await doc();
    return [d.strips[0].pluggedInto, d.seats.map((s: { stripId: string | null }) => s.stripId), d.devices[0].pluggedInto];
  }).toEqual([null, [null, null], null]);
});

test.describe("right-click menus", () => {
  const eventDoc = {
    tables: [{ id: "ta", label: "Table 1", x: 8, y: 9, width: 6, depth: 2.5, seats: 1, seatSides: "far" }],
    seats: [{ id: "ta-a0", tableId: "ta", x: 8, y: 7.4, stripId: "st1", netDeviceId: "sw1", netPort: 0 }],
    strips: [{ id: "st1", label: "Strip 1", x: 16, y: 9, pluggedInto: { kind: "outlet", id: "o1" } }],
    devices: [{ id: "sw1", label: "Switch 1", profileId: "switch-16", x: 16, y: 12 }],
    attendance: [{ personId: "p-ann", rsvp: "confirmed", seatId: null }],
  };

  async function open(page: import("@playwright/test").Page, request: APIRequestContext) {
    const { event } = await seed(request);
    await request.post("/api/people", { data: { name: "Ann", handle: "", devices: [], needsEthernet: false, notes: "" } });
    const ann = (await (await request.get("/api/people")).json()).find((p: { name: string }) => p.name === "Ann");
    await request.put(`/api/events/${event.id}`, { data: { doc: { ...eventDoc, attendance: [{ personId: ann.id, rsvp: "confirmed", seatId: null }] } } });
    await page.goto(`/#/event/${event.id}/plan`);
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(900);
    const box = (await canvas.boundingBox())!;
    const ft = (x: number, y: number) => ({ x: box.width * (0.078 + (x / 24) * 0.625), y: box.height * (0.1035 + (y / 16) * 0.502) });
    const doc = async () => (await (await request.get(`/api/events/${event.id}`)).json()).doc;
    const right = (x: number, y: number, opts: { modifiers?: ("Shift")[] } = {}) => canvas.click({ position: ft(x, y), button: "right", ...opts });
    return { canvas, ft, doc, right };
  }
  const item = (page: import("@playwright/test").Page, name: string | RegExp) =>
    page.getByRole("menuitem", typeof name === "string" ? { name, exact: true } : { name });

  test("empty floor offers to add things there, and paste", async ({ page, request }) => {
    const { doc, right } = await open(page, request);
    await right(20, 4);
    await expect(page.getByRole("menu")).toBeVisible();
    await item(page, /^Zone:/).click();
    await expect.poll(async () => (await doc()).zones.length).toBe(1);

    await right(4, 14);
    await item(page, /^Table:/).click();
    await expect.poll(async () => (await doc()).tables.length).toBe(2);
    expect((await doc()).tables.at(-1).x).toBeCloseTo(4, 0);

    await right(20, 14);
    await expect(item(page, "Paste")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("a table can be copied, pasted, duplicated, rotated and deleted from its menu", async ({ page, request }) => {
    const { doc, right } = await open(page, request);
    await right(8, 9);
    await item(page, "Rotate 90°").click();
    await expect.poll(async () => (await doc()).tables[0].rotation).toBe(90);

    await right(8, 9);
    await item(page, "Copy").click();
    await right(20, 4);
    await item(page, /^Paste Table 1/).click();
    await expect.poll(async () => (await doc()).tables.map((t: { label: string }) => t.label)).toEqual(["Table 1", "Table 1 copy"]);

    await right(8, 9);
    await item(page, "Duplicate").click();
    await expect.poll(async () => (await doc()).tables.length).toBe(3);

    await right(8, 9);
    await item(page, "Delete").click();
    await expect.poll(async () => (await doc()).tables.length).toBe(2);
  });

  test("a strip and a switch offer to disconnect everything", async ({ page, request }) => {
    const { doc, right } = await open(page, request);
    await right(16, 12);
    await expect(item(page, "Disconnect everything (1)")).toBeVisible(); // the seat on its port
    await item(page, "Disconnect everything (1)").click();
    await expect.poll(async () => (await doc()).seats[0].netDeviceId).toBeNull();

    await right(16, 9);
    await item(page, /Disconnect everything/).click();
    await expect.poll(async () => (await doc()).strips[0].pluggedInto).toBeNull();
  });

  test("a seat offers to seat a waiting guest, with the keyboard", async ({ page, request }) => {
    const { doc, ft, right } = await open(page, request);
    void ft;
    await right(8, 7.4);
    await expect(page.getByRole("menuitem", { name: "Ann" })).toBeVisible();
    await page.keyboard.press("ArrowDown"); // to "Wire to…"
    await page.keyboard.press("ArrowUp"); // and back to the guest
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await doc()).attendance[0].seatId).toBe("ta-a0");
  });

  test("a cable offers to add a bend where you clicked, and to clear the route", async ({ page, request }) => {
    const { doc, right } = await open(page, request);
    // the cable runs from the seat at (8, 7.4) to the switch at (16, 12); its middle is (12, 9.7)
    await right(12, 9.7);
    await item(page, "Add a bend here").click();
    await expect.poll(async () => (await doc()).routes["eth:ta-a0"]?.length).toBe(1);

    // the cable now bends at about (12, 9.5); right-click the second leg, toward the switch
    await right(14, 10.75);
    await expect(item(page, "Clear route")).toBeEnabled();
    await item(page, "Clear route").click();
    await expect.poll(async () => Object.keys((await doc()).routes)).toEqual([]);
  });

  test("shift + right-click leaves the browser's own menu alone", async ({ page, request }) => {
    const { right } = await open(page, request);
    await right(20, 4, { modifiers: ["Shift"] });
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("the venue editor menu adds doors onto walls and flips them", async ({ page, request }) => {
    const venue = await (await request.post("/api/venues", { data: { name: "Menu venue" } })).json();
    await request.put(`/api/venues/${venue.id}`, { data: { doc: { room: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }], circuits: [{ id: "c1", label: "Kitchen", amps: 15 }] } } });
    await page.goto(`/#/venue/${venue.id}`);
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(900);
    const box = (await canvas.boundingBox())!;
    const at = (x: number, y: number) => ({ x: box.width * (0.078 + (x / 24) * 0.625), y: box.height * (0.1035 + (y / 16) * 0.502) });
    const doc = async () => (await (await request.get(`/api/venues/${venue.id}`)).json()).doc;

    await canvas.click({ position: at(8, 0.6), button: "right" });
    await item(page, "Door").click();
    await expect.poll(async () => { const d = (await doc()).doors[0]; return [d?.y, d?.rotation]; }).toEqual([0, 0]);

    await canvas.click({ position: at(8, 0.4), button: "right" }); // on the door
    await item(page, "Swing out of the room").click();
    await expect.poll(async () => (await doc()).doors[0].flipSwing).toBe(true);

    await canvas.click({ position: at(16, 16), button: "right" });
    await item(page, "Outlet").click();
    await expect.poll(async () => (await doc()).outlets.length).toBe(1);
  });

  test("a door, window, garage door, outlet and network jack can be cloned", async ({ page, request }) => {
    const venue = await (await request.post("/api/venues", { data: { name: "Clone venue" } })).json();
    await request.put(`/api/venues/${venue.id}`, { data: { doc: {
      room: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }],
      doors: [{ id: "d1", x: 4, y: 0, width: 3, rotation: 0 }],
      windows: [{ id: "w1", x: 10, y: 0, width: 4, rotation: 0 }],
      garageDoors: [{ id: "g1", x: 16, y: 0, width: 5, rotation: 0 }],
      outlets: [{ id: "o1", x: 0, y: 8, circuitId: null }],
      jacks: [{ id: "j1", x: 24, y: 8, rotation: -90, heightIn: 12 }],
    } } });
    await page.goto(`/#/venue/${venue.id}`);
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(900);
    const box = (await canvas.boundingBox())!;
    const at = (x: number, y: number) => ({ x: box.width * (0.078 + (x / 24) * 0.625), y: box.height * (0.1035 + (y / 16) * 0.502) });
    const doc = async () => (await (await request.get(`/api/venues/${venue.id}`)).json()).doc;

    for (const [x, y, list] of [[4, 0.2, "doors"], [10, 0.2, "windows"], [16, 0.2, "garageDoors"], [0.2, 8, "outlets"], [23.8, 8, "jacks"]] as const) {
      await canvas.click({ position: at(x, y), button: "right" });
      await item(page, "Clone").click();
      await expect.poll(async () => (await doc())[list].length).toBe(2);
    }
  });
});

test("a cable can be deleted with the Delete key, the panel or the right-click menu", async ({ page, request }) => {
  const { event } = await seed(request);
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    seats: [
      { id: "s1", x: 8, y: 7.4, stripId: "st1", netDeviceId: "sw1", netPort: 0 },
      { id: "s2", x: 8, y: 11, netDeviceId: "sw1", netPort: 1 },
    ],
    strips: [{ id: "st1", label: "Strip 1", x: 16, y: 9, pluggedInto: { kind: "outlet", id: "o1" } }],
    devices: [{ id: "sw1", label: "Switch 1", profileId: "switch-16", x: 16, y: 13 }],
  } } });
  await page.goto(`/#/event/${event.id}/plan`);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(900);
  const box = (await canvas.boundingBox())!;
  const ft = (x: number, y: number) => ({ x: box.width * (0.078 + (x / 24) * 0.625), y: box.height * (0.1035 + (y / 16) * 0.502) });
  const doc = async () => (await (await request.get(`/api/events/${event.id}`)).json()).doc;

  // Delete key: select the first ethernet cable (seat 1 to the switch), midpoint (12, 10.2)
  await canvas.click({ position: ft(12, 10.2) });
  await expect(page.getByRole("heading", { name: "Ethernet cable" })).toBeVisible();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await doc()).seats.map((s: { netDeviceId: string | null }) => s.netDeviceId)).toEqual([null, "sw1"]);

  // right-click menu: the second ethernet cable, midpoint (12, 12)
  await canvas.click({ position: ft(12, 12), button: "right" });
  await page.getByRole("menuitem", { name: "Delete cable", exact: true }).click();
  await expect.poll(async () => (await doc()).seats.map((s: { netDeviceId: string | null }) => s.netDeviceId)).toEqual([null, null]);

  // panel button: the power link from seat 1 to the strip, midpoint (12, 8.2)
  await canvas.click({ position: ft(12, 8.2) });
  await expect(page.getByRole("heading", { name: "Power cable" })).toBeVisible();
  await page.getByRole("button", { name: "Delete cable" }).click();
  await expect.poll(async () => (await doc()).seats[0].stripId).toBeNull();
});

test.describe("wire to menu", () => {
  async function open(page: import("@playwright/test").Page, request: APIRequestContext, eventDoc: object) {
    const { event } = await seed(request);
    await request.put(`/api/events/${event.id}`, { data: { doc: eventDoc } });
    await page.goto(`/#/event/${event.id}/plan`);
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(900);
    const box = (await canvas.boundingBox())!;
    const ft = (x: number, y: number) => ({ x: box.width * (0.078 + (x / 24) * 0.625), y: box.height * (0.1035 + (y / 16) * 0.502) });
    const doc = async () => (await (await request.get(`/api/events/${event.id}`)).json()).doc;
    const right = (x: number, y: number) => canvas.click({ position: ft(x, y), button: "right" });
    return { doc, right };
  }
  const items = (page: import("@playwright/test").Page) => page.getByRole("menuitem");
  const wireTo = (page: import("@playwright/test").Page) => page.getByRole("menuitem", { name: "Wire to…", exact: true }).click();

  const plan = {
    seats: [{ id: "s1", label: "A1", x: 8, y: 7.4 }, { id: "s2", label: "A2", x: 11, y: 7.4, netDeviceId: "sw2", netPort: 0 }],
    strips: [{ id: "st1", label: "Strip 1", x: 8, y: 12 }, { id: "st2", label: "Strip 2", x: 12, y: 12, pluggedInto: { kind: "strip", id: "st1" } }],
    devices: [
      { id: "sw1", label: "Switch 1", profileId: "switch-16", x: 16, y: 12 },
      { id: "sw2", label: "Switch 2", profileId: "switch-16", x: 20, y: 12, ports: 1 },
      { id: "tv1", label: "Big TV", profileId: "tv-55", x: 16, y: 5 },
    ],
  };

  test("a seat is offered switches and strips, never other seats, TVs or outlets", async ({ page, request }) => {
    const { doc, right } = await open(page, request, plan);
    await right(8, 7.4);
    await wireTo(page);
    await expect(page.getByRole("menuitem", { name: "Ethernet to Switch 1", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Power from Strip 1", exact: true })).toBeVisible();
    await expect(items(page).filter({ hasText: /TV|seat|A2|North wall/i })).toHaveCount(0);
    // a switch with no free port is listed but cannot be picked
    await expect(page.getByRole("menuitem", { name: "Ethernet to Switch 2 (No free ports)" })).toBeDisabled();

    await page.getByRole("menuitem", { name: "Ethernet to Switch 1", exact: true }).click();
    await expect.poll(async () => { const s = (await doc()).seats[0]; return [s.netDeviceId, s.netPort]; }).toEqual(["sw1", 0]);
    await expect(page.getByRole("heading", { name: "Ethernet cable" })).toBeVisible(); // the new cable is selected
  });

  test("a TV can be plugged in but has no ethernet options", async ({ page, request }) => {
    const { doc, right } = await open(page, request, plan);
    await right(16, 5);
    await wireTo(page);
    await expect(items(page).filter({ hasText: /Ethernet|Uplink/ })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Plug into North wall", exact: true }).click();
    await expect.poll(async () => (await doc()).devices[2].pluggedInto).toEqual({ kind: "outlet", id: "o1" });
  });

  test("a strip will not offer to plug into a strip that is plugged into it", async ({ page, request }) => {
    const { right } = await open(page, request, plan);
    await right(8, 12);
    await wireTo(page);
    await expect(page.getByRole("menuitem", { name: "Plug into Strip 2", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Plug into North wall", exact: true })).toBeVisible();
    // and the way back works
    await page.getByRole("menuitem", { name: "Back", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Wire to…", exact: true })).toBeVisible();
  });

  test("a switch can uplink to another switch", async ({ page, request }) => {
    const { doc, right } = await open(page, request, plan);
    await right(16, 12);
    await wireTo(page);
    await page.getByRole("menuitem", { name: "Uplink to Switch 2 (No free ports)" }).isVisible();
    await expect(page.getByRole("menuitem", { name: "Uplink to Switch 2 (No free ports)" })).toBeDisabled(); // Switch 2 has one port and a seat on it
    void doc;
  });
});


test("reports show heat, a cable across a walkway, internet share and owned gear", async ({ page, request }) => {
  const { event } = await seed(request);
  await request.put(`/api/events/${event.id}`, { data: { doc: {
    zones: [{ id: "z1", label: "Aisle", kind: "walkway", x: 12, y: 8, width: 2, depth: 16 }],
    devices: [{ id: "sw1", label: "Core switch", profileId: "switch-8", x: 4, y: 10, rotation: 0 }],
    seats: [{ id: "s1", label: "A1", x: 18, y: 10, netDeviceId: "sw1", netPort: 0 }],
  } } });

  await page.goto(`/#/event/${event.id}/reports`);
  await expect(page.getByText(/Heat in the room:/)).toBeVisible();
  await expect(page.getByText(/Ethernet cable from A1 to Core switch crosses Aisle/)).toBeVisible();

  await page.getByLabel("Internet speed (Mbps)").fill("10");
  await expect(page.getByText(/1 wired seats share the connection: about 10 Mbps each/)).toBeVisible();

  const row = page.getByRole("row", { name: /Ethernet cable, 25 ft/ });
  await expect(row.getByRole("cell").last()).toHaveText("1");
  await page.getByLabel("Owned: Ethernet cable, 25 ft").fill("1");
  await expect(row.getByRole("cell").last()).toHaveText("0");
});

test("the plan can be exported as a PNG", async ({ page, request }) => {
  const { event } = await seed(request);
  await page.goto(`/#/event/${event.id}/plan`);
  await page.waitForTimeout(900);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export plan as PNG" }).click();
  expect((await download).suggestedFilename()).toBe("Fall-LAN.png");
});
