import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, DEFAULT_CONFIG, createState, currentPickNumber, applyPick, undoPick,
  availablePlayers, rosterFor, rostersByTeam, myNextPick, myNextPickAfter,
  applyOffListPick, isOffListId, saveState, loadState, clearState, playersWithOwners,
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
  assert.deepEqual(state.history, [1]);
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
