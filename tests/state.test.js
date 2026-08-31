import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, DEFAULT_CONFIG, createState, currentPickNumber, applyPick, undoPick, printTitle,
  availablePlayers, rosterFor, rostersByTeam, myNextPick, myNextPickAfter,
  applyOffListPick, isOffListId, saveState, loadState, clearState, playersWithOwners,
  setPick, serialize, deserialize, backupFilename, playersWithPickNumbers, OFF_LIST_PREFIX,
} from '../src/core/state.js';

const PLAYERS = Array.from({ length: 200 }, (_, i) => ({
  id: `p${i + 1}`, name: `Player ${i + 1}`, team: 'XX',
  position: ['RB', 'WR', 'QB', 'TE'][i % 4],
  overallRank: i + 1, positionRank: Math.floor(i / 4) + 1,
  projectedPoints: 300 - i, adp: i + 1, bye: 7,
}));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('a fresh draft starts at pick 1 with nothing taken', () => {
  const state = createState(DEFAULT_CONFIG);
  assert.equal(currentPickNumber(state), 1);
  assert.equal(availablePlayers(state, PLAYERS).length, 200);
});

test('applyPick advances the pick and assigns to the right team', () => {
  let state = createState(DEFAULT_CONFIG);
  state = applyPick(state, 'p1');
  assert.equal(currentPickNumber(state), 2);
  assert.deepEqual(state.picks[1], { playerId: 'p1', teamIndex: 1, isKeeper: false });
  assert.equal(availablePlayers(state, PLAYERS).length, 199);
});

test('applyPick does not mutate the previous state', () => {
  const before = createState(DEFAULT_CONFIG);
  applyPick(before, 'p1');
  assert.equal(currentPickNumber(before), 1);
});

test('applyPick rejects a player who is already drafted', () => {
  let state = createState(DEFAULT_CONFIG);
  state = applyPick(state, 'p1');
  assert.throws(() => applyPick(state, 'p1'), /already drafted/i);
});

test('picks follow the snake into round 2', () => {
  let state = createState(DEFAULT_CONFIG);
  for (let i = 1; i <= 11; i += 1) state = applyPick(state, `p${i}`);
  assert.equal(state.picks[10].teamIndex, 10);
  assert.equal(state.picks[11].teamIndex, 10, 'team 10 picks back-to-back at the turn');
});

test('undoPick reverses the last pick and returns the player to the pool', () => {
  let state = createState(DEFAULT_CONFIG);
  state = applyPick(state, 'p1');
  state = applyPick(state, 'p2');
  state = undoPick(state);
  assert.equal(currentPickNumber(state), 2);
  assert.equal(state.picks[2], undefined);
  assert.ok(availablePlayers(state, PLAYERS).some((pl) => pl.id === 'p2'));
});

test('undoPick on an untouched draft is a no-op', () => {
  const state = createState(DEFAULT_CONFIG);
  assert.equal(currentPickNumber(undoPick(state)), 1);
});

test('keepers are pre-placed and their pick slot is skipped', () => {
  const config = {
    ...DEFAULT_CONFIG,
    teams: DEFAULT_CONFIG.teams.map((t, i) =>
      (i === 0 ? { ...t, keeper: { playerId: 'p5', round: 1 } } : t)),
  };
  const state = createState(config);

  assert.deepEqual(state.picks[1], { playerId: 'p5', teamIndex: 1, isKeeper: true });
  assert.equal(currentPickNumber(state), 2, 'the keeper slot is already filled');
  assert.ok(!availablePlayers(state, PLAYERS).some((pl) => pl.id === 'p5'));
});

test('a round-3 keeper is placed at that team\'s round-3 slot', () => {
  const config = {
    ...DEFAULT_CONFIG,
    teams: DEFAULT_CONFIG.teams.map((t, i) =>
      (i === 6 ? { ...t, keeper: { playerId: 'p9', round: 3 } } : t)),
  };
  const state = createState(config);
  // Team 7, round 3 (odd, runs forward) = pick 27.
  assert.deepEqual(state.picks[27], { playerId: 'p9', teamIndex: 7, isKeeper: true });
});

