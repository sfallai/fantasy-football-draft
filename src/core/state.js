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
    history: [...state.history, { pick, previous: null }],
  };
}

// Editing replaces a player; it never empties a cell. That is deliberate:
// currentPickNumber returns the first UNFILLED pick, so a hole in the middle of a
// draft would make the clock mean the wrong thing and misroute every later pick.
// A cell whose player is genuinely unknown takes the off-list sentinel instead —
// `${OFF_LIST_PREFIX}${pickNumber}` — which keeps the cell filled.
//
// When the named player already sits at another (necessarily filled) pick, the two
// entries are EXCHANGED rather than rejected: two picks logged in the wrong order is
// a real draft-day mistake and had no other expression. An exchange fills exactly the
// cells it emptied, so it moves no clock and creates no hole.
//
// Note: editing a keeper's cell deliberately leaves config.teams[i].keeper.playerId
// pointing at the old player. Keepers are copied into `picks` once, by createState at
// setup, and nothing reads config.teams[].keeper after that — but a future chunk that
// starts reading it (a re-open of setup, a keeper report) must reconcile it here.
export function setPick(state, pickNumber, playerId) {
  const entry = state.picks[pickNumber];
  if (!entry) throw new Error(`Pick ${pickNumber} has not been made yet`);

  const id = String(playerId);
  if (entry.playerId === id) return state;

  let heldAt = null;
  for (const [number, other] of Object.entries(state.picks)) {
    if (Number(number) !== pickNumber && other.playerId === id) {
      heldAt = Number(number);
      break;
    }
  }

  // Spread each existing entry so teamIndex and isKeeper stay with their pick number —
  // a pick must never change hands, and a keeper slot stays a keeper slot.
  const picks = { ...state.picks, [pickNumber]: { ...entry, playerId: id } };
  const record = { pick: pickNumber, previous: entry.playerId };

  if (heldAt !== null) {
    const displaced = state.picks[heldAt];
    picks[heldAt] = { ...displaced, playerId: entry.playerId };
    // One history entry for the whole exchange, so one undo reverses both halves.
    record.swap = { pick: heldAt, previous: displaced.playerId };
  }

  return { ...state, picks, history: [...state.history, record] };
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
  const last = history.pop();
  const picks = { ...state.picks };

  if (last.previous === null) delete picks[last.pick];
  else picks[last.pick] = { ...picks[last.pick], playerId: last.previous };

  // An exchange was one action, so it comes back as one: restoring only the edited
  // cell would leave the displaced player duplicated across two picks.
  if (last.swap && picks[last.swap.pick]) {
    picks[last.swap.pick] = { ...picks[last.swap.pick], playerId: last.swap.previous };
  }

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

// The table shows drafted players too, greyed and unpickable, so the user can see
// where someone went instead of wondering whether they mistyped the name. Returns a
// copy per player: mutating the shared pool would leak owner names into the
// recommendation path, which must never see a drafted player at all.
export function playersWithOwners(state, allPlayers) {
  const ownerByPlayerId = new Map();
  for (const entry of Object.values(state.picks)) {
    const team = state.config.teams[entry.teamIndex - 1];
    if (team) ownerByPlayerId.set(entry.playerId, team.name);
  }
  return allPlayers.map((pl) => ({ ...pl, ownerName: ownerByPlayerId.get(pl.id) ?? null }));
}

// The pick editor's pool. Unlike availablePlayers it keeps the drafted players, each
// tagged with the pick that holds him, because choosing one of them EXCHANGES the two
// picks (see setPick) — hiding them is what made a transposed pair uncorrectable.
// A copy per player, for the same reason playersWithOwners copies: the shared pool
// must never gain draft state that the recommendation path could see.
export function playersWithPickNumbers(state, allPlayers) {
  const pickByPlayerId = new Map();
  for (const [number, entry] of Object.entries(state.picks)) {
    pickByPlayerId.set(entry.playerId, Number(number));
  }
  return allPlayers.map((pl) => ({ ...pl, draftedAt: pickByPlayerId.get(pl.id) ?? null }));
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

// Bumped only when the shape of what serialize writes changes incompatibly. A file
// stamped higher than this was written by a newer build than the one reading it.
export const STATE_VERSION = 1;

export function serialize(state) {
  return JSON.stringify({ version: STATE_VERSION, ...state });
}

// No timestamp: the page has no clock the user trusts more than the draft itself, and
// a round-stamped name sorts in draft order, which is how someone looks for the file.
// The round comes from the clock, not from the cell count — keepers fill cells in
// later rounds and used to inflate it. `e` (actions taken) is what distinguishes two
// backups saved either side of an edit, which fill exactly the same cells.
export function backupFilename(state) {
  const { numTeams, rounds } = state.config;
  const current = currentPickNumber(state);
  const round = current === null ? rounds : pickToSlot(current, numTeams).round;
  const made = Object.keys(state.picks).length;
  return `ffdraft-${numTeams}team-r${round}-p${made}-e${state.history.length}.json`;
}

// Browsers use document.title as the default filename when the print dialog saves a
// PDF, and the page's own title is "Draft Assistant" — so without this every league
// member's export lands as "Draft Assistant.pdf".
//
// The team name is in it because the league is the audience: twelve people exporting
// the same draft would otherwise produce twelve byte-identical filenames, and the file
// only does its job once you can tell whose it is.
//
// Deliberately no date. DATA_FETCHED_AT is when the projections were fetched, not when
// anyone drafted, and nothing in state records a draft date; putting either in the name
// would state a fact this app does not have.
export function printTitle(state) {
  const { numTeams, rounds, teams, myTeamIndex } = state.config;
  const mine = teams[myTeamIndex - 1];
  const who = mine && mine.name ? `${mine.name} — ` : '';
  return `${who}draft report card — ${numTeams} teams, ${rounds} round${rounds === 1 ? '' : 's'}`;
}

// Drafts saved before pick editing stored history as bare pick numbers. Mid-draft
// reloads have to keep working across the upgrade. An entry that survives here is
// one undoPick can safely apply: a missing `previous` used to be written straight
// back into a still-filled cell as `playerId: undefined`.
function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'number') return { pick: entry, previous: null };
      if (!entry || typeof entry !== 'object') return null;
      const pick = Number(entry.pick);
      if (!Number.isFinite(pick)) return null;
      const normalized = { pick, previous: entry.previous ?? null };
      const { swap } = entry;
      // The other half of an exchange, kept only when it is complete enough to undo.
      if (swap && Number.isFinite(Number(swap.pick)) && swap.previous != null) {
        normalized.swap = { pick: Number(swap.pick), previous: String(swap.previous) };
      }
      return normalized;
    })
    .filter(Boolean);
}

