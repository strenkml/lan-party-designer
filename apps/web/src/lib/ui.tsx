import { useEffect, useState, type ReactNode } from "react";
import type { Level } from "@lpd/shared";
import { useTheme, type ThemeChoice } from "../theme/theme";

export const LEVEL_LABEL: Record<Level, string> = { ok: "OK", warn: "Near limit", danger: "Overloaded" };

export function LevelBadge({ level }: { level: Level }) {
  const glyph = level === "ok" ? "✓" : level === "warn" ? "▲" : "✕";
  return (
    <span className={`badge ${level}`}>
      <span aria-hidden>{glyph}</span>
      {LEVEL_LABEL[level]}
    </span>
  );
}

export function Gauge(props: {
  label: string;
  level: Level;
  typicalA: number;
  peakA: number;
  ratingA: number;
  detail?: string;
}) {
  const pct = (a: number) => `${Math.min((a / props.ratingA) * 100, 100)}%`;
  return (
    <div className={`gauge ${props.level}`}>
      <div className="gauge-head">
        <span>{props.label}</span>
        <span className="muted">
          {props.typicalA.toFixed(1)}A typ · {props.peakA.toFixed(1)}A peak of {props.ratingA}A
        </span>
      </div>
      <div
        className="gauge-bar"
        role="meter"
        aria-label={`${props.label} load`}
        aria-valuemin={0}
        aria-valuemax={props.ratingA}
        aria-valuenow={Number(props.typicalA.toFixed(1))}
      >
        <div className="gauge-peak" style={{ width: pct(props.peakA) }} />
        <div className="gauge-typ" style={{ width: pct(props.typicalA) }} />
        <div className="gauge-limit" />
      </div>
      {props.detail && <div className="muted">{props.detail}</div>}
    </div>
  );
}

export function ThemeToggle() {
  const { choice, set } = useTheme();
  const opts: [ThemeChoice, string][] = [
    ["system", "Auto"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];
  return (
    <div className="seg" role="group" aria-label="Theme">
      {opts.map(([value, label]) => (
        <button key={value} aria-pressed={choice === value} onClick={() => set(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Dialog(props: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [props]);
  return (
    <div className="dialog-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog" role="dialog" aria-modal aria-label={props.title}>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

let pushToast: (msg: string) => void = () => {};
export const toast = (msg: string) => pushToast(msg);

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    pushToast = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 3200);
    };
    return () => clearTimeout(t);
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

export function NumberField(props: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  return (
    <label className="field">
      {props.label}
      {props.suffix ? ` (${props.suffix})` : ""}
      <input
        type="number"
        value={Number.isFinite(props.value) ? Math.round(props.value * 100) / 100 : ""}
        step={props.step ?? 0.5}
        min={props.min}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) props.onChange(n);
        }}
      />
    </label>
  );
}

export function TextField(props: { label: string; value: string; onChange: (s: string) => void }) {
  return (
    <label className="field">
      {props.label}
      <input type="text" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

export { newId } from "./id";

export function formatWatts(w: number) {
  return `${Math.round(w).toLocaleString()} W`;
}

export const downloadJson = (name: string, data: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

export function NameDialog(props: {
  title: string;
  label?: string;
  initial?: string;
  action: string;
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(props.initial ?? "");
  return (
    <Dialog title={props.title} onClose={props.onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await props.onSubmit(name.trim());
          props.onClose();
        }}
      >
        <label className="field">
          {props.label ?? "Name"}
          <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn primary" disabled={!name.trim()}>{props.action}</button>
      </form>
    </Dialog>
  );
}
