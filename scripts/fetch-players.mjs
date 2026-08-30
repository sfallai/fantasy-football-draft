#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEASON = 2026;
const PRIOR_SEASON = SEASON - 1;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) fantasy-football-draft/1.0';

const ESPN_PLAYERS = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leaguedefaults/1?view=kona_player_info`;
const ESPN_TEAMS = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}?view=proTeamSchedules_wl`;
const FFC_ADP = `https://fantasyfootballcalculator.com/api/v1/adp/standard?teams=10&year=${SEASON}&position=all`;
const ESPN_ATHLETE = (id) => `https://sports.core.api.espn.com/v3/sports/football/nfl/athletes/${id}`;
// Polite to the endpoint and still finishes 400 lookups in well under a minute.
const ATHLETE_CONCURRENCY = 8;

const ESPN_FILTER = JSON.stringify({
  players: {
    filterStatsForExternalIds: { value: [PRIOR_SEASON, SEASON] },
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

// Last season's actuals, which the response already carries. statSourceId 0 is what
// happened and 1 is what was projected; taking 1 here would report a stale forecast as
// production. Games played is not a field ESPN returns — it falls out of the total over
// the per-game average.
export function priorSeasonLine(player, priorSeason) {
  const row = (player.stats || []).find(
    (s) => s.seasonId === priorSeason && s.statSourceId === 0 && s.statSplitTypeId === 0,
  );
  if (!row) return null;

  const points = Math.round((row.appliedTotal || 0) * 10) / 10;
  const games = row.appliedAverage > 0 ? Math.round(row.appliedTotal / row.appliedAverage) : 0;
  const ppg = games > 0 ? Math.round((points / games) * 10) / 10 : 0;
  return { points, games, ppg };
}

// The athlete endpoint is a different service from the fantasy API and answers with a
// different shape. Every field is treated as absent unless it arrives as the right type,
// so a changed response degrades to nulls instead of writing "unknown" into the data.
export function athleteFields(athlete) {
  const age = athlete && typeof athlete.age === 'number' ? athlete.age : null;
  const years = athlete && athlete.experience && typeof athlete.experience.years === 'number'
    ? athlete.experience.years
    : null;
  return { age, experience: years };
}

// 400 requests, a few at a time. Workers pull from a shared cursor rather than being
// handed fixed slices, so one slow response cannot leave a worker idle while others queue.
export async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      // Claiming the index and advancing the cursor happen with no await between them,
      // so two workers can never be handed the same item.
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return out;
}

export function mergePlayers(espnJson, teamsJson, ffcJson, athletesById = new Map()) {
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

    const { age, experience } = athleteFields(isDef ? null : athletesById.get(String(p.id)));

    merged.push({
      id: isDef ? `DEF-${abbrev}` : String(p.id),
      name: p.fullName,
      team: abbrev,
      position,
      espnRank: p.draftRanksByRankType?.STANDARD?.rank ?? 9999,
      projectedPoints: projectedPoints(p),
      adp: (isDef ? adpByDefTeam.get(abbrev) : adpByName.get(normalizeName(p.fullName))) ?? null,
      bye: team ? team.bye : null,
      age,
      experience,
      prior: priorSeasonLine(p, PRIOR_SEASON),
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
      age: p.age,
      experience: p.experience,
      prior: p.prior,
    };
  });
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Age and experience are nice to have; the draft is not. A failed lookup returns null and
// that player simply has no age, rather than the whole morning's fetch dying on one 404.
async function fetchAthlete(id) {
  try {
    const res = await fetch(ESPN_ATHLETE(id), { headers: { 'User-Agent': UA } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('Fetching ESPN players...');
  const espn = await getJson(ESPN_PLAYERS, { 'x-fantasy-filter': ESPN_FILTER });
  console.log('Fetching ESPN pro teams...');
  const teams = await getJson(ESPN_TEAMS);
  console.log('Fetching FFC ADP...');
  const ffc = await getJson(FFC_ADP);

  // Defenses have no athlete record — their id is derived from the team abbreviation.
  const athleteIds = espn.players
    .map((entry) => entry.player)
    .filter((p) => POSITION_BY_ID[p.defaultPositionId] && p.defaultPositionId !== 16)
    .map((p) => String(p.id));

  console.log(`Fetching age and experience for ${athleteIds.length} players...`);
  const athleteResponses = await mapWithConcurrency(athleteIds, ATHLETE_CONCURRENCY, fetchAthlete);
  const athletesById = new Map(athleteIds.map((id, i) => [id, athleteResponses[i]]));
  const foundAthletes = athleteResponses.filter(Boolean).length;
  console.log(`  ${foundAthletes}/${athleteIds.length} athlete lookups succeeded`);

  const players = mergePlayers(espn, teams, ffc, athletesById);
  const withAdp = players.filter((p) => p.adp !== null).length;
  const withAge = players.filter((p) => p.age !== null).length;
  const withPrior = players.filter((p) => p.prior !== null).length;
  const rookies = players.filter((p) => p.experience !== null && p.experience <= 1).length;

  const out = fileURLToPath(new URL('../data/players.json', import.meta.url));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(players, null, 0) + '\n');

  console.log(`Wrote ${players.length} players to data/players.json (${withAdp} with ADP, `
    + `${withAge} with age, ${withPrior} with a prior season, ${rookies} rookies)`);
  console.log(`FFC sample: ${ffc.meta.total_drafts} drafts, ${ffc.meta.start_date}..${ffc.meta.end_date}`);
}

// fileURLToPath, not a `file://` template: the latter mismatches on any path
// containing a space or a non-ASCII character, and the fetch would do nothing.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
