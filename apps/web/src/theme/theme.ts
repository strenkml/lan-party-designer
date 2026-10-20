import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "lpd-theme";

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage can be blocked */
  }
  return "system";
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("themechange"));
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  return {
    choice,
    set: (next: ThemeChoice) => {
      applyTheme(next);
      setChoice(next);
    },
  };
}

/** Reads CSS variables so the canvas can match the active theme. */
export function useCssColors<K extends string>(names: readonly K[]): Record<K, string> {
  const read = () => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, style.getPropertyValue(`--${n}`).trim()])) as Record<K, string>;
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const on = () => setColors(read());
    window.addEventListener("themechange", on);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", on);
    return () => {
      window.removeEventListener("themechange", on);
      mq.removeEventListener("change", on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return colors;
}
