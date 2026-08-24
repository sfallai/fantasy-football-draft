import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig, validateConfig, resizeTeams } from '../src/ui/setup.js';

const form = (over) => ({
  numTeams: 10, rounds: 15, myTeamIndex: 4,
  slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BENCH: 6 },
  teams: Array.from({ length: 10 }, (_, i) => ({ name: `Team ${i + 1}`, keeperId: '', keeperRound: '' })),
  ...over,
});

test('buildConfig coerces strings to numbers and drops empty keepers', () => {
  const config = buildConfig(form({ numTeams: '10', rounds: '15', myTeamIndex: '7' }));
  assert.equal(config.numTeams, 10);
  assert.equal(config.rounds, 15);
  assert.equal(config.myTeamIndex, 7);
  assert.equal(config.teams.length, 10);
  assert.equal(config.teams[0].keeper, null);
});

test('buildConfig keeps a keeper with a player and a round', () => {
  const teams = form().teams;
  teams[2] = { name: 'Sharks', keeperId: 'p42', keeperRound: '3' };
  const config = buildConfig(form({ teams }));
  assert.deepEqual(config.teams[2], { name: 'Sharks', keeper: { playerId: 'p42', round: 3 } });
});

test('buildConfig ignores a keeper missing its round', () => {
  const teams = form().teams;
  teams[0] = { name: 'A', keeperId: 'p1', keeperRound: '' };
  assert.equal(buildConfig(form({ teams })).teams[0].keeper, null);
});

test('buildConfig falls back to a default name for a blank team name', () => {
  const teams = form().teams;
  teams[4] = { name: '   ', keeperId: '', keeperRound: '' };
  assert.equal(buildConfig(form({ teams })).teams[4].name, 'Team 5');
});

test('validateConfig accepts the league defaults', () => {
  assert.deepEqual(validateConfig(buildConfig(form())), []);
});

test('validateConfig rejects an out-of-range draft position', () => {
  const errors = validateConfig(buildConfig(form({ myTeamIndex: 11 })));
  assert.ok(errors.some((e) => /draft position/i.test(e)), errors.join(' | '));
});

test('validateConfig rejects a roster that does not match the round count', () => {
  const slots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BENCH: 2 };
  const errors = validateConfig(buildConfig(form({ slots })));
  assert.ok(errors.some((e) => /roster slots.*11.*15 rounds/i.test(e)), errors.join(' | '));
});

test('validateConfig rejects duplicate keepers', () => {
  const teams = form().teams;
  teams[0] = { name: 'A', keeperId: 'p1', keeperRound: '1' };
  teams[1] = { name: 'B', keeperId: 'p1', keeperRound: '2' };
  const errors = validateConfig(buildConfig(form({ teams })));
  assert.ok(errors.some((e) => /same keeper/i.test(e)), errors.join(' | '));
});

test('validateConfig rejects a keeper round beyond the draft', () => {
  const teams = form().teams;
  teams[0] = { name: 'A', keeperId: 'p1', keeperRound: '20' };
  const errors = validateConfig(buildConfig(form({ teams })));
  assert.ok(errors.some((e) => /keeper round/i.test(e)), errors.join(' | '));
});

test('validateConfig rejects an implausible team count', () => {
  assert.ok(validateConfig(buildConfig(form({ numTeams: 1 }))).length > 0);
});

test('validateConfig rejects a config whose team entries do not match numTeams', () => {
  // Reproduces the setup-screen defect: numTeams raised to 14 while the
  // form.teams array (still 10 entries) was never resized to match.
  const config = buildConfig(form({ numTeams: 14 }));
  assert.equal(config.teams.length, 10);
  const errors = validateConfig(config);
  assert.ok(errors.some((e) => /team entries/i.test(e) && e.includes('14')), errors.join(' | '));
});

test('resizeTeams grows the array, preserving existing rows and appending defaults', () => {
  const teams = form().teams;
  teams[2] = { name: 'Sharks', keeperId: 'p42', keeperRound: '3' };
  const resized = resizeTeams(teams, 14);
  assert.equal(resized.length, 14);
  assert.deepEqual(resized[2], { name: 'Sharks', keeperId: 'p42', keeperRound: '3' });
  assert.deepEqual(resized[0], teams[0]);
  assert.deepEqual(resized[10], { name: 'Team 11', keeperId: '', keeperRound: '' });
  assert.deepEqual(resized[13], { name: 'Team 14', keeperId: '', keeperRound: '' });
});

test('resizeTeams shrinks the array, preserving surviving rows', () => {
  const teams = form().teams;
  teams[1] = { name: 'Wolves', keeperId: 'p7', keeperRound: '5' };
  const resized = resizeTeams(teams, 6);
  assert.equal(resized.length, 6);
  assert.deepEqual(resized[1], { name: 'Wolves', keeperId: 'p7', keeperRound: '5' });
  assert.deepEqual(resized[0], teams[0]);
  assert.deepEqual(resized[5], teams[5]);
});
