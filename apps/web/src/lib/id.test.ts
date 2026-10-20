import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "./id";

afterEach(() => vi.unstubAllGlobals());

describe("newId", () => {
  it("makes prefixed ids that do not repeat", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId("door")));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^door-[0-9a-f]{8}$/);
  });

  it("still works on plain http origins, where crypto.randomUUID is missing", () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    expect(newId("outlet")).toMatch(/^outlet-[0-9a-f]{8}$/);
  });
});
