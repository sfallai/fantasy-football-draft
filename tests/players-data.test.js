import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeName, mergePlayers } from '../scripts/fetch-players.mjs';

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
  }

  const ranks = players.map((p) => p.overallRank).sort((a, b) => a - b);
  assert.deepEqual(ranks, players.map((_, i) => i + 1), 'overallRank must be dense 1..N');
});
