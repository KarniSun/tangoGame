// gameSession.js
// ---------------------------------------------------------------------------
// The ONE shared game-state layer, used identically by solo and multiplayer.
//
// A GameSession wraps everything about a single in-progress board: the puzzle
// (givens + clues), the immutable solution, the player's current grid, the
// timer, and a small move history. It knows nothing about the DOM or Firebase —
// multiplayer mode simply reads its state and pipes changes out to the network,
// while solo mode drives the exact same object and ignores the network.
// ---------------------------------------------------------------------------

import {
  EMPTY,
  SUN,
  MOON,
  createGame,
  cloneGrid,
  gridFromPuzzle,
  isGiven,
  isValidPlacement,
  satisfiesClues,
  isBoardComplete,
  progressFraction,
} from './puzzleEngine.js';

// Empty -> Sun -> Moon -> Empty. Tapping a cell walks this cycle.
const NEXT_SYMBOL = { [EMPTY]: SUN, [SUN]: MOON, [MOON]: EMPTY };

export class GameSession {
  constructor() {
    this.puzzle = null; // { givens, clues }
    this.solution = null; // 6x6 grid
    this.grid = null; // 6x6 grid the player edits
    this.history = []; // list of { r, c, from, to }
    this.startedAt = null; // epoch ms when the clock started
    this.finishedAt = null; // epoch ms when the board was solved
  }

  /**
   * Load a puzzle. Pass a pre-built { puzzle, solution } (multiplayer, where the
   * board comes from Firebase) or omit it to generate a fresh one (solo /
   * create-game). Resets grid, history, and timer.
   */
  startNewPuzzle(game = null) {
    const { puzzle, solution } = game || createGame();
    this.puzzle = puzzle;
    this.solution = solution;
    this.grid = gridFromPuzzle(puzzle);
    this.history = [];
    this.startedAt = null;
    this.finishedAt = null;
    return { puzzle, solution };
  }

  /** Begin timing. Idempotent so "both players present" can call it freely. */
  startTimer() {
    if (this.startedAt === null) this.startedAt = Date.now();
  }

  /**
   * Cycle the symbol at (row, col). Givens are immutable and ignored. Following
   * the original's feel, an illegal placement is still applied — we just report
   * `valid: false` so the UI can flash the cell red rather than blocking input.
   * Returns { changed, valid, symbol }.
   */
  makeMove(row, col) {
    if (!this.grid || isGiven(this.puzzle, row, col)) {
      return { changed: false, valid: true, symbol: this.grid?.[row][col] };
    }
    this.startTimer();

    const from = this.grid[row][col];
    const to = NEXT_SYMBOL[from];

    // Judge legality with the cell cleared, so the candidate is compared only
    // against its neighbours (isValidPlacement treats the target as the candidate).
    this.grid[row][col] = EMPTY;
    const valid =
      to === EMPTY ||
      (isValidPlacement(this.grid, row, col, to) &&
        satisfiesClues(this.grid, this.puzzle.clues, row, col, to));

    this.grid[row][col] = to;
    this.history.push({ r: row, c: col, from, to });

    if (this.isSolved()) this.finishedAt = Date.now();
    return { changed: true, valid, symbol: to };
  }

  /**
   * Undo the most recent move, restoring the cell to its previous symbol.
   * Returns the reverted { r, c } (so the UI can refresh) or null if there is
   * nothing to undo. Clears the finish time if the board is no longer solved.
   */
  undo() {
    const last = this.history.pop();
    if (!last) return null;
    this.grid[last.r][last.c] = last.from;
    if (!this.isSolved()) this.finishedAt = null;
    return { r: last.r, c: last.c };
  }

  /** True when at least one move can be undone. */
  canUndo() {
    return this.history.length > 0;
  }

  /**
   * Clear all of the player's own moves, restoring the board to the initial
   * puzzle (givens only). The timer keeps running — resetting is "start the
   * board over", not "reset the clock" — so it stays fair in a timed race.
   */
  reset() {
    this.grid = gridFromPuzzle(this.puzzle);
    this.history = [];
    this.finishedAt = null;
  }

  /** The board is solved the instant it matches the unique stored solution. */
  isSolved() {
    return !!this.solution && isBoardComplete(this.grid, this.solution);
  }

  /** Fraction (0..1) of cells correctly filled — feeds progress bars. */
  getProgress() {
    return this.solution ? progressFraction(this.grid, this.solution) : 0;
  }

  /**
   * Elapsed seconds since the timer started. Freezes at the finish time once
   * solved so the displayed result stops ticking.
   */
  getElapsedTime() {
    if (this.startedAt === null) return 0;
    const end = this.finishedAt ?? Date.now();
    return (end - this.startedAt) / 1000;
  }

  /** A defensive copy of the current grid (for renderers that shouldn't mutate). */
  snapshot() {
    return cloneGrid(this.grid);
  }
}
