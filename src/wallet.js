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
// touch persistence. Everything else goes through them. When accounts land,
// those two bodies are what change - the reward table and every caller stay put.
// ---------------------------------------------------------------------------

const PROFILE_KEY = 'tango-profile';

/** A brand-new player's wallet. Free cosmetics are implicitly owned. */
function emptyProfile() {
  return {
    coins: 0,
    owned: [], // ids of PURCHASED cosmetics; free ones are never listed
    equipped: {}, // { symbols, board, title, avatar } -> cosmetic id
  };
}

// --- the storage seam -------------------------------------------------------

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return emptyProfile();
    const p = JSON.parse(raw);
    return {
      coins: Number(p.coins) || 0,
      owned: Array.isArray(p.owned) ? p.owned : [],
      equipped: p.equipped && typeof p.equipped === 'object' ? p.equipped : {},
    };
  } catch {
    return emptyProfile(); // corrupt or blocked storage - start clean
  }
}

function saveProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* storage full or blocked - the balance just won't persist */
  }
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
