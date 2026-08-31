#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEASON = 2026;
const PRIOR_SEASON = SEASON - 1;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) fantasy-football-draft/1.0';

const ESPN_PLAYERS = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leaguedefaults/1?view=kona_player_info`;
const ESPN_TEAMS = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}?view=proTeamSchedules_wl`;
// teams=12, not 10, because that is what comes back either way: requesting teams=10 and
// teams=12 returned byte-identical ADPs for all 221 players, and both responses' own meta
// reports `{teams: 12, rounds: 15}`. The parameter is ignored for this dataset, so asking
// for 10 only made the URL lie about what it fetches.
//
// ADP here is an OVERALL PICK NUMBER, and it is roughly league-size independent: the Nth
// best player goes around pick N whatever the league size, because draft order follows
// player value rather than roster count. So a consumer must NOT rescale it by team count.
// What league size does change is which round a pick falls in, and where the board ends —
// this sample tops out at 174.2 against a 180-pick board, so deep players are censored.
const FFC_ADP = `https://fantasyfootballcalculator.com/api/v1/adp/standard?teams=12&year=${SEASON}&position=all`;
const ESPN_ATHLETE = (id) => `https://sports.core.api.espn.com/v3/sports/football/nfl/athletes/${id}`;
const ESPN_DEPTH = (teamId) => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${SEASON}/teams/${teamId}/depthcharts`;
// Polite to the endpoint and still finishes 400 lookups in well under a minute.
const ATHLETE_CONCURRENCY = 8;
// A regular season is 17 games. Games derived below can exceed that for a player who
// changed teams mid-season, since ESPN's own appliedAverage denominator spans both teams.
const MAX_GAMES = 17;

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
  // appliedAverage can be legitimately negative (a season with a negative average is real,
  // e.g. Jarrett Stidham's -0.1), so the guard is "not zero", not "positive" — `> 0` was
  // rejecting those seasons and reporting them as 0 games, which is internally
  // contradictory with a non-zero points total. Games can also come out above a 17-game
  // season for a player who changed teams mid-season, since ESPN's own appliedAverage is
  // computed over a denominator spanning both teams (e.g. Rashid Shaheed derives 18);
  // clamp rather than publish an impossible number.
  const rawGames = row.appliedAverage !== 0 ? Math.round(row.appliedTotal / row.appliedAverage) : 0;
  const games = Math.min(rawGames, MAX_GAMES);
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

// Anything the feed does not carry becomes null, never NaN or undefined. Math.min of an
// undefined is NaN, and a NaN in the data would serialize to `null` in JSON but pass a
// `typeof === 'number'` check in memory — two different shapes for one absence.
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// 400 requests, a few at a time. Workers pull from a shared cursor rather than being
// handed fixed slices, so one slow response cannot leave a worker idle while others queue.
// Contract: `fn` must not throw/reject — a rejection propagates through Promise.all and
// aborts every in-flight worker, discarding whatever they had already resolved. Safe today
// because the only caller, fetchAthlete, catches everything internally and resolves null.
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

// K and DEF live in the Special Teams group and have no meaningful handcuff — they are
// streamed off waivers, and the grade already ignores them.
const DEPTH_POSITIONS = ['qb', 'rb', 'wr', 'te'];

// The offensive group is identified by the positions it contains, never by its name:
// measured across four teams, the defensive group is "Base 3-4 D" on some and
// "Base 4-3 D" on others, and a formation name like "3WR 1TE" is not a contract.
function offensiveGroup(chartJson) {
  return (chartJson.items || []).find(
    (group) => group.positions && group.positions.qb && group.positions.rb,
  ) || null;
}

function athleteIdFromRef(entry) {
  const ref = entry && entry.athlete && entry.athlete.$ref;
  // Not `\d+`: production refs end in a numeric id, but that anchor was found to reject
  // every one of the fixtures above, which use readable non-numeric ids for legibility.
  // Any run of non-slash, non-query characters covers both without weakening the match —
  // the segment still has to sit directly after "athletes/".
  const match = typeof ref === 'string' ? ref.match(/athletes\/([^/?]+)/) : null;
  return match ? match[1] : null;
}

// Each chart is self-contained: the pairs come from consecutive ranks within one
// position group, so nothing here needs to know which team a chart came from. That
// keeps a mismatch between fantasy proTeamId and core-API team id from silently
// corrupting the map — a chart for the wrong team would simply attribute to nobody.
export function depthMapFromCharts(chartsByTeam) {
  const map = new Map();
  for (const chartJson of chartsByTeam) {
    if (!chartJson) continue;
    const group = offensiveGroup(chartJson);
    if (!group) continue;
    for (const position of DEPTH_POSITIONS) {
      const slot = group.positions[position];
      if (!slot || !Array.isArray(slot.athletes)) continue;
      const ordered = [...slot.athletes]
        .sort((a, b) => a.rank - b.rank)
        .map((entry) => ({ id: athleteIdFromRef(entry), rank: entry.rank }))
        .filter((entry) => entry.id);
      ordered.forEach((entry, i) => {
        const next = ordered[i + 1];
        map.set(entry.id, { depthRank: entry.rank, backupId: next ? next.id : null });
      });
    }
  }
  return map;
}

export function mergePlayers(espnJson, teamsJson, ffcJson, athletesById = new Map(), depthById = new Map()) {
  const teamsById = new Map();
  for (const t of teamsJson.settings.proTeams) {
    teamsById.set(t.id, { abbrev: t.abbrev, bye: t.byeWeek ?? null });
  }

  // FFC lookups: skill players by normalized name, defenses by team abbrev. The whole
  // record, not just `p.adp` — the spread beside it is what makes "will he last until my
  // next pick?" answerable at all, and it was being downloaded and dropped.
  const adpByName = new Map();
  const adpByDefTeam = new Map();
  for (const p of ffcJson.players || []) {
    const position = p.position === 'PK' ? 'K' : p.position;
    if (position === 'DEF') adpByDefTeam.set(p.team, p);
    else adpByName.set(normalizeName(p.name), p);
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
    const ffc = (isDef ? adpByDefTeam.get(abbrev) : adpByName.get(normalizeName(p.fullName))) ?? null;
    const depth = depthById.get(String(p.id)) || null;

    merged.push({
      id: isDef ? `DEF-${abbrev}` : String(p.id),
      name: p.fullName,
      team: abbrev,
      position,
      espnRank: p.draftRanksByRankType?.STANDARD?.rank ?? 9999,
      projectedPoints: projectedPoints(p),
      adp: num(ffc && ffc.adp),
      adpStdev: num(ffc && ffc.stdev),
      // FFC's `high` is drafted-high — the EARLIEST pick and the smaller number. Stored
      // under names that say which is which, so nothing downstream has to know the
      // convention. min/max rather than a straight rename: the feed is consistent today
      // (high < low in 221 of 221 live players), and this keeps a future flip from
      // silently inverting the pair.
      adpEarliest: num(ffc && Math.min(ffc.high, ffc.low)),
      adpLatest: num(ffc && Math.max(ffc.high, ffc.low)),
      adpDrafts: num(ffc && ffc.times_drafted),
      bye: team ? team.bye : null,
      age,
      experience,
      prior: priorSeasonLine(p, PRIOR_SEASON),
      depthRank: depth ? depth.depthRank : null,
      // May point at a player outside the 400-player pool. That is not an error — it
      // means the handcuff is not draftable here, and the UI omits rather than invents.
      backupId: depth ? depth.backupId : null,
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
      adpStdev: p.adpStdev,
      adpEarliest: p.adpEarliest,
      adpLatest: p.adpLatest,
      adpDrafts: p.adpDrafts,
      bye: p.bye,
      age: p.age,
      experience: p.experience,
      prior: p.prior,
      depthRank: p.depthRank,
      backupId: p.backupId,
    };
  });
}

// A stalled upstream would otherwise hang the fetch indefinitely — and with it the
// CI job, which has no timeout of its own short enough to matter, all the way out
// to Actions' 6-hour default. That can run into the next day's scheduled trigger.
async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Age and experience are nice to have; the draft is not. A failed lookup returns null and
// that player simply has no age, rather than the whole morning's fetch dying on one 404.
async function fetchAthlete(id) {
  try {
    const res = await fetch(ESPN_ATHLETE(id), {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// A separate file rather than a field inside players.json: every consumer of that
// file expects a bare array, and widening it would touch all of them.
export function fetchedAtPayload(date) {
  return { fetchedAt: date.toISOString() };
}

async function main() {
  console.log('Fetching ESPN players...');
  const espn = await getJson(ESPN_PLAYERS, { 'x-fantasy-filter': ESPN_FILTER });
  console.log('Fetching ESPN pro teams...');
  const teams = await getJson(ESPN_TEAMS);
  console.log('Fetching FFC ADP...');
  const ffc = await getJson(FFC_ADP);

  console.log('Fetching depth charts...');
  const teamIds = teams.settings.proTeams.map((t) => t.id).filter(Boolean);
  const charts = await mapWithConcurrency(teamIds, ATHLETE_CONCURRENCY, async (teamId) => {
    // One team's chart failing must not fail the run — but it must be visible, because
    // silently shipping 31 of 32 is the failure this reports on.
    try {
      return await getJson(ESPN_DEPTH(teamId));
    } catch {
      return null;
    }
  });
  const depthById = depthMapFromCharts(charts);
  const resolved = charts.filter(Boolean).length;
  console.log(`Depth charts: ${resolved} of ${teamIds.length} teams, ${depthById.size} players ranked`);

  // Defenses have no athlete record — their id is derived from the team abbreviation.
  const athleteIds = espn.players
    .map((entry) => entry.player)
    .filter((p) => POSITION_BY_ID[p.defaultPositionId] && POSITION_BY_ID[p.defaultPositionId] !== 'DEF')
    .map((p) => String(p.id));

  console.log(`Fetching age and experience for ${athleteIds.length} players...`);
  let completed = 0;
  const trackProgress = (id) => {
    const result = fetchAthlete(id);
    result.then(() => {
      completed += 1;
      if (completed % 50 === 0) console.log(`  ...${completed}/${athleteIds.length} athlete lookups done`);
    });
    return result;
  };
  const firstPass = await mapWithConcurrency(athleteIds, ATHLETE_CONCURRENCY, trackProgress);

  // A transient failure (a stall, a dropped connection) is not permanent — retry once,
  // limited to the ids that came back null, before accepting them as missing.
  const missingIds = athleteIds.filter((id, i) => !firstPass[i]);
  console.log(`  ${athleteIds.length - missingIds.length}/${athleteIds.length} succeeded on the first pass`
    + (missingIds.length > 0 ? `; retrying ${missingIds.length}...` : ''));
  const retryResponses = missingIds.length > 0
    ? await mapWithConcurrency(missingIds, ATHLETE_CONCURRENCY, fetchAthlete)
    : [];
  const retryById = new Map(missingIds.map((id, i) => [id, retryResponses[i]]));

  const athleteResponses = athleteIds.map((id, i) => firstPass[i] ?? retryById.get(id) ?? null);
  const athletesById = new Map(athleteIds.map((id, i) => [id, athleteResponses[i]]));
  const foundAthletes = athleteResponses.filter(Boolean).length;
  const recoveredByRetry = retryResponses.filter(Boolean).length;
  console.log(`  ${foundAthletes}/${athleteIds.length} athlete lookups succeeded overall `
    + `(${recoveredByRetry} recovered by retry)`);

  const players = mergePlayers(espn, teams, ffc, athletesById, depthById);
  const withAdp = players.filter((p) => p.adp !== null).length;
  const withAge = players.filter((p) => p.age !== null).length;
  const withPrior = players.filter((p) => p.prior !== null).length;
  // A rookie has no prior season by definition — that's what makes the predicate
  // convention-independent. ESPN's `experience` counter is not self-consistent on its own:
  // the sole experience===1 player in the pool has a full prior season on record (a team
  // change, not a rookie season), while some rookies come back with experience===2.
  const rookies = players.filter(
    (p) => p.experience !== null && p.experience <= 1 && p.prior === null,
  ).length;

  const out = fileURLToPath(new URL('../data/players.json', import.meta.url));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(players, null, 0) + '\n');

  const stampPath = fileURLToPath(new URL('../data/fetched-at.json', import.meta.url));
  writeFileSync(stampPath, JSON.stringify(fetchedAtPayload(new Date()), null, 0) + '\n');

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