test('an even-round keeper is placed at that team\'s reversed-round slot', () => {
  const config = {
    ...DEFAULT_CONFIG,
    teams: DEFAULT_CONFIG.teams.map((t, i) =>
      (i === 2 ? { ...t, keeper: { playerId: 'p20', round: 2 } } : t)),
  };
  const state = createState(config);
  // Team 3, round 2 (even, reversed) = pick 18.
  assert.deepEqual(state.picks[18], { playerId: 'p20', teamIndex: 3, isKeeper: true });
});

test('undoPick never removes a keeper', () => {
  const config = {
    ...DEFAULT_CONFIG,
    teams: DEFAULT_CONFIG.teams.map((t, i) =>
      (i === 0 ? { ...t, keeper: { playerId: 'p5', round: 1 } } : t)),
  };
  let state = createState(config);
  state = applyPick(state, 'p1');
  state = undoPick(state);
  state = undoPick(state);
  assert.deepEqual(state.picks[1], { playerId: 'p5', teamIndex: 1, isKeeper: true });
});

test('rosterFor and rostersByTeam group players by team', () => {
  let state = createState(DEFAULT_CONFIG);
  for (let i = 1; i <= 12; i += 1) state = applyPick(state, `p${i}`);

  assert.deepEqual(rosterFor(state, 1, PLAYERS).map((pl) => pl.id), ['p1']);
  assert.deepEqual(rosterFor(state, 10, PLAYERS).map((pl) => pl.id), ['p10', 'p11']);

  const all = rostersByTeam(state, PLAYERS);
  assert.equal(Object.keys(all).length, 10, 'every team index is present');
  assert.deepEqual(all[9].map((pl) => pl.id), ['p9', 'p12']);
});

test('myNextPick tracks the user\'s upcoming turn', () => {
  let state = createState({ ...DEFAULT_CONFIG, myTeamIndex: 4 });
  assert.equal(myNextPick(state), 4);
  for (let i = 1; i <= 4; i += 1) state = applyPick(state, `p${i}`);
  assert.equal(myNextPick(state), 17);
});

test('myNextPick skips a scheduled slot a keeper already occupies', () => {
  // Team 4 keeps a player in round 3, which is pick 24. Picks 18-23 must report
  // pick 37 as the next selection, not the slot that is already spoken for.
  const teams = DEFAULT_CONFIG.teams.map((t, i) =>
    (i === 3 ? { ...t, keeper: { playerId: 'p99', round: 3 } } : { ...t, keeper: null }));
  let state = createState({ ...DEFAULT_CONFIG, myTeamIndex: 4, teams });
  assert.equal(state.picks[24].isKeeper, true, 'keeper sits at pick 24');

  let taken = 0;
  while (currentPickNumber(state) < 18) {
    taken += 1;
    state = applyPick(state, `p${taken}`);
  }
  assert.equal(currentPickNumber(state), 18);
  assert.equal(myNextPick(state), 37, 'pick 24 is already filled, so 37 is the real next turn');
  assert.equal(myNextPickAfter(state, 18), 37);
});

test('myNextPickAfter returns the selection strictly after the given pick', () => {
  const state = createState({ ...DEFAULT_CONFIG, myTeamIndex: 4 });
  assert.equal(myNextPick(state), 4, 'pick 4 is on the clock and is ours');
  assert.equal(myNextPickAfter(state, 4), 17, 'the turn after this one');
  assert.equal(myNextPickAfter(state, 143), 144, 'team 4\'s last selection');
  assert.equal(myNextPickAfter(state, 144), null, 'no selection after the last round');
});

test('an off-list pick consumes the slot without naming a pool player', () => {
  let state = createState(DEFAULT_CONFIG);
  state = applyPick(state, 'p1');
  state = applyOffListPick(state);

  assert.equal(currentPickNumber(state), 3, 'the slot is spent, so the draft advances');
  assert.equal(state.picks[2].teamIndex, 2, 'it is still team 2\'s pick');
  assert.equal(state.picks[2].isKeeper, false);
  assert.ok(isOffListId(state.picks[2].playerId));
  assert.equal(availablePlayers(state, PLAYERS).length, 199, 'no pool player was removed');
});

test('off-list picks are unique, so the duplicate check keeps working', () => {
  let state = createState(DEFAULT_CONFIG);
  state = applyOffListPick(state);
  state = applyOffListPick(state);
  assert.notEqual(state.picks[1].playerId, state.picks[2].playerId);
  assert.equal(currentPickNumber(state), 3);
});

