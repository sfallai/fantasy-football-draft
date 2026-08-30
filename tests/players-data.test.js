import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeName, mergePlayers, priorSeasonLine, athleteFields, mapWithConcurrency } from '../scripts/fetch-players.mjs';

test('normalizeName strips punctuation, case, and suffixes', () => {
  assert.equal(normalizeName("Ka'imi Fairbairn"), 'kaimifairbairn');
  assert.equal(normalizeName('Marvin Harrison Jr.'), 'marvinharrison');
  assert.equal(normalizeName('A.J. Brown'), 'ajbrown');
});

test('mergePlayers joins ESPN projections with FFC adp and team byes', () => {
  const espn = {
    players: [
      {
        player: {
          id: 111, fullName: 'Jahmyr Gibbs', defaultPositionId: 2, proTeamId: 8,
          draftRanksByRankType: { STANDARD: { rank: 1 } },
          stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 297.1 }],
        },
      },
      {
        player: {
          id: 222, fullName: 'Seahawks D/ST', defaultPositionId: 16, proTeamId: 26,
          draftRanksByRankType: { STANDARD: { rank: 120 } },
          stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 104.0 }],
        },
      },
    ],
  };
  const teams = { settings: { proTeams: [
    { id: 8, abbrev: 'DET', byeWeek: 6 },
    { id: 26, abbrev: 'SEA', byeWeek: 11 },
  ] } };
  const ffc = { players: [
    { name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', adp: 1.4 },
    { name: 'Seattle Defense', position: 'DEF', team: 'SEA', adp: 133.2 },
  ] };

  const out = mergePlayers(espn, teams, ffc);
  assert.equal(out.length, 2);

  const gibbs = out.find((p) => p.name === 'Jahmyr Gibbs');
  assert.deepEqual(gibbs, {
    id: '111', name: 'Jahmyr Gibbs', team: 'DET', position: 'RB',
    overallRank: 1, positionRank: 1, projectedPoints: 297.1, adp: 1.4, bye: 6,
    age: null, experience: null, prior: null,
  });

  const def = out.find((p) => p.position === 'DEF');
  assert.equal(def.id, 'DEF-SEA', 'defenses get a team-derived id');
  assert.equal(def.adp, 133.2, 'defenses join on team abbrev, not name');
  assert.equal(def.bye, 11);
  assert.equal(def.overallRank, 2, 'overallRank is dense over the returned pool');
});

test('mergePlayers leaves adp null when FFC has no entry', () => {
  const espn = { players: [{ player: {
    id: 333, fullName: 'Deep Sleeper', defaultPositionId: 3, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 250 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 40 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'DET', byeWeek: 6 }] } };
  const out = mergePlayers(espn, teams, { players: [] });
  assert.equal(out[0].adp, null);
});

test('mergePlayers attaches age, experience, and last season line', () => {
  const espn = { players: [{ player: {
    id: 111, fullName: 'Jahmyr Gibbs', defaultPositionId: 2, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 1 } },
    stats: [
      { seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 297.1 },
      { seasonId: 2025, statSourceId: 0, statSplitTypeId: 0, appliedTotal: 289.9, appliedAverage: 17.05 },
    ],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'DET', byeWeek: 6 }] } };
  const athletes = new Map([['111', { age: 24, experience: { years: 4 } }]]);

  const [gibbs] = mergePlayers(espn, teams, { players: [] }, athletes);
  assert.equal(gibbs.age, 24);
  assert.equal(gibbs.experience, 4);
  assert.deepEqual(gibbs.prior, { points: 289.9, games: 17, ppg: 17.1 });
});

test('mergePlayers marks a first-year player as inexperienced, not as missing data', () => {
  const espn = { players: [{ player: {
    id: 999, fullName: 'Some Rookie', defaultPositionId: 3, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 90 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 110 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'DET', byeWeek: 6 }] } };
  const athletes = new Map([['999', { age: 22, experience: { years: 1 } }]]);

  const [rookie] = mergePlayers(espn, teams, { players: [] }, athletes);
  assert.equal(rookie.experience, 1, 'experience <= 1 is what makes a player a rookie');
  assert.equal(rookie.prior, null, 'and he has no prior season to report');
});

test('mergePlayers leaves age and experience null for defenses and failed lookups', () => {
  const espn = { players: [
    { player: {
      id: 222, fullName: 'Seahawks D/ST', defaultPositionId: 16, proTeamId: 26,
      draftRanksByRankType: { STANDARD: { rank: 120 } },
      stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 104 }],
    } },
    { player: {
      id: 333, fullName: 'Lookup Failed', defaultPositionId: 1, proTeamId: 26,
      draftRanksByRankType: { STANDARD: { rank: 130 } },
      stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 200 }],
    } },
  ] };
  const teams = { settings: { proTeams: [{ id: 26, abbrev: 'SEA', byeWeek: 11 }] } };
  // 333's request came back null; 222 is a defense and was never looked up.
  const athletes = new Map([['333', null]]);

  const out = mergePlayers(espn, teams, { players: [] }, athletes);
  for (const p of out) {
    assert.equal(p.age, null, `${p.name} age`);
    assert.equal(p.experience, null, `${p.name} experience`);
  }
});

