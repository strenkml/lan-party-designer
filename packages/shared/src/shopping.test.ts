import { describe, expect, it } from "vitest";
import { OwnedGear } from "./schema";
import { shoppingWithOwned } from "./shopping";

const owned = (o: Partial<OwnedGear> = {}) => OwnedGear.parse(o);
const summary = {
  ethernet: [{ lengthFt: 25, count: 4 }, { lengthFt: 10, count: 2 }],
  cords: [{ lengthFt: 50, count: 1 }],
  strips: 3,
};

describe("shoppingWithOwned", () => {
  it("buys everything when nothing is owned", () => {
    const rows = shoppingWithOwned(summary, 2, owned());
    expect(rows.map((r) => [r.id, r.need, r.have, r.buy])).toEqual([
      ["eth:25", 4, 0, 4],
      ["eth:10", 2, 0, 2],
      ["cord:50", 1, 0, 1],
      ["strips", 3, 0, 3],
      ["switches", 2, 0, 2],
    ]);
  });

  it("takes owned gear off what needs buying, never below zero", () => {
    const rows = shoppingWithOwned(
      summary,
      2,
      owned({ ethernet: { "25": 3, "10": 5 }, cords: { "50": 1 }, strips: 1, switches: 4 }),
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.buy]))).toEqual({
      "eth:25": 1, "eth:10": 0, "cord:50": 0, strips: 2, switches: 0,
    });
  });

  it("lists owned cable lengths the plan does not need so they can be edited", () => {
    const rows = shoppingWithOwned(summary, 0, owned({ ethernet: { "6": 2 } }));
    expect(rows.find((r) => r.id === "eth:6")).toMatchObject({ need: 0, have: 2, buy: 0, lengthFt: 6 });
  });

  it("leaves out rows with nothing needed and nothing owned", () => {
    expect(shoppingWithOwned({ ethernet: [], cords: [], strips: 0 }, 0, owned())).toEqual([]);
  });

  it("sorts cable rows longest first", () => {
    const rows = shoppingWithOwned({ ethernet: [{ lengthFt: 10, count: 1 }], cords: [], strips: 0 }, 0, owned({ ethernet: { "50": 1 } }));
    expect(rows.map((r) => r.id)).toEqual(["eth:50", "eth:10"]);
  });
});
