# Draft Report Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take kickers and defenses out of the grade, and grow the end-of-draft summary into a report card — what is still on waivers, the biggest steals and reaches, where the whole league was wrong, and a per-team note for each of the ten.

**Architecture:** Two new pure-core modules (`src/core/teamnotes.js` for per-team facts, `src/core/report.js` for the league-wide composition over them) and one new UI module (`src/ui/report.js`) that is a thin pass over the returned data. Everything is derived from `data/players.json` and draft state, so every section is testable without a DOM. The grading change is one filter in `teamStrength` and stands on its own.

**Tech Stack:** Plain ES modules, no dependencies. `node --test` with `node:assert/strict`. The hand-written DOM stand-in at `tests/dom-stub.js` for the render test.

**Spec:** `docs/superpowers/specs/2026-08-31-draft-report-card-design.md`

## Global Constraints

- Node >= 22. **Zero npm dependencies, permanently.** Do not add a package for anything.
- `draft.html` is a build artifact. **Never hand-edit it.** Run `npm run build` only in the final task; `tests/build.test.js` rebuilds in-process and asserts byte equality.
- Modules under `src/` may use **only** single-line `import { a } from './rel.js';` and `export function|const|class`. The bundler (`scripts/build.mjs`) is a regex transform — a multi-line import, a default export, or `export {  }` at the bottom silently produces a broken page instead of a failing build.
- Do not touch `data/players.json` or `data/fetched-at.json`.
- **No predicted finish or win-loss record, anywhere.** Forbidden in chunk F, enforced by a test in `tests/summary.test.js`, and it stays forbidden here.
- **Every sentence on the screen states a computed fact.** Where a fact is unavailable — a player with no ADP, a team with no bye clash — omit the line rather than padding it. No prose that reads as judgement rather than measurement.
- **No undefendable constants.** Where a threshold would be needed, rank and take the top N instead.
- Do not reorder or restyle the existing ranking table. The grading change alters its numbers, not its presentation.
- No printing or exporting. Out of scope.

## Vocabulary

- **pick number** — the overall 1-based pick, `1..numTeams*rounds`. `state.picks` is keyed by it.
- **`state.picks[n]`** — `{ playerId, teamIndex, isKeeper? }`. `teamIndex` is 1-based.
- **keeper** — a pick created by `createState` from league setup, carrying `isKeeper: true`. Not a draft decision.
- **off-list pick** — a `playerId` matching `isOffListId()`; no player exists in `allPlayers` for it.
- **replacement level** — `replacementPoints(allPlayers, numTeams, slots)` from `src/core/vbd.js`, returning `{QB, RB, WR, TE, K, DEF}`. On the shipped pool with 10 teams and `DEFAULT_SLOTS` it is exactly `{ QB: 288.3, RB: 167, WR: 141.7, TE: 104, K: 145.8, DEF: 100.4 }`.

## File Structure

| File | Responsibility |
|---|---|
| `src/core/grade.js` (modify) | `teamStrength` stops counting K/DEF starting slots. |
| `src/core/teamnotes.js` (new) | Per-team facts from one roster: the starting spine, who is stuck on the bench, which weeks two or more starters are off. |
| `src/core/report.js` (new) | League-wide composition: waivers, ADP deltas, steals, reaches, blind spot, earliest benched pick, and `buildReport` assembling the lot. |
| `src/ui/report.js` (new) | `renderReport(container, report)` — a thin pass over that data. |
| `src/ui/summary.js` (modify) | Moves Back to draft into a header row; delegates to `renderReport` when a report is supplied. |
| `src/ui/app.js` (modify) | `showSummary` builds the report and passes it in `ctx`. |
| `src/styles.css` (modify) | Report section styling inside the existing 620px summary column. |
| `src/ui/tour.js` (modify) | Draft step 6's copy, which currently describes only the chunk F ranking. |

## Two decisions taken before writing this, with the measurements behind them

**1. Waivers are grouped by position, not one global list ordered by projection.**

The spec says *"The best undrafted players by projection, with their overall rank."* Measured against the shipped pool, taking the top 160 by `overallRank` as drafted, a global projection ordering returns:

```
QB Jordan Love 259.0   QB C.J. Stroud 246.6   QB Sam Darnold 242.6
QB Bryce Young 237.5   QB Geno Smith 232.3    QB Cam Ward 220.0
QB Aaron Rodgers 219.2 QB Jacoby Brissett 198.9 QB Fernando Mendoza 187.6
```

Nine quarterbacks, because projected points are not position-normalised — a QB at a given rank projects roughly twice what an RB or WR at the same rank does. This is the same defect that made every sleeper a QB in chunk D, and it was fixed there by scoping the comparison to positional peers. Do the same here: **the best few undrafted at each of QB, RB, WR and TE.** That delivers the spec's intent ("the single most useful thing on the page for the ten minutes after a draft" — who is the best RB left?) and cannot degenerate.

K and DEF are excluded from the waiver list: they are streamed week to week, the grade no longer counts them, and every team already holds one.

**2. "Early picks on backups" is expressed as a ranking, not a round threshold.**

The spec asks the blind-spot section for *"how many teams spent early picks on backups who cannot start."* "Early" needs a round number nobody can defend. Instead: assign every team's final roster with `assignSlots`, take the players who landed in a `BN` slot, and rank them by the pick that bought them. **The earliest picks in the league that ended up on a bench.** No constant, and it is a stronger fact than a count — it names them.

---

## Task 1: Kickers and defenses come out of the grade

**Files:**
- Modify: `src/core/grade.js:1-9`
- Test: `tests/grade.test.js`

**Interfaces:**
- Consumes: `assignSlots(players, slots)` from `src/core/roster.js`, already imported.
- Produces: `UNGRADED_POSITIONS` (a `string[]`) exported from `src/core/grade.js`. `teamStrength(roster, slots)` keeps its signature and return type (a number).

**Why this is here at all.** A kicker projects 145–172 against a mid-draft league spread of 100–150, so under the current rule drafting one early *raises* a grade by up to two letters — while the recommendation panel two feet away tells you to wait. The two panels currently give opposite advice by construction. There is deliberately **no separate penalty term**: a wasted pick contributes nothing, and contributing nothing is the penalty.

- [ ] **Step 1: Write the failing tests**

Add to `tests/grade.test.js`, after the existing `teamStrength` tests:

