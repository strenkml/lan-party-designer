import type { ReactNode } from "react";
import { href } from "../lib/route";
import { ThemeToggle } from "../lib/ui";

export function TopBar(props: { crumb?: ReactNode; tabs?: ReactNode; right?: ReactNode }) {
  return (
    <header className="topbar">
      <a className="brand" href={href()}>
        LAN Party <i>Designer</i>
      </a>
      {props.crumb && <div className="crumb">{props.crumb}</div>}
      {props.tabs && <nav className="tabs" aria-label="Sections">{props.tabs}</nav>}
      <div className="spacer" />
      {props.right}
      <a className="btn ghost small hide-mobile" href={href("people")}>
        People & devices
      </a>
      <ThemeToggle />
    </header>
  );
}
