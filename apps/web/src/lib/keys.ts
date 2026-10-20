import { useEffect, useRef } from "react";

interface Handlers {
  undo: () => void;
  redo: () => void;
  remove: () => void;
  escape: () => void;
  enter: () => void;
}

/** Editor shortcuts. Ignored while typing in a form field. */
export function useEditorKeys(h: Handlers) {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) ref.current.redo();
        else ref.current.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        if (typing) return;
        e.preventDefault();
        ref.current.redo();
      } else if (typing) {
        return;
      } else if (e.key === "Delete" || e.key === "Backspace") {
        ref.current.remove();
      } else if (e.key === "Escape") {
        ref.current.escape();
      } else if (e.key === "Enter") {
        ref.current.enter();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}