test('priorSeasonLine reads last season actuals, not this season projections', () => {
  const player = { stats: [
    { seasonId: 2025, statSourceId: 0, statSplitTypeId: 0, appliedTotal: 289.9, appliedAverage: 17.052941176470586 },
    { seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 297.1, appliedAverage: 17.4 },
  ] };
  assert.deepEqual(priorSeasonLine(player, 2025), { points: 289.9, games: 17, ppg: 17.1 });
});

test('priorSeasonLine ignores a projection row for the prior season', () => {
  // statSourceId 1 is what ESPN expected to happen. Only statSourceId 0 is what did.
  const player = { stats: [
    { seasonId: 2025, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 250, appliedAverage: 15 },
  ] };
  assert.equal(priorSeasonLine(player, 2025), null);
});

test('priorSeasonLine returns null when there is no prior season at all', () => {
  const rookie = { stats: [
    { seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 120, appliedAverage: 7 },
  ] };
  assert.equal(priorSeasonLine(rookie, 2025), null);
  assert.equal(priorSeasonLine({}, 2025), null, 'a player with no stats array at all');
});

test('priorSeasonLine never divides by zero for a player who logged no games', () => {
  const shelved = { stats: [
    { seasonId: 2025, statSourceId: 0, statSplitTypeId: 0, appliedTotal: 0, appliedAverage: 0 },
  ] };
  assert.deepEqual(priorSeasonLine(shelved, 2025), { points: 0, games: 0, ppg: 0 });
});

test('athleteFields extracts age and experience years', () => {
  assert.deepEqual(
    athleteFields({ age: 24, experience: { years: 4 } }),
    { age: 24, experience: 4 },
  );
});

test('athleteFields returns nulls rather than throwing on a failed or odd response', () => {
  const empty = { age: null, experience: null };
  assert.deepEqual(athleteFields(null), empty, 'the request failed');
  assert.deepEqual(athleteFields({}), empty, 'the response had neither field');
  assert.deepEqual(athleteFields({ age: 'unknown', experience: {} }), empty, 'wrong types');
});

test('mapWithConcurrency resolves in input order, not completion order', async () => {
  const out = await mapWithConcurrency([30, 1, 15], 3, async (n) => {
    await new Promise((r) => setTimeout(r, n));
    return n * 2;
  });
  assert.deepEqual(out, [60, 2, 30]);
});

test('mapWithConcurrency never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 1));
    running -= 1;
    return null;
  });
  assert.ok(peak <= 4, `peak concurrency was ${peak}, expected at most 4`);
});

test('mapWithConcurrency handles an empty list without hanging', async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
});

test('generated data/players.json matches the schema and covers all positions', () => {
  const players = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url)));
  assert.ok(players.length >= 200, `expected >=200 players, got ${players.length}`);

  const positions = new Set(players.map((p) => p.position));
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    assert.ok(positions.has(pos), `missing position ${pos}`);
  }

  const ids = new Set();
  for (const p of players) {
    assert.equal(typeof p.id, 'string');
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.team, 'string');
    assert.equal(typeof p.overallRank, 'number');
    assert.equal(typeof p.positionRank, 'number');
    assert.equal(typeof p.projectedPoints, 'number');
    assert.ok(p.adp === null || typeof p.adp === 'number');
    assert.ok(p.bye === null || typeof p.bye === 'number');
    assert.ok(p.age === null || typeof p.age === 'number', `${p.name} age`);
    assert.ok(p.experience === null || typeof p.experience === 'number', `${p.name} experience`);
    assert.ok(
      p.prior === null
        || (typeof p.prior.points === 'number'
          && typeof p.prior.games === 'number'
          && typeof p.prior.ppg === 'number'),
      `${p.name} prior`,
    );
  }

  const ranks = players.map((p) => p.overallRank).sort((a, b) => a - b);
  assert.deepEqual(ranks, players.map((_, i) => i + 1), 'overallRank must be dense 1..N');

  // A refresh that returned zeros would pass every check above while silently
  // destroying VBD — every player would sit at or below replacement level.
  const projecting = players.filter((p) => p.projectedPoints > 0).length;
  const floor = Math.floor(players.length * 0.9);
  assert.ok(
    projecting >= floor,
    `only ${projecting} of ${players.length} players have a non-zero projection `
    + `(expected at least ${floor}) — the projections source is probably broken; `
    + 'run `git checkout data/players.json` to restore the committed file',
  );

  // The athlete endpoint is separate from the fantasy API and can fail wholesale without
  // failing the fetch — by design. That silence is exactly what needs a tripwire: every
  // per-player check above passes when every age is null.
  const skill = players.filter((p) => p.position !== 'DEF');
  const aged = skill.filter((p) => p.age !== null).length;
  assert.ok(
    aged >= Math.floor(skill.length * 0.8),
    `only ${aged} of ${skill.length} non-defense players have an age (expected at least `
    + `${Math.floor(skill.length * 0.8)}) — the athlete lookups probably failed; `
    + 'run `git checkout data/players.json` to restore the committed file',
  );

  const rookies = skill.filter((p) => p.experience !== null && p.experience <= 1).length;
  assert.ok(rookies > 0, 'no rookies in the pool — experience is not being read correctly');
});
