#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEASON = 2026;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) fantasy-football-draft/1.0';

const ESPN_PLAYERS = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leaguedefaults/1?view=kona_player_info`;
const ESPN_TEAMS = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}?view=proTeamSchedules_wl`;
const FFC_ADP = `https://fantasyfootballcalculator.com/api/v1/adp/standard?teams=10&year=${SEASON}&position=all`;

const ESPN_FILTER = JSON.stringify({
  players: {
    filterStatsForExternalIds: { value: [SEASON] },
    limit: 400,
    sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'STANDARD' },
  },
});

const POSITION_BY_ID = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

// Suffixes stripped so "Marvin Harrison Jr." matches FFC's "Marvin Harrison".
const NAME_SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b/g;

export function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(NAME_SUFFIXES, '')
    .replace(/[^a-z]/g, '');
}

function projectedPoints(player) {
  const stats = player.stats || [];
  const season = stats.find(
    (s) => s.seasonId === SEASON && s.statSourceId === 1 && s.statSplitTypeId === 0,
  );
  return season ? Math.round(season.appliedTotal * 10) / 10 : 0;
}

export function mergePlayers(espnJson, teamsJson, ffcJson) {
  const teamsById = new Map();
  for (const t of teamsJson.settings.proTeams) {
    teamsById.set(t.id, { abbrev: t.abbrev, bye: t.byeWeek ?? null });
  }

  // FFC lookups: skill players by normalized name, defenses by team abbrev.
  const adpByName = new Map();
  const adpByDefTeam = new Map();
  for (const p of ffcJson.players || []) {
    const position = p.position === 'PK' ? 'K' : p.position;
    if (position === 'DEF') adpByDefTeam.set(p.team, p.adp);
    else adpByName.set(normalizeName(p.name), p.adp);
  }

  const merged = [];
  for (const entry of espnJson.players) {
    const p = entry.player;
    const position = POSITION_BY_ID[p.defaultPositionId];
    if (!position) continue;

    const team = teamsById.get(p.proTeamId);
    const abbrev = team ? team.abbrev : 'FA';
    const isDef = position === 'DEF';

    merged.push({
      id: isDef ? `DEF-${abbrev}` : String(p.id),
      name: p.fullName,
      team: abbrev,
      position,
      espnRank: p.draftRanksByRankType?.STANDARD?.rank ?? 9999,
      projectedPoints: projectedPoints(p),
      adp: (isDef ? adpByDefTeam.get(abbrev) : adpByName.get(normalizeName(p.fullName))) ?? null,
      bye: team ? team.bye : null,
    });
  }

  // Dense 1..N overall rank in ESPN standard-rank order, then per-position rank.
  merged.sort((a, b) => a.espnRank - b.espnRank || b.projectedPoints - a.projectedPoints);
  const positionCounters = {};
  return merged.map((p, i) => {
    positionCounters[p.position] = (positionCounters[p.position] || 0) + 1;
    return {
      id: p.id,
      name: p.name,
      team: p.team,
      position: p.position,
      overallRank: i + 1,
      positionRank: positionCounters[p.position],
      projectedPoints: p.projectedPoints,
      adp: p.adp,
      bye: p.bye,
    };
  });
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function main() {
  console.log('Fetching ESPN players...');
  const espn = await getJson(ESPN_PLAYERS, { 'x-fantasy-filter': ESPN_FILTER });
  console.log('Fetching ESPN pro teams...');
  const teams = await getJson(ESPN_TEAMS);
  console.log('Fetching FFC ADP...');
  const ffc = await getJson(FFC_ADP);

  const players = mergePlayers(espn, teams, ffc);
  const withAdp = players.filter((p) => p.adp !== null).length;

  const out = fileURLToPath(new URL('../data/players.json', import.meta.url));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(players, null, 0) + '\n');

  console.log(`Wrote ${players.length} players to data/players.json (${withAdp} with ADP)`);
  console.log(`FFC sample: ${ffc.meta.total_drafts} drafts, ${ffc.meta.start_date}..${ffc.meta.end_date}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
