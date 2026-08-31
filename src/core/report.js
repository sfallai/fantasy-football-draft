import { availablePlayers, isOffListId, rostersByTeam } from './state.js';
import { pickToSlot } from './snake.js';
import { startingSpine, benchedPlayers, byeClashes } from './teamnotes.js';

// Grouped by position, never one list ordered by projection. Projected points are not
// position-normalised — a QB at a given rank projects roughly twice what an RB or WR at
// the same rank does — so a global ordering off the shipped pool returns nine
// quarterbacks and answers nobody's question. This is the same defect that made every
// sleeper a QB in chunk D, fixed the same way: compare within a position.
//
// K and DEF are absent on purpose: streamed week to week, out of the grade, and every
// team already holds one.
export const WAIVER_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
export const WAIVERS_PER_POSITION = 3;

export function stillOnWaivers(state, allPlayers, perPosition = WAIVERS_PER_POSITION) {
  const left = availablePlayers(state, allPlayers);
  return WAIVER_POSITIONS
    .map((position) => ({
      position,
      players: left
        .filter((pl) => pl.position === position)
        .sort((a, b) => b.projectedPoints - a.projectedPoints)
        .slice(0, perPosition),
    }))
    .filter((group) => group.players.length > 0);
}

// Every pick that can honestly be measured against ADP, with the four that cannot
// dropped rather than guessed at:
//
//   keepers      - held at a round the league agreed beforehand, not a draft decision.
//                  A round-15 keeper with an ADP of 5 scores as a 145-pick steal and
//                  would top the list in every draft that had one.
//   off-list     - no player exists behind the id at all.
//   no ADP       - nothing to measure. Covers 3 of the top 160 on the shipped pool.
//   K and DEF    - an ADP exists, and it does not describe how leagues draft them.
//                  Measured on the shipped pool: 20 defenses carry an ADP, earliest
//                  83.3, median 146.8; 19 kickers, earliest 127.5, median 156.8. An
//                  ADP of 83.3 is round 9 of a ten-team draft, and no room takes a
//                  defense before round 13 — so a defense taken at pick 134 scores as
//                  "51 picks after an ADP of 83", and that number measures the ADP,
//                  not the pick. Over 40 simulated ten-team drafts it swamped both
//                  headline sections: 162 of 200 "Biggest steals" lines and 260 of 400
//                  team "Best value" lines were kickers or defenses. The skew is
//                  symmetric, so an "early" one is measured against the same wrong bar
//                  and the reaches list goes with it.
//
//                  It is also the defect the grading change exists to remove, in a new
//                  place: the ranking at the top of the same screen says a defense
//                  contributes nothing, and four inches below it the report would call
//                  one the best pick of the draft.
//
//                  WAIVER_POSITIONS, not a fresh list — these are the same four
//                  positions stillOnWaivers and leagueBlindSpot report on, and every
//                  position list in this report now says the same thing.
//
// delta is a WHOLE number of picks measured against the ADP as the report displays it —
// `pickNumber - Math.round(adp)`, not the raw difference. POSITIVE means he fell (a
// steal), NEGATIVE means he went early (a reach); only the renderer negates it, and it
// does no arithmetic on it beyond that.
//
// Rounded here rather than in the renderer for two reasons. The report prints the
// rounded ADP beside the gap, and rounding the two independently makes them disagree:
// pick 20 against an ADP of 8.5 rendered "12 picks after his ADP of 9", and 9 + 12 is
// 21. And a raw delta in (-0.5, 0) is negative, so it passed the reach filter and then
// displayed as zero — "0 picks before his ADP of 1", exactly the non-fact the zero rule
// below forbids, reached through a fractional ADP. 193 of the 219 ADPs in the shipped
// pool are fractional, so neither was rare. Whole picks against the displayed ADP fixes
// both at once: the filters exclude the sub-half-pick cases for free, and the two
// printed numbers always reconstruct the pick.
export function pickValues(state, allPlayers) {
  const byId = new Map(allPlayers.map((pl) => [pl.id, pl]));
  const { numTeams, teams } = state.config;
  const out = [];

  for (const [key, entry] of Object.entries(state.picks)) {
    if (entry.isKeeper) continue;
    if (isOffListId(entry.playerId)) continue;
    const player = byId.get(entry.playerId);
    if (!player || player.adp === null || player.adp === undefined) continue;
    if (!WAIVER_POSITIONS.includes(player.position)) continue;

    const pickNumber = Number(key);
    const team = teams[entry.teamIndex - 1];
    out.push({
      pickNumber,
      round: pickToSlot(pickNumber, numTeams).round,
      teamIndex: entry.teamIndex,
      teamName: team ? team.name : `Team ${entry.teamIndex}`,
      player,
      adp: player.adp,
      delta: pickNumber - Math.round(player.adp),
    });
  }

  return out.sort((a, b) => a.pickNumber - b.pickNumber);
}

