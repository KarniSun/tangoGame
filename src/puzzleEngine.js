// puzzleEngine.js
// ---------------------------------------------------------------------------
// PURE puzzle logic for Tango: generation, solving, and rule validation.
// This module contains ZERO DOM, UI, or Firebase code. Every function is a
// pure function of its inputs, so it can be unit-tested in isolation and is
// reused *identically* by solo mode and multiplayer mode.
//
// Grid representation: a 6x6 array of arrays. Each cell holds one of:
//   EMPTY (0) | SUN (1) | MOON (2)
//
// A clue is an object describing a constraint between two orthogonally
// adjacent cells: { r1, c1, r2, c2, type } where type is '=' (same) or 'x'
// (opposite).
// ---------------------------------------------------------------------------

export const EMPTY = 0;
export const SUN = 1;
export const MOON = 2;

export const SIZE = 6;
const HALF = SIZE / 2; // exactly 3 of each symbol per row/column

// --- small generic helpers -------------------------------------------------

/** Return a deep copy of a 6x6 grid so callers never mutate shared state. */
export function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

/** Create an empty 6x6 grid. */
export function emptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
}

/** Fisher-Yates shuffle (returns a new array). Used to randomize try-order. */
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- rule validation --------------------------------------------------------

/**
 * Can `symbol` legally sit at (row, col) given the rest of `grid`?
 *
 * Enforces the two hard board rules against the currently-filled cells:
 *   1. No more than 2 identical symbols adjacent (no 3-in-a-row) in any
 *      horizontal or vertical direction.
 *   2. No more than 3 of a symbol total in the cell's row or column.
 *
 * We check *all four* directions (not just left/up) because this function is
 * shared by the solver, where givens can already exist below/right of the
 * cell being filled. It ignores EMPTY neighbours, so it works on partial grids.
 */
export function isValidPlacement(grid, row, col, symbol) {
  // Rule 1: no 3-in-a-row. Slide a window of 3 across the cell in both axes.
  if (makesThreeInLine(grid, row, col, symbol, 0, 1)) return false; // horizontal
  if (makesThreeInLine(grid, row, col, symbol, 1, 0)) return false; // vertical

  // Rule 2: at most 3 of this symbol per row / per column.
  let rowCount = 0;
  let colCount = 0;
  for (let i = 0; i < SIZE; i++) {
    if (i !== col && grid[row][i] === symbol) rowCount++;
    if (i !== row && grid[i][col] === symbol) colCount++;
  }
  if (rowCount + 1 > HALF) return false;
  if (colCount + 1 > HALF) return false;

  return true;
}

/**
 * Would placing `symbol` at (row,col) complete a run of three identical
 * symbols along direction (dr,dc)? Checks the three windows that contain the
 * cell: [-2,-1,0], [-1,0,+1], [0,+1,+2]. A window only counts if all three of
 * its cells (the candidate plus two real neighbours) hold `symbol`.
 */
function makesThreeInLine(grid, row, col, symbol, dr, dc) {
  for (let offset = -2; offset <= 0; offset++) {
    let run = true;
    for (let k = 0; k < 3; k++) {
      const r = row + dr * (offset + k);
      const c = col + dc * (offset + k);
      // The candidate cell itself is treated as `symbol`; others must match.
      const value = r === row && c === col ? symbol : cellAt(grid, r, c);
      if (value !== symbol) {
        run = false;
        break;
      }
    }
    if (run) return true;
  }
  return false;
}

/** Read a cell, returning EMPTY for out-of-bounds coordinates. */
function cellAt(grid, r, c) {
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return EMPTY;
  return grid[r][c];
}

/**
 * Do all `clues` that touch (row,col) stay satisfiable with `symbol` there?
 * Only clues whose *other* cell is already filled can be violated; clues with
 * an empty partner are still open and pass for now.
 */
export function satisfiesClues(grid, clues, row, col, symbol) {
  for (const clue of clues) {
    const isA = clue.r1 === row && clue.c1 === col;
    const isB = clue.r2 === row && clue.c2 === col;
    if (!isA && !isB) continue;

    const other = isA ? grid[clue.r2][clue.c2] : grid[clue.r1][clue.c1];
    if (other === EMPTY) continue;

    if (clue.type === '=' && other !== symbol) return false;
    if (clue.type === 'x' && other === symbol) return false;
  }
  return true;
}

// --- solution generation (Phase A) -----------------------------------------

/**
 * Generate a fully-solved, rule-valid 6x6 grid via backtracking.
 *
 * Cells are filled in a fixed order (0..35). At each cell we try SUN and MOON
 * in a *random* order so every call produces a different board. isValidPlacement
 * prunes branches that break a rule; we recurse and backtrack on dead ends.
 */
export function generateSolution() {
  const grid = emptyGrid();
  if (!fillFrom(grid, 0)) {
    // Statistically unreachable on a 6x6, but never hand back a bad grid.
    throw new Error('Failed to generate a valid Tango solution');
  }
  return grid;
}

