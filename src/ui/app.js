import { el, clear } from './dom.js';
import { renderSetup } from './setup.js';
import { renderMyTeam } from './myteam.js';
import { renderCenter, resetView } from './center.js';
import { renderBoard } from './board.js';
import { pickToSlot } from '../core/snake.js';
import { positionalNeeds, benchDepthIfAdded } from '../core/roster.js';
import { replacementPoints, withVbd } from '../core/vbd.js';
import { maxPositiveVbd, maxOverallRank } from '../core/recommend.js';
import { competitiveNotes } from '../core/competitive.js';
import { DEFAULT_CONFIG, createState, currentPickNumber, applyPick, applyOffListPick, undoPick, setPick, availablePlayers, rosterFor, rostersByTeam, myNextPick, myNextPickAfter, saveState, loadState, clearState, playersWithOwners, serialize, deserialize, backupFilename } from '../core/state.js';

let state = null;
let allPlayers = [];
let replacement = null;
// Fixed for the whole draft, exactly like `replacement` — see recommend().
let vbdScale = 1;
// The BPA denominator, also fixed for the whole draft: a position filter narrows the
// pool recommend() sees, and deriving this from that pool would move the denominator.
let poolSize = 1;
// False once a save has failed, so the user is warned before they trust a refresh.
let storageWorks = true;

function scaleFromReplacement() {
  return maxPositiveVbd(withVbd(allPlayers, replacement));
}

function persist() {
  storageWorks = saveState(state);
}

function root() {
  return document.getElementById('app');
}

function startDraft(config) {
  state = createState(config);
  // Baselines depend on numTeams and slots, both of which the setup screen lets the
  // user change, so they must be recomputed for the config just chosen — not left
  // over from whatever config (default or a previously loaded draft) preceded this.
  replacement = replacementPoints(allPlayers, state.config.numTeams, state.config.slots);
  vbdScale = scaleFromReplacement();
  persist();
  renderDraft();
}

function showSetup() {
  const container = root();
  clear(container);
  renderSetup(container, (state && state.config) || DEFAULT_CONFIG, startDraft);
}

function handlePick(playerId) {
  try {
    state = applyPick(state, playerId);
  } catch (err) {
    window.alert(err.message);
    return;
  }
  persist();
  renderDraft();
}

// Someone drafted a player who is not in the loaded pool. Burn the slot so every
// later pick still lands on the right pick number and the right team.
function handleOffListPick() {
  try {
    state = applyOffListPick(state);
  } catch (err) {
    window.alert(err.message);
    return;
  }
  persist();
  renderDraft();
}

function handleEditPick(pickNumber, playerId) {
  try {
    state = setPick(state, pickNumber, playerId);
  } catch (err) {
    window.alert(err.message);
    return;
  }
  persist();
  renderDraft();
}

function handleUndo() {
  state = undoPick(state);
  persist();
  renderDraft();
}

function handleReset() {
  if (!window.confirm('Clear this draft and return to setup?')) return;
  clearState();
  state = null;
  // The centre panel's sort/filter/search is module state and would otherwise
  // survive into the next draft.
  resetView();
  showSetup();
}

// Blob and FileReader, not a library: the page ships as one self-contained file and
// takes no dependency, ever.
function handleBackup() {
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: backupFilename(state) }, []);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function handleImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let restored;
    try {
      restored = deserialize(String(reader.result));
    } catch {
      window.alert('That file is not a saved draft.');
      return;
    }
    if (!window.confirm('Replace the current draft with this backup?')) return;
    state = restored;
    replacement = replacementPoints(allPlayers, state.config.numTeams, state.config.slots);
    vbdScale = scaleFromReplacement();
    // The centre panel's sort, filter and position targeting are module state that
    // outlives a draft. Without this an imported draft inherits the last one's targeting.
    resetView();
    persist();
    renderDraft();
  };
  reader.readAsText(file);
}

