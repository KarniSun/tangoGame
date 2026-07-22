// multiplayer.js
// ---------------------------------------------------------------------------
// The ONLY module that talks to Firebase. It handles room creation/joining,
// writing this client's own progress/finish time, and subscribing to the room
// so we can watch the opponent live. Solo mode never imports this file.
//
// The Firebase SDK is loaded straight from the CDN as an ES module, so there is
// no build step. If you prefer, swap these URLs for locally-vendored copies.
// ---------------------------------------------------------------------------

import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig.js';

const SDK_VERSION = '10.12.2';
const APP_URL = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`;
const DB_URL = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-database.js`;

let db = null; // memoized Realtime Database handle
let rtdb = null; // memoized set of database functions from the SDK

/**
 * Lazily initialise Firebase and cache both the database handle and the SDK's
 * function bag. Throws a clear error if the config is still the placeholder, so
 * the UI can tell the user to paste their keys instead of failing cryptically.
 */
async function ensureDb() {
  if (db) return db;
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Firebase is not configured — paste your keys into src/firebaseConfig.js to play multiplayer.'
    );
  }
  const { initializeApp } = await import(APP_URL);
  rtdb = await import(DB_URL);
  const app = initializeApp(firebaseConfig);
  db = rtdb.getDatabase(app);
  return db;
}

/** Random 4-character room code (uppercase letters + digits, no ambiguity). */
export function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/** Reference to a room node, `rooms/{code}`. */
async function roomRef(code) {
  await ensureDb();
  return rtdb.ref(db, `rooms/${code}`);
}

/** Fresh, empty player node. */
function newPlayer() {
  return { progress: 0, finishTime: null, present: true };
}

/**
 * Create a room as player1: write the shared puzzle + solution and both player
 * slots. The room `shape` mirrors the brief:
 *   { puzzle, solution, createdAt, player1, player2 }.
 */
export async function createRoom(code, game, difficulty) {
  const ref = await roomRef(code);
  await rtdb.set(ref, {
    puzzle: game.puzzle,
    solution: game.solution,
    difficulty, // baked in so the joining player sees the host's choice
    createdAt: rtdb.serverTimestamp(),
    player1: newPlayer(),
    player2: { progress: 0, finishTime: null, present: false },
  });
  return 'player1';
}

/**
 * Join an existing room as player2. Reads the room once, fails if it does not
 * exist, marks player2 present, and returns the shared game plus this client's
 * role so the caller can build an identical GameSession.
 */
export async function joinRoom(code) {
  const ref = await roomRef(code);
  const snap = await rtdb.get(ref);
  if (!snap.exists()) throw new Error(`Room "${code}" not found.`);
  const data = snap.val();

  await rtdb.update(rtdb.ref(db, `rooms/${code}/player2`), { present: true });
  return {
    role: 'player2',
    game: { puzzle: data.puzzle, solution: data.solution },
    difficulty: data.difficulty ?? null,
  };
}

/** Write THIS client's progress fraction to its own player node only. */
export async function writeProgress(code, role, progress) {
  await ensureDb();
  await rtdb.update(rtdb.ref(db, `rooms/${code}/${role}`), { progress });
}

/** Write THIS client's finish time (seconds) to its own player node only. */
export async function writeFinish(code, role, finishTime) {
  await ensureDb();
  await rtdb.update(rtdb.ref(db, `rooms/${code}/${role}`), { finishTime });
}

/**
 * Subscribe to the whole room. `callback(roomData)` fires on every change, so
 * both clients independently see puzzle resets, opponent progress, and finish
 * times. Returns an unsubscribe function.
 */
export async function subscribeRoom(code, callback) {
  const ref = await roomRef(code);
  // In the modular SDK onValue() returns the unsubscribe function directly —
  // return it as-is rather than trying to re-detach via off().
  return rtdb.onValue(ref, (snap) => {
    if (snap.exists()) callback(snap.val());
  });
}

/**
 * Rematch: overwrite the room with a fresh puzzle and reset both players'
 * progress/finish while keeping their presence. Either client may call this;
 * the onValue subscription pushes the new board to both.
 */
export async function writeRematch(code, game, difficulty) {
  const ref = await roomRef(code);
  const snap = await rtdb.get(ref);
  const prev = snap.val() || {};
  await rtdb.update(ref, {
    puzzle: game.puzzle,
    solution: game.solution,
    difficulty,
    createdAt: rtdb.serverTimestamp(),
    player1: { progress: 0, finishTime: null, present: prev.player1?.present ?? true },
    player2: { progress: 0, finishTime: null, present: prev.player2?.present ?? true },
  });
}

/** Mark THIS client as gone so the opponent's panel reflects the departure. */
export async function leaveRoom(code, role) {
  await ensureDb();
  await rtdb.update(rtdb.ref(db, `rooms/${code}/${role}`), { present: false });
}

/** The opponent's role, given ours. */
export function opponentRole(role) {
  return role === 'player1' ? 'player2' : 'player1';
}

// ---------------------------------------------------------------------------
// PARTY MODE — up to 12 players, a lobby, N rounds, and a live leaderboard.
// Each client writes ONLY its own players/{id} subtree; the two shared,
// contended fields (`finishDeadline`, `status`) are written via single-shot
// transactions so exactly one client ever flips them.
// ---------------------------------------------------------------------------

export const MAX_PLAYERS = 12;

/** Random per-client player id (main.js persists it in sessionStorage). */
export function generatePlayerId() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += a[Math.floor(Math.random() * a.length)];
  return id;
}