test('an off-list pick is undoable like any other pick', () => {
  let state = createState(DEFAULT_CONFIG);
  state = applyPick(state, 'p1');
  state = applyOffListPick(state);
  state = undoPick(state);
  assert.equal(currentPickNumber(state), 2);
  assert.equal(state.picks[2], undefined);
  assert.deepEqual(state.history, [{ pick: 1, previous: null }]);
});

test('renderers drop off-list ids instead of showing a phantom player', () => {
  let state = createState(DEFAULT_CONFIG);
  state = applyOffListPick(state);
  assert.deepEqual(rosterFor(state, 1, PLAYERS), []);
  assert.deepEqual(rostersByTeam(state, PLAYERS)[1], []);
});

test('currentPickNumber is null once every pick is filled', () => {
  let state = createState({ ...DEFAULT_CONFIG, rounds: 1 });
  for (let i = 1; i <= 10; i += 1) state = applyPick(state, `p${i}`);
  assert.equal(currentPickNumber(state), null);
  assert.throws(() => applyPick(state, 'p11'), /complete/i);
});

test('state round-trips through storage', () => {
  const storage = memoryStorage();
  let state = createState(DEFAULT_CONFIG);
  state = applyPick(state, 'p1');
  saveState(state, storage);

  const loaded = loadState(storage);
  assert.deepEqual(loaded.picks, state.picks);
  assert.deepEqual(loaded.history, state.history);
  assert.equal(loaded.config.myTeamIndex, state.config.myTeamIndex);

  clearState(storage);
  assert.equal(loadState(storage), null);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('loadState returns null on corrupt storage instead of throwing', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, 'not json{');
  assert.equal(loadState(storage), null);
});

test('a storage-shaped object missing getItem/setItem/removeItem is never used', () => {
  // Mirrors Node v25's globalThis.localStorage, which exists but has no methods
  // unless --localstorage-file is passed. Must not throw and must behave as "no storage".
  const bogusStub = {};
  const state = createState(DEFAULT_CONFIG);
  assert.doesNotThrow(() => saveState(state, bogusStub));
  assert.equal(saveState(state, bogusStub), false, 'reports that nothing was saved');
  assert.doesNotThrow(() => clearState(bogusStub));
  assert.equal(loadState(bogusStub), null);
});

test('saveState reports success and failure so the UI can warn', () => {
  const state = createState(DEFAULT_CONFIG);
  assert.equal(saveState(state, memoryStorage()), true);
  assert.equal(saveState(state, { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} }), false);
});

test('saveState/clearState swallow errors and loadState returns null when storage throws at call time', () => {
  // Simulates a real browser storage that throws (quota exceeded, blocked site data, etc).
  const throwingStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('quota exceeded'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  const state = createState(DEFAULT_CONFIG);
  assert.doesNotThrow(() => saveState(state, throwingStorage));
  assert.equal(saveState(state, throwingStorage), false, 'a swallowed error is still reported');
  assert.doesNotThrow(() => clearState(throwingStorage));
  assert.equal(loadState(throwingStorage), null);
});

test('playersWithOwners labels a drafted player with the team that took him', () => {
  const players = [
    { id: 'a', name: 'A', position: 'RB' },
    { id: 'b', name: 'B', position: 'WR' },
  ];
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');

  const out = playersWithOwners(state, players);
  assert.equal(out.length, 2, 'every player is listed, drafted or not');
  assert.equal(out.find((p) => p.id === 'a').ownerName, 'Team 1');
  assert.equal(out.find((p) => p.id === 'b').ownerName, null, 'undrafted players own nothing');
});

test('playersWithOwners preserves input order', () => {
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const state = createState({ numTeams: 2, rounds: 2 });
  assert.deepEqual(playersWithOwners(state, players).map((p) => p.id), ['a', 'b', 'c']);
});

test('playersWithOwners does not mutate the players it is given', () => {
  const players = [{ id: 'a' }];
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  playersWithOwners(state, players);
  assert.equal('ownerName' in players[0], false);
});

test('playersWithOwners survives an off-list pick', () => {
  // An off-list pick's id matches no player. It must not throw and must not
  // invent a row.
  const players = [{ id: 'a' }];
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyOffListPick(state);
  const out = playersWithOwners(state, players);
  assert.equal(out.length, 1);
  assert.equal(out[0].ownerName, null);
});

test('playersWithOwners labels a keeper with his team', () => {
  const players = [{ id: 'k' }];
  const state = createState({
    numTeams: 2,
    rounds: 2,
    teams: [{ name: 'Alpha', keeper: { playerId: 'k', round: 1 } }, { name: 'Beta', keeper: null }],
  });
  assert.equal(playersWithOwners(state, players)[0].ownerName, 'Alpha');
});

test('setPick replaces the player at an already-made pick', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = setPick(state, 1, 'b');
  assert.equal(state.picks[1].playerId, 'b');
});

