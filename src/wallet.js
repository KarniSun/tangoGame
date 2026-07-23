// wallet.js
// ---------------------------------------------------------------------------
// Coins, owned cosmetics, and the payout table. Two jobs, deliberately kept in
// one module:
//
//   1. computeReward() - a PURE function. Given how a game went it returns the
//      coin payout. No storage, no DOM, no Firebase, so the economy can be
//      re-tuned (or tested) entirely from the table at the top of this file.
//   2. The wallet itself - balance, ownership, and equipped items.
//
// STORAGE SEAM: loadProfile() and saveProfile() are the ONLY two functions that
// touch persistence. Everything else goes through them, and they stay
// synchronous against an in-memory copy so no caller had to become async when
// accounts arrived - a sign-in just swaps where that copy is persisted to.
//
// Guest -> account merge: signing in ADDS the guest balance to the account,
// unions the owned items in, and then RESETS the guest wallet. That reset is
// what makes it idempotent - signing in twice cannot double-count, and coins
// earned as a guest AFTER a sign-out still merge correctly next time. No
// "already merged" flag is needed.
// ---------------------------------------------------------------------------

import { getDb } from './firebaseApp.js';

const PROFILE_KEY = 'tango-profile';

/** A brand-new player's wallet. Free cosmetics are implicitly owned. */
function emptyProfile() {
  return {
    coins: 0,
    owned: [], // ids of PURCHASED cosmetics; free ones are never listed
    equipped: {}, // { symbols, board, title, avatar } -> cosmetic id
  };
}

/** Coerce anything we read (localStorage or Firebase) into a valid profile. */
function normalise(p) {
  if (!p || typeof p !== 'object') return emptyProfile();
  return {
    coins: Number(p.coins) || 0,
    owned: Array.isArray(p.owned) ? p.owned : [],
    equipped: p.equipped && typeof p.equipped === 'object' ? p.equipped : {},
  };
}

// --- the storage seam -------------------------------------------------------

let accountUid = null; // null while playing as a guest
let cache = null; // the live in-memory profile
let notify = null; // called when a remote change lands, so the UI can refresh

function readGuest() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? normalise(JSON.parse(raw)) : emptyProfile();
  } catch {
    return emptyProfile(); // corrupt or blocked storage - start clean
  }
}

function writeGuest(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* storage full or blocked - the balance just won't persist */
  }
}

function loadProfile() {
  if (!cache) cache = readGuest();
  return cache;
}

function saveProfile(profile) {
  cache = profile;
  if (accountUid) queueRemoteWrite(profile);
  else writeGuest(profile);
}

// --- the reward table -------------------------------------------------------
// Tuned so a typical game pays enough that the cheapest cosmetics are ~3 games
// away and the flagships ~40. Multiplayer pays double solo because it costs you
// a friend's time as well as your own.

const BASE = { easy: 5, medium: 10, hard: 20, expert: 35 };
const MODE_MULT = { solo: 1, duel: 2, party: 2 };
const RANK_BONUS = { 1: 1.0, 2: 0.5, 3: 0.25 }; // extra fraction of the earned pot

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

/**
 * What a finished game pays out.
 *
 * `mode` is 'solo' | 'duel' | 'party'. For a duel, `outcome` is
 * 'win' | 'tie' | 'loss' | 'unfinished'. For a party, `roundsDone` /
 * `totalRounds` describe how far you got and `rank` is your finishing place.
 * `progress` (0..1) is how much of the board you had filled in correctly when
 * the game ended, and is what pays out players who never finished.
 *
 * Everyone who takes part earns at least 1 coin - losing still pays, because a
 * game you can't profit from is a game people quit halfway through.
 */
export function computeReward({
  mode,
  difficulty,
  outcome = null,
  roundsDone = 0,
  totalRounds = 0,
  progress = 0,
  rank = null,
}) {
  const unit = (BASE[difficulty] ?? BASE.medium) * (MODE_MULT[mode] ?? 1);
  let coins;

  if (mode === 'party') {
    const done = totalRounds > 0 && roundsDone >= totalRounds;
    // A finished player's last board sits at progress 1; only pay the partial
    // credit to someone still mid-round, or they'd collect a phantom round.
    const partial = done ? 0 : Math.round(unit * clamp01(progress));
    const bonus = roundsDone > 0 ? Math.round(unit * roundsDone * (RANK_BONUS[rank] || 0)) : 0;
    coins = unit * roundsDone + partial + bonus;
  } else if (mode === 'duel') {
    if (outcome === 'win') coins = unit * 1.5;
    else if (outcome === 'tie') coins = unit * 1.25;
    else if (outcome === 'loss') coins = unit;
    else coins = unit * 0.4 * clamp01(progress); // never solved it
  } else {
    coins = unit; // solo
  }

  return Math.max(1, Math.round(coins));
}

