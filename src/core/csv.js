import { pickToSlot } from './snake.js';
import { isOffListId } from './state.js';

// One row per pick, not the grid. The grid is what the board already shows; a
// spreadsheet wants something it can sort and filter, and a pivot table rebuilds the
// grid from this while nothing rebuilds this from the grid.
export const CSV_HEADER = ['Pick', 'Round', 'Team', 'Player', 'Position', 'NFL', 'Bye', 'ADP', 'Projected', 'Keeper'];

// Empty, never zero, for anything the app does not know. A 0 in the ADP column sorts to
// the top and reads as the first pick of the draft; an empty cell is what a spreadsheet
// already means by "not known".
const known = (value) => (value === null || value === undefined ? '' : value);

export function draftRows(state, allPlayers) {
  const byId = new Map(allPlayers.map((pl) => [pl.id, pl]));
  const { numTeams, teams } = state.config;

  return Object.keys(state.picks)
    .map(Number)
    .sort((a, b) => a - b)
    .map((pick) => {
      const entry = state.picks[pick];
      const team = teams[entry.teamIndex - 1];
      // An off-list pick is a cell the user filled without naming anyone. The row stays
      // — the pick genuinely happened and the round and team are facts — but every
      // column that would describe a player is left empty rather than guessed at.
      const player = isOffListId(entry.playerId) ? null : byId.get(entry.playerId) || null;
      return [
        pick,
        pickToSlot(pick, numTeams).round,
        team ? team.name : `Team ${entry.teamIndex}`,
        player ? player.name : '',
        player ? player.position : '',
        player ? known(player.team) : '',
        player ? known(player.bye) : '',
        player ? known(player.adp) : '',
        player ? known(player.projectedPoints) : '',
        entry.isKeeper ? 'yes' : '',
      ];
    });
}

// RFC 4180: quote only when the value contains a comma, a quote, or a line break, and
// double any quote inside. Team names are typed by the user on the setup screen, so a
// comma in one is not hypothetical — unquoted it silently becomes an extra column and
// shifts every field after it.
function escape(value) {
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

// CRLF, which is what the spec says and what Excel expects.
export function toCsv(rows) {
  return rows.map((row) => row.map(escape).join(',')).join('\r\n');
}

// The league is the audience, as with the printed report: without a name in it, twelve
// people exporting one draft produce twelve identical files.
export function csvFilename(state) {
  const { teams, myTeamIndex, numTeams } = state.config;
  const mine = teams[myTeamIndex - 1];
  // Strip what a filesystem refuses, then collapse the runs of separators that leaves.
  const who = (mine && mine.name ? mine.name : '')
    .replace(/[/\\:*?"<>|]/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
  return `${who ? `${who}-` : ''}draft-results-${numTeams}-teams.csv`;
}