test('setPick keeps the pick on the same team', () => {
  // teamIndex comes from the pick number, and editing must never move a pick to
  // another manager's roster.
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  const before = state.picks[2].teamIndex;
  state = setPick(state, 2, 'c');
  assert.equal(state.picks[2].teamIndex, before);
});

// Two picks logged in the wrong order is a real draft-day mistake, and it used to
// have no expression at all: setPick threw `already drafted`, and clearing a cell
// would have moved the clock backwards. Exchanging the two entries fixes it without
// touching currentPickNumber — both cells stay filled, so there is never a hole.
test('setPick exchanges the two picks when the player is already at another pick', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  const swapped = setPick(state, 1, 'b');
  assert.equal(swapped.picks[1].playerId, 'b');
  assert.equal(swapped.picks[2].playerId, 'a', 'the displaced player takes the other cell');
});

test('an exchange leaves both picks with their own team', () => {
  // The whole point of the invariant: a pick belongs to the manager whose slot it
  // is, and correcting the order must never move a player onto the wrong roster.
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  const swapped = setPick(state, 1, 'b');
  assert.equal(swapped.picks[1].teamIndex, state.picks[1].teamIndex);
  assert.equal(swapped.picks[2].teamIndex, state.picks[2].teamIndex);
  assert.notEqual(swapped.picks[1].teamIndex, swapped.picks[2].teamIndex, 'two managers, still');
});

test('an exchange leaves a keeper flag on the pick number it belongs to', () => {
  let state = createState({
    numTeams: 2, rounds: 2,
    teams: [{ name: 'A', keeper: { playerId: 'k', round: 1 } }, { name: 'B', keeper: null }],
  });
  // Pick 1 is A's keeper; pick 2 is B's ordinary selection.
  state = applyPick(state, 'x');
  const swapped = setPick(state, 1, 'x');
  assert.equal(swapped.picks[1].playerId, 'x');
  assert.equal(swapped.picks[1].isKeeper, true, 'the keeper slot is still the keeper slot');
  assert.equal(swapped.picks[2].playerId, 'k');
  assert.equal(swapped.picks[2].isKeeper, false, 'and the ordinary pick did not become one');
});

test('an exchange does not move the clock or leave a hole', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  const before = currentPickNumber(state);
  const swapped = setPick(state, 1, 'b');
  assert.equal(currentPickNumber(swapped), before);
  assert.equal(Object.keys(swapped.picks).length, 2);
});

test('one undo reverses the whole exchange, not half of it', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  state = setPick(state, 1, 'b');
  state = undoPick(state);
  assert.equal(state.picks[1].playerId, 'a');
  assert.equal(state.picks[2].playerId, 'b', 'the displaced pick came back too');
  assert.equal(currentPickNumber(state), 3, 'and undoing an exchange un-makes no pick');
});

