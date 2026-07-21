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
export async function createRoom(code, game) {
  const ref = await roomRef(code);
  await rtdb.set(ref, {
    puzzle: game.puzzle,
    solution: game.solution,
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
export async function writeRematch(code, game) {
  const ref = await roomRef(code);
  const snap = await rtdb.get(ref);
  const prev = snap.val() || {};
  await rtdb.update(ref, {
    puzzle: game.puzzle,
    solution: game.solution,
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
