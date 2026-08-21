/**
 * Line icons drawn to one spec: 24-unit grid, 1.7 stroke, round caps.
 * Keeping them inline avoids an icon dependency and keeps the set consistent.
 */
const PATHS = {
  scan: 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16',
  send: 'M7 17 17 7M9 7h8v8',
  receive: 'M17 7 7 17M15 17H7V9',
  wallet: 'M3 8.5A2.5 2.5 0 0 1 5.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5v-8ZM3 9h17M16.5 13.5h.01',
  plus: 'M12 5v14M5 12h14',
  mobile: 'M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5ZM10.5 17.5h3',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
  bank: 'M3 10h18M4 10 12 4l8 6M6 10v7M10 10v7M14 10v7M18 10v7M3.5 20h17',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 19.5a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 13.5a6.5 6.5 0 0 1 3.5 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  bell: 'M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M10.3 20a2 2 0 0 0 3.4 0',
  home: 'M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5ZM9.5 20.5v-6h5v6',
  passbook: 'M5 4.5h11a2 2 0 0 1 2 2V21l-3-2-3 2-3-2-3 2V6.5a2 2 0 0 1 2-2H5ZM9 9h6M9 13h4',
  chevronRight: 'm9.5 5 7 7-7 7',
  chevronLeft: 'm14.5 5-7 7 7 7',
  chevronDown: 'm5 9.5 7 7 7-7',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  copy: 'M9 9h9a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 21H9a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 9 9ZM4.5 15A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5',
  share: 'M17 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM17 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM9.2 10.8l5.6-2.9M9.2 13.2l5.6 2.9',
  lock: 'M7 10.5V8a5 5 0 0 1 10 0v2.5M6 10.5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
  logout: 'M15 8V6a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 15 18v-2M10 12h10M17 9l3 3-3 3',
  edit: 'M4.5 19.5h4L20 8a2.1 2.1 0 0 0-3-3L5.5 16.5l-1 3ZM14.5 6.5l3 3',
  tv: 'M4 6.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM8.5 21h7M8 6.5 12 3l4 3.5',
  flame: 'M12 21a6 6 0 0 0 6-6c0-4-3-5.5-3-9 0 0-2.5 1.5-2.5 4.5C12.5 8 11 6 9.5 6.5 10 9 6 10.5 6 15a6 6 0 0 0 6 6Z',
  droplet: 'M12 3.5s6 6.2 6 10.2a6 6 0 0 1-12 0c0-4 6-10.2 6-10.2Z',
  wifi: 'M4 9.5a12 12 0 0 1 16 0M7 13a7.5 7.5 0 0 1 10 0M10 16.5a3 3 0 0 1 4 0M12 20h.01',
  card: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9ZM3 10.5h18M6.5 14.5h3',
  close: 'M6 6l12 12M18 6 6 18',
  filter: 'M4 6h16M7 12h10M10 18h4',
  camera: 'M4 8.5h3l1.5-2.5h7L17 8.5h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  alert: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 8v5M12 16h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5',
  bag: 'M6 8h12l-1 12H7L6 8ZM9 8V6a3 3 0 0 1 6 0v2',
  gift: 'M3.5 11.5h17v8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-8ZM2.5 7.5h19v4h-19v-4ZM12 7.5v13M12 7.5S10.5 3 8 3a2.2 2.2 0 0 0 0 4.5h4Zm0 0s1.5-4.5 4-4.5a2.2 2.2 0 0 1 0 4.5h-4Z',

  // ---- Nambikai. Same 24-unit grid and 1.7 stroke as everything above; the
  // component renders exactly one <path>, so multi-part glyphs are subpaths.
  shield: 'M12 3.5l7 2.5v5.5c0 4.3-2.9 7.6-7 9.5-4.1-1.9-7-5.2-7-9.5V6l7-2.5Z',
  sparkle: 'M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9 12 3.5ZM18 16.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z',
  chart: 'M4 20V4M4 20h16M8 20v-6M12.5 20v-10M17 20v-4',
  trend: 'M4 16.5 9.5 11l3.5 3.5L20 7M20 7h-4.5M20 7v4.5',
  link: 'M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1',
  document: 'M6.5 3.5h7L18 8v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1.5-1.5ZM13 3.5V8h5M8.5 13h7M8.5 17h5',
  store: 'M4 9.5h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-10ZM3 9.5 5 4h14l2 5.5M9.5 20.5v-6h5v6',
  flag: 'M6 21V4M6 4.5h11l-2 3.5 2 3.5H6',
  slash: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8',
};

export default function Icon({ name, size = 22, className = '', strokeWidth = 1.7, ...rest }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

export const iconNames = Object.keys(PATHS);