function fillFrom(grid, index) {
  if (index === SIZE * SIZE) return true; // all 36 cells placed
  const row = Math.floor(index / SIZE);
  const col = index % SIZE;

  for (const symbol of shuffled([SUN, MOON])) {
    if (!isValidPlacement(grid, row, col, symbol)) continue;
    grid[row][col] = symbol;
    if (fillFrom(grid, index + 1)) return true;
    grid[row][col] = EMPTY; // backtrack
  }
  return false;
}

// --- clue selection (Phase B) -----------------------------------------------

/**
 * Pick a small set of `=`/`x` clues that are consistent with `solution`.
 * We enumerate every orthogonally-adjacent pair, shuffle, take a handful, and
 * label each by comparing the two solved symbols (equal -> '=', else 'x').
 */
export function addClues(solution, count = 5) {
  const pairs = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (c + 1 < SIZE) pairs.push([r, c, r, c + 1]); // horizontal neighbour
      if (r + 1 < SIZE) pairs.push([r, c, r + 1, c]); // vertical neighbour
    }
  }

  return shuffled(pairs)
    .slice(0, count)
    .map(([r1, c1, r2, c2]) => ({
      r1,
      c1,
      r2,
      c2,
      type: solution[r1][c1] === solution[r2][c2] ? '=' : 'x',
    }));
}

// --- solution counting (shared solver) --------------------------------------

/**
 * Count how many complete, valid solutions `grid` admits under `clues`,
 * stopping early once `limitAt2` solutions are found (default 2). This early
 * cutoff is the whole trick: for uniqueness checking we never care about the
 * exact count, only whether it is exactly 1 or "more than 1", so we abort as
 * soon as a second solution appears. Pre-filled givens are treated as fixed.
 */
export function countSolutions(grid, clues = [], limitAt2 = 2) {
  const work = cloneGrid(grid);
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (work[r][c] === EMPTY) cells.push([r, c]);
    }
  }

  let found = 0;
  const solve = (i) => {
    if (i === cells.length) {
      found++;
      return found >= limitAt2; // signal caller to stop the search
    }
    const [row, col] = cells[i];
    for (const symbol of [SUN, MOON]) {
      if (
        isValidPlacement(work, row, col, symbol) &&
        satisfiesClues(work, clues, row, col, symbol)
      ) {
        work[row][col] = symbol;
        if (solve(i + 1)) return true; // early-out bubbles up
        work[row][col] = EMPTY;
      }
    }
    return false;
  };

  solve(0);
  return found;
}

// --- logic solver (no guessing) ---------------------------------------------

/**
 * Solve `grid` using ONLY forced moves — the deductions a human makes without
 * guessing. Repeatedly scans every empty cell; if exactly one of {sun, moon} is
 * legal there (respecting the no-3-in-a-row rule, the 3-per-line balance, and
 * the clues), that symbol is forced and filled in. This captures the standard
 * Tango techniques (adjacency forcing, line-balance completion, clue forcing).
 * We loop until a full pass makes no progress.
 *
 * Returns { solved, contradiction }: `solved` is true only if pure logic filled
 * the whole board. A puzzle that returns solved=true is guaranteed both unique
 * AND reachable step-by-step without trial and error — i.e. genuinely fair.
 */
export function forcedSolve(startGrid, clues, depth = 0) {
  const grid = cloneGrid(startGrid);
  let progress = true;
  let passes = 0; // number of deduction "waves"; a proxy for how deep the chains run
  let hardSteps = 0; // moves that required contradiction reasoning (a difficulty proxy)

  while (progress) {
    progress = false;

    // Level 1: single-cell forcing — fill any cell with only one legal symbol.
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] !== EMPTY) continue;
        const canSun =
          isValidPlacement(grid, r, c, SUN) && satisfiesClues(grid, clues, r, c, SUN);
        const canMoon =
          isValidPlacement(grid, r, c, MOON) && satisfiesClues(grid, clues, r, c, MOON);

        if (!canSun && !canMoon)
          return { solved: false, contradiction: true, passes, hardSteps };
        if (canSun !== canMoon) {
          grid[r][c] = canSun ? SUN : MOON; // only one option — forced move
          progress = true;
        }
      }
    }

    // Level 2+: contradiction reasoning. Only invoked when simple forcing stalls
    // (and depth budget remains). For an empty cell, hypothesise a symbol and
    // propagate with a shallower solver; if that leads to a contradiction, the
    // OTHER symbol is proven — this is provable deduction, not guessing.
    if (!progress && depth > 0) {
      outer: for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (grid[r][c] !== EMPTY) continue;
          for (const sym of [SUN, MOON]) {
            if (!isValidPlacement(grid, r, c, sym) || !satisfiesClues(grid, clues, r, c, sym)) {
              continue; // already impossible by level-1 checks
            }
            const test = cloneGrid(grid);
            test[r][c] = sym;
            if (forcedSolve(test, clues, depth - 1).contradiction) {
              grid[r][c] = sym === SUN ? MOON : SUN; // sym disproven → other is forced
              progress = true;
              hardSteps++;
              break outer;
            }
          }
        }
      }
    }

    if (progress) passes++;
  }

  let solved = true;
  for (let r = 0; r < SIZE && solved; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === EMPTY) {
        solved = false;
        break;
      }
    }
  }
  return { solved, contradiction: false, passes, hardSteps };
}

