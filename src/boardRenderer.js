// boardRenderer.js
// ---------------------------------------------------------------------------
// DOM rendering of the board only — no puzzle logic, no Firebase. Given a
// container and a GameSession, it builds the 6x6 grid once, draws the sun/moon
// icons and the =/x clue badges, and wires clicks back into the session via a
// supplied callback. A single renderer is reused by both solo and multiplayer.
// ---------------------------------------------------------------------------

import { EMPTY, SUN, MOON, SIZE, isGiven } from './puzzleEngine.js';

// Flat, gradient-free icon markup, matching the minimal Tango look.
const SUN_SVG = `
  <svg viewBox="0 0 100 100" class="symbol sun" aria-label="sun">
    <circle cx="50" cy="50" r="20" fill="#F5C518"/>
    ${rays()}
  </svg>`;

const MOON_SVG = `
  <svg viewBox="0 0 100 100" class="symbol moon" aria-label="moon">
    <path d="M62 24a30 30 0 1 0 0 52 24 24 0 1 1 0-52z" fill="#3B82C4"/>
  </svg>`;

function rays() {
  let out = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = 50 + Math.cos(a) * 27;
    const y1 = 50 + Math.sin(a) * 27;
    const x2 = 50 + Math.cos(a) * 36;
    const y2 = 50 + Math.sin(a) * 36;
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#F5C518" stroke-width="6" stroke-linecap="round"/>`;
  }
  return out;
}

function symbolMarkup(value) {
  if (value === SUN) return SUN_SVG;
  if (value === MOON) return MOON_SVG;
  return '';
}

/**
 * Build the board inside `container` for `session` and return an API object.
 * `onMove(row, col)` is called on every tap of an editable cell; the caller
 * (main/ui) is responsible for actually invoking session.makeMove and then
 * calling `update()` to reflect the new state.
 *
 * Returns { update, flashInvalid }:
 *   - update():        redraw all cell symbols from the current session grid.
 *   - flashInvalid(r,c): briefly mark a cell red to show a rule violation.
 */
export function renderBoard(container, session, onMove) {
  const { puzzle } = session;
  container.innerHTML = '';
  container.classList.add('board');

  // 6x6 of button cells. No gaps: internal grid lines come from cell borders,
  // which keeps clue-badge positioning simple (see below).
  const cellEls = [];
  for (let r = 0; r < SIZE; r++) {
    cellEls[r] = [];
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      if (isGiven(puzzle, r, c)) cell.classList.add('given');
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.addEventListener('click', () => onMove(r, c));
      container.appendChild(cell);
      cellEls[r][c] = cell;
    }
  }

  // Clue badges sit on the shared border between their two cells. With evenly
  // sized, gapless cells, a cell's centre along an axis is (index + 0.5)/SIZE.
  // The midpoint between two neighbours is therefore (i + j + 1)/(2*SIZE).
  for (const clue of puzzle.clues) {
    const badge = document.createElement('div');
    badge.className = 'clue';
    badge.textContent = clue.type === '=' ? '=' : '×';
    badge.style.left = `${((clue.c1 + clue.c2 + 1) / (2 * SIZE)) * 100}%`;
    badge.style.top = `${((clue.r1 + clue.r2 + 1) / (2 * SIZE)) * 100}%`;
    container.appendChild(badge);
  }

  const update = () => {
    const grid = session.grid;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const el = cellEls[r][c];
        const value = grid[r][c];
        const markup = symbolMarkup(value);
        if (el.dataset.value !== String(value)) {
          el.innerHTML = markup;
          el.dataset.value = String(value);
          el.classList.toggle('filled', value !== EMPTY);
        }
      }
    }
  };

  const flashInvalid = (r, c) => {
    const el = cellEls[r][c];
    el.classList.remove('invalid'); // restart the animation if mid-flash
    void el.offsetWidth; // force reflow so re-adding the class replays it
    el.classList.add('invalid');
    setTimeout(() => el.classList.remove('invalid'), 600);
  };

  // Briefly pulse a cell to draw the eye to it (used by the Hint button).
  const highlightHint = (r, c) => {
    const el = cellEls[r][c];
    el.classList.remove('hint');
    void el.offsetWidth; // restart the animation
    el.classList.add('hint');
    setTimeout(() => el.classList.remove('hint'), 1300);
  };

  update();
  return { update, flashInvalid, highlightHint };
}
