import { useEffect, useState } from "react";

export type Route =
  | { page: "home" }
  | { page: "people" }
  | { page: "venue"; id: string }
  | { page: "event"; id: string; tab: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "venue" && parts[1]) return { page: "venue", id: parts[1] };
  if (parts[0] === "event" && parts[1]) return { page: "event", id: parts[1], tab: parts[2] ?? "plan" };
  if (parts[0] === "people") return { page: "people" };
  return { page: "home" };
}

export const href = (...parts: string[]) => `#/${parts.join("/")}`;

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
