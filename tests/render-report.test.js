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

// tests/dom-stub.js has no layout engine and textOf flattens the whole tree into one
// string, so a fact rendered in section A satisfies a substring assertion aimed at
// section B — deleting the entire "Still on waivers" block left the suite green,
// because the blind-spot line names the same player. This picks one section out by
// its heading and returns only that section's text. Use textOf itself only for the
// genuinely global claims.
const sectionText = (container, heading) => {
  const found = walk(container).find((n) => n.className === 'rep-section'
    && (n.children[0] || {}).textContent === heading);
  assert.ok(found, `no section headed "${heading}"`);
  return textOf(found);
};

const FULL = {
  waivers: [{ position: 'QB', players: [pl('q', 'Jordan Love', 'QB', 259, 9, 198)] }],
  steals: [{ pickNumber: 96, round: 10, teamName: 'Rival', player: pl('s', 'Steal Guy', 'RB', 180), adp: 62, delta: 34 }],
  reaches: [{ pickNumber: 14, round: 2, teamName: 'Mine', player: pl('r', 'Reach Guy', 'WR', 150), adp: 59, delta: -45 }],
  // The bar sits BELOW the best man left, because leagueBlindSpot only ever emits
  // players projecting above it. A fixture with best < bar renders prose the code
  // cannot produce — "above the replacement level of 288.3 … at 259.0" — and a test
  // built on it asserts a sentence no user will ever see.
  blindSpot: [{ position: 'QB', count: 4, bar: 240, best: pl('q', 'Jordan Love', 'QB', 259) }],
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
  assert.match(text, /34 picks after an ADP of 62/);
  assert.match(text, /Round 10/);
});

test('a reach states how far early, as a positive count of picks', () => {
  // The delta is stored negative. Rendering "-45 picks before" reads as a double
  // negative; the sign is carried by the word "before".
  const text = textOf(render(FULL));
  assert.match(text, /45 picks before an ADP of 59/);
  assert.doesNotMatch(text, /-45/);
});

test('the blind spot states the count, the bar, and the best man left', () => {
  const text = textOf(render(FULL));
  assert.match(text, /4 startable QBs went undrafted/);
  assert.match(text, /240\.0/, 'the bar, to one decimal');
  assert.match(text, /259\.0/, 'and the best man still there, who must clear it');
});

// A gap of one pick is common — three of the six plural slips in one simulated draft
// were a delta of 1 — and it has to read "1 pick" at all four sites: the two league
// sections and the two lines inside a team block.
const ONE = {
  waivers: [], blindSpot: [], benched: [],
  steals: [{ pickNumber: 5, round: 1, teamName: 'Rival', player: pl('s1', 'One Late', 'RB', 100), adp: 4, delta: 1 }],
  reaches: [{ pickNumber: 3, round: 1, teamName: 'Mine', player: pl('r1', 'One Early', 'WR', 100), adp: 4, delta: -1 }],
  teams: [{
    teamIndex: 1, name: 'Mine', spine: [], clashes: [],
    bestValue: { pickNumber: 5, round: 1, player: pl('s1', 'One Late', 'RB', 100), adp: 4, delta: 1 },
    biggestReach: { pickNumber: 3, round: 1, player: pl('r1', 'One Early', 'WR', 100), adp: 4, delta: -1 },
  }],
};

test('a gap of exactly one pick is singular, in the league sections and in a team block', () => {
  const c = render(ONE);
  assert.match(sectionText(c, 'Biggest steals'), /1 pick after an ADP of 4/);
  assert.match(sectionText(c, 'Biggest reaches'), /1 pick before an ADP of 4/);
  const team = sectionText(c, 'Team by team');
  assert.match(team, /Best value: One Late, 1 pick after an ADP of 4/);
  assert.match(team, /Earliest pick: One Early, 1 pick before an ADP of 4/);
  assert.doesNotMatch(textOf(c), /1 picks/, 'nowhere on the report');
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
