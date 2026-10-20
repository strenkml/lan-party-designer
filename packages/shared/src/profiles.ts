import type { DeviceProfile } from "./schema";

/**
 * Starter catalog. Numbers are measured wall draw, not PSU nameplate ratings:
 * a 750 W supply in a gaming PC typically pulls 300 to 500 W under load.
 */
export const DEFAULT_PROFILES: DeviceProfile[] = [
  { id: "pc-mid", name: "Gaming PC (mid-range)", kind: "pc", typicalW: 250, peakW: 400, ports: 0 },
  { id: "pc-high", name: "Gaming PC (high-end)", kind: "pc", typicalW: 400, peakW: 650, ports: 0 },
  { id: "laptop", name: "Laptop", kind: "laptop", typicalW: 60, peakW: 100, ports: 0 },
  { id: "laptop-gaming", name: "Gaming laptop", kind: "laptop", typicalW: 150, peakW: 250, ports: 0 },
  { id: "monitor-24", name: 'Monitor 24"', kind: "monitor", typicalW: 25, peakW: 40, ports: 0 },
  { id: "monitor-27", name: 'Monitor 27"', kind: "monitor", typicalW: 35, peakW: 55, ports: 0 },
  { id: "monitor-34", name: 'Ultrawide 34"', kind: "monitor", typicalW: 50, peakW: 80, ports: 0 },
  { id: "console", name: "Game console", kind: "console", typicalW: 160, peakW: 220, ports: 0 },
  { id: "switch-8", name: "Switch 8 port", kind: "switch", typicalW: 8, peakW: 12, ports: 8 },
  { id: "switch-16", name: "Switch 16 port", kind: "switch", typicalW: 15, peakW: 25, ports: 16 },
  { id: "switch-24", name: "Switch 24 port", kind: "switch", typicalW: 25, peakW: 40, ports: 24 },
  { id: "router", name: "Router", kind: "router", typicalW: 12, peakW: 20, ports: 4 },
  { id: "server", name: "Game server", kind: "server", typicalW: 120, peakW: 250, ports: 0 },
  { id: "tv-55", name: 'TV 55"', kind: "display", typicalW: 90, peakW: 150, ports: 0 },
  { id: "projector", name: "Projector", kind: "display", typicalW: 250, peakW: 350, ports: 0 },
];
