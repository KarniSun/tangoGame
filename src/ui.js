// ui.js
// ---------------------------------------------------------------------------
// Presentation glue: screen switching, timer/progress display, opponent panel,
// share link, and the result modal. It only *reads* values handed to it (from a
// GameSession or a Firebase room snapshot) and renders them. No puzzle logic,
// no Firebase calls, no move validation live here.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

/** Format seconds as e.g. "42.3s". */
export function formatTime(seconds) {
  return `${seconds.toFixed(1)}s`;
}

/** Show exactly one top-level screen ('home' | 'game'). */
export function showScreen(name) {
  for (const screen of document.querySelectorAll('.screen')) {
    screen.classList.toggle('active', screen.id === `screen-${name}`);
  }
}

/** Wire the home-screen buttons. Callbacks are supplied by main.js. */
export function setupHome({ onSolo, onCreate, onParty, onJoin }) {
  $('btn-solo').addEventListener('click', onSolo);
  $('btn-create').addEventListener('click', onCreate);
  $('btn-party').addEventListener('click', onParty);
  $('btn-join').addEventListener('click', () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (code) onJoin(code);
  });
  $('join-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
}

/** The player's chosen display name (trimmed); persisted by main.js. */
export function getPlayerName() {
  return $('player-name').value.trim();
}
export function setPlayerName(name) {
  $('player-name').value = name || '';
}

/**
 * Wire a segmented control: clicking a `.<btnClass>` inside `container` marks it
 * active and reports the chosen value from `data-<attr>`. Reused by the home and
 * lobby difficulty selectors and the rounds/countdown pickers.
 */
function wireSegment(container, btnClass, attr, onChange) {
  const buttons = container.querySelectorAll(`.${btnClass}`);
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.toggle('active', b === btn));
      onChange(btn.dataset[attr]);
    });
  });
}

/**
 * Wire the HOME difficulty control only (scoped so it never grabs the lobby's
 * own difficulty buttons). Calls `onChange('easy'|'medium'|'hard'|'expert')`.
 */
export function setupDifficulty(onChange) {
  wireSegment($('screen-home'), 'diff-btn', 'diff', onChange);
}

/** Toggle which mode-specific chrome is visible on the game screen. */
export function configureGameChrome({ mode, isHost = false }) {
  const oneVone = mode === 'create' || mode === 'join';
  const party = mode === 'party';
  $('opponent-panel').classList.toggle('hidden', !oneVone);
  $('share-box').classList.toggle('hidden', mode !== 'create');
  $('solo-controls').classList.toggle('hidden', oneVone || party);
  $('leaderboard-strip').classList.toggle('hidden', !party);
  $('btn-end-game').classList.toggle('hidden', !(party && isHost));
  $('you-label').textContent = mode === 'solo' ? 'Solo' : 'You';
  if (!party) hideCountdown();
}

/** Display the shareable room link (create mode). */
export function setShareLink(url) {
  $('share-link').value = url;
  $('share-box').classList.remove('hidden');
}

/** Update the player's own timer + progress bar. */
export function updateSelf(seconds, progressFraction) {
  $('you-timer').textContent = formatTime(seconds);
  $('you-progress').style.width = `${Math.round(progressFraction * 100)}%`;
}

/** Update the opponent panel from the room snapshot's player node. */
export function updateOpponent(player) {
  const present = player && player.present;
  $('opp-status').textContent = present ? '' : 'waiting…';
  $('opp-progress').style.width = `${Math.round((player?.progress || 0) * 100)}%`;
  $('opp-timer').textContent =
    player?.finishTime != null ? formatTime(player.finishTime) : present ? 'playing…' : '-';
}

/** Show a transient status line (e.g. "Waiting for opponent to join…"). */
export function setStatus(text) {
  $('status').textContent = text || '';
}

/**
 * Show the difficulty badge (e.g. "Hard") for the current game, colour-coded by
 * level. Passing a falsy value hides it. Shown in every mode so a joining player
 * immediately sees the host's chosen difficulty.
 */
export function setDifficultyLabel(level) {
  const badge = $('difficulty-badge');
  if (!level) {
    badge.classList.add('hidden');
    return;
  }
  badge.textContent = level.charAt(0).toUpperCase() + level.slice(1);
  badge.className = `diff-badge diff-${level}`; // reset then apply level colour
}

/** Show/refresh the solo personal-best label. */
export function setBest(seconds) {
  $('solo-best').textContent = seconds != null ? `Best: ${formatTime(seconds)}` : '';
}

/** Show an error message on the home screen. */
export function setHomeError(text) {
  $('home-error').textContent = text || '';
}

/** Refresh the coin balance shown on the home card. */
export function setCoins(amount) {
  $('coin-balance').textContent = String(amount);
}

/** Fill (or hide) one of the "+N coins earned" lines. */
function setCoinsLine(id, earned) {
  const el = $(id);
  if (earned == null) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = `🪙 +${earned} coin${earned === 1 ? '' : 's'}`;
  el.classList.remove('hidden');
}

/**
 * Show the result modal. `onRematch` may be null to hide the rematch button
 * (used by solo, which shows "New Puzzle" instead). `coins` is the payout for
 * the game that just ended, or null to show no coin line at all.
 */
export function showResult({ title, message, coins = null, rematchLabel, onRematch, onHome }) {
  $('result-title').textContent = title;
  $('result-message').textContent = message;
  setCoinsLine('result-coins', coins);

  const rematchBtn = $('result-rematch');
  if (onRematch) {
    rematchBtn.textContent = rematchLabel || 'Rematch';
    rematchBtn.classList.remove('hidden');
    rematchBtn.onclick = onRematch;
  } else {
    rematchBtn.classList.add('hidden');
  }
  $('result-home').onclick = onHome;
  $('result-modal').classList.remove('hidden');
}