// --- balance ----------------------------------------------------------------

export function getCoins() {
  return loadProfile().coins;
}

/** Add (or, with a negative amount, spend) coins. Returns the new balance. */
export function addCoins(amount) {
  const profile = loadProfile();
  profile.coins = Math.max(0, profile.coins + Math.round(amount));
  saveProfile(profile);
  return profile.coins;
}

// --- ownership --------------------------------------------------------------

export function owns(id) {
  return loadProfile().owned.includes(id);
}

export function getOwned() {
  return loadProfile().owned;
}

/**
 * Buy a cosmetic. Returns { ok, reason, coins }. Refuses rather than throwing so
 * the shop can just render the reason. Purchasing also equips the item - nobody
 * buys a skin they didn't want to wear.
 */
export function buy(id, price, slot) {
  const profile = loadProfile();
  if (profile.owned.includes(id)) return { ok: false, reason: 'owned', coins: profile.coins };
  if (profile.coins < price) return { ok: false, reason: 'poor', coins: profile.coins };

  profile.coins -= price;
  profile.owned = [...profile.owned, id];
  if (slot) profile.equipped = { ...profile.equipped, [slot]: id };
  saveProfile(profile);
  return { ok: true, coins: profile.coins };
}

// --- equipped ---------------------------------------------------------------

export function getEquipped() {
  return loadProfile().equipped;
}

export function equip(slot, id) {
  const profile = loadProfile();
  profile.equipped = { ...profile.equipped, [slot]: id };
  saveProfile(profile);
  return profile.equipped;
}

// --- accounts ---------------------------------------------------------------
// Signed in, the profile lives at `profiles/{uid}` in the Realtime Database and
// localStorage goes back to being an empty guest wallet.
//
// Note the balance is CLIENT-AUTHORITATIVE: the database rules stop other people
// writing your profile, but nothing stops you writing your own from the console.
// Making that impossible needs server-side validation (Cloud Functions).

let unsubscribeRemote = null;
let writeTimer = null;

/**
 * Fold a guest wallet into an account's. Pure, so the rule that matters most -
 * you never lose coins and never gain them twice - can be tested directly.
 */
export function mergeProfiles(remote, guest) {
  const r = normalise(remote);
  const g = normalise(guest);
  return {
    coins: r.coins + g.coins,
    owned: [...new Set([...r.owned, ...g.owned])],
    // An established account keeps what it was wearing; a brand-new one adopts
    // whatever the guest had on, so signing up doesn't visibly undress you.
    equipped: Object.keys(r.equipped).length ? r.equipped : g.equipped,
  };
}

/** Debounced, so a burst of purchases is one write rather than several. */
function queueRemoteWrite(profile) {
  const uid = accountUid;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    writeTimer = null;
    if (accountUid !== uid) return; // signed out or switched while waiting
    try {
      const { db, rtdb } = await getDb();
      await rtdb.set(rtdb.ref(db, `profiles/${uid}`), {
        ...profile,
        updatedAt: rtdb.serverTimestamp(),
      });
    } catch {
      /* offline - the in-memory copy stays correct and syncs on the next write */
    }
  }, 400);
}

/**
 * Attach the wallet to a signed-in account, folding in whatever was earned as a
 * guest. Safe to call repeatedly for the same uid.
 *
 * `onRemoteChange` fires when another device changes the profile, so the caller
 * can refresh the balance and re-apply cosmetics.
 */
export async function attachAccount(uid, onRemoteChange) {
  const { db, rtdb } = await getDb();
  const ref = rtdb.ref(db, `profiles/${uid}`);

  const snap = await rtdb.get(ref);
  const merged = mergeProfiles(normalise(snap.exists() ? snap.val() : null), readGuest());

  accountUid = uid;
  notify = onRemoteChange || null;
  cache = merged;

  // Empty the guest wallet so its contents can never be merged in twice.
  writeGuest(emptyProfile());

  await rtdb.set(ref, { ...merged, updatedAt: rtdb.serverTimestamp() });

  if (unsubscribeRemote) unsubscribeRemote();
  unsubscribeRemote = rtdb.onValue(ref, (s) => {
    if (!s.exists() || accountUid !== uid) return;
    cache = normalise(s.val());
    if (notify) notify();
  });

  return merged;
}

/** Detach on sign-out: back to a fresh, empty guest wallet. */
export function detachAccount() {
  if (unsubscribeRemote) unsubscribeRemote();
  unsubscribeRemote = null;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  accountUid = null;
  notify = null;
  cache = emptyProfile();
  writeGuest(cache);
}

export function isSignedIn() {
  return accountUid !== null;
}
