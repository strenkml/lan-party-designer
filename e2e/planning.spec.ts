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