```js
test('a kicker does not move a team\'s strength', () => {
  // The regression that motivated the whole chunk. Brandon Aubrey projects 171.7 —
  // more than a mid-round starting WR — so counting him let a round-8 kicker outrank
  // a genuinely better roster for three rounds.
  const skill = [pl('a', 'RB', 200), pl('b', 'WR', 150)];
  const before = teamStrength(skill, DEFAULT_SLOTS);
  assert.equal(teamStrength([...skill, pl('k', 'K', 171.7)], DEFAULT_SLOTS), before);
});

test('a defense does not move a team\'s strength either', () => {
  const skill = [pl('a', 'RB', 200)];
  const before = teamStrength(skill, DEFAULT_SLOTS);
  assert.equal(teamStrength([...skill, pl('d', 'DEF', 130.6)], DEFAULT_SLOTS), before);
});

test('a team of nothing but kickers and defenses grades as if it had not drafted', () => {
  // Not a penalty — the absence of one. Spending four picks where they buy no
  // starting-lineup point scores exactly what spending no picks scores, which is
  // the truth about those picks.
  const roster = [pl('k1', 'K', 171.7), pl('k2', 'K', 161.9), pl('d1', 'DEF', 130.6)];
  assert.equal(teamStrength(roster, DEFAULT_SLOTS), 0);
});

test('the excluded positions are named, not inferred from slot labels', () => {
  assert.deepEqual(UNGRADED_POSITIONS, ['K', 'DEF']);
});
```

Add `UNGRADED_POSITIONS` to the import at the top of the file:

```js
import { teamStrength, gradeFor, gradeTeams, GRADE_BANDS, NEUTRAL_GRADE, UNGRADED_POSITIONS } from '../src/core/grade.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/grade.test.js`
Expected: FAIL — the kicker test reports `371.7 !== 350`, and `UNGRADED_POSITIONS` is `undefined`.

- [ ] **Step 3: Implement**

Replace the top of `src/core/grade.js` (the import and `teamStrength`) with:

```js
import { assignSlots } from './roster.js';

// Kickers and defenses are worth real points and no draft capital — they are streamed
// off waivers week to week. Counting them in the grade rewarded spending capital where
// it buys nothing: a kicker projects 145-172 against a league spread of 100-150, so a
// round-8 kicker moved a team up two letters while the recommendation panel was telling
// the user to wait. There is no separate penalty for a wasted pick; a pick that
// contributes nothing IS the penalty.
export const UNGRADED_POSITIONS = ['K', 'DEF'];

// Reusing assignSlots rather than reimplementing "who starts" is the point: the grade and
// the roster panel are then incapable of disagreeing about a team's lineup.
export function teamStrength(roster, slots) {
  return assignSlots(roster, slots)
    .filter((slot) => slot.player
      && !slot.label.startsWith('BN')
      && !UNGRADED_POSITIONS.includes(slot.player.position))
    .reduce((sum, slot) => sum + slot.player.projectedPoints, 0);
}
```

Filter on `slot.player.position`, not on the slot label: a league that sets `slots.K = 2` produces labels `K1`/`K2`, and a label test would have to strip the digits. The player's position is the fact being excluded.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/grade.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and fix what this legitimately broke**

Run: `npm test`

Some existing fixtures elsewhere may include a K or DEF and assert a strength or a grade. Every such number is now **wrong by definition** — update the expected value and add a one-line comment saying the kicker no longer counts. Do not weaken an assertion to make it pass, and do not change a fixture's roster to avoid recomputing. `tests/render-app.test.js` exercises the mid-draft roster popover, which shows a live grade from the same `gradeTeams`; if a grade letter there moves, that is this change working.

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/core/grade.js tests/
git commit -m "fix(grade): stop kickers and defenses inflating a team's strength"
```

---

## Task 2: Per-team facts

**Files:**
- Create: `src/core/teamnotes.js`
- Test: `tests/teamnotes.js` → **create `tests/teamnotes.test.js`**

**Interfaces:**
- Consumes: `assignSlots(players, slots)` from `src/core/roster.js`.
- Produces, all exported from `src/core/teamnotes.js`:
  - `SPINE_POSITIONS` — `['QB', 'RB', 'WR', 'TE']`
  - `startingSpine(roster, slots)` → `[{ label: string, player: object }]`, in slot order
  - `benchedPlayers(roster, slots)` → `[player]`
  - `byeClashes(roster, slots)` → `[{ week: number, players: [player] }]`, most players first

- [ ] **Step 1: Write the failing test**

Create `tests/teamnotes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startingSpine, benchedPlayers, byeClashes, SPINE_POSITIONS } from '../src/core/teamnotes.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const pl = (id, position, points, bye = 9) => ({
  id, name: id, position, projectedPoints: points, team: 'XX', bye,
});

test('the spine is the starting lineup, in slot order', () => {
  const roster = [pl('qb', 'QB', 300), pl('rb1', 'RB', 200), pl('rb2', 'RB', 180), pl('wr1', 'WR', 170)];
  assert.deepEqual(
    startingSpine(roster, DEFAULT_SLOTS).map((s) => [s.label, s.player.id]),
    [['QB', 'qb'], ['RB1', 'rb1'], ['RB2', 'rb2'], ['WR1', 'wr1']],
  );
});

test('the spine leaves out the kicker and the defense', () => {
  // Same exclusion the grade now makes. A spine is the core you start every week
  // because you drafted it; a kicker is this week's kicker.
  const roster = [pl('qb', 'QB', 300), pl('k', 'K', 171.7), pl('d', 'DEF', 130.6)];
  assert.deepEqual(startingSpine(roster, DEFAULT_SLOTS).map((s) => s.player.id), ['qb']);
  assert.deepEqual(SPINE_POSITIONS, ['QB', 'RB', 'WR', 'TE']);
});

test('the spine leaves out the bench', () => {
  // DEFAULT_SLOTS starts one QB; the second is depth.
  const roster = [pl('q1', 'QB', 300), pl('q2', 'QB', 290)];
  assert.deepEqual(startingSpine(roster, DEFAULT_SLOTS).map((s) => s.player.id), ['q1']);
});

test('benchedPlayers is exactly who could not make the lineup', () => {
  const roster = [pl('q1', 'QB', 300), pl('q2', 'QB', 290), pl('q3', 'QB', 280)];
  assert.deepEqual(benchedPlayers(roster, DEFAULT_SLOTS).map((p) => p.id), ['q2', 'q3']);
});

test('a bye clash is two or more starters off in the same week', () => {
  const roster = [pl('qb', 'QB', 300, 10), pl('rb1', 'RB', 200, 10), pl('rb2', 'RB', 180, 7)];
  assert.deepEqual(
    byeClashes(roster, DEFAULT_SLOTS).map((c) => [c.week, c.players.map((p) => p.id)]),
    [[10, ['qb', 'rb1']]],
  );
});

