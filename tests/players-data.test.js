import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeName, mergePlayers, priorSeasonLine, athleteFields, mapWithConcurrency, fetchedAtPayload } from '../scripts/fetch-players.mjs';

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
    adpStdev: null, adpEarliest: null, adpLatest: null, adpDrafts: null,
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

test('mergePlayers keeps the ADP spread, not just the mean', () => {
  const espn = { players: [{ player: {
    id: 111, fullName: 'Jordan Love', defaultPositionId: 1, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 130 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 259 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'GB', byeWeek: 5 }] } };
  // FFC's own field names: `high` is the EARLIEST pick and the smaller number.
  const ffc = { players: [
    { name: 'Jordan Love', position: 'QB', team: 'GB', adp: 127.5, stdev: 11.1, high: 100, low: 148, times_drafted: 2017 },
  ] };

  const [love] = mergePlayers(espn, teams, ffc);
  assert.equal(love.adp, 127.5);
  assert.equal(love.adpStdev, 11.1);
  assert.equal(love.adpEarliest, 100, 'FFC calls this `high` — drafted high, i.e. early');
  assert.equal(love.adpLatest, 148);
  assert.equal(love.adpDrafts, 2017);
});

test('the extremes are ordered by what they mean, not by what FFC calls them', () => {
  // Belt and braces against a feed change. FFC is consistent today — high < low in
  // 221 of 221 live players — so this is guarding a future flip, not fixing one.
  const espn = { players: [{ player: {
    id: 111, fullName: 'Jordan Love', defaultPositionId: 1, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 130 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 259 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'GB', byeWeek: 5 }] } };
  const ffc = { players: [
    { name: 'Jordan Love', position: 'QB', team: 'GB', adp: 127.5, stdev: 11.1, high: 148, low: 100, times_drafted: 9 },
  ] };

  const [love] = mergePlayers(espn, teams, ffc);
  assert.equal(love.adpEarliest, 100);
  assert.equal(love.adpLatest, 148);
});