// A delta of exactly zero is neither: he went at his ADP, and reporting that as a
// 0-pick steal would pad a section with a non-fact.
export function biggestSteals(values, limit = 5) {
  return values
    .filter((v) => v.delta > 0)
    .sort((a, b) => b.delta - a.delta || a.pickNumber - b.pickNumber)
    .slice(0, limit);
}

export function biggestReaches(values, limit = 5) {
  return values
    .filter((v) => v.delta < 0)
    .sort((a, b) => a.delta - b.delta || a.pickNumber - b.pickNumber)
    .slice(0, limit);
}

// "Startable" is measured, not asserted: a player projecting above his position's
// replacement level would improve somebody's starting lineup. Several of those going
// undrafted means the whole league was wrong about the position — which is exactly the
// claim the section makes, and no more.
export function leagueBlindSpot(state, allPlayers, replacement) {
  const left = availablePlayers(state, allPlayers);
  return WAIVER_POSITIONS
    .map((position) => {
      const bar = replacement[position] || 0;
      const players = left
        .filter((pl) => pl.position === position && pl.projectedPoints > bar)
        .sort((a, b) => b.projectedPoints - a.projectedPoints);
      return {
        position,
        count: players.length,
        bar: Math.round(bar * 10) / 10,
        best: players[0] || null,
      };
    })
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || WAIVER_POSITIONS.indexOf(a.position) - WAIVER_POSITIONS.indexOf(b.position));
}

// The spec asks for "early picks on backups who cannot start". "Early" would need a
// round number nobody can defend, so this ranks instead: assign every final roster and
// name the players who landed on a bench, earliest pick first. A stronger fact than a
// count, and constant-free.
export function benchedEarliest(state, allPlayers, limit = 5) {
  const { slots, teams, numTeams } = state.config;
  const rosters = rostersByTeam(state, allPlayers);
  const pickOf = new Map();
  for (const [key, entry] of Object.entries(state.picks)) pickOf.set(entry.playerId, Number(key));

  const out = [];
  for (let teamIndex = 1; teamIndex <= numTeams; teamIndex += 1) {
    for (const player of benchedPlayers(rosters[teamIndex] || [], slots)) {
      const pickNumber = pickOf.get(player.id);
      // A keeper has a pick number like any other and belongs here: a kept player who
      // cannot crack the lineup is the clearest wasted capital in the league.
      if (pickNumber === undefined) continue;
      const team = teams[teamIndex - 1];
      out.push({
        pickNumber,
        round: pickToSlot(pickNumber, numTeams).round,
        teamIndex,
        teamName: team ? team.name : `Team ${teamIndex}`,
        player,
      });
    }
  }

  return out.sort((a, b) => a.pickNumber - b.pickNumber).slice(0, limit);
}

// `teamValues` is this team's slice of pickValues — already keeper-, off-list- and
// no-ADP-filtered, so a team whose every pick was unmeasurable simply reports neither.
export function notesForTeam(roster, slots, teamValues) {
  // Two sorts, each the same one its league-wide section uses, rather than the head and
  // the tail of one. The tail of a descending-delta sort with an ASCENDING pickNumber
  // secondary key resolves a tie to the LATEST pick, while biggestReaches — the head of
  // the ascending sort — resolves the identical tie to the earliest, so the two sections
  // named different picks. Deltas are whole numbers of picks, so ties are ordinary: 56
  // of 400 team blocks over 40 simulated drafts disagreed with the section above them.
  const byDelta = [...teamValues].sort((a, b) => b.delta - a.delta || a.pickNumber - b.pickNumber);
  const byReach = [...teamValues].sort((a, b) => a.delta - b.delta || a.pickNumber - b.pickNumber);
  const top = byDelta[0];
  const bottom = byReach[0];
  return {
    spine: startingSpine(roster, slots),
    clashes: byeClashes(roster, slots),
    bestValue: top && top.delta > 0 ? top : null,
    biggestReach: bottom && bottom.delta < 0 ? bottom : null,
  };
}

export function buildReport(state, allPlayers, replacement) {
  const values = pickValues(state, allPlayers);
  const rosters = rostersByTeam(state, allPlayers);
  const { slots, teams } = state.config;

  return {
    waivers: stillOnWaivers(state, allPlayers),
    steals: biggestSteals(values),
    reaches: biggestReaches(values),
    blindSpot: leagueBlindSpot(state, allPlayers, replacement),
    benched: benchedEarliest(state, allPlayers),
    teams: teams.map((team, i) => ({
      teamIndex: i + 1,
      name: team.name,
      ...notesForTeam(rosters[i + 1] || [], slots, values.filter((v) => v.teamIndex === i + 1)),
    })),
  };
}
