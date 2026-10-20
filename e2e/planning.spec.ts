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
});
