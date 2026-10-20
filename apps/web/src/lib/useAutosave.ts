import { useEffect, useRef, useState } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import type { DocState } from "../store/docStore";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Saves the doc about one second after the last edit. Last write wins. */
export function useAutosave<T>(
  store: UseBoundStore<StoreApi<DocState<T>>>,
  save: (doc: T) => Promise<unknown>,
  enabled: boolean,
  delayMs = 1000,
): { status: SaveStatus; flush: () => Promise<void> } {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saveRef = useRef(save);
  saveRef.current = save;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedRevision = useRef(0);

  const run = async () => {
    clearTimeout(timer.current);
    const { doc, revision } = store.getState();
    if (revision === savedRevision.current) return;
    setStatus("saving");
    try {
      await saveRef.current(doc);
      savedRevision.current = revision;
      setStatus(store.getState().revision === revision ? "saved" : "saving");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    if (!enabled) return;
    savedRevision.current = store.getState().revision;
    const unsubscribe = store.subscribe((state, prev) => {
      if (state.revision === prev.revision || state.revision === 0) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(run, delayMs);
    });
    const onLeave = () => void run();
    window.addEventListener("beforeunload", onLeave);
    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", onLeave);
      clearTimeout(timer.current);
      void run();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, store, delayMs]);

  return { status, flush: run };
}
