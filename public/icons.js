// Category icons — hand-drawn line SVGs on a 24×24 grid (no emoji, no icon library).
// Each value is the inner markup only; catSvg() wraps it with the shared stroke style, so every
// icon inherits `currentColor` and works in both themes. The server stores just the key.
// Add an icon by adding a key here; the picker lists whatever this object contains.
const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="0.9" fill="currentColor" stroke="none"/>`;

export const ICONS = {
  // home & bills
  home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  bolt: '<path d="M13 3 5.5 13.5H11L10 21l7.5-10.5H12z"/>',
  droplet: '<path d="M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0c0-4.3 6-10.5 6-10.5z"/>',
  wifi: `<path d="M3 9.5a13 13 0 0 1 18 0"/><path d="M6 13a8.5 8.5 0 0 1 12 0"/><path d="M9 16.3a4 4 0 0 1 6 0"/>${dot(12, 19.5)}`,
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 18h2"/>',
  receipt: '<path d="M6 3.5h12V21l-2.2-1.5L13.5 21 12 19.5 10.5 21l-2.3-1.5L6 21z"/><path d="M9 8h6M9 12h6"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5"/><path d="M5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7M3.5 20h17"/>',
  // food & drink
  cart: '<path d="M3 4h2.2l2 10.5h10.6L20 7.5H6"/><circle cx="9" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
  utensils: '<path d="M6 3v5a3 3 0 0 0 6 0V3M9 11v10"/><path d="M17 21V3c-2.2 1.2-3.5 3.8-3.5 7.5V14H17"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M9 3.5v2M12.5 3.5v2"/>',
  // getting around
  car: '<path d="M5.5 16.5H4a1 1 0 0 1-1-1V12l2-5a1.5 1.5 0 0 1 1.4-1h11.2A1.5 1.5 0 0 1 19 7l2 5v3.5a1 1 0 0 1-1 1h-1.5"/><path d="M3 12h18"/><circle cx="7.5" cy="16.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/><path d="M9.5 16.5h5"/>',
  bus: `<rect x="4.5" y="4" width="15" height="13" rx="2.5"/><path d="M4.5 11h15M7.5 17v2.5M16.5 17v2.5"/>${dot(8.3, 14.2)}${dot(15.7, 14.2)}`,
  fuel: '<path d="M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M4 20h11M5 10h9"/><path d="M14 8h2.5A1.5 1.5 0 0 1 18 9.5V16a1.5 1.5 0 0 0 3 0V9l-2.5-2.5"/>',
  plane: '<path d="M21 3 3 10l7 3 3 7z"/><path d="M21 3 10 13"/>',
  // health & fun
  heart: '<path d="M12 20s-7.5-4.5-7.5-10a4.2 4.2 0 0 1 7.5-2.6A4.2 4.2 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10z"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  dumbbell: '<path d="M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11"/>',
  ticket: '<path d="M3 9a2 2 0 0 0 0 6v2.5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V15a2 2 0 0 1 0-6V6.5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z"/><path d="M14 6v2M14 11v2M14 16v2"/>',
  music: '<circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/><path d="M9 18V6l10-2v12"/>',
  gamepad: '<rect x="3" y="7.5" width="18" height="10" rx="5"/><path d="M8 10.5v4M6 12.5h4M15.5 11.5h.01M18 13.5h.01"/>',
  book: '<path d="M12 6.5C10.5 5 8 4.5 3.5 4.5v13c4.5 0 7 .5 8.5 2 1.5-1.5 4-2 8.5-2v-13c-4.5 0-7 .5-8.5 2z"/><path d="M12 6.5v13"/>',
  cap: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11.5V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.5M21.5 9v5"/>',
  // things you buy
  bag: '<path d="M5.5 8h13l-1 12h-11z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
  shirt: '<path d="M8.5 4 3.5 7l2 3.5L8 9.5V20h8V9.5l2.5 1 2-3.5-5-3a3.5 3.5 0 0 1-7 0z"/>',
  gift: '<rect x="4" y="9" width="16" height="4" rx="1"/><path d="M5.5 13v7h13v-7M12 9v11"/><path d="M12 9c-1-3.5-4.5-4-4.5-2s2 2 4.5 2zM12 9c1-3.5 4.5-4 4.5-2s-2 2-4.5 2z"/>',
  tag: '<path d="M3.5 4.5v7.6a1 1 0 0 0 .3.7l8.4 8.4a1 1 0 0 0 1.4 0l7.6-7.6a1 1 0 0 0 0-1.4l-8.4-8.4a1 1 0 0 0-.7-.3H4.5a1 1 0 0 0-1 1z"/><circle cx="8" cy="8" r="1.3"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5"/>',
  // life
  paw: '<circle cx="6.5" cy="11" r="1.7"/><circle cx="10" cy="6.8" r="1.7"/><circle cx="14" cy="6.8" r="1.7"/><circle cx="17.5" cy="11" r="1.7"/><path d="M8 17.2c0-2.8 2-4.7 4-4.7s4 1.9 4 4.7c0 1.9-1.8 2.3-2.7 1.8-.8-.4-1.8-.4-2.6 0-.9.5-2.7.1-2.7-1.8z"/>',
  leaf: '<path d="M5 19C5 10 10 5 20 4c0 10-5 15-13 15z"/><path d="M5 19l8-8"/>',
  shield: '<path d="M12 3 5 5.5v6c0 4.5 3 7.5 7 9.5 4-2 7-5 7-9.5v-6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  smile: `<circle cx="12" cy="12" r="9"/><path d="M8.5 14a4 4 0 0 0 7 0"/>${dot(9, 9.5)}${dot(15, 9.5)}`,
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  // money in
  briefcase: '<rect x="3.5" y="8" width="17" height="11.5" rx="2"/><path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8M3.5 13h17"/>',
  laptop: '<rect x="5" y="5.5" width="14" height="10" rx="1.5"/><path d="M2.5 19h19"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3"/><path d="M4 7.5V17a2 2 0 0 0 2 2h14V8H6.5A2.5 2.5 0 0 1 4 7.5z"/><path d="M16 13.5h.01"/>',
  coins: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  // catch-all
  dots: `${dot(6, 12)}${dot(12, 12)}${dot(18, 12)}`.replaceAll('r="0.9"', 'r="1.4"'),
};

export const ICON_KEYS = Object.keys(ICONS);

// Unknown keys (an icon removed later, or a hand-edited database) fall back to a tag.
export const catSvg = (key) =>
  `<svg class="cat-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key] ?? ICONS.tag}</svg>`;