test('an exchange survives a save and reload, undo included', () => {
  // myTeamIndex explicitly, because the round trip through deserialize validates the
  // config against the renderers' assumptions and DEFAULT_CONFIG's 4 is out of a
  // two-team league. createState does not clamp it; the setup screen rejects it.
  let state = createState({ numTeams: 2, rounds: 2, myTeamIndex: 1 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  state = setPick(state, 1, 'b');
  const reloaded = deserialize(serialize(state));
  assert.equal(reloaded.picks[1].playerId, 'b');
  const undone = undoPick(reloaded);
  assert.equal(undone.picks[1].playerId, 'a');
  assert.equal(undone.picks[2].playerId, 'b');
});

test('setPick does not mutate the state it is given during an exchange', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  setPick(state, 1, 'b');
  assert.equal(state.picks[1].playerId, 'a');
  assert.equal(state.picks[2].playerId, 'b');
});

test('setPick allows re-setting a pick to the player it already holds', () => {
  // The duplicate check must not trip on the pick being edited.
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  assert.equal(setPick(state, 1, 'a').picks[1].playerId, 'a');
});

test('setPick refuses a pick that has not been made', () => {
  // Editing never creates a pick out of order — that is what the normal flow is for.
  const state = createState({ numTeams: 2, rounds: 2 });
  assert.throws(() => setPick(state, 3, 'a'), /not been made/);
});

test('setPick preserves a keeper flag', () => {
  const state = createState({
    numTeams: 2, rounds: 2,
    teams: [{ name: 'A', keeper: { playerId: 'k', round: 1 } }, { name: 'B', keeper: null }],
  });
  const edited = setPick(state, 1, 'k2');
  assert.equal(edited.picks[1].isKeeper, true, 'it is still the keeper slot, with a different player');
});

test('setPick does not mutate the state it is given', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  setPick(state, 1, 'b');
  assert.equal(state.picks[1].playerId, 'a');
});

test('undo reverses an edit, restoring the player that was there', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = setPick(state, 1, 'b');
  state = undoPick(state);
  assert.equal(state.picks[1].playerId, 'a');
  assert.equal(currentPickNumber(state), 2, 'undoing an edit does not un-make the pick');
});

test('undo still removes an ordinary pick', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = undoPick(state);
  assert.equal(state.picks[1], undefined);
  assert.equal(currentPickNumber(state), 1);
});

test('undo unwinds edits and picks in the order they happened', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  state = setPick(state, 1, 'c');
  state = undoPick(state);
  assert.equal(state.picks[1].playerId, 'a', 'the edit came last, so it goes first');
  state = undoPick(state);
  assert.equal(state.picks[2], undefined);
});

test('deserialize accepts a legacy history of bare pick numbers', () => {
  // A draft saved before this chunk. Losing it on reload mid-draft is unacceptable.
  const legacy = JSON.stringify({
    version: 1,
    config: DEFAULT_CONFIG,
    picks: { 1: { playerId: 'a', teamIndex: 1, isKeeper: false } },
    history: [1],
  });
  const state = deserialize(legacy);
  assert.deepEqual(state.history, [{ pick: 1, previous: null }]);
  assert.equal(undoPick(state).picks[1], undefined, 'and it still undoes correctly');
});

test('backupFilename names the league and round so two files never collide', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  const name = backupFilename(state);
  assert.match(name, /^ffdraft-/);
  assert.match(name, /\.json$/);
  assert.match(name, /r1/, 'the round it was taken at, so a later backup sorts after an earlier one');
});

// A backup is the only path by which bytes the app did not write reach the state
// model. deserialize is the gate: what it lets through gets persisted and rendered.
const goodBackup = (over) => JSON.stringify({
  version: 1,
  config: { ...DEFAULT_CONFIG, numTeams: 2, rounds: 2, myTeamIndex: 1, teams: [{ name: 'A' }, { name: 'B' }] },
  picks: {},
  history: [],
  ...over,
});

test('deserialize accepts a well-formed backup', () => {
  const state = deserialize(goodBackup());
  assert.equal(state.config.numTeams, 2);
  assert.deepEqual(state.history, []);
});

test('deserialize rejects a config with no teams array', () => {
  const raw = JSON.parse(goodBackup());
  delete raw.config.teams;
  assert.throws(() => deserialize(JSON.stringify(raw)), /team/i);
});

test('deserialize rejects a teams array of the wrong length', () => {
  const raw = JSON.parse(goodBackup());
  raw.config.teams = [{ name: 'A' }];
  assert.throws(() => deserialize(JSON.stringify(raw)), /team/i);
});

test('deserialize rejects a myTeamIndex outside the league', () => {
  assert.throws(() => deserialize(goodBackup({
    config: { ...DEFAULT_CONFIG, numTeams: 2, rounds: 2, myTeamIndex: 9, teams: [{ name: 'A' }, { name: 'B' }] },
  })), /draft position/i);
});

test('deserialize rejects missing roster slots', () => {
  const raw = JSON.parse(goodBackup());
  raw.config.slots = null;
  assert.throws(() => deserialize(JSON.stringify(raw)), /slot/i);
});

