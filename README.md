# Tango Duel

A 1v1 real-time version of the LinkedIn/Tango sun-and-moon logic puzzle. Two
players race to solve the **exact same** board; first to finish wins. Also
includes a solo practice mode. No accounts and no custom backend - a static site
plus Firebase Realtime Database for syncing the two players.

## Play locally

ES modules need to be served over HTTP (not opened as a `file://`). From this
folder:

```bash
python3 -m http.server 5178
# then open http://localhost:5178
```

Any static server works (`npx serve`, VS Code Live Server, etc.).

- **Practice Solo** works immediately - no Firebase needed.
- **Create Game / Join** need Firebase configured (see below).

## Configure Firebase (multiplayer only)

1. Create a free project at <https://firebase.google.com>.
2. Add a **Web app** and enable **Realtime Database**.
3. Copy the config values into [`src/firebaseConfig.js`](src/firebaseConfig.js)
   - including `databaseURL` (from the Realtime Database page).
4. Suggested database rules for this small, account-less game:

   ```json
   { "rules": { "rooms": { "$room": { ".read": true, ".write": true } } } }
   ```

## How multiplayer works

- **Create Game** generates a 4-char room code + a fresh puzzle, writes it to
  `rooms/{code}`, and shows a shareable link (`?room=CODE`).
- **Join** reads that room and loads the identical puzzle.
- Each client writes only its own `progress`/`finishTime` and subscribes to the
  room to watch the opponent live. The winner is computed independently by both
  clients from the shared finish times - no server logic.
- **Rematch** writes a new puzzle to the same room, resetting both players.

## Architecture

Puzzle generation, solving, and rule validation live in **one** place
([`src/puzzleEngine.js`](src/puzzleEngine.js)) and are reused identically by solo
and multiplayer. The engine is pure (no DOM/Firebase) and unit-testable.

| File | Responsibility |
| --- | --- |
| `src/puzzleEngine.js` | Pure logic: generate / solve / validate / carve |
| `src/gameSession.js` | Shared game state (grid, timer, moves) for both modes |
| `src/boardRenderer.js` | DOM rendering of the board + clue badges |
| `src/ui.js` | Screen switching, timer/panel display, result modal |
| `src/multiplayer.js` | The only file that talks to Firebase |
| `src/firebaseConfig.js` | Firebase config object |
| `src/main.js` | Entry point - wires modules together per mode |

### Puzzle generation (in `puzzleEngine.js`)

- `generateSolution()` - backtracking full-grid generator (random symbol order).
- `addClues(solution)` - picks `=`/`×` clues consistent with the solution.
- `makePuzzle(solution, clues, minGivens)` - clears cells while a solution
  counter confirms uniqueness; `minGivens` is the difficulty knob.
- `countSolutions(grid, clues)` - backtracking solver that stops at the 2nd
  solution; used for uniqueness checks.

## Deploy

Push the files to **GitHub Pages, Vercel, or Netlify** - no build step.
