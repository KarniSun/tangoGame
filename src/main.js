// main.js
// ---------------------------------------------------------------------------
// Entry point. Reads the chosen mode, builds the right combination of modules,
// and wires them together. It owns no puzzle logic and no rendering details —
// it just orchestrates GameSession + boardRenderer + ui, and (only in
// multiplayer) the multiplayer/Firebase layer.
// ---------------------------------------------------------------------------

import { GameSession } from './gameSession.js';
import { createGame } from './puzzleEngine.js';
import { renderBoard } from './boardRenderer.js';
import * as ui from './ui.js';

const BEST_KEY = 'tango-best-time';

// Difficulty presets fed into createGame(). Fewer givens = harder (more of the
// board must be deduced). The host's choice is baked into the generated puzzle,
// so in multiplayer the joining player automatically gets the same difficulty.
const DIFFICULTY = {
  easy: { minGivens: 16, clueCount: 5 },
  medium: { minGivens: 11, clueCount: 5 },
  hard: { minGivens: 6, clueCount: 5 },
};
let difficulty = 'medium'; // current home-screen selection
let activeDifficulty = 'medium'; // difficulty of the game currently being played

// Shared per-game runtime state. Rebuilt every time a game starts.
let session = null;
let board = null;
let mode = null; // 'solo' | 'create' | 'join'
let ticker = null; // interval id for the display clock
let finished = false; // guard so we resolve/show the result only once

// Multiplayer-only handles.
let mp = null; // lazily-imported multiplayer module
let roomCode = null;
let myRole = null;
let unsubscribe = null;
let canPlay = false; // gated until both players are present
let myFinishTime = null; // my elapsed seconds at solve, known before Firebase echoes it

// --- boot -------------------------------------------------------------------

ui.setupHome({ onSolo: startSolo, onCreate: startCreate, onJoin: startJoin });
ui.setupDifficulty((level) => (difficulty = level));
setupResultDismiss();
setupGameControls();

// A shared link (?room=ABCD) drops you straight into the join flow.
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  startJoin(roomParam.toUpperCase());
} else {
  ui.showScreen('home');
}

// --- solo mode --------------------------------------------------------------

function startSolo() {
  mode = 'solo';
  activeDifficulty = difficulty;
  beginGame(createGame(DIFFICULTY[difficulty]));
  ui.configureGameChrome({ mode });
  ui.setBest(loadBest());
  ui.setStatus('Solve it as fast as you can!');
}

// --- create (multiplayer host) ---------------------------------------------

async function startCreate() {
  mode = 'create';
  try {
    mp = await import('./multiplayer.js');
    roomCode = mp.generateRoomCode();
    activeDifficulty = difficulty;
    const game = createGame(DIFFICULTY[difficulty]);
    myRole = await mp.createRoom(roomCode, game, difficulty);

    beginGame(game);
    ui.configureGameChrome({ mode });
    ui.setShareLink(`${location.origin}${location.pathname}?room=${roomCode}`);
    ui.setStatus('Waiting for opponent to join…');
    await watchRoom();
  } catch (err) {
    failToHome(err);
  }
}

// --- join (multiplayer guest) ----------------------------------------------

async function startJoin(code) {
  mode = 'join';
  try {
    mp = await import('./multiplayer.js');
    roomCode = code;
    const { role, game, difficulty: diff } = await mp.joinRoom(code);
    myRole = role;
    activeDifficulty = diff || 'medium';

    beginGame(game);
    ui.configureGameChrome({ mode });
    ui.setStatus('Get ready…');
    await watchRoom();
  } catch (err) {
    failToHome(err);
  }
}

// --- shared game setup ------------------------------------------------------

/** Build a fresh session + board for `game` and show the game screen. */
function beginGame(game) {
  finished = false;
  myFinishTime = null;
  canPlay = mode === 'solo'; // multiplayer unlocks once both are present
  session = new GameSession();
  session.startNewPuzzle(game);
  if (mode === 'solo') session.startTimer();

  board = renderBoard(document.getElementById('board'), session, handleMove);
  ui.hideResult();
  ui.setDifficultyLabel(activeDifficulty);
  ui.updateSelf(0, 0);
  ui.updateOpponent(null);
  refreshUndo();
  ui.showScreen('game');
  startTicker();
}

/** Handle a tap on cell (r,c): apply the move, flash invalids, sync, check win. */
function handleMove(r, c) {
  if (finished || !canPlay) return;
  const result = session.makeMove(r, c);
  if (!result.changed) return;

  board.update();
  if (!result.valid) board.flashInvalid(r, c);
  refreshSelf();
  refreshUndo();

  if (mode !== 'solo') {
    mp.writeProgress(roomCode, myRole, session.getProgress()).catch(() => {});
  }
  if (session.isSolved()) handleLocalSolve();
}

/** Undo the last move and sync the reverted progress in multiplayer. */
function handleUndo() {
  if (finished || !canPlay) return;
  const reverted = session.undo();
  if (!reverted) return;
  board.update();
  refreshSelf();
  refreshUndo();
  if (mode !== 'solo') {
    mp.writeProgress(roomCode, myRole, session.getProgress()).catch(() => {});
  }
}

/** Enable the Undo button only when there is a move to take back. */
function refreshUndo() {
  document.getElementById('btn-undo').disabled = !session.canUndo();
}

/** The local player just completed the board. */
function handleLocalSolve() {
  myFinishTime = session.getElapsedTime();
  if (mode === 'solo') {
    resolveSolo();
  } else {
    mp.writeFinish(roomCode, myRole, myFinishTime).catch(() => {});
    // Outcome is resolved in the room subscription so both finish times agree.
  }
}

// --- multiplayer room watching ---------------------------------------------

