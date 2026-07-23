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

> `python3 -m http.server` sends no cache headers, so browsers may hold on to an
> old copy of an ES module after you edit it and leave you debugging code that is
> no longer running. If a change seems to have no effect, hard-reload
> (<kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>) or use a server that sends
> `Cache-Control: no-store`.

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
- **Party mode** (up to 12 players) shares a lobby, N rounds of pre-generated
  puzzles, and a live leaderboard. Each client writes only its own
  `players/{id}` subtree; the two contended fields (`finishDeadline`, `status`)
  are flipped through transactions so exactly one client ever wins the race.

### Leaving and rejoining

Your slot in a room is remembered per room code in `localStorage` under
`tango-room:{CODE}` (6-hour expiry, since 4-character codes get recycled). That
identity is what makes coming back work:

- Leaving, refreshing, or closing the tab and returning to the same code
  **re-attaches you to your own slot** rather than creating a second one - in
  party mode you resume on the round you were actually playing with your earlier
  round times intact, and in 1v1 you reclaim your original `player1`/`player2`
  slot instead of always landing in `player2`.
- New players may join a party while it is in the **lobby** or **finished** (they
  wait on the leaderboard and are included in the host's next "Play again"). Only
  a game actively in progress turns strangers away.
- **Play again** drops players who left and never returned, so the leaderboard
  does not accumulate ghosts. It runs as a transaction, so someone joining at the
  same moment is not clobbered.
- If the host leaves, the earliest-joined remaining player inherits the room -
  in every state, not just the lobby - so "End game" and "Play again" stay
  reachable.

## Coins

Every finished game pays out, and the balance is kept in `localStorage` under
`tango-profile`. The whole economy lives in one table at the top of
[`src/wallet.js`](src/wallet.js):

| Difficulty | Easy | Medium | Hard | Expert |
| --- | --- | --- | --- | --- |
| Base | 5 | 10 | 20 | 35 |

Solo pays the base; 1v1 and party pay double it. On top of that, a duel win pays
×1.5 (tie ×1.25, a loss still pays the full unit), and a party pays per round
completed plus a placement bonus of +100% / +50% / +25% for the top three.

**Nobody leaves empty-handed.** A player who never finishes still earns a share
scaled by how much of the board they had right, with a floor of 1 coin - a game
you cannot profit from is a game people quit halfway through.

`loadProfile()` / `saveProfile()` in `wallet.js` are the only two functions that
touch storage, which is the seam an account-backed sync would replace.

## Cosmetics

Coins buy cosmetics from the **Shop** on the home screen, catalogued in
[`src/cosmetics.js`](src/cosmetics.js). Four slots, one equipped item each:

| Slot | What it changes | Seen by others |
| --- | --- | --- |
| Sun & moon | `--sun` / `--moon` | no |
| Board theme | `--cell-bg`, `--given-bg`, `--line`, `--cream` | no |
| Avatar | an emoji beside your name | **yes** |
| Title | a small tag beside your name | **yes** |

Skins and themes are nothing but CSS custom properties written onto `<html>`, so
equipping one restyles the game with no re-render. This is why the sun and moon
SVGs in `boardRenderer.js` use `fill="var(--sun)"` rather than literal hex.

Board themes must define **both** a `light` and a `dark` variant. They override
the same variables the dark palette sets, and an inline style on `:root` beats
any stylesheet rule - so a one-variant theme would silently break the light/dark
toggle. `applyCosmetics()` picks the right variant and is re-run on every theme
change.

Avatars and titles ride along in each room's player node, which is how they reach
other players' lobbies and leaderboards.

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
| `src/wallet.js` | Coin balance, ownership, and the payout table |
| `src/cosmetics.js` | Shop catalog + applying equipped items as CSS variables |
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
