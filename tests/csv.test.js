import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftRows, toCsv, csvFilename, CSV_HEADER } from '../src/core/csv.js';
import { createState, applyPick, applyOffListPick } from '../src/core/state.js';

const pl = (id, name, position, points, opts = {}) => ({
  id, name, position, projectedPoints: points, team: opts.team ?? 'XX',
  bye: opts.bye ?? 9, adp: opts.adp ?? null, overallRank: opts.rank ?? 1,
});

const POOL = [
  pl('a', 'Jahmyr Gibbs', 'RB', 297.1, { team: 'DET', bye: 6, adp: 1.4 }),
  pl('b', "Ja'Marr Chase", 'WR', 285, { team: 'CIN', bye: 10, adp: 3.2 }),
  pl('c', 'Brock Bowers', 'TE', 210.5, { team: 'LV', bye: 8, adp: 12.9 }),
  pl('d', 'Broncos D/ST', 'DEF', 130.6, { team: 'DEN', bye: 12, adp: null }),
];
const CONFIG = { numTeams: 2, rounds: 2, myTeamIndex: 1 };

test('one row per pick, in pick order, with everything the app knows', () => {
  let state = createState(CONFIG);
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  const rows = draftRows(state, POOL);
  assert.deepEqual(rows[0], [1, 1, 'Team 1', 'Jahmyr Gibbs', 'RB', 'DET', 6, 1.4, 297.1, '']);
  assert.deepEqual(rows[1], [2, 1, 'Team 2', "Ja'Marr Chase", 'WR', 'CIN', 10, 3.2, 285, '']);
});

test('the header names every column', () => {
  assert.deepEqual(CSV_HEADER,
    ['Pick', 'Round', 'Team', 'Player', 'Position', 'NFL', 'Bye', 'ADP', 'Projected', 'Keeper']);
});

test('snake order is real: round 2 runs back the other way', () => {
  // The grid hides this; a per-pick export must not.
  let state = createState(CONFIG);
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  state = applyPick(state, 'c');
  const rows = draftRows(state, POOL);
  assert.deepEqual(rows.map((r) => [r[0], r[2]]),
    [[1, 'Team 1'], [2, 'Team 2'], [3, 'Team 2']]);
});

test('picks not yet made are absent, not blank rows', () => {
  let state = createState(CONFIG);
  state = applyPick(state, 'a');
  assert.equal(draftRows(state, POOL).length, 1);
});

test('an off-list pick keeps its row and says nothing it does not know', () => {
  let state = createState(CONFIG);
  state = applyOffListPick(state);
  const [row] = draftRows(state, POOL);
  assert.deepEqual(row, [1, 1, 'Team 1', '', '', '', '', '', '', '']);
});

test('a keeper is flagged', () => {
  const state = createState({
    numTeams: 2,
    rounds: 2,
    myTeamIndex: 1,
    teams: [{ name: 'Team 1', keeper: { playerId: 'a', round: 1 } }, { name: 'Team 2' }],
  });
  const [row] = draftRows(state, POOL);
  assert.equal(row[9], 'yes');
});

test('a missing ADP or bye is an empty cell, never a zero', () => {
  // A zero would sort to the top of an ADP column and read as the first pick of the
  // draft. Empty is what a spreadsheet means by "not known".
  let state = createState(CONFIG);
  state = applyPick(state, 'd');
  const [row] = draftRows(state, POOL);
  assert.equal(row[7], '', 'ADP');
  assert.equal(row[5], 'DEN', 'but the team it does know is there');
});

// A minimal quote-aware reader, so the tests below check what a spreadsheet will
// actually see rather than what a naive split on commas sees. Splitting on bare commas
// counts the comma INSIDE a quoted field, which is the whole thing quoting exists for.
function parseRow(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { fields.push(field); field = ''; }
    else field += c;
  }
  fields.push(field);
  return fields;
}

test('a comma in a team name does not become a new column', () => {
  // Team names are typed by the user on the setup screen, so this is not hypothetical.
  const state = createState({
    numTeams: 2, rounds: 1, myTeamIndex: 1,
    teams: [{ name: 'Hobbs, Wayne & Sons' }, { name: 'Team 2' }],
  });
  const csv = toCsv([draftRows({ ...state, picks: { 1: { playerId: 'a', teamIndex: 1 } } }, POOL)[0]]);
  const fields = parseRow(csv.split('\r\n')[0]);
  assert.equal(fields.length, 10, 'still ten columns to a reader that honours quotes');
  assert.equal(fields[2], 'Hobbs, Wayne & Sons', 'and the name survives intact');
  assert.equal(fields[3], 'Jahmyr Gibbs', 'so every later column is still in its place');
  // Unquoted, this same line would read as eleven fields and shift the player into the
  // position column. That is the failure being prevented.
  assert.equal(csv.split('\r\n')[0].split(',').length, 11);
});

test('a quote in a value is doubled, per RFC 4180', () => {
  assert.match(toCsv([['He said "hi"']]), /"He said ""hi"""/);
});

test('a newline inside a value is quoted rather than breaking the row', () => {
  const csv = toCsv([['two\nlines', 'x']]);
  assert.match(csv, /"two\nlines"/);
  assert.equal(csv.split('\r\n').length, 1, 'one CSV record, even though it holds a newline');
});

test('a value that needs no quoting is not quoted', () => {
  assert.equal(toCsv([['Jahmyr Gibbs', 'RB', 6]]), 'Jahmyr Gibbs,RB,6');
});

test('rows are CRLF-separated, which is what the CSV spec and Excel expect', () => {
  assert.equal(toCsv([['a'], ['b']]), 'a\r\nb');
});

test('the filename says whose draft it is and stays legal', () => {
  const state = createState({
    numTeams: 2, rounds: 1, myTeamIndex: 1,
    teams: [{ name: 'Hobbs / Wayne: "Sons"' }, { name: 'Team 2' }],
  });
  const name = csvFilename(state);
  assert.match(name, /\.csv$/);
  assert.doesNotMatch(name, /[/\\:*?"<>|]/, 'nothing a filesystem will refuse');
  assert.match(name, /Hobbs/, 'but still recognisably theirs');
});

test('a team with no name still produces a usable filename', () => {
  const state = createState({ numTeams: 2, rounds: 1, myTeamIndex: 1 });
  state.config.teams[0].name = '';
  assert.match(csvFilename(state), /^draft-results.*\.csv$/);
});

test('a lone carriage return is quoted too, not just a newline', () => {
  // Reachable through an imported backup, whose team names are not retyped on the
  // setup screen. A bare CR terminates a record for some readers.
  assert.match(toCsv([['two\rparts']]), /"two\rparts"/);
});

test('the filename stem is capped, and its separators are not doubled', () => {
  const state = createState({
    numTeams: 2, rounds: 1, myTeamIndex: 1,
    teams: [{ name: `  ${'Wolverhampton '.repeat(12)}  ` }, { name: 'Team 2' }],
  });
  const name = csvFilename(state);
  assert.ok(name.length < 120, `a filesystem will accept it: ${name.length} chars`);
  assert.doesNotMatch(name, /--/, 'no doubled separator from a trimmed edge');
});
