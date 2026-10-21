import type { ShoppingSummary } from "./runs";
import type { OwnedGear } from "./schema";

export interface ShoppingRow {
  id: string;
  label: string;
  group: "ethernet" | "cords" | "strips" | "switches";
  /** Cable length, for ethernet and cord rows. */
  lengthFt?: number;
  need: number;
  have: number;
  buy: number;
}

const row = (r: Omit<ShoppingRow, "buy">): ShoppingRow => ({ ...r, buy: Math.max(r.need - r.have, 0) });

function cableRows(
  group: "ethernet" | "cords",
  prefix: string,
  noun: string,
  needed: { lengthFt: number; count: number }[],
  owned: Record<string, number>,
): ShoppingRow[] {
  const lengths = new Set<number>(needed.map((n) => n.lengthFt));
  for (const [len, count] of Object.entries(owned)) if (count > 0) lengths.add(Number(len));
  return [...lengths]
    .sort((a, b) => b - a)
    .map((lengthFt) =>
      row({
        id: `${prefix}:${lengthFt}`,
        label: `${noun}, ${lengthFt} ft`,
        group,
        lengthFt,
        need: needed.find((n) => n.lengthFt === lengthFt)?.count ?? 0,
        have: owned[String(lengthFt)] ?? 0,
      }),
    );
}

/** The shopping list with gear already on hand taken off. Owned cables only cover cables of the same length. */
export function shoppingWithOwned(summary: ShoppingSummary, switches: number, owned: OwnedGear): ShoppingRow[] {
  const rows = [
    ...cableRows("ethernet", "eth", "Ethernet cable", summary.ethernet, owned.ethernet),
    ...cableRows("cords", "cord", "Extension cord", summary.cords, owned.cords),
    row({ id: "strips", label: "Power strips", group: "strips", need: summary.strips, have: owned.strips }),
    row({ id: "switches", label: "Switches and routers", group: "switches", need: switches, have: owned.switches }),
  ];
  return rows.filter((r) => r.need > 0 || r.have > 0);
}
