import { el, clear } from './dom.js';
import { renderSetup } from './setup.js';
import { renderMyTeam } from './myteam.js';
import { renderCenter } from './center.js';
import { renderBoard } from './board.js';
import { pickToSlot, nextPickForTeam } from '../core/snake.js';
import { positionalNeeds } from '../core/roster.js';
import { replacementPoints, withVbd } from '../core/vbd.js';
import { competitiveNotes } from '../core/competitive.js';
import { DEFAULT_CONFIG, createState, currentPickNumber, applyPick, undoPick, availablePlayers, rosterFor, rostersByTeam, myNextPick, saveState, loadState, clearState } from '../core/state.js';

let state = null;
let allPlayers = [];
let replacement = null;

function root() {
  return document.getElementById('app');
}

function startDraft(config) {
  state = createState(config);
  saveState(state);
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
  saveState(state);
  renderDraft();
}

function handleUndo() {
  state = undoPick(state);
  saveState(state);
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
  const nextPick = myNextPick(state);

  const notes = isMyPick
    ? competitiveNotes({
      currentPick,
      nextPick: nextPickForTeam(currentPick, config.myTeamIndex, config.numTeams, config.rounds),
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
    currentPick,
    nextPick,
    round,
    numTeams: config.numTeams,
    isMyPick,
    pickingTeamName: pickingTeam ? config.teams[pickingTeam - 1].name : '',
    notes,
  }, { onPick: handlePick, onUndo: handleUndo });

  renderBoard(right, { state, allPlayers, currentPick });
}

export function init() {
  allPlayers = window.PLAYERS || [];
  replacement = replacementPoints(allPlayers, DEFAULT_CONFIG.numTeams, DEFAULT_CONFIG.slots);

  const saved = loadState();
  if (saved) {
    state = saved;
    replacement = replacementPoints(allPlayers, state.config.numTeams, state.config.slots);
    renderDraft();
  } else {
    showSetup();
  }
}

init();
