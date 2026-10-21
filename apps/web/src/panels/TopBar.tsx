import type { ReactNode } from "react";
import { href, useRoute } from "../lib/route";
import { ThemeToggle } from "../lib/ui";

export function TopBar(props: { crumb?: ReactNode; tabs?: ReactNode; right?: ReactNode }) {
  const route = useRoute();
  const onPeople = route.page === "people";
  const onHome = route.page === "home";
  return (
    <header className="topbar">
      <a className="brand" href={href()}>
        LAN Party <i>Designer</i>
      </a>
      <nav className="tabs main-nav" aria-label="Main">
        <a className="tab" href={href()} aria-current={onHome ? "page" : undefined}>
          Events
        </a>
        <a className="tab" href={href("people")} aria-current={onPeople ? "page" : undefined}>
          People & devices
        </a>
      </nav>
      {props.crumb && <div className="crumb">{props.crumb}</div>}
      {props.tabs && <nav className="tabs section-tabs" aria-label="Sections">{props.tabs}</nav>}
      <div className="spacer" />
      {props.right}
      <ThemeToggle />
    </header>
  );
}
