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
export function setupHome({ onSolo, onCreate, onJoin }) {
  $('btn-solo').addEventListener('click', onSolo);
  $('btn-create').addEventListener('click', onCreate);
  $('btn-join').addEventListener('click', () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (code) onJoin(code);
  });
  $('join-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
}

/**
 * Wire the difficulty segmented control. Clicking a button marks it active and
 * calls `onChange(level)` with 'easy' | 'medium' | 'hard'. Purely presentational
 * — main.js keeps the selected value and feeds it into the puzzle generator.
 */
export function setupDifficulty(onChange) {
  const buttons = document.querySelectorAll('.diff-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.toggle('active', b === btn));
      onChange(btn.dataset.diff);
    });
  });
}

/** Toggle which mode-specific chrome is visible on the game screen. */
export function configureGameChrome({ mode }) {
  const multiplayer = mode === 'create' || mode === 'join';
  $('opponent-panel').classList.toggle('hidden', !multiplayer);
  $('share-box').classList.toggle('hidden', mode !== 'create');
  $('solo-controls').classList.toggle('hidden', multiplayer);
  $('you-label').textContent = multiplayer ? 'You' : 'Solo';
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
    player?.finishTime != null ? formatTime(player.finishTime) : present ? 'playing…' : '—';
}

/** Show a transient status line (e.g. "Waiting for opponent to join…"). */
export function setStatus(text) {
  $('status').textContent = text || '';
}

/** Show/refresh the solo personal-best label. */
export function setBest(seconds) {
  $('solo-best').textContent = seconds != null ? `Best: ${formatTime(seconds)}` : '';
}

/** Show an error message on the home screen. */
export function setHomeError(text) {
  $('home-error').textContent = text || '';
}

/**
 * Show the result modal. `onRematch` may be null to hide the rematch button
 * (used by solo, which shows "New Puzzle" instead).
 */
export function showResult({ title, message, rematchLabel, onRematch, onHome }) {
  $('result-title').textContent = title;
  $('result-message').textContent = message;

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