function renderDraft() {
  const container = root();
  const { config } = state;
  const currentPick = currentPickNumber(state);
  const round = currentPick === null ? config.rounds : pickToSlot(currentPick, config.numTeams).round;
  const pickingTeam = currentPick === null ? null : pickToSlot(currentPick, config.numTeams).teamIndex;
  const isMyPick = pickingTeam === config.myTeamIndex;

  // VBD baselines are computed once from the full pool, so replacement level does not
  // drift as players come off the board — that is what makes VBD comparable all draft.
  const pool = withVbd(availablePlayers(state, allPlayers), replacement);
  // Every player, drafted or not, for the table. `pool` stays available-only so the
  // recommendation path structurally cannot see a drafted player.
  const tablePlayers = withVbd(playersWithOwners(state, allPlayers), replacement);
  const myRoster = rosterFor(state, config.myTeamIndex, allPlayers);
  const needs = positionalNeeds(myRoster, config.slots, round, config.rounds);
  // How deep the bench would get at each position if this pick went there.
  const surplus = benchDepthIfAdded(myRoster, config.slots);
  const nextPick = myNextPick(state);
  // The selection after this one — what the competitive window is measured over,
  // and what the header shows when it is already your turn.
  const nextAfterCurrent = currentPick === null ? null : myNextPickAfter(state, currentPick);

  const notes = isMyPick
    ? competitiveNotes({
      currentPick,
      nextPick: nextAfterCurrent,
      numTeams: config.numTeams,
      rounds: config.rounds,
      rostersByTeam: rostersByTeam(state, allPlayers),
      slots: config.slots,
      pool,
      replacement,
    })
    : [];

  clear(container);
  const left = el('div', { class: 'panel' }, []);
  const center = el('div', { class: 'panel center' }, []);
  const right = el('div', { class: 'panel' }, []);

  // localStorage can be unavailable or throw (Safari on file://, blocked site data,
  // quota). Saving then silently no-ops, and the user only finds out when a refresh
  // loses the draft — so say so, on every render, until it works again.
  if (!storageWorks) {
    container.appendChild(el('div', {
      class: 'notes',
      text: 'Draft is NOT being saved — do not refresh this page. '
        + 'Browser storage is unavailable (private window, blocked site data, or full).',
    }, []));
  }

  container.appendChild(el('div', { class: 'layout' }, [left, center, right]));

  renderMyTeam(left, {
    roster: myRoster,
    slots: config.slots,
    round,
    totalRounds: config.rounds,
    teamName: config.teams[config.myTeamIndex - 1].name,
  });
  left.appendChild(el('button', {
    text: 'Reset draft', style: { marginTop: '12px' }, onClick: handleReset,
  }, []));
  left.appendChild(el('button', { text: 'Save backup', style: { marginTop: '8px' }, onClick: handleBackup }, []));
  const importInput = el('input', {
    type: 'file', accept: '.json,application/json', style: { display: 'none' },
    onChange: (e) => { if (e.target.files && e.target.files[0]) handleImport(e.target.files[0]); },
  }, []);
  left.appendChild(el('button', { text: 'Import backup', style: { marginTop: '8px' }, onClick: () => importInput.click() }, []));
  left.appendChild(importInput);

  renderCenter(center, {
    pool,
    tablePlayers,
    myRoster,
    slots: config.slots,
    needs,
    surplus,
    currentPick,
    nextPick: isMyPick ? nextAfterCurrent : nextPick,
    round,
    numTeams: config.numTeams,
    isMyPick,
    pickingTeamName: pickingTeam ? config.teams[pickingTeam - 1].name : '',
    notes,
    vbdScale,
    poolSize,
  }, { onPick: handlePick, onUndo: handleUndo, onOffList: handleOffListPick });

  renderBoard(right, {
    state,
    allPlayers,
    editablePool: availablePlayers(state, allPlayers),
    onEditPick: handleEditPick,
  });
}

export function init() {
  allPlayers = window.PLAYERS || [];
  // Depends only on the shipped pool, so unlike vbdScale it never needs recomputing
  // when the league config changes.
  poolSize = maxOverallRank(allPlayers);
  replacement = replacementPoints(allPlayers, DEFAULT_CONFIG.numTeams, DEFAULT_CONFIG.slots);
  vbdScale = scaleFromReplacement();

  const saved = loadState();
  if (saved) {
    state = saved;
    replacement = replacementPoints(allPlayers, state.config.numTeams, state.config.slots);
    vbdScale = scaleFromReplacement();
    renderDraft();
  } else {
    showSetup();
  }
}

// The built page has no bundler and no entry hook: evaluating this module IS the
// start signal, so the call has to stay at module scope. Under `node --test` there
// is a `process`, and the test must install its DOM stub and fixtures before
// anything renders — so it is skipped there and the test calls init() itself.
if (typeof process === 'undefined') init();
