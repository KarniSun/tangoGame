// cosmetics.js
// ---------------------------------------------------------------------------
// The shop catalog, plus the one function that applies what you have equipped.
//
// Cosmetics are deliberately just CSS custom properties. `symbols` and `board`
// items carry a bag of variables that get written onto <html>, so equipping one
// restyles the game with no re-render and no special-casing anywhere else.
//
// Board themes must define BOTH a light and a dark variant. The variables they
// override (--cell-bg, --given-bg, --line, --cream) are the same ones the dark
// palette in style.css redefines, and an inline style on :root beats any
// stylesheet rule - so a single-variant board theme would silently break the
// light/dark toggle. applyCosmetics() picks the variant for the active theme.
// ---------------------------------------------------------------------------

/** Slots a player can fill. One equipped item each. */
export const SLOTS = ['symbols', 'board', 'avatar', 'title'];

export const SLOT_LABEL = {
  symbols: 'Sun & moon',
  board: 'Board theme',
  avatar: 'Avatar',
  title: 'Title',
};

// Prices are tiered: a couple of starters at ~3 games, most around ~10, and one
// flagship per visual slot at ~40 games to give the economy a long-term goal.
export const COSMETICS = [
  // --- sun & moon skins ----------------------------------------------------
  { id: 'sym-classic', slot: 'symbols', name: 'Classic', price: 0,
    vars: { '--sun': '#f5c518', '--moon': '#3b82c4' } },
  { id: 'sym-mono', slot: 'symbols', name: 'Monochrome', price: 250,
    vars: { '--sun': '#d8d3c8', '--moon': '#55606f' } },
  { id: 'sym-midnight', slot: 'symbols', name: 'Midnight', price: 250,
    vars: { '--sun': '#e8d24a', '--moon': '#6d5ce0' } },
  { id: 'sym-sunset', slot: 'symbols', name: 'Sunset', price: 300,
    vars: { '--sun': '#ff9f43', '--moon': '#c94f7c' } },
  { id: 'sym-neon', slot: 'symbols', name: 'Neon', price: 400,
    vars: { '--sun': '#c6ff00', '--moon': '#00e5ff' } },
  { id: 'sym-eclipse', slot: 'symbols', name: 'Eclipse', price: 1200,
    vars: { '--sun': '#ff5f1f', '--moon': '#1a1a2e' } },

  // --- board themes --------------------------------------------------------
  { id: 'board-paper', slot: 'board', name: 'Paper', price: 0,
    light: { '--cream': '#fbf7f1', '--cell-bg': '#ffffff', '--given-bg': '#ece5d8', '--line': '#2b3440' },
    dark: { '--cream': '#14161b', '--cell-bg': '#20242e', '--given-bg': '#2b313d', '--line': '#414a5a' } },
  { id: 'board-slate', slot: 'board', name: 'Slate', price: 300,
    light: { '--cream': '#eef1f5', '--cell-bg': '#ffffff', '--given-bg': '#dbe2ea', '--line': '#41505f' },
    dark: { '--cream': '#12161c', '--cell-bg': '#1d232c', '--given-bg': '#28303b', '--line': '#46566a' } },
  { id: 'board-forest', slot: 'board', name: 'Forest', price: 300,
    light: { '--cream': '#eef4ec', '--cell-bg': '#ffffff', '--given-bg': '#d8e6d4', '--line': '#2f4a35' },
    dark: { '--cream': '#111814', '--cell-bg': '#1b241d', '--given-bg': '#26332a', '--line': '#3e5c46' } },
  { id: 'board-sakura', slot: 'board', name: 'Sakura', price: 350,
    light: { '--cream': '#fdf0f3', '--cell-bg': '#ffffff', '--given-bg': '#f6dbe2', '--line': '#5b3742' },
    dark: { '--cream': '#1a1216', '--cell-bg': '#251a1f', '--given-bg': '#33242b', '--line': '#5e414c' } },
  { id: 'board-aurora', slot: 'board', name: 'Aurora', price: 1400,
    light: { '--cream': '#eaf6f4', '--cell-bg': '#ffffff', '--given-bg': '#cfeae6', '--line': '#1f5b57' },
    dark: { '--cream': '#0d1618', '--cell-bg': '#152227', '--given-bg': '#1d3138', '--line': '#2f6f72' } },

  // --- avatars (shown to other players on the leaderboard) -----------------
  { id: 'ava-none', slot: 'avatar', name: 'None', price: 0, emoji: '' },
  { id: 'ava-fox', slot: 'avatar', name: 'Fox', price: 60, emoji: '🦊' },
  { id: 'ava-owl', slot: 'avatar', name: 'Owl', price: 60, emoji: '🦉' },
  { id: 'ava-panda', slot: 'avatar', name: 'Panda', price: 60, emoji: '🐼' },
  { id: 'ava-wolf', slot: 'avatar', name: 'Wolf', price: 60, emoji: '🐺' },
  { id: 'ava-lion', slot: 'avatar', name: 'Lion', price: 60, emoji: '🦁' },
  { id: 'ava-octopus', slot: 'avatar', name: 'Octopus', price: 60, emoji: '🐙' },

  // --- titles --------------------------------------------------------------
  { id: 'title-none', slot: 'title', name: 'None', price: 0, text: '' },
  { id: 'title-rookie', slot: 'title', name: 'Rookie', price: 0, text: 'Rookie' },
  { id: 'title-speedster', slot: 'title', name: 'Speedster', price: 200, text: 'Speedster' },
  { id: 'title-nightowl', slot: 'title', name: 'Night Owl', price: 200, text: 'Night Owl' },
  { id: 'title-grandmaster', slot: 'title', name: 'Grandmaster', price: 900, text: 'Grandmaster' },
];

const BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));

export function getCosmetic(id) {
  return BY_ID.get(id) || null;
}

/** Everything in one slot, cheapest first so free defaults lead. */
export function bySlot(slot) {
  return COSMETICS.filter((c) => c.slot === slot);
}

/** The free default for a slot - what you wear when nothing is equipped. */
export function defaultFor(slot) {
  return COSMETICS.find((c) => c.slot === slot && c.price === 0) || null;
}

/** Free items need no purchase, so they are owned by everyone implicitly. */
export function isFree(id) {
  const c = getCosmetic(id);
  return !!c && c.price === 0;
}

/** The item actually worn in a slot, falling back to that slot's free default. */
export function equippedIn(equipped, slot) {
  return getCosmetic((equipped || {})[slot]) || defaultFor(slot);
}

/** The emoji currently worn, for writing into a room's player node. */
export function avatarOf(equipped) {
  const c = equippedIn(equipped, 'avatar');
  return (c && c.emoji) || '';
}

/** The title currently worn, likewise. */
export function titleOf(equipped) {
  const c = equippedIn(equipped, 'title');
  return (c && c.text) || '';
}

/**
 * Write the equipped symbol and board variables onto <html>. Called on boot and
 * again whenever the theme flips, because board themes are theme-dependent.
 */
export function applyCosmetics(equipped, isDark) {
  const root = document.documentElement;
  const symbols = equippedIn(equipped, 'symbols');
  const board = equippedIn(equipped, 'board');

  const vars = {
    ...((symbols && symbols.vars) || {}),
    ...((board && (isDark ? board.dark : board.light)) || {}),
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}
