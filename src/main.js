// main.js
// ---------------------------------------------------------------------------
// Entry point. Reads the chosen mode, builds the right combination of modules,
// and wires them together. It owns no puzzle logic and no rendering details —
// it just orchestrates GameSession + boardRenderer + ui, and (only in
// multiplayer) the multiplayer/Firebase layer.
// ---------------------------------------------------------------------------

import { GameSession } from './gameSession.js';
import { createGame, EMPTY } from './puzzleEngine.js';
import { renderBoard } from './boardRenderer.js';
import * as ui from './ui.js';

const BEST_KEY = 'tango-best-time';
const NAME_KEY = 'tango-name';
const THEME_KEY = 'tango-theme'; // 'light' | 'dark' | absent (follow the system)
const RULES_KEY = 'tango-rules-open';

// Difficulty presets fed into createGame(). Fewer givens = harder (more of the
// board must be deduced). The host's choice is baked into the generated puzzle,
// so in multiplayer the joining player automatically gets the same difficulty.
const DIFFICULTY = {
  easy: { minGivens: 16, clueCount: 5 },
  medium: { minGivens: 11, clueCount: 5 },
  hard: { minGivens: 6, clueCount: 5 },
  // Expert: sample 120 candidates and keep the one demanding the MOST
  // contradiction-reasoning steps (~9 vs a typical 1) — still fully fair, never
  // guessing, but relentlessly demanding.
  expert: { minGivens: 0, clueCount: 2, sampleBest: 120, depth: 1 },
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

const HINT_INITIAL = 30; // seconds before the FIRST hint of a puzzle/round
const HINT_COOLDOWN = 15; // seconds between hints afterwards
let hintReadyAt = 0; // epoch ms when the Hint button becomes usable again

// Party-only state.
let myId = null; // this client's player id within the party
let isHost = false;
let partyConfig = null; // { rounds, difficulty, graceSeconds }
let partyRounds = []; // the shared array of round puzzles
let myRound = 0; // index of the round I'm currently on
let myRoundTimes = []; // my per-round solve times
let partyRoom = null; // latest room snapshot (for the countdown ticker)
let partyStarted = false; // have I entered round 0 of the current game?
let partyPrevStatus = null; // to detect finished→playing (play again)
let partyFinalShown = false;
let finishRequested = false; // guard so finishParty is only fired once per game

// --- boot -------------------------------------------------------------------

ui.setupHome({ onSolo: startSolo, onCreate: startCreate, onParty: startCreateParty, onJoin: routeJoin });
ui.setupDifficulty((level) => (difficulty = level));
ui.setPlayerName(localStorage.getItem(NAME_KEY) || '');
setupResultDismiss();
setupGameControls();
setupPartyControls();
setupTheme();
setupRules();

// A shared link (?room=ABCD) drops you straight into the join flow (auto-detects
// whether the code is a 1v1 room or a party).
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  routeJoin(roomParam.toUpperCase());
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

// --- party mode -------------------------------------------------------------

const NAME_ADJ = ['Swift', 'Brave', 'Clever', 'Sunny', 'Lunar', 'Bright', 'Bold', 'Cosmic', 'Golden', 'Quiet'];
const NAME_ANIMAL = ['Fox', 'Owl', 'Otter', 'Hawk', 'Panda', 'Wolf', 'Lynx', 'Crane', 'Koala', 'Raven'];

/** A friendly random fallback name so nameless players stay distinguishable. */
function randomName() {
  const a = NAME_ADJ[Math.floor(Math.random() * NAME_ADJ.length)];
  const b = NAME_ANIMAL[Math.floor(Math.random() * NAME_ANIMAL.length)];
  return `${a} ${b}`;
}

/**
 * Read the display name. If the field is empty we assign a friendly random name
 * (e.g. "Swift Fox") rather than a shared "Player", so multiple nameless players
 * don't collide on the leaderboard. The chosen name is remembered and shown back
 * in the field for next time.
 */
function playerName() {
  const n = ui.getPlayerName() || randomName();
  localStorage.setItem(NAME_KEY, n);
  ui.setPlayerName(n);
  return n;
}

function partyLink() {
  return `${location.origin}${location.pathname}?room=${roomCode}`;
}

/** Wire the lobby controls, the host "End game" button, and party dismissals. */
function setupPartyControls() {
  ui.setupLobbyControls({
    onRounds: (n) => hostSetConfig({ rounds: n }),
    onDifficulty: (d) => hostSetConfig({ difficulty: d }),
    onGrace: (g) => hostSetConfig({ graceSeconds: g }),
    onStart: hostStartParty,
    onLeave: goHome,
    onCopy: copyPartyLink,
  });
  document.getElementById('btn-end-game').addEventListener('click', () => {
    if (isHost) mp.finishParty(roomCode).catch(() => {});
  });
  document.getElementById('leaderboard-home').addEventListener('click', goHome);
}

async function copyPartyLink() {
  try {
    await navigator.clipboard.writeText(partyLink());
    const btn = document.getElementById('btn-lobby-copy');
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy link'), 1500);
  } catch {
    /* clipboard blocked — ignore */
  }
}

/** Host: push a config change to the room (guests see it live). */
function hostSetConfig(patch) {
  if (isHost && roomCode) mp.updatePartyConfig(roomCode, patch).catch(() => {});
}

/** Create a party and enter its lobby as host. */
async function startCreateParty() {
  mode = 'party';
  try {
    mp = await import('./multiplayer.js');
    const name = playerName();
    roomCode = mp.generateRoomCode();
    myId = mp.generatePlayerId();
    isHost = true;
    const config = { rounds: 3, difficulty, graceSeconds: 60 };
    await mp.createParty(roomCode, { hostId: myId, name, config });
    enterLobby();
    await watchRoom();
  } catch (err) {
    failToHome(err);
  }
}

/** Join a party's lobby. */
async function joinPartyFlow(code) {
  mode = 'party';
  try {
    mp = await import('./multiplayer.js');
    const name = playerName();
    roomCode = code;
    myId = mp.generatePlayerId();
    isHost = false;
    await mp.joinParty(code, { playerId: myId, name });
    enterLobby();
    await watchRoom();
  } catch (err) {
    failToHome(err);
  }
}

/** Route a typed/shared code to the right flow by peeking at the room's mode. */
async function routeJoin(code) {
  try {
    mp = await import('./multiplayer.js');
    const info = await mp.peekRoom(code);
    if (!info.exists) throw new Error(`Room "${code}" not found.`);
    if (info.mode === 'party') {
      if (info.status !== 'lobby') throw new Error('That game has already started.');
      await joinPartyFlow(code);
    } else {
      await startJoin(code);
    }
  } catch (err) {
    failToHome(err);
  }
}

function enterLobby() {
  partyStarted = false;
  partyFinalShown = false;
  partyPrevStatus = null;
  finishRequested = false;
  myRound = 0;
  myRoundTimes = [];
  stopTicker();
  ui.hideLeaderboard();
  ui.hideResult();
  ui.hideCountdown();
  ui.showScreen('lobby');
}

/** Host generates the round puzzles and starts the game for everyone. */
async function hostStartParty() {
  if (!isHost) return;
  const cfg = (partyRoom && partyRoom.config) || { rounds: 3, difficulty: 'medium', graceSeconds: 60 };
  const btn = document.getElementById('btn-start-party');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    await new Promise((r) => setTimeout(r, 20)); // let the label paint first
    const rounds = Array.from({ length: cfg.rounds }, () => createGame(DIFFICULTY[cfg.difficulty]));
    await mp.startParty(roomCode, rounds);
  } catch (err) {
    failToHome(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start game';
  }
}

/** The single party subscription handler: lobby → playing → finished. */
function onPartyRoomUpdate(room) {
  partyRoom = room;
  isHost = room.hostId === myId;

  if (room.status === 'lobby') {
    maybeMigrateHost(room);
    const players = presentSortedByJoin(room).map(([id, p]) => ({
      name: p.name,
      isMe: id === myId,
      isHost: id === room.hostId,
    }));
    ui.renderLobby({ code: roomCode, players, config: room.config || {}, isHost });
    ui.showScreen('lobby');
  } else if (room.status === 'playing') {
    if (partyPrevStatus !== 'playing') partyStarted = false; // (re)start / play-again
    if (!partyStarted) {
      partyStarted = true;
      partyFinalShown = false;
      finishRequested = false;
      partyRounds = room.rounds || [];
      partyConfig = room.config || {};
      activeDifficulty = partyConfig.difficulty || 'medium';
      myRound = 0;
      myRoundTimes = [];
      ui.hideLeaderboard();
      startPartyRound(0);
    }
    ui.renderLiveStandings(buildRows(room, 'live'));
    updatePartyCountdown(room);
  } else if (room.status === 'finished') {
    showPartyFinal(room);
  }

  partyPrevStatus = room.status;
}

/** Present players, earliest-joined first. */
function presentSortedByJoin(room) {
  return Object.entries(room.players || {})
    .filter(([, p]) => p.present !== false)
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
}

/** If the host has left the lobby, the earliest-joined present player claims it. */
function maybeMigrateHost(room) {
  const host = (room.players || {})[room.hostId];
  if (host && host.present !== false) return;
  const present = presentSortedByJoin(room);
  if (present.length && present[0][0] === myId) {
    mp.claimHost(roomCode, myId, room.hostId).catch(() => {});
  }
}

/** Start (or instantly advance to) round k of the party. */
function startPartyRound(k) {
  myRound = k;
  beginGame(partyRounds[k]); // renders the board + shows the game screen
  session.startTimer();
  canPlay = true;
  ui.configureGameChrome({ mode: 'party', isHost });
  ui.setStatus(`Round ${k + 1} of ${partyRounds.length}`);
  if (k > 0) ui.flashRoundToast(`Round ${k + 1}/${partyRounds.length}`);
}

/** I solved my current round: record it and either advance or finish. */
function handlePartySolve() {
  myRoundTimes = [...myRoundTimes, session.getElapsedTime()];
  myRound += 1;
  canPlay = false;
  const N = partyRounds.length;

  if (myRound < N) {
    mp.writePlayerState(roomCode, myId, {
      currentRound: myRound,
      roundTimes: myRoundTimes,
    }).catch(() => {});
    startPartyRound(myRound); // instant next round
  } else {
    const total = myRoundTimes.reduce((a, b) => a + b, 0);
    mp.writePlayerState(roomCode, myId, {
      currentRound: N,
      roundTimes: myRoundTimes,
      done: true,
      totalTime: total,
    }).catch(() => {});
    mp.armFinishDeadline(roomCode, (partyConfig && partyConfig.graceSeconds) || 60).catch(() => {});
    ui.setStatus(`You finished! Total ${fmtTotal(total)} — waiting for others…`);
  }
}

/** Drive the global countdown from the shared deadline; end the game once due. */
function updatePartyCountdown(room) {
  const done = allPresentDone(room);
  if (room.finishDeadline) {
    const left = (room.finishDeadline - Date.now()) / 1000;
    ui.showCountdown(left);
    if ((left <= 0 || done) && !finishRequested) {
      finishRequested = true;
      mp.finishParty(roomCode).catch(() => {});
    }
  } else {
    ui.hideCountdown();
    if (done && !finishRequested) {
      finishRequested = true;
      mp.finishParty(roomCode).catch(() => {});
    }
  }
}

function allPresentDone(room) {
  const ps = Object.values(room.players || {}).filter((p) => p.present !== false);
  return ps.length > 0 && ps.every((p) => p.done === true);
}

/** Build sorted leaderboard rows for the live strip ('live') or final board. */
function buildRows(room, context) {
  const N = partyRounds.length || (room.rounds ? room.rounds.length : room.config?.rounds) || 0;
  const players = Object.entries(room.players || {}).map(([id, p]) => {
    const times = p.roundTimes || [];
    const sum = times.reduce((a, b) => a + (b || 0), 0);
    return {
      id,
      name: p.name || 'Player',
      present: p.present !== false,
      done: !!p.done,
      roundsDone: times.length,
      sum,
      progress: p.progress || 0,
    };
  });
  players.sort(
    (a, b) => b.roundsDone - a.roundsDone || a.sum - b.sum || b.progress - a.progress
  );
  return players.map((p, i) => {
    let label;
    let tone;
    if (p.done) {
      label = context === 'final' ? `${N}/${N}` : 'Done';
      tone = 'done';
    } else if (!p.present) {
      label = 'left';
      tone = 'left';
    } else if (context === 'final') {
      label = `${p.roundsDone}/${N}`; // didn't finish before the game closed
      tone = 'left';
    } else {
      label = `R${Math.min(p.roundsDone + 1, N)}/${N}`;
      tone = 'solving';
    }
    return {
      rank: i + 1,
      name: p.name,
      label,
      tone,
      time: p.roundsDone || p.done ? fmtTotal(p.sum) : '',
      isMe: p.id === myId,
    };
  });
}

/** Format a total time: "42.3s" under a minute, "m:ss" over. */
function fmtTotal(sec) {
  if (sec == null) return '';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

function showPartyFinal(room) {
  canPlay = false;
  stopTicker();
  ui.hideCountdown();
  ui.showLeaderboard({
    title: 'Final results',
    rows: buildRows(room, 'final'),
    primaryLabel: 'Play again',
    onPrimary: isHost ? partyPlayAgainAction : null,
    onHome: goHome,
  });
  partyFinalShown = true;
}

async function partyPlayAgainAction() {
  if (!isHost) return;
  try {
    ui.hideLeaderboard();
    const cfg = (partyRoom && partyRoom.config) || partyConfig;
    const rounds = Array.from({ length: cfg.rounds }, () => createGame(DIFFICULTY[cfg.difficulty]));
    await mp.partyPlayAgain(roomCode, rounds);
  } catch (err) {
    failToHome(err);
  }
}

// --- shared game setup ------------------------------------------------------

/** Build a fresh session + board for `game` and show the game screen. */
function beginGame(game) {
  finished = false;
  fullHintShown = false;
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
  hintReadyAt = Date.now() + HINT_INITIAL * 1000; // first hint unlocks after 30 s
  refreshHint();
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
  refreshConflicts();
  syncProgress();
  if (session.isSolved()) handleLocalSolve();
}

/** Push this client's progress to Firebase for the active multiplayer mode. */
function syncProgress() {
  if (mode === 'create' || mode === 'join') {
    mp.writeProgress(roomCode, myRole, session.getProgress()).catch(() => {});
  } else if (mode === 'party') {
    mp.writePlayerState(roomCode, myId, { progress: session.getProgress() }).catch(() => {});
  }
}

/** Undo the last move and sync the reverted progress in multiplayer. */
function handleUndo() {
  if (finished || !canPlay) return;
  const reverted = session.undo();
  if (!reverted) return;
  board.update();
  refreshSelf();
  refreshUndo();
  refreshConflicts();
  syncProgress();
}

/** Clear all the player's moves back to the initial puzzle, and sync progress. */
function handleReset() {
  if (finished || !canPlay || !session.canUndo()) return;
  session.reset();
  board.update();
  refreshSelf();
  refreshUndo();
  refreshConflicts();
  syncProgress();
}

/** Enable Undo/Reset only when there is at least one move to take back. */
function refreshUndo() {
  const disabled = !session.canUndo();
  document.getElementById('btn-undo').disabled = disabled;
  document.getElementById('btn-reset').disabled = disabled;
}

/**
 * Hint: point out a wrong cell first (so the player fixes their own mistake),
 * otherwise reveal one correct cell. Then start the 30 s cooldown.
 */
function handleHint() {
  if (finished || !canPlay || Date.now() < hintReadyAt) return;
  const h = session.revealHint();
  if (!h) return;
  if (h.type === 'reveal') {
    board.update();
    refreshSelf();
    refreshUndo();
    refreshConflicts();
    syncProgress();
  }
  board.highlightHint(h.r, h.c);
  hintReadyAt = Date.now() + HINT_COOLDOWN * 1000;
  refreshHint();
  if (session.isSolved()) handleLocalSolve();
}

/** Update the Hint button's cooldown label / disabled state. */
function refreshHint() {
  const btn = document.getElementById('btn-hint');
  const left = Math.ceil((hintReadyAt - Date.now()) / 1000);
  if (left > 0) {
    btn.disabled = true;
    btn.textContent = `Hint ${left}s`;
  } else {
    btn.disabled = false;
    btn.textContent = '💡 Hint';
  }
}

// Whether the "board full but incorrect" hint currently occupies the status line.
let fullHintShown = false;

/**
 * When the board is completely full but still not the solution, explain why it
 * didn't count as solved. Only fires on a full board, so it never nags mid-play.
 */
function refreshConflicts() {
  const full = session.grid.every((row) => row.every((v) => v !== EMPTY));
  if (full && !session.isSolved()) {
    ui.setStatus('Board full, but not solved — check the = / × clues and each row & column.');
    fullHintShown = true;
  } else if (fullHintShown) {
    ui.setStatus(''); // clear the hint once the player edits the board again
    fullHintShown = false;
  }
}

/** The local player just completed the board. */
function handleLocalSolve() {
  if (mode === 'solo') {
    myFinishTime = session.getElapsedTime();
    resolveSolo();
  } else if (mode === 'party') {
    handlePartySolve();
  } else {
    myFinishTime = session.getElapsedTime();
    mp.writeFinish(roomCode, myRole, myFinishTime).catch(() => {});
    // Outcome is resolved in the room subscription so both finish times agree.
  }
}

// --- multiplayer room watching ---------------------------------------------

async function watchRoom() {
  const handler = mode === 'party' ? onPartyRoomUpdate : onRoomUpdate;
  unsubscribe = await mp.subscribeRoom(roomCode, handler);
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
  ticker = setInterval(tick, 100);
}
function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}
function tick() {
  refreshSelf();
  refreshHint(); // count the hint cooldown down
  // Party countdown must advance between room events, so run it every tick.
  if (mode === 'party' && partyRoom && partyRoom.status === 'playing') {
    updatePartyCountdown(partyRoom);
  }
}
function refreshSelf() {
  if (session) ui.updateSelf(session.getElapsedTime(), session.getProgress());
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
  // Tell others we left before tearing down the subscription (best-effort).
  if ((mode === 'create' || mode === 'join') && mp && roomCode && myRole) {
    mp.leaveRoom(roomCode, myRole).catch(() => {});
  } else if (mode === 'party' && mp && roomCode && myId) {
    mp.leaveParty(roomCode, myId).catch(() => {});
  }
  cleanupRoom();
  stopTicker();
  ui.hideResult();
  ui.hideLeaderboard();
  ui.hideCountdown();
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
  myId = null;
  isHost = false;
  partyRoom = null;
  partyStarted = false;
  partyPrevStatus = null;
  partyFinalShown = false;
  finishRequested = false;
}

function failToHome(err) {
  console.error(err);
  cleanupRoom();
  ui.setHomeError(err.message || 'Something went wrong.');
  ui.showScreen('home');
}

function setupGameControls() {
  document.getElementById('btn-leave').addEventListener('click', goHome);
  document.getElementById('btn-hint').addEventListener('click', handleHint);
  document.getElementById('btn-undo').addEventListener('click', handleUndo);
  document.getElementById('btn-reset').addEventListener('click', handleReset);
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

// --- theme (light/dark toggle) ----------------------------------------------
// No saved choice → follow the OS (via the prefers-color-scheme CSS). A saved
// choice sets data-theme on <html>, which the stylesheet lets override the OS.

function setupTheme() {
  applyTheme(localStorage.getItem(THEME_KEY)); // null → follow system
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = isDarkNow() ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  updateThemeIcon();
}

function isDarkNow() {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced) return forced === 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function updateThemeIcon() {
  // Show the action: a sun while dark (tap → light), a moon while light.
  document.getElementById('theme-toggle').textContent = isDarkNow() ? '☀️' : '🌙';
}

// --- rules dropdown ---------------------------------------------------------
// Open by default so newcomers see the rules without being told; once someone
// closes it, that choice is remembered.

function setupRules() {
  const el = document.getElementById('rules');
  el.open = localStorage.getItem(RULES_KEY) !== 'false';
  el.addEventListener('toggle', () => localStorage.setItem(RULES_KEY, String(el.open)));
}
