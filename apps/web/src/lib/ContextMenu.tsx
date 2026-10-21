import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuEntry =
  | { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
  | { separator: true }
  | { heading: string };

const isItem = (e: MenuEntry): e is Extract<MenuEntry, { label: string }> => "label" in e;

/** A right-click menu at a screen position. Arrow keys move, Enter picks, Escape or a click elsewhere closes. */
export function ContextMenu(props: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: props.x, y: props.y });

  // keep the menu on screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(props.x, window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(props.y, window.innerHeight - height - 4)),
    });
  }, [props.x, props.y, props.entries]);

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);

  useEffect(() => {
    items()[0]?.focus();
    const close = (e: Event) => {
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node) && e.type === "mousedown") return;
      props.onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("contextmenu", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("contextmenu", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    }
  };

  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {props.entries.map((entry, i) =>
        isItem(entry) ? (
          <button
            key={i}
            role="menuitem"
            className={`ctx-item${entry.danger ? " danger" : ""}`}
            disabled={entry.disabled}
            tabIndex={-1}
            onClick={() => {
              props.onClose();
              entry.onSelect();
            }}
          >
            {entry.label}
          </button>
        ) : "separator" in entry ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : (
          <div key={i} className="ctx-heading" role="presentation">{entry.heading}</div>
        ),
      )}
    </div>
  );
}