test('one starter alone in a week is not a clash', () => {
  const roster = [pl('qb', 'QB', 300, 10), pl('rb1', 'RB', 200, 7)];
  assert.deepEqual(byeClashes(roster, DEFAULT_SLOTS), []);
});

test('a benched player sharing a bye with a starter is not a clash', () => {
  // Only a projected STARTER can leave a hole in the lineup. The same rule
  // byeConflict already applies in roster.js.
  const roster = [pl('q1', 'QB', 300, 10), pl('q2', 'QB', 290, 10)];
  assert.deepEqual(byeClashes(roster, DEFAULT_SLOTS), []);
});

test('a missing bye is never a clash', () => {
  // Two unknowns are not a known collision. byeConflict makes the same call.
  const roster = [pl('qb', 'QB', 300, null), pl('rb1', 'RB', 200, null)];
  assert.deepEqual(byeClashes(roster, DEFAULT_SLOTS), []);
});

test('clashes are ordered worst first', () => {
  const roster = [
    pl('qb', 'QB', 300, 10), pl('rb1', 'RB', 200, 10), pl('rb2', 'RB', 190, 10),
    pl('wr1', 'WR', 180, 7), pl('wr2', 'WR', 170, 7),
  ];
  assert.deepEqual(byeClashes(roster, DEFAULT_SLOTS).map((c) => [c.week, c.players.length]),
    [[10, 3], [7, 2]]);
});

