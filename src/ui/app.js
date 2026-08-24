import { el, clear } from './dom.js';
import { renderSetup } from './setup.js';
import { renderMyTeam } from './myteam.js';
import { renderCenter } from './center.js';
import { renderBoard } from './board.js';
import { pickToSlot } from '../core/snake.js';
import { positionalNeeds, benchDepthIfAdded } from '../core/roster.js';
import { replacementPoints, withVbd } from '../core/vbd.js';
import { maxPositiveVbd } from '../core/recommend.js';
import { competitiveNotes } from '../core/competitive.js';
import { DEFAULT_CONFIG, createState, currentPickNumber, applyPick, applyOffListPick, undoPick, availablePlayers, rosterFor, rostersByTeam, myNextPick, myNextPickAfter, saveState, loadState, clearState } from '../core/state.js';

let state = null;
let allPlayers = [];
let replacement = null;
// Fixed for the whole draft, exactly like `replacement` — see recommend().
let vbdScale = 1;
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

function handleUndo() {
  state = undoPick(state);
  persist();
  renderDraft();
}

function handleReset() {
  if (!window.confirm('Clear this draft and return to setup?')) return;
  clearState();
  state = null;
  showSetup();
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
  const center = el('div', { class: 'panel' }, []);
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

  renderCenter(center, {
    pool,
    myRoster,
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
  }, { onPick: handlePick, onUndo: handleUndo, onOffList: handleOffListPick });

  renderBoard(right, { state, allPlayers });
}

export function init() {
  allPlayers = window.PLAYERS || [];
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

init();
