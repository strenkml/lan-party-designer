import { produce } from "immer";
import { create } from "zustand";

const MERGE_WINDOW_MS = 800;
const HISTORY_LIMIT = 200;

export interface DocState<T> {
  doc: T;
  past: T[];
  future: T[];
  /** Bumps on every edit, undo and redo, never on load. Autosave watches it. */
  revision: number;
  lastKey: string | null;
  lastAt: number;
  load: (doc: T) => void;
  update: (recipe: (draft: T) => void, opts?: { key?: string }) => void;
  undo: () => void;
  redo: () => void;
}

export function createDocStore<T>(initial: T) {
  return create<DocState<T>>((set, get) => ({
    doc: initial,
    past: [],
    future: [],
    revision: 0,
    lastKey: null,
    lastAt: 0,
    load: (doc) => set({ doc, past: [], future: [], revision: 0, lastKey: null, lastAt: 0 }),
    update: (recipe, opts) => {
      const { doc, past, revision, lastKey, lastAt } = get();
      const next = produce(doc, recipe);
      if (next === doc) return;
      const at = Date.now();
      const merge = opts?.key !== undefined && opts.key === lastKey && at - lastAt < MERGE_WINDOW_MS;
      set({
        doc: next,
        past: merge ? past : [...past, doc].slice(-HISTORY_LIMIT),
        future: [],
        revision: revision + 1,
        lastKey: opts?.key ?? null,
        lastAt: at,
      });
    },
    undo: () => {
      const { doc, past, future, revision } = get();
      const prev = past[past.length - 1];
      if (prev === undefined) return;
      set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], revision: revision + 1, lastKey: null });
    },
    redo: () => {
      const { doc, past, future, revision } = get();
      const next = future[0];
      if (next === undefined) return;
      set({ doc: next, past: [...past, doc], future: future.slice(1), revision: revision + 1, lastKey: null });
    },
  }));
}