test('deserialize rejects a non-positive team or round count', () => {
  const raw = JSON.parse(goodBackup());
  raw.config.rounds = 0;
  assert.throws(() => deserialize(JSON.stringify(raw)), /round/i);
});

test('deserialize rejects a version it does not understand', () => {
  // Chunk G changes the player schema. A file from that future version must say so
  // rather than half-load.
  assert.throws(() => deserialize(goodBackup({ version: 99 })), /newer version/i);
});

test('deserialize normalises a history entry with no previous', () => {
  // A hand-edited or truncated file used to make undoPick write playerId: undefined
  // into a still-filled cell.
  const state = deserialize(goodBackup({
    picks: { 1: { playerId: 'a', teamIndex: 1, isKeeper: false } },
    history: [{ pick: 1 }],
  }));
  assert.deepEqual(state.history, [{ pick: 1, previous: null }]);
});

test('deserialize drops a history entry that is not an entry at all', () => {
  const state = deserialize(goodBackup({ history: [null, 'nonsense', { pick: 1, previous: null }] }));
  assert.deepEqual(state.history, [{ pick: 1, previous: null }]);
});

test('backupFilename distinguishes two backups taken either side of an edit', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  const before = backupFilename(state);
  state = setPick(state, 1, 'b');
  assert.notEqual(backupFilename(state), before, 'the same cells are filled, but the draft differs');
});

test('backupFilename reports the round on the clock, not one inflated by keepers', () => {
  const state = createState({
    numTeams: 2, rounds: 3,
    teams: [{ name: 'A', keeper: { playerId: 'k', round: 3 } }, { name: 'B', keeper: null }],
  });
  // One cell filled, but it is a round-3 keeper and the clock is still on pick 1.
  assert.match(backupFilename(state), /-r1-/);
});

test('playersWithPickNumbers tags a drafted player with the pick that holds him', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'p1');
  const tagged = playersWithPickNumbers(state, PLAYERS.slice(0, 3));
  assert.equal(tagged[0].draftedAt, 1);
  assert.equal(tagged[1].draftedAt, null);
  assert.notEqual(tagged[0], PLAYERS[0], 'a copy — the shared pool must not gain draft state');
});

test('setPick can mark an earlier pick off-list without leaving a hole', () => {
  // applyOffListPick only ever fires at the clock, so before this the only way to
  // say "pick 1 was someone not in my pool" was to have said it at the time.
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  state = setPick(state, 1, `${OFF_LIST_PREFIX}1`);
  assert.equal(state.picks[1].playerId, `${OFF_LIST_PREFIX}1`);
  assert.equal(currentPickNumber(state), 3, 'the cell is still filled, so the clock has not moved');
  assert.equal(undoPick(state).picks[1].playerId, 'a');
});

test('printTitle names the report from the league', () => {
  // Browsers use document.title as the default PDF filename, so without this every
  // league member's export is "Draft Assistant.pdf".
  const state = createState({ numTeams: 10, rounds: 15, myTeamIndex: 1 });
  assert.equal(printTitle(state), 'Team 1 — draft report card — 10 teams, 15 rounds');
});

test('printTitle names WHOSE report it is', () => {
  // Twelve people exporting the same draft would otherwise produce twelve identical
  // filenames, which defeats the point of a file you send to your league.
  const config = {
    numTeams: 2,
    rounds: 3,
    myTeamIndex: 2,
    teams: [{ name: 'Rival' }, { name: 'My Team' }],
  };
  assert.match(printTitle(createState(config)), /^My Team — /);
});

test('printTitle survives a team with no name', () => {
  const state = createState({ numTeams: 2, rounds: 3, myTeamIndex: 1 });
  state.config.teams[0].name = '';
  assert.equal(printTitle(state), 'draft report card — 2 teams, 3 rounds');
});

test('printTitle stays singular for a one-round draft', () => {
  const state = createState({ numTeams: 2, rounds: 1, myTeamIndex: 1 });
  assert.match(printTitle(state), /2 teams, 1 round$/);
});

test('printTitle carries no date, because the app does not know one', () => {
  // DATA_FETCHED_AT is when the projections were fetched, not when anyone drafted.
  // Putting it in the filename would state a fact this app does not have.
  const state = createState({ numTeams: 10, rounds: 15, myTeamIndex: 1 });
  assert.doesNotMatch(printTitle(state), /\d{4}-\d{2}-\d{2}|20\d\d/);
});
