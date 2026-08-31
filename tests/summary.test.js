import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';

installDomStub();
const { renderSummary } = await import('../src/ui/summary.js');

const ROWS = [
  { teamIndex: 2, name: 'Rival', strength: 1450.5, grade: 'A', z: 1.1, rank: 1 },
  { teamIndex: 1, name: 'My Team', strength: 1300.0, grade: 'B-', z: 0.1, rank: 2 },
  { teamIndex: 3, name: 'Third', strength: 1100.2, grade: 'D', z: -1.2, rank: 3 },
];
const walk = (n, o = []) => { o.push(n); for (const c of n.children || []) walk(c, o); return o; };
const render = () => {
  const c = document.createElement('div');
  renderSummary(c, { rows: ROWS, myTeamIndex: 1 }, { onBack() {} });
  return c;
};

test('every team appears, best first', () => {
  const names = walk(render()).filter((n) => n.className === 'sum-name').map((n) => n.textContent);
  assert.deepEqual(names, ['Rival', 'My Team', 'Third']);
});

test('each row shows its rank, grade and projected points', () => {
  const container = render();
  const cells = (cls) => walk(container).filter((n) => n.className === cls).map((n) => n.textContent);
  assert.deepEqual(cells('sum-rank'), ['1', '2', '3']);
  assert.deepEqual(cells('sum-grade'), ['A', 'B-', 'D']);
  // One decimal on every row, including the whole number: the column is tabular-nums
  // and right-aligned, so a bare "1300" beside "1450.5" sits a digit out of line.
  assert.deepEqual(cells('sum-pts'), ['1450.5', '1300.0', '1100.2']);
});

test('the user\'s own team is marked', () => {
  const mine = walk(render()).filter((n) => (n.className || '').includes('mine'));
  assert.equal(mine.length, 1);
  assert.ok(walk(mine[0]).some((n) => n.textContent === 'My Team'));
});

test('the ranking says what it is, and does not claim to predict a season', () => {
  // The schedule is not in the data. Presenting this as a finish order would be inventing
  // a result; the spec forbids it explicitly.
  const text = walk(render()).map((n) => n.textContent || '').join(' ');
  assert.match(text, /projection/i);
  assert.doesNotMatch(text, /\b\d+-\d+\b/, 'no win-loss record anywhere');
});

test('Back to draft calls its handler', () => {
  let went = false;
  const c = document.createElement('div');
  renderSummary(c, { rows: ROWS, myTeamIndex: 1 }, { onBack: () => { went = true; } });
  walk(c).find((n) => n.tagName === 'button' && /back/i.test(n.textContent)).listeners.click[0]();
  assert.equal(went, true);
});

test('the summary renders without a report, exactly as it did before', () => {
  const c = document.createElement('div');
  renderSummary(c, { rows: ROWS, myTeamIndex: 1 }, { onBack() {} });
  assert.equal(walk(c).some((n) => n.className === 'report'), false);
  assert.equal(walk(c).filter((n) => n.className === 'sum-name').length, 3);
});

test('a report supplied in ctx is rendered below the ranking', () => {
  const c = document.createElement('div');
  renderSummary(c, {
    rows: ROWS,
    myTeamIndex: 1,
    report: {
      waivers: [], steals: [], reaches: [], blindSpot: [], benched: [],
      teams: [{ teamIndex: 1, name: 'My Team', spine: [], clashes: [], bestValue: null, biggestReach: null }],
    },
  }, { onBack() {} });
  assert.equal(walk(c).filter((n) => n.className === 'report').length, 1);
});

test('a draft that is not over is not titled as one that is', () => {
  // End draft is unguarded, so one click three picks in used to render "Draft complete"
  // over "22 startable WRs went undrafted" and "Still on waivers: Jonathan Taylor".
  // Every one of those sentences is true; the heading was the thing that was not.
  const c = document.createElement('div');
  renderSummary(c, { rows: ROWS, myTeamIndex: 1, complete: false }, { onBack() {} });
  const text = walk(c).map((n) => n.textContent || '').join(' ');
  assert.doesNotMatch(text, /Draft complete/);
  assert.match(text, /picks made so far/i, 'and it says what the numbers cover');
});

test('a finished draft still says so, and so does a caller that omits the flag', () => {
  const done = document.createElement('div');
  renderSummary(done, { rows: ROWS, myTeamIndex: 1, complete: true }, { onBack() {} });
  assert.ok(walk(done).some((n) => n.textContent === 'Draft complete'));
  // chunk F's caller passes neither a report nor this flag.
  assert.ok(walk(render()).some((n) => n.textContent === 'Draft complete'));
});

test('the ranking says it no longer counts kickers or defenses', () => {
  // The caveat and the arithmetic have to move together, or the screen lies about
  // what its own number means.
  const text = walk(render()).map((n) => n.textContent || '').join(' ');
  assert.match(text, /not counting kickers or defenses/i);
});
