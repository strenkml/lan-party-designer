import type { ReactNode } from "react";

const icon = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const Icons = {
  select: icon(<path d="M5 3l14 8-6 2-2 6z" />),
  room: icon(<path d="M4 6l8-3 8 4v11l-8 3-8-4z" />),
  door: icon(<><path d="M5 20V4h9v16" /><path d="M14 20h6" /><circle cx="11.5" cy="12" r="0.8" /></>),
  obstacle: icon(<rect x="4" y="7" width="16" height="10" rx="2" />),
  outlet: icon(<><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 9v3M15 9v3M10 16h4" /></>),
  table: icon(<><rect x="3" y="9" width="18" height="6" rx="1" /><path d="M7 5h2M15 5h2M7 19h2M15 19h2" /></>),
  strip: icon(<><rect x="2" y="9" width="20" height="6" rx="2" /><path d="M7 12h.01M12 12h.01M17 12h.01" /></>),
  device: icon(<><rect x="2" y="8" width="20" height="8" rx="1.5" /><path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01" /></>),
  calibrate: icon(<><path d="M3 17L17 3l4 4L7 21z" /><path d="M8 10l2 2M11 7l2 2M5 13l2 2" /></>),
  undo: icon(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></>),
  redo: icon(<><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></>),
};