async function watchRoom() {
  unsubscribe = await mp.subscribeRoom(roomCode, onRoomUpdate);
}

/** React to every room change: opponent presence, progress, and finish times. */
function onRoomUpdate(room) {
  maybeReloadPuzzle(room); // a rematch swaps in a new shared puzzle for both

  const oppKey = mp.opponentRole(myRole);
  const me = room[myRole] || {};
  const opp = room[oppKey] || {};

  ui.updateOpponent(opp);

  // Start the shared clock the moment both players are present.
  if (!canPlay && me.present && opp.present) {
    canPlay = true;
    session.startTimer();
    ui.setStatus('Go!');
  } else if (!opp.present) {
    ui.setStatus('Waiting for opponent to join…');
  }

  if (!finished) resolveMultiplayer(me, opp);
}

/**
 * Decide the winner from both players' finish times. Prefer the locally-known
 * finish time so we react instantly, before Firebase echoes our own write back.
 */
function resolveMultiplayer(me, opp) {
  const mine = myFinishTime ?? me.finishTime ?? null;
  const theirs = opp.finishTime ?? null;
  if (mine == null && theirs == null) return;

  let title;
  if (mine != null && theirs != null && mine === theirs) {
    title = "It's a tie! 🤝"; // exact same time — both clients agree it's a draw
  } else {
    let iWon;
    if (mine != null && theirs != null) {
      iWon = mine < theirs;
    } else if (mine != null) {
      iWon = true; // I finished and the opponent has not
    } else {
      iWon = false; // opponent finished first
    }
    title = iWon ? 'You won! 🎉' : 'Opponent won — better luck next time';
  }

  const mineStr = mine != null ? ui.formatTime(mine) : '—';
  const theirsStr = theirs != null ? ui.formatTime(theirs) : '—';

  finished = true;
  stopTicker();
  ui.showResult({
    title,
    message: `You: ${mineStr}  ·  Opponent: ${theirsStr}`,
    rematchLabel: 'Rematch',
    onRematch: doRematch,
    onHome: goHome,
  });
}

/** Rematch: write a new shared puzzle; the subscription reloads both clients. */
async function doRematch() {
  try {
    ui.hideResult();
    activeDifficulty = difficulty;
    await mp.writeRematch(roomCode, createGame(DIFFICULTY[difficulty]), difficulty);
  } catch (err) {
    failToHome(err);
  }
}

// A rematch (or any puzzle reset) is detected by the solution changing.
let lastSolutionKey = null;
function maybeReloadPuzzle(room) {
  const key = JSON.stringify(room.solution);
  if (lastSolutionKey && key !== lastSolutionKey) {
    activeDifficulty = room.difficulty || 'medium';
    beginGame({ puzzle: room.puzzle, solution: room.solution });
    canPlay = false; // re-gate until presence re-confirmed by the next update
  }
  lastSolutionKey = key;
}

// --- solo resolution --------------------------------------------------------

function resolveSolo() {
  finished = true;
  stopTicker();
  const seconds = session.getElapsedTime();
  const best = saveBestIfBetter(seconds);
  ui.setBest(best);
  ui.showResult({
    title: 'Solved! 🎉',
    message: `Your time: ${ui.formatTime(seconds)}${
      best === seconds ? '  ·  New personal best!' : ''
    }`,
    rematchLabel: 'New Puzzle',
    onRematch: () => {
      ui.hideResult();
      startSolo();
    },
    onHome: goHome,
  });
}

// --- display clock ----------------------------------------------------------

function startTicker() {
  stopTicker();
  ticker = setInterval(refreshSelf, 100);
}
function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}
function refreshSelf() {
  ui.updateSelf(session.getElapsedTime(), session.getProgress());
}

// --- personal best (solo, localStorage) ------------------------------------

function loadBest() {
  const raw = localStorage.getItem(BEST_KEY);
  return raw != null ? Number(raw) : null;
}
function saveBestIfBetter(seconds) {
  const best = loadBest();
  if (best == null || seconds < best) {
    localStorage.setItem(BEST_KEY, String(seconds));
    return seconds;
  }
  return best;
}

// --- teardown / navigation --------------------------------------------------

function goHome() {
  // Tell the opponent we left before tearing down the subscription (best-effort).
  if (mode !== 'solo' && mp && roomCode && myRole) {
    mp.leaveRoom(roomCode, myRole).catch(() => {});
  }
  cleanupRoom();
  stopTicker();
  ui.hideResult();
  ui.setStatus('');
  history.replaceState(null, '', location.pathname); // drop ?room from the URL
  ui.showScreen('home');
}

function cleanupRoom() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  roomCode = null;
  myRole = null;
  lastSolutionKey = null;
}

function failToHome(err) {
  console.error(err);
  cleanupRoom();
  ui.setHomeError(err.message || 'Something went wrong.');
  ui.showScreen('home');
}

function setupGameControls() {
  document.getElementById('btn-leave').addEventListener('click', goHome);
  document.getElementById('btn-undo').addEventListener('click', handleUndo);
  document.getElementById('btn-new-solo').addEventListener('click', () => {
    ui.hideResult();
    startSolo();
  });
  document.getElementById('btn-copy').addEventListener('click', async () => {
    const link = document.getElementById('share-link');
    try {
      await navigator.clipboard.writeText(link.value);
      const btn = document.getElementById('btn-copy');
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    } catch {
      link.select(); // clipboard API blocked (e.g. insecure origin) — fall back
    }
  });
}

function setupResultDismiss() {
  // Clicking the dimmed backdrop closes the modal without leaving the game.
  document.getElementById('result-modal').addEventListener('click', (e) => {
    if (e.target.id === 'result-modal') ui.hideResult();
  });
}