/**
 * True if the puzzle is solvable by pure deduction (no blind guessing). `depth`
 * controls how much contradiction reasoning is allowed: 0 = only direct
 * single-cell forcing (Easy…Expert); higher depths certify harder boards that
 * require "assume-and-refute" chains (the Master tier).
 */
export function isLogicSolvable(grid, clues, depth = 0) {
  return forcedSolve(grid, clues, depth).solved;
}

// --- puzzle carving (Phase C) -----------------------------------------------

/**
 * Turn a full `solution` (+ its `clues`) into a playable puzzle by removing
 * cells while keeping it solvable by PURE LOGIC (no guessing).
 *
 * We shuffle all 36 positions and greedily try to clear each one: tentatively
 * empty it, then check whether the remaining partial grid is still logic-solvable
 * (forcedSolve). If clearing the cell would force the player to guess, we put it
 * back (it's a required given); otherwise we leave it empty. Requiring
 * logic-solvability is strictly stronger than requiring a unique solution — it
 * guarantees the player can always reach the answer by deduction, which is what
 * makes the puzzle feel fair rather than "unsolvable". Shuffling the order makes
 * each carve (and thus each puzzle) different.
 *
 * The difficulty knob is `minGivens`: we stop clearing once we are down to
 * roughly `minGivens` cells. Fewer givens = harder (more deduction steps).
 */
export function makePuzzle(solution, clues, minGivens = 10, depth = 0) {
  const grid = cloneGrid(solution);
  const positions = shuffled(
    Array.from({ length: SIZE * SIZE }, (_, i) => [Math.floor(i / SIZE), i % SIZE])
  );

  let filled = SIZE * SIZE;
  for (const [r, c] of positions) {
    if (filled <= minGivens) break; // reached the target density — stop carving
    const saved = grid[r][c];
    grid[r][c] = EMPTY;
    if (!isLogicSolvable(grid, clues, depth)) {
      grid[r][c] = saved; // required given — without it the player would have to guess
    } else {
      filled--;
    }
  }

  const givens = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] !== EMPTY) givens.push({ r, c, v: grid[r][c] });
    }
  }
  return { givens, clues };
}

/** Generate one carved puzzle + its solution. */
function carveOne(clueCount, minGivens, depth) {
  const solution = generateSolution();
  const clues = addClues(solution, clueCount);
  const puzzle = makePuzzle(solution, clues, minGivens, depth);
  return { solution, puzzle };
}

/**
 * Full pipeline: generate a solved grid, attach clues, and carve a puzzle. Every
 * result is guaranteed solvable by pure logic (see makePuzzle).
 *
 * `sampleBest` enables difficulty-targeted rejection sampling: generate that
 * many candidate puzzles and keep the hardest one, scored by deduction depth
 * (forcedSolve passes — how many waves of forced moves the solve takes), with
 * fewer givens as a tie-breaker. Generation is ~0.5ms, so sampling dozens is
 * cheap. This is how the "Expert" tier gets its bite: not just few givens, but
 * boards that demand long chains of reasoning.
 */
export function createGame({ clueCount = 5, minGivens = 10, sampleBest = 1, depth = 0 } = {}) {
  if (sampleBest <= 1) return carveOne(clueCount, minGivens, depth);

  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < sampleBest; i++) {
    const candidate = carveOne(clueCount, minGivens, depth);
    const { passes, hardSteps } = forcedSolve(
      gridFromPuzzle(candidate.puzzle),
      candidate.puzzle.clues,
      depth
    );
    // Reward the amount of contradiction reasoning required most (that's what
    // actually makes a board hard for a human), then deduction depth, then
    // sparser boards. Most random boards need ~1 such step; the hardest need ~9.
    const score = hardSteps * 10000 + passes * 100 - candidate.puzzle.givens.length;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

// --- completion / progress helpers ------------------------------------------

/** Build the starting play grid for a puzzle: only the givens are filled. */
export function gridFromPuzzle(puzzle) {
  const grid = emptyGrid();
  for (const { r, c, v } of puzzle.givens) grid[r][c] = v;
  return grid;
}

/** Is (r,c) a pre-filled given (and therefore non-editable)? */
export function isGiven(puzzle, r, c) {
  return puzzle.givens.some((g) => g.r === r && g.c === c);
}

/** True when every cell of `grid` equals the corresponding cell of `solution`. */
export function isBoardComplete(grid, solution) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] !== solution[r][c]) return false;
    }
  }
  return true;
}

/**
 * Progress as a 0..1 fraction of cells that match the solution. Used for the
 * live opponent panel; comparing against the (unique) solution means only
 * genuinely-correct placements count toward the bar.
 */
export function progressFraction(grid, solution) {
  let correct = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] !== EMPTY && grid[r][c] === solution[r][c]) correct++;
    }
  }
  return correct / (SIZE * SIZE);
}
