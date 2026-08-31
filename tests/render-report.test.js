import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';

installDomStub();
const { renderReport } = await import('../src/ui/report.js');

const pl = (id, name, position, points, bye = 9, rank = 1) => ({
  id, name, position, projectedPoints: points, bye, overallRank: rank, team: 'XX',
});
const walk = (n, o = []) => { o.push(n); for (const c of n.children || []) walk(c, o); return o; };
const textOf = (c) => walk(c).map((n) => n.textContent || '').join(' ');

const FULL = {
  waivers: [{ position: 'QB', players: [pl('q', 'Jordan Love', 'QB', 259, 9, 198)] }],
  steals: [{ pickNumber: 96, round: 10, teamName: 'Rival', player: pl('s', 'Steal Guy', 'RB', 180), adp: 62, delta: 34 }],
  reaches: [{ pickNumber: 14, round: 2, teamName: 'Mine', player: pl('r', 'Reach Guy', 'WR', 150), adp: 59, delta: -45 }],
  blindSpot: [{ position: 'QB', count: 4, bar: 288.3, best: pl('q', 'Jordan Love', 'QB', 259) }],
  benched: [{ pickNumber: 23, round: 3, teamName: 'Rival', player: pl('b', 'Bench Guy', 'RB', 140) }],
  teams: [{
    teamIndex: 1, name: 'Mine',
    spine: [{ label: 'QB', player: pl('a', 'Spine QB', 'QB', 300) }, { label: 'RB1', player: pl('c', 'Spine RB', 'RB', 200) }],
    clashes: [{ week: 10, players: [pl('a', 'Spine QB', 'QB', 300, 10), pl('c', 'Spine RB', 'RB', 200, 10)] }],
    bestValue: { pickNumber: 96, round: 10, player: pl('s', 'Steal Guy', 'RB', 180), adp: 62, delta: 34 },
    biggestReach: null,
  }],
};
const render = (report) => {
  const c = document.createElement('div');
  renderReport(c, report);
  return c;
};

test('every section renders its fact', () => {
  const text = textOf(render(FULL));
  assert.match(text, /Jordan Love/);
  assert.match(text, /Steal Guy/);
  assert.match(text, /Reach Guy/);
  assert.match(text, /Bench Guy/);
  assert.match(text, /Spine QB/);
});

test('a steal states how far he fell and from what', () => {
  const text = textOf(render(FULL));
  assert.match(text, /34 picks after his ADP of 62/);
  assert.match(text, /Round 10/);
});

test('a reach states how far early, as a positive count of picks', () => {
  // The delta is stored negative. Rendering "-45 picks before" reads as a double
  // negative; the sign is carried by the word "before".
  const text = textOf(render(FULL));
  assert.match(text, /45 picks before his ADP of 59/);
  assert.doesNotMatch(text, /-45/);
});

test('the blind spot states the count, the bar, and the best man left', () => {
  const text = textOf(render(FULL));
  assert.match(text, /4 startable QBs went undrafted/);
  assert.match(text, /288\.3/);
});

test('a section with nothing to say is left out entirely', () => {
  const empty = {
    waivers: [], steals: [], reaches: [], blindSpot: [], benched: [],
    teams: [{ teamIndex: 1, name: 'Mine', spine: [], clashes: [], bestValue: null, biggestReach: null }],
  };
  const text = textOf(render(empty));
  assert.doesNotMatch(text, /Biggest steals/);
  assert.doesNotMatch(text, /Still on waivers/);
  assert.doesNotMatch(text, /blind spot/i);
});

test('a team with no clash and no notable pick still gets its heading', () => {
  // The per-team list is a roll call: dropping a team would read as an omission.
  const one = {
    waivers: [], steals: [], reaches: [], blindSpot: [], benched: [],
    teams: [{ teamIndex: 1, name: 'Quiet', spine: [], clashes: [], bestValue: null, biggestReach: null }],
  };
  assert.match(textOf(render(one)), /Quiet/);
});

test('a bye clash names the week and counts the starters', () => {
  assert.match(textOf(render(FULL)), /2 starters are off in Week 10/);
});

test('nothing on the report predicts a finish', () => {
  // Same rule the ranking above it is held to, enforced the same way.
  const text = textOf(render(FULL));
  assert.doesNotMatch(text, /\b\d+-\d+\b/, 'no win-loss record anywhere');
  assert.doesNotMatch(text, /\bwill\b/i, 'no prediction');
});

test('renderReport clears nothing and appends one node', () => {
  // summary.js calls it with a container that already holds the ranking table.
  const c = document.createElement('div');
  c.appendChild(document.createElement('p'));
  renderReport(c, FULL);
  assert.equal(c.children.length, 2);
  assert.equal(c.children[1].className, 'report');
});