export function hideResult() {
  $('result-modal').classList.add('hidden');
}

// --- party mode -------------------------------------------------------------

/** Build one leaderboard row element (names use textContent - never innerHTML). */
function rowEl(e) {
  const row = document.createElement('div');
  row.className = 'lb-row' + (e.isMe ? ' you' : '');
  const rk = document.createElement('span');
  rk.className = 'rk';
  rk.textContent = e.rank;
  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.textContent = e.name;
  const tag = document.createElement('span');
  tag.className = `tag tag-${e.tone || 'solving'}`;
  tag.textContent = e.label;
  const tm = document.createElement('span');
  tm.className = 'tm';
  tm.textContent = e.time || '';
  row.append(rk, nm, tag, tm);
  return row;
}

/** Set the active button of a segmented control to the one matching `val`. */
function setSegActive(container, attr, val) {
  container.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset[attr] === val);
  });
}

/** Wire the lobby's config controls and action buttons (host + guest). */
export function setupLobbyControls({ onRounds, onDifficulty, onGrace, onStart, onLeave, onCopy }) {
  wireSegment($('lobby-rounds'), 'seg-btn', 'rounds', (v) => onRounds(Number(v)));
  wireSegment($('lobby-diff'), 'diff-btn', 'diff', onDifficulty);
  wireSegment($('lobby-grace'), 'seg-btn', 'grace', (v) => onGrace(Number(v)));
  $('btn-start-party').addEventListener('click', onStart);
  $('btn-lobby-leave').addEventListener('click', onLeave);
  $('btn-lobby-copy').addEventListener('click', onCopy);
}

const DIFF_NAME = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

/** Render the lobby: room code, player chips, and host config vs guest wait. */
export function renderLobby({ code, players, config, isHost }) {
  $('lobby-code').textContent = code;
  const list = $('lobby-players');
  list.innerHTML = '';
  players.forEach((p) => {
    const chip = document.createElement('span');
    chip.className = 'pchip' + (p.isMe ? ' me' : '');
    chip.textContent = p.name;
    if (p.isHost) {
      const star = document.createElement('span');
      star.className = 'pchip-host';
      star.textContent = ' ★';
      chip.appendChild(star);
    }
    list.appendChild(chip);
  });

  $('lobby-host').classList.toggle('hidden', !isHost);
  $('lobby-wait').classList.toggle('hidden', isHost);
  if (isHost) {
    setSegActive($('lobby-rounds'), 'rounds', String(config.rounds));
    setSegActive($('lobby-diff'), 'diff', config.difficulty);
    setSegActive($('lobby-grace'), 'grace', String(config.graceSeconds));
  } else {
    $('lobby-wait').textContent = `Waiting for the host to start… (${config.rounds} rounds · ${
      DIFF_NAME[config.difficulty] || config.difficulty
    })`;
  }
}

/** Render the compact live standings strip (leader + you, tap to expand all). */
export function renderLiveStandings(rows) {
  const strip = $('leaderboard-strip');
  strip.innerHTML = '';

  const full = document.createElement('div');
  full.className = 'lb-full';
  rows.forEach((r) => full.appendChild(rowEl(r)));

  const collapsed = document.createElement('div');
  collapsed.className = 'lb-collapsed';
  const top = rows[0];
  const me = rows.find((r) => r.isMe);
  if (top) collapsed.appendChild(rowEl(top));
  if (me && me !== top) collapsed.appendChild(rowEl(me));

  const hint = document.createElement('div');
  hint.className = 'lb-hint';
  const setHint = () => {
    hint.textContent = strip.classList.contains('expanded')
      ? 'tap to collapse'
      : `tap to see all ${rows.length}`;
  };
  setHint();

  strip.append(collapsed, full, hint);
  strip.onclick = () => {
    strip.classList.toggle('expanded');
    setHint();
  };
}

function fmtClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Show/refresh the global finish countdown banner (urgent under 10 s). */
export function showCountdown(secondsLeft) {
  const el = $('round-countdown');
  el.classList.remove('hidden');
  el.classList.toggle('urgent', secondsLeft <= 10);
  $('round-countdown-time').textContent = fmtClock(secondsLeft);
}
export function hideCountdown() {
  $('round-countdown').classList.add('hidden');
  $('round-countdown').classList.remove('urgent');
}

let toastTimer = null;
/** Briefly flash a non-blocking "Round k/N" toast on an instant round change. */
export function flashRoundToast(text) {
  const el = $('round-toast');
  el.textContent = text;
  el.classList.remove('hidden');
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    el.classList.add('hidden');
  }, 1100);
}

/** Show the full final leaderboard. `onPrimary` null hides the primary button. */
export function showLeaderboard({ title, rows, coins = null, primaryLabel, onPrimary, onHome }) {
  $('leaderboard-title').textContent = title;
  const list = $('leaderboard-list');
  list.innerHTML = '';
  rows.forEach((r) => list.appendChild(rowEl(r)));
  setCoinsLine('leaderboard-coins', coins);

  const pr = $('leaderboard-primary');
  if (onPrimary) {
    pr.textContent = primaryLabel || 'Play again';
    pr.classList.remove('hidden');
    pr.onclick = onPrimary;
  } else {
    pr.classList.add('hidden');
  }
  $('leaderboard-home').onclick = onHome;
  $('leaderboard-modal').classList.remove('hidden');
}
export function hideLeaderboard() {
  $('leaderboard-modal').classList.add('hidden');
}