// Import is the one path by which bytes the app did not write reach the state model,
// and whatever gets past here is persisted and then rendered. renderDraft reads
// config.teams[myTeamIndex - 1].name unguarded, so a config that is merely truthy is
// not enough: check the shape the renderers assume before any of it is stored.
function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Malformed draft state: no league settings');
  }
  const { numTeams, rounds, myTeamIndex, teams, slots } = config;
  if (!Number.isInteger(numTeams) || numTeams < 1) {
    throw new Error('Malformed draft state: team count must be a positive whole number');
  }
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error('Malformed draft state: round count must be a positive whole number');
  }
  if (!Array.isArray(teams) || teams.length !== numTeams) {
    throw new Error(`Malformed draft state: expected ${numTeams} teams, found ${Array.isArray(teams) ? teams.length : 'none'}`);
  }
  if (teams.some((team) => !team || typeof team !== 'object')) {
    throw new Error('Malformed draft state: every team needs a name');
  }
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
    throw new Error('Malformed draft state: no roster slots');
  }
  if (!Number.isInteger(myTeamIndex) || myTeamIndex < 1 || myTeamIndex > numTeams) {
    throw new Error(`Malformed draft state: draft position must be between 1 and ${numTeams}`);
  }
}

export function deserialize(json) {
  const raw = JSON.parse(json);
  if (!raw || !raw.config || !raw.picks) throw new Error('Malformed draft state');
  // Absent on files written before versioning; anything above what this build knows
  // was written by a later one, whose shape it cannot assume.
  if (raw.version !== undefined && Number(raw.version) > STATE_VERSION) {
    throw new Error(`This backup was saved by a newer version of the app (v${raw.version}) than this one (v${STATE_VERSION}).`);
  }
  validateConfig(raw.config);
  return { config: raw.config, picks: raw.picks, history: normalizeHistory(raw.history) };
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
