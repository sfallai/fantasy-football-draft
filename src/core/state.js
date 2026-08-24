import { pickToSlot, slotToPick, totalPicks, nextPickForTeam } from './snake.js';
import { DEFAULT_SLOTS } from './roster.js';

export const STORAGE_KEY = 'ffdraft.state.v1';

// Any manager may draft someone who is not in the pool (a rookie, a handcuff, an
// injured stash). Such a pick still consumes its slot, so it is recorded under a
// sentinel id that matches no player: unique per pick so the duplicate check keeps
// working, and recognisable so renderers can show it as an off-list pick.
export const OFF_LIST_PREFIX = 'off-list-';

export function isOffListId(playerId) {
  return String(playerId).startsWith(OFF_LIST_PREFIX);
}

function defaultTeams(numTeams) {
  return Array.from({ length: numTeams }, (_, i) => ({ name: `Team ${i + 1}`, keeper: null }));
}

export const DEFAULT_CONFIG = {
  numTeams: 10,
  rounds: 15,
  scoring: 'standard',
  draftType: 'snake',
  myTeamIndex: 4,
  slots: { ...DEFAULT_SLOTS },
  teams: defaultTeams(10),
};

export function createState(config) {
  const full = { ...DEFAULT_CONFIG, ...config };
  full.slots = { ...DEFAULT_SLOTS, ...(config.slots || {}) };
  full.teams = config.teams && config.teams.length === full.numTeams
    ? config.teams.map((t) => ({ name: t.name, keeper: t.keeper || null }))
    : defaultTeams(full.numTeams);

  const picks = {};
  full.teams.forEach((team, i) => {
    if (!team.keeper || !team.keeper.playerId) return;
    const teamIndex = i + 1;
    const round = Number(team.keeper.round) || 1;
    const pick = slotToPick(round, teamIndex, full.numTeams);
    picks[pick] = { playerId: String(team.keeper.playerId), teamIndex, isKeeper: true };
  });

  return { config: full, picks, history: [] };
}

export function currentPickNumber(state) {
  const last = totalPicks(state.config.numTeams, state.config.rounds);
  for (let pick = 1; pick <= last; pick += 1) {
    if (!state.picks[pick]) return pick;
  }
  return null;
}

export function pickedIds(state) {
  return new Set(Object.values(state.picks).map((entry) => entry.playerId));
}

export function applyPick(state, playerId) {
  const pick = currentPickNumber(state);
  if (pick === null) throw new Error('Draft is complete — no picks remain');
  if (pickedIds(state).has(String(playerId))) {
    throw new Error(`Player ${playerId} is already drafted`);
  }

  const { teamIndex } = pickToSlot(pick, state.config.numTeams);
  return {
    ...state,
    picks: { ...state.picks, [pick]: { playerId: String(playerId), teamIndex, isKeeper: false } },
    history: [...state.history, pick],
  };
}

// Consumes the current pick slot without naming a player from the pool, so a pick
// the app cannot represent never shifts every later pick onto the wrong team.
export function applyOffListPick(state) {
  const pick = currentPickNumber(state);
  if (pick === null) throw new Error('Draft is complete — no picks remain');
  return applyPick(state, `${OFF_LIST_PREFIX}${pick}`);
}

export function undoPick(state) {
  if (state.history.length === 0) return state;
  const history = [...state.history];
  const pick = history.pop();
  const picks = { ...state.picks };
  delete picks[pick];
  return { ...state, picks, history };
}

export function availablePlayers(state, allPlayers) {
  const taken = pickedIds(state);
  return allPlayers.filter((pl) => !taken.has(pl.id));
}

export function rosterFor(state, teamIndex, allPlayers) {
  const byId = new Map(allPlayers.map((pl) => [pl.id, pl]));
  return Object.keys(state.picks)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((pick) => state.picks[pick].teamIndex === teamIndex)
    .map((pick) => byId.get(state.picks[pick].playerId))
    .filter(Boolean);
}

export function rostersByTeam(state, allPlayers) {
  const out = {};
  for (let i = 1; i <= state.config.numTeams; i += 1) out[i] = [];

  const byId = new Map(allPlayers.map((pl) => [pl.id, pl]));
  for (const pick of Object.keys(state.picks).map(Number).sort((a, b) => a - b)) {
    const entry = state.picks[pick];
    const player = byId.get(entry.playerId);
    if (player && out[entry.teamIndex]) out[entry.teamIndex].push(player);
  }
  return out;
}

// The user's next *selection* strictly after `afterPick`. Scheduled slots that are
// already filled (a keeper) are skipped — they are not selections the user makes,
// and treating them as such both misreports the wait and shrinks the competitive
// window used to judge positional-run risk.
export function myNextPickAfter(state, afterPick) {
  const { numTeams, rounds, myTeamIndex } = state.config;
  let pick = nextPickForTeam(afterPick, myTeamIndex, numTeams, rounds);
  while (pick !== null && state.picks[pick]) {
    pick = nextPickForTeam(pick, myTeamIndex, numTeams, rounds);
  }
  return pick;
}

export function myNextPick(state) {
  const pick = currentPickNumber(state);
  if (pick === null) return null;
  // currentPickNumber only ever returns an unfilled slot, so if it is ours it is
  // genuinely our next selection.
  if (pickToSlot(pick, state.config.numTeams).teamIndex === state.config.myTeamIndex) return pick;
  return myNextPickAfter(state, pick);
}

export function serialize(state) {
  return JSON.stringify({ version: 1, ...state });
}

export function deserialize(json) {
  const raw = JSON.parse(json);
  if (!raw || !raw.config || !raw.picks) throw new Error('Malformed draft state');
  return { config: raw.config, picks: raw.picks, history: raw.history || [] };
}

function isUsableStorage(candidate) {
  return !!candidate
    && typeof candidate.getItem === 'function'
    && typeof candidate.setItem === 'function'
    && typeof candidate.removeItem === 'function';
}

function resolveStorage(storage) {
  const candidate = storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
  return isUsableStorage(candidate) ? candidate : null;
}

// Returns whether the draft was actually persisted. A pick must never crash the
// app, but a silent no-op is worse than a crash if the user then refreshes, so the
// caller is told and can warn.
export function saveState(state, storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, serialize(state));
    return true;
  } catch {
    // Storage can throw at write time (quota exceeded, blocked site data, etc).
    return false;
  }
}

export function loadState(storage) {
  const store = resolveStorage(storage);
  if (!store) return null;
  let raw;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function clearState(storage) {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — clearing is best-effort.
  }
}