test('a defense carries the spread too, joined on team abbrev', () => {
  const espn = { players: [{ player: {
    id: 222, fullName: 'Seahawks D/ST', defaultPositionId: 16, proTeamId: 26,
    draftRanksByRankType: { STANDARD: { rank: 120 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 104 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 26, abbrev: 'SEA', byeWeek: 11 }] } };
  const ffc = { players: [
    { name: 'Seattle Defense', position: 'DEF', team: 'SEA', adp: 133.2, stdev: 14.2, high: 110, low: 160, times_drafted: 812 },
  ] };

  const [def] = mergePlayers(espn, teams, ffc);
  assert.equal(def.adp, 133.2, 'the ADP itself still resolves — the map now holds a record, not a number');
  assert.equal(def.adpStdev, 14.2);
  assert.equal(def.adpDrafts, 812);
});

test('a player FFC has never seen gets null for every ADP field', () => {
  const espn = { players: [{ player: {
    id: 333, fullName: 'Deep Sleeper', defaultPositionId: 3, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 250 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 40 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'DET', byeWeek: 6 }] } };
  const [p] = mergePlayers(espn, teams, { players: [] });
  assert.deepEqual(
    [p.adp, p.adpStdev, p.adpEarliest, p.adpLatest, p.adpDrafts],
    [null, null, null, null, null],
  );
});

test('an FFC record missing a spread yields null for it, not NaN or undefined', () => {
  // Defenses and deep players have been seen with adp but no stdev.
  const espn = { players: [{ player: {
    id: 111, fullName: 'Jordan Love', defaultPositionId: 1, proTeamId: 8,
    draftRanksByRankType: { STANDARD: { rank: 130 } },
    stats: [{ seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 259 }],
  } }] };
  const teams = { settings: { proTeams: [{ id: 8, abbrev: 'GB', byeWeek: 5 }] } };
  const ffc = { players: [{ name: 'Jordan Love', position: 'QB', team: 'GB', adp: 127.5 }] };

  const [love] = mergePlayers(espn, teams, ffc);
  assert.equal(love.adp, 127.5);
  assert.equal(love.adpStdev, null);
  assert.equal(love.adpEarliest, null);
  assert.equal(love.adpLatest, null);
  assert.equal(love.adpDrafts, null);
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
  assert.ok(peak > 1, `peak concurrency was ${peak}, expected concurrent execution (a purely `
    + 'sequential implementation would also pass the <= 4 check above)');
});

test('mapWithConcurrency handles an empty list without hanging', async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
});

test('fetchedAtPayload records the moment of the fetch as ISO-8601', () => {
  const payload = fetchedAtPayload(new Date('2026-08-30T11:00:00.000Z'));
  assert.deepEqual(payload, { fetchedAt: '2026-08-30T11:00:00.000Z' });
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
    for (const field of ['adpStdev', 'adpEarliest', 'adpLatest', 'adpDrafts']) {
      assert.ok(p[field] === null || typeof p[field] === 'number', `${p.name} ${field}`);
    }
    assert.ok(
      p.adpEarliest === null || p.adpLatest === null || p.adpEarliest <= p.adpLatest,
      `${p.name} adpEarliest ${p.adpEarliest} is later than adpLatest ${p.adpLatest}`,
    );
    assert.ok(p.bye === null || typeof p.bye === 'number');
    assert.ok(p.age === null || typeof p.age === 'number', `${p.name} age`);
    assert.ok(
      p.age === null || (p.age >= 18 && p.age <= 50),
      `${p.name} age ${p.age} is out of plausible range`,
    );
    assert.ok(p.experience === null || typeof p.experience === 'number', `${p.name} experience`);
    assert.ok(
      p.prior === null
        || (typeof p.prior.points === 'number'
          && typeof p.prior.games === 'number'
          && typeof p.prior.ppg === 'number'),
      `${p.name} prior`,
    );
    assert.ok(
      p.prior === null || p.prior.games <= 17,
      `${p.name} prior.games ${p.prior && p.prior.games} exceeds a 17-game season`,
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
    + 'run `git checkout data/players.json data/fetched-at.json` to restore the committed files',
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
    + 'run `git checkout data/players.json data/fetched-at.json` to restore the committed files',
  );

  // prior has the largest silent-failure surface of the three new fields: if ESPN narrows
  // the stats filter or changes statSourceId semantics, every prior becomes null, every
  // per-player type check above still passes (null is legal), and the suite stays green.
  const withPrior = players.filter((p) => p.prior !== null).length;
  const priorFloor = Math.floor(players.length * 0.5);
  assert.ok(
    withPrior >= priorFloor,
    `only ${withPrior} of ${players.length} players have a prior season (expected at least `
    + `${priorFloor}) — the prior-season stats filter probably changed; `
    + 'run `git checkout data/players.json data/fetched-at.json` to restore the committed files',
  );

  // Fantasy Football Calculator is the shakiest source in this file: a separate host
  // from ESPN, the only one of the three with no CORS headers, no versioned contract,
  // and currently supplying ADP for roughly half the pool. If its response shape
  // changes while still returning 200, mergePlayers quietly writes null for every
  // player, every per-player check above still passes (null is legal), and the site
  // ships with no ADP or value signal at all — silently, and unattended, since this
  // runs from a daily cron with no human watching.
  const withAdp = players.filter((p) => p.adp !== null).length;
  const adpFloor = Math.floor(players.length * 0.4);
  assert.ok(
    withAdp >= adpFloor,
    `only ${withAdp} of ${players.length} players have an ADP (expected at least `
    + `${adpFloor}) — Fantasy Football Calculator's response shape probably changed; `
    + 'run `git checkout data/players.json data/fetched-at.json` to restore the committed files',
  );

  // A join that silently stopped matching would leave every spread null while every
  // other check above still passed — and the availability odds would then simply never
  // appear, with nothing to say why.
  const withSpread = players.filter((p) => p.adpStdev !== null).length;
  assert.ok(
    withSpread >= withAdp * 0.9,
    `only ${withSpread} of ${withAdp} players with an ADP also have a spread — the FFC join has broken`,
  );

  // A rookie has no prior season by definition — that's what makes this predicate
  // convention-independent. ESPN's `experience` is not a self-consistent years-played
  // counter on its own (see fetch-players.mjs main()).
  const rookies = skill.filter(
    (p) => p.experience !== null && p.experience <= 1 && p.prior === null,
  ).length;
  assert.ok(rookies > 0, 'no rookies in the pool — experience is not being read correctly');
});