test('an empty roster produces empty everything, never a throw', () => {
  assert.deepEqual(startingSpine([], DEFAULT_SLOTS), []);
  assert.deepEqual(benchedPlayers([], DEFAULT_SLOTS), []);
  assert.deepEqual(byeClashes([], DEFAULT_SLOTS), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/teamnotes.test.js`
Expected: FAIL — `Cannot find module '../src/core/teamnotes.js'`.

- [ ] **Step 3: Implement**

Create `src/core/teamnotes.js`:

```js
import { assignSlots } from './roster.js';

// The core a team starts every week because it drafted it. Kicker and defense are left
// out for the same reason the grade leaves them out: they cost no draft capital and are
// replaced off waivers, so they say nothing about how the draft went.
export const SPINE_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

// assignSlots, not a re-implementation: the grade, the roster panel and this report are
// then incapable of disagreeing about who starts.
export function startingSpine(roster, slots) {
  return assignSlots(roster, slots)
    .filter((slot) => slot.player
      && !slot.label.startsWith('BN')
      && SPINE_POSITIONS.includes(slot.player.position))
    .map((slot) => ({ label: slot.label, player: slot.player }));
}

export function benchedPlayers(roster, slots) {
  return assignSlots(roster, slots)
    .filter((slot) => slot.label.startsWith('BN') && slot.player)
    .map((slot) => slot.player);
}

// Weeks where two or more STARTERS are off at once — the only players whose absence
// leaves a hole. A null bye is missing data, never a clash: two unknowns are not a known
// collision, which is the rule byeConflict already applies.
export function byeClashes(roster, slots) {
  const byWeek = new Map();
  for (const { player } of startingSpine(roster, slots)) {
    if (player.bye === null || player.bye === undefined) continue;
    if (!byWeek.has(player.bye)) byWeek.set(player.bye, []);
    byWeek.get(player.bye).push(player);
  }
  return [...byWeek.entries()]
    .filter(([, players]) => players.length >= 2)
    .map(([week, players]) => ({ week, players }))
    .sort((a, b) => b.players.length - a.players.length || a.week - b.week);
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/teamnotes.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/teamnotes.js tests/teamnotes.test.js
git commit -m "feat(report): per-team spine, bench and bye clashes"
```

---

## Task 3: Waivers, and every pick measured against ADP

**Files:**
- Create: `src/core/report.js`
- Test: create `tests/report.test.js`

**Interfaces:**
- Consumes: `availablePlayers(state, allPlayers)` and `isOffListId(playerId)` from `src/core/state.js`; `pickToSlot(overallPick, numTeams)` from `src/core/snake.js`.
- Produces, exported from `src/core/report.js`:
  - `WAIVER_POSITIONS` — `['QB', 'RB', 'WR', 'TE']`
  - `WAIVERS_PER_POSITION` — `3`
  - `stillOnWaivers(state, allPlayers, perPosition = WAIVERS_PER_POSITION)` → `[{ position, players: [player] }]`, empty groups dropped
  - `pickValues(state, allPlayers)` → `[{ pickNumber, round, teamIndex, teamName, player, adp, delta }]`, ordered by `pickNumber`. `delta = pickNumber - adp`, rounded to one decimal: **positive means he fell past his ADP (a steal), negative means he went early (a reach).**
  - `biggestSteals(values, limit = 5)` → the same shape, largest positive delta first
  - `biggestReaches(values, limit = 5)` → the same shape, largest negative delta first

**Three exclusions, all load-bearing.** A keeper is not a draft decision — it is held at a round the league agreed on beforehand, so measuring a round-15 keeper against an ADP of 5 invents a 145-pick "steal" that would top the list every time. An off-list pick has no player behind it at all. A player with no ADP cannot be measured; the spec says omit rather than guess, and ADP covers 157 of the top 160 players so this drops almost nothing.

- [ ] **Step 1: Write the failing test**

Create `tests/report.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stillOnWaivers, pickValues, biggestSteals, biggestReaches,
  WAIVER_POSITIONS, WAIVERS_PER_POSITION,
} from '../src/core/report.js';
import { createState, applyPick, applyOffListPick } from '../src/core/state.js';

const pl = (id, position, points, adp = null, rank = 1) => ({
  id, name: id, position, projectedPoints: points, adp, overallRank: rank, team: 'XX', bye: 9,
});

// Four teams, two rounds: picks 1,2,3,4 then 5,6,7,8 snaking back.
const CONFIG = { numTeams: 4, rounds: 2, myTeamIndex: 1 };
const fresh = (config = CONFIG) => createState(config);

const POOL = [
  pl('rb1', 'RB', 250, 2, 1), pl('rb2', 'RB', 240, 5, 2), pl('rb3', 'RB', 230, 9, 3),
  pl('wr1', 'WR', 220, 3, 4), pl('wr2', 'WR', 210, 40, 5),
  pl('qb1', 'QB', 300, 60, 6), pl('qb2', 'QB', 290, 70, 7),
  pl('te1', 'TE', 150, 80, 8),
  pl('fell', 'RB', 235, 1, 11),
  pl('k1', 'K', 171.7, 90, 9),
  pl('noadp', 'WR', 205, null, 10),
];

test('waivers are grouped by position, never one list ordered by projection', () => {
  // A global projection ordering returns nine quarterbacks off the shipped pool,
  // because projected points are not position-normalised. Measured, not assumed.
  const state = fresh();
  const groups = stillOnWaivers(state, POOL);
  assert.deepEqual(groups.map((g) => g.position), ['QB', 'RB', 'WR', 'TE']);
  assert.deepEqual(WAIVER_POSITIONS, ['QB', 'RB', 'WR', 'TE']);
});

test('each group is the best remaining at that position, best first', () => {
  const state = fresh();
  const groups = stillOnWaivers(state, POOL);
  // rb1 250, rb2 240, fell 235, rb3 230 — capped at three, so rb3 does not appear.
  const rbs = groups.find((g) => g.position === 'RB');
  assert.deepEqual(rbs.players.map((p) => p.id), ['rb1', 'rb2', 'fell']);
});

test('a drafted player is off the waiver list', () => {
  const state = fresh();
  applyPick(state, 'rb1');
  const rbs = stillOnWaivers(state, POOL).find((g) => g.position === 'RB');
  assert.deepEqual(rbs.players.map((p) => p.id), ['rb2', 'fell', 'rb3']);
});

test('the list is capped per position and the cap is stated', () => {
  assert.equal(WAIVERS_PER_POSITION, 3);
  const state = fresh();
  const rbs = stillOnWaivers(state, POOL, 2).find((g) => g.position === 'RB');
  assert.equal(rbs.players.length, 2);
});

test('kickers and defenses are not on the waiver list at all', () => {
  // Streamed week to week, excluded from the grade, and every team already holds one.
  const state = fresh();
  assert.equal(stillOnWaivers(state, POOL).some((g) => g.position === 'K'), false);
});

test('a position with nobody left is dropped, not shown empty', () => {
  const state = fresh();
  applyPick(state, 'te1');
  assert.equal(stillOnWaivers(state, POOL).some((g) => g.position === 'TE'), false);
});

test('delta is picks past ADP: positive fell, negative went early', () => {
  const state = fresh();
  applyPick(state, 'rb1');   // pick 1, adp 2  -> -1, a reach by one
  applyPick(state, 'wr2');   // pick 2, adp 40 -> -38, a big reach
  applyPick(state, 'fell');  // pick 3, adp 1  -> +2, fell two past his ADP
  const values = pickValues(state, POOL);
  assert.deepEqual(values.map((v) => [v.pickNumber, v.player.id, v.delta]),
    [[1, 'rb1', -1], [2, 'wr2', -38], [3, 'fell', 2]]);
});

test('each measured pick carries its round and the team that made it', () => {
  const state = fresh();
  applyPick(state, 'rb1');
  applyPick(state, 'rb2');
  applyPick(state, 'rb3');
  applyPick(state, 'wr1');
  applyPick(state, 'wr2');   // pick 5: round 2, and a snake puts it back on team 4
  const fifth = pickValues(state, POOL).find((v) => v.pickNumber === 5);
  assert.equal(fifth.round, 2);
  assert.equal(fifth.teamIndex, 4);
  assert.equal(fifth.teamName, 'Team 4');
});

test('a keeper is never measured against ADP', () => {
  // A keeper is held at a round the league agreed beforehand, not a draft decision.
  // Measuring one invents a huge steal that would top the list every single time.
  const state = createState({
    numTeams: 4, rounds: 2, myTeamIndex: 1,
    teams: [
      { name: 'A', keeper: { playerId: 'rb1', round: 2 } },
      { name: 'B', keeper: null }, { name: 'C', keeper: null }, { name: 'D', keeper: null },
    ],
  });
  assert.equal(pickValues(state, POOL).some((v) => v.player.id === 'rb1'), false);
});

test('an off-list pick is skipped rather than crashing the report', () => {
  const state = fresh();
  applyOffListPick(state);
  assert.deepEqual(pickValues(state, POOL), []);
});

test('a player with no ADP is omitted, never guessed at', () => {
  const state = fresh();
  applyPick(state, 'noadp');
  assert.deepEqual(pickValues(state, POOL), []);
});

test('steals are the largest positive deltas, reaches the largest negative', () => {
  const state = fresh();
  applyPick(state, 'wr2');   // pick 1, adp 40 -> -39
  applyPick(state, 'rb1');   // pick 2, adp 2  ->   0, neither
  applyPick(state, 'rb2');   // pick 3, adp 5  ->  -2
  applyPick(state, 'te1');   // pick 4, adp 80 -> -76
  applyPick(state, 'qb1');   // pick 5, adp 60 -> -55
  const values = pickValues(state, POOL);
  assert.deepEqual(biggestReaches(values, 2).map((v) => [v.player.id, v.delta]),
    [['te1', -76], ['qb1', -55]]);
  assert.deepEqual(biggestSteals(values, 2), [], 'nobody fell, so there are no steals');
});

test('a delta of exactly zero is neither a steal nor a reach', () => {
  // He went at his ADP. There is nothing to report, and reporting it as a 0-pick
  // steal would be padding a section with a non-fact.
  const values = [{ pickNumber: 2, delta: 0, player: pl('x', 'RB', 1, 2) }];
  assert.deepEqual(biggestSteals(values), []);
  assert.deepEqual(biggestReaches(values), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/report.test.js`
Expected: FAIL — `Cannot find module '../src/core/report.js'`.

- [ ] **Step 3: Implement**

Create `src/core/report.js`:

```js
import { availablePlayers, isOffListId } from './state.js';
import { pickToSlot } from './snake.js';

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

// Every pick that can honestly be measured against ADP, with the three that cannot
// dropped rather than guessed at:
//
//   keepers      - held at a round the league agreed beforehand, not a draft decision.
//                  A round-15 keeper with an ADP of 5 scores as a 145-pick steal and
//                  would top the list in every draft that had one.
//   off-list     - no player exists behind the id at all.
//   no ADP       - nothing to measure. Covers 3 of the top 160 on the shipped pool.
//
// delta is picks past ADP: POSITIVE means he fell (a steal), NEGATIVE means he went
// early (a reach). Same sign convention as reasonsFor in recommend.js.
export function pickValues(state, allPlayers) {
  const byId = new Map(allPlayers.map((pl) => [pl.id, pl]));
  const { numTeams, teams } = state.config;
  const out = [];

  for (const [key, entry] of Object.entries(state.picks)) {
    if (entry.isKeeper) continue;
    if (isOffListId(entry.playerId)) continue;
    const player = byId.get(entry.playerId);
    if (!player || player.adp === null || player.adp === undefined) continue;

    const pickNumber = Number(key);
    const team = teams[entry.teamIndex - 1];
    out.push({
      pickNumber,
      round: pickToSlot(pickNumber, numTeams).round,
      teamIndex: entry.teamIndex,
      teamName: team ? team.name : `Team ${entry.teamIndex}`,
      player,
      adp: player.adp,
      delta: Math.round((pickNumber - player.adp) * 10) / 10,
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
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/report.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all green — this task adds a module and touches nothing existing.

- [ ] **Step 6: Commit**

```bash
git add src/core/report.js tests/report.test.js
git commit -m "feat(report): waiver groups and ADP deltas for every measurable pick"
```

---

## Task 4: The league's blind spot, the earliest wasted picks, and the composed report

**Files:**
- Modify: `src/core/report.js`
- Test: `tests/report.test.js`

**Interfaces:**
- Consumes: `benchedPlayers(roster, slots)` from `src/core/teamnotes.js` (Task 2); `startingSpine` and `byeClashes` from the same; `rostersByTeam(state, allPlayers)` from `src/core/state.js`; `replacementPoints(allPlayers, numTeams, slots)` from `src/core/vbd.js`.
- Produces, added to `src/core/report.js`:
  - `leagueBlindSpot(state, allPlayers, replacement)` → `[{ position, count, bar, best }]` — positions where startable players went undrafted, most first. `bar` is the replacement level, rounded to one decimal. `best` is the top undrafted player at that position.
  - `benchedEarliest(state, allPlayers, limit = 5)` → `[{ pickNumber, round, teamIndex, teamName, player }]`, earliest pick first
  - `notesForTeam(roster, slots, teamValues)` → `{ spine, clashes, bestValue, biggestReach }`
  - `buildReport(state, allPlayers, replacement)` → `{ waivers, steals, reaches, blindSpot, benched, teams }` where `teams` is `[{ teamIndex, name, spine, clashes, bestValue, biggestReach }]` in team order

**"Startable" is a measurement, not an opinion.** A player is startable if he projects above his position's replacement level — the same `replacementPoints` the VBD column already uses, which on the shipped pool returns `QB 288.3, RB 167.0, WR 141.7, TE 104.0`. A position where several such players went undrafted is a position the whole league was wrong about.

- [ ] **Step 1: Write the failing test**

Append to `tests/report.test.js`, and extend the import at the top to include the four new names:

```js
import {
  stillOnWaivers, pickValues, biggestSteals, biggestReaches,
  leagueBlindSpot, benchedEarliest, notesForTeam, buildReport,
  WAIVER_POSITIONS, WAIVERS_PER_POSITION,
} from '../src/core/report.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';
```

```js
const BAR = { QB: 250, RB: 200, WR: 200, TE: 100, K: 0, DEF: 0 };

test('a blind spot is a position where startable players went undrafted', () => {
  // qb1 (300) and qb2 (290) both clear the QB bar of 250 and nobody took either.
  const state = fresh();
  const spots = leagueBlindSpot(state, POOL, BAR);
  const qb = spots.find((s) => s.position === 'QB');
  assert.equal(qb.count, 2);
  assert.equal(qb.bar, 250);
  assert.equal(qb.best.id, 'qb1', 'and it names the best one left');
});

test('a position nobody was wrong about is absent, not listed as zero', () => {
  const state = fresh();
  // te1 projects 150 against a bar of 100, so TE IS a blind spot here; WR is not,
  // because wr1 (220) and wr2 (210) clear 200 — so raise the bar past both.
  const spots = leagueBlindSpot(state, POOL, { ...BAR, WR: 900 });
  assert.equal(spots.some((s) => s.position === 'WR'), false);
});

test('blind spots are ordered by how many were missed', () => {
  const state = fresh();
  // RBs above 200: rb1 250, rb2 240, rb3 230, fell 235 -> four. QBs above 250: two.
  const spots = leagueBlindSpot(state, POOL, { QB: 250, RB: 200, WR: 900, TE: 900 });
  assert.deepEqual(spots.map((s) => [s.position, s.count]), [['RB', 4], ['QB', 2]]);
});

test('a drafted player is not a missed one', () => {
  const state = fresh();
  applyPick(state, 'qb1');
  assert.equal(leagueBlindSpot(state, POOL, BAR).find((s) => s.position === 'QB').count, 1);
});

test('the earliest picks that ended up on a bench are named, earliest first', () => {
  // Team 1 takes three RBs. DEFAULT_SLOTS starts RB1, RB2 and FLEX, so the first
  // three all start; a fourth would be the first benched. Two teams, four rounds.
  const state = createState({ numTeams: 2, rounds: 4, myTeamIndex: 1 });
  applyPick(state, 'rb1');   // pick 1, team 1
  applyPick(state, 'qb1');   // pick 2, team 2
  applyPick(state, 'qb2');   // pick 3, team 2  (snake)
  applyPick(state, 'rb2');   // pick 4, team 1
  applyPick(state, 'rb3');   // pick 5, team 1
  applyPick(state, 'wr1');   // pick 6, team 2
  applyPick(state, 'wr2');   // pick 7, team 2
  applyPick(state, 'te1');   // pick 8, team 1
  // Team 2 holds qb1 (300) and qb2 (290) with one QB slot: qb2 is benched, bought
  // at pick 3, and that is the earliest wasted pick in this league.
  const benched = benchedEarliest(state, POOL, 3);
  assert.equal(benched[0].player.id, 'qb2');
  assert.equal(benched[0].pickNumber, 3);
  assert.equal(benched[0].round, 2);
  assert.equal(benched[0].teamIndex, 2);
});

test('a team that wasted nothing contributes nothing to that list', () => {
  const state = createState({ numTeams: 2, rounds: 1, myTeamIndex: 1 });
  applyPick(state, 'rb1');
  applyPick(state, 'wr1');
  assert.deepEqual(benchedEarliest(state, POOL), []);
});

test('a team note carries its spine, its clashes, and its two most extreme picks', () => {
  const roster = [pl('qb1', 'QB', 300, 60, 6), pl('rb1', 'RB', 250, 2, 1)];
  const values = [
    { pickNumber: 1, delta: -1, player: roster[1] },
    { pickNumber: 8, delta: 12, player: roster[0] },
  ];
  const note = notesForTeam(roster, DEFAULT_SLOTS, values);
  assert.deepEqual(note.spine.map((s) => s.player.id), ['qb1', 'rb1']);
  assert.deepEqual(note.clashes, [], 'no clash to report');
  assert.equal(note.bestValue.player.id, 'qb1', 'the pick that fell furthest');
  assert.equal(note.biggestReach.player.id, 'rb1', 'and the one taken earliest');
});

test('a team with no reach reports none rather than an inverted steal', () => {
  const roster = [pl('qb1', 'QB', 300, 60, 6)];
  const values = [{ pickNumber: 8, delta: 12, player: roster[0] }];
  const note = notesForTeam(roster, DEFAULT_SLOTS, values);
  assert.equal(note.bestValue.player.id, 'qb1');
  assert.equal(note.biggestReach, null);
});

test('buildReport assembles every section and one note per team, in team order', () => {
  const state = fresh();
  applyPick(state, 'rb1');
  applyPick(state, 'wr2');
  const report = buildReport(state, POOL, BAR);
  assert.deepEqual(Object.keys(report).sort(),
    ['benched', 'blindSpot', 'reaches', 'steals', 'teams', 'waivers']);
  assert.deepEqual(report.teams.map((t) => t.teamIndex), [1, 2, 3, 4]);
  assert.deepEqual(report.teams.map((t) => t.name), ['Team 1', 'Team 2', 'Team 3', 'Team 4']);
  assert.equal(report.reaches[0].player.id, 'wr2', 'taken 38 picks before his ADP');
});

test('buildReport survives a draft that has not started', () => {
  // The summary screen is reachable from the draft screen at any time.
  const report = buildReport(fresh(), POOL, BAR);
  assert.deepEqual(report.steals, []);
  assert.deepEqual(report.reaches, []);
  assert.deepEqual(report.benched, []);
  assert.equal(report.teams.length, 4);
  assert.deepEqual(report.teams[0].spine, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/report.test.js`
Expected: FAIL — `leagueBlindSpot is not a function`.

- [ ] **Step 3: Implement**

Extend the imports at the top of `src/core/report.js` (each on its own single line, as the bundler requires):

```js
import { availablePlayers, isOffListId, rostersByTeam } from './state.js';
import { pickToSlot } from './snake.js';
import { startingSpine, benchedPlayers, byeClashes } from './teamnotes.js';
```

Append to `src/core/report.js`:

```js
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
  const byDelta = [...teamValues].sort((a, b) => b.delta - a.delta || a.pickNumber - b.pickNumber);
  const top = byDelta[0];
  const bottom = byDelta[byDelta.length - 1];
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
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/report.test.js`
Expected: PASS.

- [ ] **Step 5: Add one test against the real data**

The fixtures above prove the arithmetic. This proves the section is not vacuous on the pool that actually ships. Append to `tests/report.test.js`:

```js
test('the blind spot is computable against the real pool and the real replacement levels', async () => {
  const { readFileSync } = await import('node:fs');
  const { replacementPoints } = await import('../src/core/vbd.js');
  const real = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'));
  const state = createState({ numTeams: 10, rounds: 15, myTeamIndex: 1 });
  const replacement = replacementPoints(real, 10, DEFAULT_SLOTS);
  // The figures the spec quotes, to the decimal. If a data refresh moves them this
  // assertion is the thing that says so.
  assert.equal(replacement.QB, 288.3);
  assert.equal(replacement.RB, 167);
  assert.equal(replacement.WR, 141.7);
  assert.equal(replacement.TE, 104);
  // Before a pick is made every startable player is undrafted, so every position is a
  // blind spot. That is the degenerate case, and it proves the wiring end to end.
  const spots = leagueBlindSpot(state, real, replacement);
  assert.deepEqual(spots.map((s) => s.position).sort(), ['QB', 'RB', 'TE', 'WR']);
  for (const spot of spots) assert.ok(spot.best.projectedPoints > spot.bar);
});
```

Run: `node --test tests/report.test.js`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and commit**

```bash
npm test
git add src/core/report.js tests/report.test.js
git commit -m "feat(report): blind spot, earliest wasted picks, and the composed report"
```

---

## Task 5: Render the report card

**Files:**
- Create: `src/ui/report.js`
- Modify: `src/ui/summary.js`, `src/ui/app.js`, `src/styles.css`
- Test: create `tests/render-report.test.js`; modify `tests/summary.test.js`

**Interfaces:**
- Consumes: `el`, `clear` from `src/ui/dom.js`; the `buildReport` shape from Task 4.
- Produces: `renderReport(container, report)` exported from `src/ui/report.js`. Appends one `.report` element to `container`. `renderSummary(container, ctx, handlers)` keeps its signature; `ctx.report` is optional and **its absence must render exactly what renders today**.

**Copy rules, restated because this is the task they bind.** Every line states a computed fact. A section with nothing to say is omitted entirely rather than rendered with an "everyone drafted well" line. No adjectives that grade a decision — "taken 45 picks before his ADP" is a measurement; "a wild reach" is not. No predicted finish, no win-loss record.

- [ ] **Step 1: Write the failing test**

Create `tests/render-report.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/render-report.test.js`
Expected: FAIL — `Cannot find module '../src/ui/report.js'`.

- [ ] **Step 3: Implement the renderer**

Create `src/ui/report.js`:

```js
import { el } from './dom.js';

// Every line here states a computed fact. A section with nothing to say is omitted
// rather than padded, and nothing is phrased as judgement: "34 picks after his ADP of
// 62" is a measurement, "a steal of the draft" is the app claiming an authority it does
// not have. It would also be obviously templated by the third team.
function section(title, lines) {
  if (lines.length === 0) return null;
  return el('div', { class: 'rep-section' }, [
    el('h2', { text: title }, []),
    ...lines,
  ]);
}

const line = (text) => el('div', { class: 'rep-line', text }, []);

function waiverLines(waivers) {
  return waivers.map((group) => el('div', { class: 'rep-line' }, [
    el('span', { class: 'rep-pos', text: group.position }, []),
    el('span', {
      text: group.players
        .map((pl) => `${pl.name} — ${pl.projectedPoints.toFixed(1)} (rank ${pl.overallRank})`)
        .join(', '),
    }, []),
  ]));
}

function stealLine(v) {
  return line(`Round ${v.round} · ${v.teamName} — ${v.player.name}, ${Math.round(v.delta)} picks after his ADP of ${Math.round(v.adp)}`);
}

// The delta is stored negative; the sign is carried by the word "before", so the
// number is rendered as a magnitude. "-45 picks before" reads as a double negative.
function reachLine(v) {
  return line(`Round ${v.round} · ${v.teamName} — ${v.player.name}, ${Math.round(-v.delta)} picks before his ADP of ${Math.round(v.adp)}`);
}

function blindSpotLine(spot) {
  const plural = spot.count === 1 ? '' : 's';
  const best = spot.best ? ` The best still there is ${spot.best.name}, at ${spot.best.projectedPoints.toFixed(1)}.` : '';
  return line(`${spot.count} startable ${spot.position}${plural} went undrafted — anyone projecting above the replacement level of ${spot.bar.toFixed(1)}.${best}`);
}

function benchLine(b) {
  return line(`Round ${b.round} · ${b.teamName} — ${b.player.name} does not make their starting lineup.`);
}

function teamBlock(team) {
  const lines = [];
  if (team.spine.length > 0) {
    lines.push(el('div', { class: 'rep-spine' }, [
      el('span', { class: 'rep-label', text: 'Spine' }, []),
      el('span', { text: team.spine.map((s) => `${s.label} ${s.player.name}`).join(' · ') }, []),
    ]));
  }
  for (const clash of team.clashes) {
    lines.push(line(`${clash.players.length} starters are off in Week ${clash.week}: ${clash.players.map((p) => p.name).join(', ')}`));
  }
  if (team.bestValue) {
    lines.push(line(`Best value: ${team.bestValue.player.name}, ${Math.round(team.bestValue.delta)} picks after his ADP of ${Math.round(team.bestValue.adp)}`));
  }
  if (team.biggestReach) {
    lines.push(line(`Earliest pick: ${team.biggestReach.player.name}, ${Math.round(-team.biggestReach.delta)} picks before his ADP of ${Math.round(team.biggestReach.adp)}`));
  }
  return el('div', { class: 'rep-team' }, [
    el('h3', { text: team.name }, []),
    ...lines,
  ]);
}

export function renderReport(container, report) {
  const sections = [
    section('Still on waivers', waiverLines(report.waivers)),
    section('Biggest steals', report.steals.map(stealLine)),
    section('Biggest reaches', report.reaches.map(reachLine)),
    section('The league\'s blind spot', report.blindSpot.map(blindSpotLine)),
    section('Earliest picks that never start', report.benched.map(benchLine)),
    section('Team by team', report.teams.map(teamBlock)),
  ].filter(Boolean);

  container.appendChild(el('div', { class: 'report' }, sections));
}
```

- [ ] **Step 4: Run the render tests**

Run: `node --test tests/render-report.test.js`
Expected: PASS.

- [ ] **Step 5: Wire it into the summary screen**

In `src/ui/summary.js`, add the import as its own single line at the top:

```js
import { renderReport } from './report.js';
```

Move `Back to draft` out of the bottom of the list and into a header row beside the
heading, and delegate to the report. Replace the `container.appendChild(...)` call with:

```js
  const summary = el('div', { class: 'summary' }, [
    // The button lives in the header, not after the rows: with the report below, a
    // button between the table and "Still on waivers" reads as the end of the page.
    el('div', { class: 'sum-title' }, [
      el('h1', { text: 'Draft complete' }, []),
      el('button', { text: 'Back to draft', onClick: handlers.onBack }, []),
    ]),
    // The schedule is not in the data, so this is an ordering of preseason projections
    // and nothing more. Saying so is the difference between information and a fake result.
    el('p', { class: 'meta', text: 'Teams ranked by the projected points of the best lineup they can start, not counting kickers or defenses. This is a preseason projection, not a predicted finish.' }, []),
    // No sum-rank/sum-name/sum-grade/sum-pts classes here: those select a team's data
    // cell, and reusing them on the header would let '#'/'Team'/'Grade'/'Proj' answer
    // those queries too. The header still lines up under the grid via column order —
    // `.sum-head` and `.sum-row` share the same grid-template-columns.
    el('div', { class: 'sum-head' }, [
      el('span', { text: '#' }, []),
      el('span', { text: 'Team' }, []),
      el('span', { text: 'Grade' }, []),
      el('span', { text: 'Proj' }, []),
    ]),
    ...rowNodes,
  ]);

  // Optional: chunk F's summary renders without one, and so does any caller that has
  // not built a report.
  if (ctx.report) renderReport(summary, ctx.report);

  container.appendChild(summary);
```

Destructure `report` alongside the existing fields, or read `ctx.report` directly as above — either is fine, but do not make it a required parameter.

- [ ] **Step 6: Pin the summary changes with tests**

Add to `tests/summary.test.js`:

```js
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

test('the ranking says it no longer counts kickers or defenses', () => {
  // The caveat and the arithmetic have to move together, or the screen lies about
  // what its own number means.
  const text = walk(render()).map((n) => n.textContent || '').join(' ');
  assert.match(text, /not counting kickers or defenses/i);
});
```

Run: `node --test tests/summary.test.js`
Expected: PASS, including the existing `Back to draft calls its handler` test, which finds the button anywhere in the tree.

- [ ] **Step 7: Build the report in app.js**

In `src/ui/app.js`, add the import as its own single line:

```js
import { buildReport } from '../core/report.js';
```

`src/ui/app.js` already holds the replacement levels in a module-level `replacement`,
recomputed by `recomputeBaselines()` whenever the config changes. **Use that variable —
do not call `replacementPoints` again here.** A second computation would silently
disagree with the VBD column the moment a config differed, and the blind spot would be
measured against a bar the rest of the app is not using.

Then in `showSummary`, build the report and pass it:

```js
function showSummary() {
  const rows = gradeTeams(rostersByTeam(state, allPlayers), state.config.slots, state.config.teams);
  const report = buildReport(state, allPlayers, replacement);
  const container = root();
  clear(container);
  renderSummary(container, { rows, myTeamIndex: state.config.myTeamIndex, report }, {
    onBack: () => { screen = 'draft'; render(); },
  });
```

Leave the rest of `showSummary` — including `appendFreshness` — untouched.

- [ ] **Step 8: Style it**

Append to `src/styles.css`, after the existing `.sum-*` rules:

```css
/* The report shares the summary's 620px column: it is the same document, continued. */
.sum-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.sum-title h1 { margin: 0; }
.report { margin-top: 32px; }
.rep-section { margin-bottom: 28px; }
.rep-section h2 {
  margin: 0 0 10px; font-size: 12px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--muted);
}
.rep-line { padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.rep-line:last-child { border-bottom: none; }
.rep-pos {
  display: inline-block; width: 34px; color: var(--accent);
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
}
.rep-team { margin-bottom: 18px; }
.rep-team h3 { margin: 0 0 4px; font-size: 14px; }
.rep-spine { padding: 5px 0; font-size: 13px; color: #c3c9d6; }
.rep-label {
  display: inline-block; width: 52px; color: var(--muted);
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
}
```

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: every test passes except `tests/build.test.js`, which will fail until the
rebuild in Task 6. That single failure is expected here and nowhere else — if anything
else fails, fix it before committing.

- [ ] **Step 10: Commit**

```bash
git add src/ui/report.js src/ui/summary.js src/ui/app.js src/styles.css tests/
git commit -m "feat(report): render the report card below the ranking"
```

---

## Task 6: The tour's description of the summary, and the rebuild

**Files:**
- Modify: `src/ui/tour.js` (the last entry in `DRAFT_STEPS`)
- Modify: `draft.html` (by running the build, never by hand)
- Test: `tests/tour.test.js`, `tests/build.test.js`

**Interfaces:**
- Consumes: `DRAFT_STEPS` from `src/ui/tour.js`, whose anchors are pinned by the
  anchor-resolution test added in chunk H. Do not change any `anchor` value.

**Why this is in scope.** Chunk H's draft step 6 reads *"When the draft is over this ranks
all the teams with a grade, so you can see how yours came out."* That described the chunk F
summary. It is now wrong by omission — the screen has five more sections — and it is the
last thing the tour says to someone who has never drafted.

- [ ] **Step 1: Write the failing test**

Add to `tests/tour.test.js`:

```js
test('the last draft step describes the report, not just the ranking', () => {
  const last = DRAFT_STEPS[DRAFT_STEPS.length - 1];
  assert.match(last.body, /waiver/i, 'the most useful thing on that screen is named');
  assert.doesNotMatch(last.body, /\bwill\b/i, 'no prediction, here or on the screen itself');
});
```

`DRAFT_STEPS` is already imported at the top of that file; confirm with
`grep -n "DRAFT_STEPS" tests/tour.test.js` and extend the import if it is not.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tour.test.js`
Expected: FAIL — the current body does not mention waivers.

- [ ] **Step 3: Rewrite the copy**

In `src/ui/tour.js`, replace the body of the last `DRAFT_STEPS` entry. Keep the `anchor`
(`.btn-end-draft`) and the title (`Afterwards`) exactly as they are — the anchor is
pinned by a test, and the tour's voice is plain and unhurried, so match it:

```js
    body: 'When the draft is over this ranks every team with a grade, then lists what it can measure: the best players still on waivers, the picks that fell furthest past their ADP, and a note on each team. You can come back here afterwards.',
```

Check the sentence against what Task 5 actually renders before committing to it — if a
section was named differently, say what the screen says.

- [ ] **Step 4: Run the tour tests**

Run: `node --test tests/tour.test.js`
Expected: PASS.

- [ ] **Step 5: Rebuild the single-file app**

Run: `npm run build`
Expected: `Wrote draft.html (### KB, 400 players)`.

This is the only task that runs the build, and this is the only commit that may contain
`draft.html`. Do not edit it by hand under any circumstances.

- [ ] **Step 6: Run the whole suite, including the byte-equality check**

Run: `npm test`
Expected: everything green, `tests/build.test.js` included. That test rebuilds in-process
and compares to the committed file, so it is the proof the artifact matches the source.

- [ ] **Step 7: Commit**

```bash
git add src/ui/tour.js tests/tour.test.js draft.html
git commit -m "docs(tour): describe the report card, and rebuild"
```

- [ ] **Step 8: State the browser check**

The test suite has **no layout engine** — `tests/dom-stub.js` is a hand-written object
graph that measures nothing. A collapsed section, a line running off the 620px column, or
a report that pushes `Back to draft` off screen is invisible to every test above. Report
explicitly that the following was **not** verified by the suite and needs a human eye on
the live site:

- the report reads well at the summary's 620px width, on a phone as well as a laptop
- the per-team blocks are scannable rather than a wall of ten identical shapes
- `Back to draft` in its new header position is reachable without scrolling

---

## Self-review

**Spec coverage.**

| Spec requirement | Task |
|---|---|
| K and DEF out of the grade | 1 |
| No separate penalty term | 1 (stated in the comment and pinned by the all-kickers test) |
| Bench players contribute nothing — starters only | 1, 2 (`startingSpine` excludes `BN`) |
| Still on waivers | 3 |
| Biggest steals | 3 |
| Biggest reaches | 3 |
| The league's blind spot | 4 |
| Per-team notes: spine, bye clashes, picks furthest from ADP | 2, 4 |
| Every sentence a computed fact; omit rather than pad | 5 (`section()` returns null; the empty-section test) |
| No predicted finish or win-loss record | 5 (test), 6 (test) |
| No reordering of the existing ranking | 5 (the ranking block is unchanged apart from the button move) |
| No printing or exporting | Not built |
| Pure functions in `src/core/`, thin rendering | 2, 3, 4 core; 5 UI |
| A test pinning that a kicker no longer moves strength | 1 |

The spec's open decision — whether FLEX-eligible bench players contribute at a discount —
is resolved as the spec recommends: **starters only, no discount factor.** Revisit only if
grades cluster.

One deliberate deviation, argued in "Two decisions taken before writing this": the waiver
list is grouped by position rather than ordered globally by projection, because the global
ordering was measured and returns nine quarterbacks.

**Placeholder scan.** No TBDs. Every code step carries the code.

**Arithmetic check.** Every expected value in every test above was recomputed by hand
against `pickToSlot` and `assignSlots` while writing this section, and four errors were
found and fixed: a delta test with no positive case (pick 3 minus an ADP of 9 is -6, not
+6), a blind-spot count that read 1 where the fixture yields 4, a tour test demanding a
word the proposed copy did not contain, and a `showSummary` that recomputed replacement
levels the module already holds.

**Type consistency.** `delta` is negative for a reach in every producer and consumer;
only `reachLine` and the two per-team reach lines negate it, and only for display.
`pickValues` returns `teamName`, and `benchedEarliest` returns the same field derived the
same way. `notesForTeam` takes `teamValues` (this team's slice), while `biggestSteals` and
`biggestReaches` take the whole `values` array — both are called only from `buildReport`,
which passes each correctly. `startingSpine` returns `{label, player}` objects and every
consumer reads `.player`.
