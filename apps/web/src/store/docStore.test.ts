import { describe, expect, it } from "vitest";
import { createDocStore } from "./docStore";

interface Doc {
  n: number;
  items: string[];
}
const make = () => {
  const store = createDocStore<Doc>({ n: 0, items: [] });
  store.getState().load({ n: 0, items: [] });
  return store;
};

describe("docStore", () => {
  it("undoes and redoes edits in order", () => {
    const store = make();
    store.getState().update((d) => void (d.n = 1));
    store.getState().update((d) => void d.items.push("a"));
    store.getState().undo();
    expect(store.getState().doc).toEqual({ n: 1, items: [] });
    store.getState().undo();
    expect(store.getState().doc.n).toBe(0);
    store.getState().redo();
    expect(store.getState().doc.n).toBe(1);
  });

  it("drops the redo stack when a new edit follows an undo", () => {
    const store = make();
    store.getState().update((d) => void (d.n = 1));
    store.getState().undo();
    store.getState().update((d) => void (d.n = 5));
    store.getState().redo();
    expect(store.getState().doc.n).toBe(5);
  });

  it("merges rapid edits that share a key into one undo step", () => {
    const store = make();
    for (const n of [1, 2, 3]) store.getState().update((d) => void (d.n = n), { key: "typing" });
    store.getState().undo();
    expect(store.getState().doc.n).toBe(0);
  });

  it("marks the doc dirty after an edit but not after loading", () => {
    const store = make();
    expect(store.getState().revision).toBe(0);
    store.getState().update((d) => void (d.n = 1));
    expect(store.getState().revision).toBe(1);
  });

  it("clears history when a different document is loaded", () => {
    const store = make();
    store.getState().update((d) => void (d.n = 1));
    store.getState().load({ n: 9, items: [] });
    store.getState().undo();
    expect(store.getState().doc.n).toBe(9);
  });
});
