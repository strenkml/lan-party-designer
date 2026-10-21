import type { Watts } from "./power";

const BTU_PER_WATT_HOUR = 3.412;
const BTU_PER_TON = 12000;
export const WINDOW_UNIT_BTU = 5000;

export interface HeatLoad {
  typicalBtu: number;
  peakBtu: number;
  peakTons: number;
  /** Small window air conditioners (5000 BTU/h) it would take to remove the peak heat. */
  peakWindowUnits: number;
}

/** Nearly all electrical power drawn by gear ends up as heat in the room. */
export function heatLoad(w: Pick<Watts, "typicalW" | "peakW">): HeatLoad {
  const typicalBtu = w.typicalW * BTU_PER_WATT_HOUR;
  const peakBtu = w.peakW * BTU_PER_WATT_HOUR;
  return {
    typicalBtu,
    peakBtu,
    peakTons: peakBtu / BTU_PER_TON,
    peakWindowUnits: Math.ceil(peakBtu / WINDOW_UNIT_BTU),
  };
}