/** Register onDisconnect so a dropped client is marked absent automatically. */
async function registerPresence(code, playerId) {
  await ensureDb();
  const presRef = rtdb.ref(db, `rooms/${code}/players/${playerId}/present`);
  rtdb.onDisconnect(presRef).set(false);
}

/** A fresh party-player node. */
function newPartyPlayer(name) {
  return {
    name,
    present: true,
    joinedAt: rtdb.serverTimestamp(),
    currentRound: 0,
    progress: 0,
    roundTimes: [],
    done: false,
    totalTime: null,
  };
}

/**
 * Peek at a room with a single read so the shared Join input can route by mode
 * and reject full / already-started rooms before committing to a flow.
 */
export async function peekRoom(code) {
  const ref = await roomRef(code);
  const snap = await rtdb.get(ref);
  if (!snap.exists()) return { exists: false };
  const data = snap.val();
  return {
    exists: true,
    mode: data.mode || '1v1', // legacy 1v1 rooms have no `mode`
    status: data.status || null,
    playerCount: data.players ? Object.keys(data.players).length : 0,
  };
}

/** Create a party room in the lobby state with the host as the first player. */
export async function createParty(code, { hostId, name, config }) {
  const ref = await roomRef(code);
  await rtdb.set(ref, {
    mode: 'party',
    status: 'lobby',
    hostId,
    config,
    createdAt: rtdb.serverTimestamp(),
    startedAt: null,
    finishDeadline: null,
    endedAt: null,
    players: { [hostId]: newPartyPlayer(name) },
  });
  await registerPresence(code, hostId);
}

/**
 * Join a party lobby. Rejects if the room is missing, already started (late
 * join blocked), or full. Returns the current room snapshot.
 */
export async function joinParty(code, { playerId, name }) {
  const ref = await roomRef(code);
  const snap = await rtdb.get(ref);
  if (!snap.exists()) throw new Error(`Room "${code}" not found.`);
  const data = snap.val();
  if (data.mode !== 'party') throw new Error('That code is not a party room.');
  if (data.status !== 'lobby') throw new Error('That game has already started.');
  if (data.players && Object.keys(data.players).length >= MAX_PLAYERS) {
    throw new Error('That room is full (12 players).');
  }
  await rtdb.update(rtdb.ref(db, `rooms/${code}/players/${playerId}`), newPartyPlayer(name));
  await registerPresence(code, playerId);
  return data;
}

/** Host edits lobby config (rounds / difficulty / grace). */
export async function updatePartyConfig(code, config) {
  await ensureDb();
  await rtdb.update(rtdb.ref(db, `rooms/${code}/config`), config);
}

/** Host starts the game: shared start time + the pre-generated round puzzles. */
export async function startParty(code, rounds) {
  await ensureDb();
  await rtdb.update(rtdb.ref(db, `rooms/${code}`), {
    status: 'playing',
    rounds,
    startedAt: rtdb.serverTimestamp(),
    finishDeadline: null,
  });
}

/** Write THIS client's own player fields only. */
export async function writePlayerState(code, playerId, patch) {
  await ensureDb();
  await rtdb.update(rtdb.ref(db, `rooms/${code}/players/${playerId}`), patch);
}

/**
 * Arm the global finish countdown — set only if still null, so the FIRST player
 * to complete all rounds wins the arm. Returns true if this client armed it.
 * (Absolute ms timestamp; ~1 s cross-device skew is fine for a 30–90 s window.)
 */
export async function armFinishDeadline(code, graceSeconds) {
  await ensureDb();
  const dref = rtdb.ref(db, `rooms/${code}/finishDeadline`);
  const res = await rtdb.runTransaction(dref, (cur) =>
    cur == null ? Date.now() + graceSeconds * 1000 : undefined
  );
  return res.committed;
}

/** Flip the room to finished exactly once (deadline reached, all done, or host). */
export async function finishParty(code) {
  await ensureDb();
  const sref = rtdb.ref(db, `rooms/${code}/status`);
  const res = await rtdb.runTransaction(sref, (cur) =>
    cur === 'playing' ? 'finished' : undefined
  );
  if (res.committed) {
    await rtdb.update(rtdb.ref(db, `rooms/${code}`), { endedAt: rtdb.serverTimestamp() });
  }
}

/** Mark THIS client absent (best-effort; onDisconnect also covers hard drops). */
export async function leaveParty(code, playerId) {
  await ensureDb();
  await rtdb.update(rtdb.ref(db, `rooms/${code}/players/${playerId}`), { present: false });
}

/**
 * Claim host when the previous host has left the lobby. CAS on `hostId` so only
 * the first claimer (whose `oldHostId` still matches) wins; others abort.
 */
export async function claimHost(code, playerId, oldHostId) {
  await ensureDb();
  const href = rtdb.ref(db, `rooms/${code}/hostId`);
  await rtdb.runTransaction(href, (cur) => (cur === oldHostId ? playerId : undefined));
}

/** Host restarts a fresh game for the same room: reset everyone, new puzzles. */
export async function partyPlayAgain(code, rounds) {
  const ref = await roomRef(code);
  const snap = await rtdb.get(ref);
  const prev = snap.val() || {};
  const players = {};
  for (const [id, p] of Object.entries(prev.players || {})) {
    players[id] = {
      ...p,
      currentRound: 0,
      progress: 0,
      roundTimes: [],
      done: false,
      totalTime: null,
    };
  }
  await rtdb.update(ref, {
    status: 'playing',
    rounds,
    startedAt: rtdb.serverTimestamp(),
    finishDeadline: null,
    endedAt: null,
    players,
  });
}
