# Chunk F — Grading and End of Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every team a letter grade as the draft runs, and an end-of-draft summary ranking all teams by the strength of the lineup they actually built.

**Architecture:** A new pure `src/core/grade.js` computes strength from each team's best legal starting lineup — reusing `assignSlots`, the same helper that decides who starts everywhere else, so the grade and the roster panel can never disagree about who is a starter. Grades render beside the board's team names and inside its existing popover. A new `src/ui/summary.js` renders the end-of-draft screen; `src/ui/app.js` switches between it and the draft.

**Tech Stack:** Node 22+, `node:test`, `node:assert/strict`, `tests/dom-stub.js`. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-29-post-draft-improvements-design.md` (chunk F)

## Global Constraints

- **Node >= 22.** Zero npm dependencies, permanently.
- **`draft.html` is a build artifact.** Never hand-edit. `tests/build.test.js` rebuilds in-process and asserts byte equality, so any `src/` change needs `npm run build` before the suite is green.
- **Modules under `src/` may only use** `import { a } from './rel.js';` on ONE line and `export function|const|class`. The bundler is a regex transform: a violation silently breaks the built page rather than failing the build.
- **Do not run `npm run fetch`.** `data/players.json` and `data/fetched-at.json` must be byte-identical.
- **Grade measures the starting lineup only.** Bench players are excluded — the spec's phrase is "it measures what actually scores".
- **Never invent a win-loss record.** The schedule is not in the data. The summary presents a preseason projection ordering, and says so.
- **`el()` sets `text` before children, and `textContent` clears child nodes.** A node needing both a label and a child element must pass children only — this is how the board header breaks if you use `text:` alongside them.

---

### Task 1: Strength, grades, and the league table

**Files:**
- Create: `src/core/grade.js`
- Test: `tests/grade.test.js` (new)

**Interfaces:**
- Consumes: `assignSlots` from `./roster.js`.
- Produces:
  - `teamStrength(roster, slots) -> number` — summed projected points of the best legal starting lineup.
  - `gradeFor(z) -> string` — a letter from a z-score.
  - `NEUTRAL_GRADE` — the letter used when every team is identical.
  - `gradeTeams(rostersByTeam, slots, teams) -> [{ teamIndex, name, strength, z, grade, rank }]`, sorted best first.

- [ ] **Step 1: Write the failing tests**

Create `tests/grade.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamStrength, gradeFor, gradeTeams, NEUTRAL_GRADE } from '../src/core/grade.js';
import { DEFAULT_SLOTS } from '../src/core/roster.js';

const pl = (id, position, points) => ({
  id, name: id, position, projectedPoints: points, team: 'XX', bye: 9,
});
const teamsNamed = (...names) => names.map((name) => ({ name, keeper: null }));

test('teamStrength counts the starting lineup and ignores the bench', () => {
  // DEFAULT_SLOTS starts one QB. A second is bench depth and must not inflate a grade —
  // the spec's whole basis is "it measures what actually scores".
  const roster = [pl('q1', 'QB', 300), pl('q2', 'QB', 290)];
  assert.equal(teamStrength(roster, DEFAULT_SLOTS), 300);
});

test('teamStrength counts a FLEX starter', () => {
  // Two RBs fill RB1/RB2, the third starts at FLEX, so all three count.
  const roster = [pl('a', 'RB', 200), pl('b', 'RB', 150), pl('c', 'RB', 100)];
  assert.equal(teamStrength(roster, DEFAULT_SLOTS), 450);
});

test('teamStrength is zero for an empty roster', () => {
  assert.equal(teamStrength([], DEFAULT_SLOTS), 0);
});

test('gradeFor maps each band, inclusive at its floor', () => {
  assert.equal(gradeFor(2.0), 'A+');
  assert.equal(gradeFor(1.5), 'A+', 'the floor belongs to the band above it');
  assert.equal(gradeFor(1.49), 'A');
  assert.equal(gradeFor(0), 'B-');
  assert.equal(gradeFor(-0.01), 'C+');
  assert.equal(gradeFor(-1.5), 'D');
  assert.equal(gradeFor(-1.51), 'F');
});

test('gradeTeams ranks by strength, best first', () => {
  const rosters = {
    1: [pl('a', 'RB', 100)],
    2: [pl('b', 'RB', 300)],
    3: [pl('c', 'RB', 200)],
  };
  const rows = gradeTeams(rosters, DEFAULT_SLOTS, teamsNamed('Weak', 'Strong', 'Middle'));
  assert.deepEqual(rows.map((r) => r.name), ['Strong', 'Middle', 'Weak']);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);
  assert.equal(rows[0].grade, 'A+');
  assert.equal(rows[2].grade, 'F');
});

test('every team grades neutrally before anyone has picked', () => {
  // All strengths are zero, so the standard deviation is zero. There is no information
  // to tell the teams apart, and dividing by it would produce NaN on every grade shown.
  const rosters = { 1: [], 2: [], 3: [] };
  const rows = gradeTeams(rosters, DEFAULT_SLOTS, teamsNamed('A', 'B', 'C'));
  assert.deepEqual(rows.map((r) => r.grade), [NEUTRAL_GRADE, NEUTRAL_GRADE, NEUTRAL_GRADE]);
  assert.deepEqual(rows.map((r) => r.z), [0, 0, 0], 'z is 0, never NaN');
});

test('gradeTeams breaks a strength tie by team order, not at random', () => {
  const rosters = { 1: [pl('a', 'RB', 100)], 2: [pl('b', 'RB', 100)] };
  const rows = gradeTeams(rosters, DEFAULT_SLOTS, teamsNamed('First', 'Second'));
  assert.deepEqual(rows.map((r) => r.name), ['First', 'Second']);
});

test('gradeTeams handles a team with no roster entry at all', () => {
  // rostersByTeam always has a key per team today, but a missing one must not throw.
  const rows = gradeTeams({}, DEFAULT_SLOTS, teamsNamed('A', 'B'));
  assert.deepEqual(rows.map((r) => r.strength), [0, 0]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/grade.test.js`
Expected: FAIL — cannot find module `../src/core/grade.js`.

- [ ] **Step 3: Implement**

Create `src/core/grade.js`:

```js
import { assignSlots } from './roster.js';

// Reusing assignSlots rather than reimplementing "who starts" is the point: the grade and
// the roster panel are then incapable of disagreeing about a team's lineup.
export function teamStrength(roster, slots) {
  return assignSlots(roster, slots)
    .filter((slot) => !slot.label.startsWith('BN') && slot.player)
    .reduce((sum, slot) => sum + slot.player.projectedPoints, 0);
}

// Standard deviations from the league mean, each band inclusive at its floor.
export const GRADE_BANDS = [
  [1.5, 'A+'], [1.0, 'A'], [0.75, 'A-'], [0.5, 'B+'], [0.25, 'B'], [0, 'B-'],
  [-0.25, 'C+'], [-0.5, 'C'], [-0.75, 'C-'], [-1.0, 'D+'], [-1.5, 'D'],
];

// Used when every team is identical — before the first pick, most obviously. There is no
// information to rank anyone on, so everyone gets the same neutral letter rather than the
// implementation dividing by a zero standard deviation and grading the league NaN.
export const NEUTRAL_GRADE = 'C+';

export function gradeFor(z) {
  for (const [floor, grade] of GRADE_BANDS) if (z >= floor) return grade;
  return 'F';
}

export function gradeTeams(rostersByTeam, slots, teams) {
  const rows = teams.map((team, i) => ({
    teamIndex: i + 1,
    name: team.name,
    // One decimal: projections carry one, and a grade table full of raw floats reads as
    // false precision about a number that is a projection in the first place.
    strength: Math.round(teamStrength(rostersByTeam[i + 1] || [], slots) * 10) / 10,
  }));

  const count = rows.length || 1;
  const mean = rows.reduce((sum, r) => sum + r.strength, 0) / count;
  const sd = Math.sqrt(rows.reduce((sum, r) => sum + (r.strength - mean) ** 2, 0) / count);

  return rows
    .map((r) => ({
      ...r,
      z: sd === 0 ? 0 : (r.strength - mean) / sd,
      grade: sd === 0 ? NEUTRAL_GRADE : gradeFor((r.strength - mean) / sd),
    }))
    .sort((a, b) => b.strength - a.strength || a.teamIndex - b.teamIndex)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
```

- [ ] **Step 4: Verify**

Run: `node --test tests/grade.test.js` → PASS. Then `npm test` — 0 failures (no `src/` file that the bundle renders has changed yet, but `grade.js` is under `src/`, so the byte-equality check **will** fail; that is expected and a later task rebuilds).

- [ ] **Step 5: Commit**

```bash
git add src/core/grade.js tests/grade.test.js
git commit -m "feat(grade): score a team by the lineup it can actually start"
```

---

### Task 2: Grades on the board

**Files:**
- Modify: `src/ui/board.js`, `src/ui/app.js`, `src/styles.css`
- Test: `tests/board.test.js`

**Interfaces:**
- Consumes: `gradeTeams` (Task 1).
- Produces: `renderBoard`'s `ctx` gains `grades` — a `Map` from `teamIndex` to the row object `gradeTeams` returns. `showRosterPopover` takes that row as a fifth argument.

- [ ] **Step 1: Write the failing tests**

Add to `tests/board.test.js`. It currently tests `boardCells` only, so import `renderBoard` and the DOM stub as `tests/render-myteam.test.js` does.

```js
test('each team header carries its grade', () => {
  const { state, players } = boardFixture();
  const container = document.createElement('div');
  const grades = new Map([[1, { grade: 'A+' }], [2, { grade: 'D' }]]);
  renderBoard(container, {
    state, allPlayers: players, grades, editablePool: [], onEditPick() {},
  });
  const shown = find(container, (n) => n.className === 'team-grade').map((n) => n.textContent);
  assert.deepEqual(shown, ['A+', 'D']);
});

test('a header still shows the team name alongside the grade', () => {
  // el() sets `text` before children and textContent wipes child nodes, so a header
  // built with both would silently lose the grade. Pin that it does not.
  const { state, players } = boardFixture();
  const container = document.createElement('div');
  renderBoard(container, {
    state, allPlayers: players, grades: new Map([[1, { grade: 'B' }]]),
    editablePool: [], onEditPick() {},
  });
  const header = find(container, (n) => n.tagName === 'th' && n.children.length)[0];
  const texts = header.children.map((c) => c.textContent);
  assert.ok(texts.some((t) => t.includes('Team')), 'the name survives');
  assert.ok(texts.includes('B'), 'and so does the grade');
});

test('a board with no grades supplied still renders', () => {
  // renderBoard is called before grades exist in at least one path; it must not throw.
  const { state, players } = boardFixture();
  const container = document.createElement('div');
  renderBoard(container, { state, allPlayers: players, editablePool: [], onEditPick() {} });
  assert.equal(find(container, (n) => n.className === 'team-grade').length, 0);
});
```

`tests/board.test.js` currently tests `boardCells` only, so add the stub, the walker and a
fixture at the top of the file:

```js
import { installDomStub } from './dom-stub.js';

installDomStub();
if (!document.body) {
  const body = document.createElement('body');
  body.removeChild = (c) => {
    body.childNodes = body.childNodes.filter((x) => x !== c);
    body.children = body.children.filter((x) => x !== c);
    return c;
  };
  document.body = body;
}
document.addEventListener = () => {};
document.removeEventListener = () => {};
globalThis.window = { innerWidth: 1400, innerHeight: 900 };

const { renderBoard } = await import('../src/ui/board.js');

function find(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) find(child, predicate, out);
  return out;
}

function boardFixture() {
  const players = [
    { id: 'a', name: 'Alpha Back', position: 'RB', team: 'DET', projectedPoints: 210, overallRank: 1, bye: 6 },
    { id: 'b', name: 'Beta Wide', position: 'WR', team: 'CIN', projectedPoints: 190, overallRank: 2, bye: 9 },
  ];
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  return { state, players };
}
```

`createState` and `applyPick` come from the file's existing import of `../src/core/state.js`;
add them to that line rather than writing a second import.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/board.test.js`
Expected: FAIL — no `.team-grade` nodes exist.

- [ ] **Step 3: Implement**

In `src/ui/board.js`, replace the header-cell construction:

```js
  const headerCells = [el('th', { class: 'rnd', text: 'R' }, [])];
  for (let teamIndex = 1; teamIndex <= numTeams; teamIndex += 1) {
    const row = ctx.grades ? ctx.grades.get(teamIndex) : null;
    // Children, not `text:` — el() applies text first and textContent clears children,
    // so passing both would drop the grade without any error.
    headerCells.push(el('th', {
      class: teamIndex === myTeamIndex ? 'mine' : '',
      title: `Click for ${teams[teamIndex - 1].name}'s roster, needs and grade`,
      onClick: (e) => showRosterPopover(e, state, allPlayers, teamIndex, row),
    }, [
      el('div', { text: teams[teamIndex - 1].name }, []),
      row ? el('div', { class: 'team-grade', text: row.grade }, []) : null,
    ]));
  }
```

Give `showRosterPopover` the extra parameter. The spec says this popover becomes **slot
layout, then that team's picks as a table, then their grade** — the slot layout is already
there, so add the other two. `rosterFor` returns the team's players in pick order, which is
the order the table wants.

```js
    el('div', { style: { marginTop: '8px', color: '#8b93a5' }, text: 'Picks' }, []),
    // In pick order, which is what rosterFor returns — the slot layout above already
    // answers "who starts", so this answers the different question of what they took.
    ...roster.map((pl) => el('div', { class: 'pop-pick' }, [
      el('span', { style: { color: POSITION_COLORS[pl.position] }, text: pl.position }, []),
      el('span', { class: 'pop-pick-name', text: pl.name }, []),
      el('span', { class: 'meta', text: String(pl.projectedPoints) }, []),
    ])),
    row ? el('div', { class: 'pop-grade' }, [
      el('span', { text: `Grade ${row.grade}` }, []),
      el('span', { class: 'meta', text: `${row.strength} projected starter pts` }, []),
    ]) : null,
```

with the matching CSS:

```css
.pop-pick { display: grid; grid-template-columns: 28px 1fr 40px; gap: 6px; align-items: baseline; padding: 2px 0; font-size: 11px; }
.pop-pick-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pop-pick .meta { text-align: right; font-variant-numeric: tabular-nums; }
```

and a test alongside the others in Task 2's step 1:

```js
test('the popover lists the team\'s picks as well as its slots and grade', () => {
  const { state, players } = boardFixture();
  const container = document.createElement('div');
  renderBoard(container, {
    state, allPlayers: players, grades: new Map([[1, { grade: 'B', strength: 210 }]]),
    editablePool: [], onEditPick() {},
  });
  find(container, (n) => n.tagName === 'th' && n.children.length)[0]
    .listeners.click[0]({ clientX: 10, clientY: 10 });
  const pop = document.body.children.find((n) => (n.className || '').includes('roster-pop'));
  assert.ok(find(pop, (n) => n.className === 'pop-pick').length > 0, 'picks are listed');
  assert.ok(find(pop, (n) => n.className === 'pop-grade').length === 1, 'and the grade');
});
```

In `src/ui/app.js`, add `gradeTeams` to a single-line import from `../core/grade.js`, and in `renderDraft` build the map before rendering the board:

```js
  // Keyed by teamIndex for the board; the same rows, sorted, feed the summary.
  const gradeRows = gradeTeams(rostersByTeam(state, allPlayers), config.slots, config.teams);
  const grades = new Map(gradeRows.map((r) => [r.teamIndex, r]));
```

and pass `grades` in `renderBoard`'s ctx.

In `src/styles.css`:

```css
table.board th .team-grade { font-size: 10px; font-weight: 600; color: var(--accent); letter-spacing: 0.04em; }
.pop-grade { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border); font-weight: 600; }
```

- [ ] **Step 4: Verify**

Run: `npm test` — only the build-freshness check may fail.

- [ ] **Step 5: Commit**

```bash
git add src/ui/board.js src/ui/app.js src/styles.css tests/board.test.js
git commit -m "feat(board): show each team's grade on its column and in its popover"
```

---

### Task 3: The end-of-draft summary

**Files:**
- Create: `src/ui/summary.js`
- Modify: `src/ui/app.js`, `src/styles.css`
- Test: `tests/summary.test.js` (new)

**Interfaces:**
- Consumes: the rows `gradeTeams` returns (Task 1).
- Produces: `renderSummary(container, ctx, handlers)` where `ctx` is `{ rows, myTeamIndex }` and `handlers` is `{ onBack }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/summary.test.js`:

```js
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
  assert.deepEqual(cells('sum-pts'), ['1450.5', '1300', '1100.2']);
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/summary.test.js` — FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/ui/summary.js`:

```js
import { el, clear } from './dom.js';

export function renderSummary(container, ctx, handlers) {
  clear(container);
  const { rows, myTeamIndex } = ctx;

  const rowNodes = rows.map((r) => el('div', {
    class: r.teamIndex === myTeamIndex ? 'sum-row mine' : 'sum-row',
  }, [
    el('span', { class: 'sum-rank', text: String(r.rank) }, []),
    el('span', { class: 'sum-name', text: r.name }, []),
    el('span', { class: 'sum-grade', text: r.grade }, []),
    el('span', { class: 'sum-pts', text: String(r.strength) }, []),
  ]));

  container.appendChild(el('div', { class: 'summary' }, [
    el('h1', { text: 'Draft complete' }, []),
    // The schedule is not in the data, so this is an ordering of preseason projections
    // and nothing more. Saying so is the difference between information and a fake result.
    el('p', { class: 'meta', text: 'Teams ranked by the projected points of the best lineup they can start. This is a preseason projection, not a predicted finish.' }, []),
    el('div', { class: 'sum-head' }, [
      el('span', { class: 'sum-rank', text: '#' }, []),
      el('span', { class: 'sum-name', text: 'Team' }, []),
      el('span', { class: 'sum-grade', text: 'Grade' }, []),
      el('span', { class: 'sum-pts', text: 'Proj' }, []),
    ]),
    ...rowNodes,
    el('button', { text: 'Back to draft', style: { marginTop: '16px' }, onClick: handlers.onBack }, []),
  ]));
}
```

In `src/ui/app.js`, add a module-level flag and the two controls:

```js
// The summary replaces the three panels rather than overlaying them: it is a place you go,
// and a draft that is over has nothing behind it worth seeing through a scrim.
let showingSummary = false;
```

At the very top of `renderDraft`, before anything else is built:

```js
  if (showingSummary) {
    const rows = gradeTeams(rostersByTeam(state, allPlayers), state.config.slots, state.config.teams);
    clear(root());
    renderSummary(root(), { rows, myTeamIndex: state.config.myTeamIndex }, {
      onBack: () => { showingSummary = false; renderDraft(); },
    });
    return;
  }
```

and an **End draft** button in the left panel, beside Reset:

```js
  left.appendChild(el('button', {
    text: 'End draft', style: { marginTop: '8px' },
    onClick: () => { showingSummary = true; renderDraft(); },
  }, []));
```

Add `renderSummary` to a single-line import from `./summary.js`.

In `src/styles.css`:

```css
.summary { max-width: 620px; margin: 40px auto; padding: 0 16px; }
.sum-head, .sum-row { display: grid; grid-template-columns: 32px 1fr 56px 84px; gap: 8px; align-items: baseline; padding: 7px 8px; border-bottom: 1px solid var(--border); }
.sum-head { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.sum-row.mine { background: #22262f; border-radius: 6px; }
.sum-grade { font-weight: 600; color: var(--accent); }
.sum-pts { text-align: right; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 4: Verify**

Run: `npm test` — only the build-freshness check may fail.

- [ ] **Step 5: Commit**

```bash
git add src/ui/summary.js src/ui/app.js src/styles.css tests/summary.test.js
git commit -m "feat(summary): rank every team at the end of the draft"
```

---

### Task 4: Rebuild and verify

**Files:**
- Modify: `draft.html` (rebuilt)

- [ ] **Step 1: Rebuild and confirm the suite**

```bash
npm test      # build-freshness red — expected
npm run build
npm test      # 0 failures
```

- [ ] **Step 2: Confirm the chunk reached the bundle**

```bash
node -e '
const html = require("fs").readFileSync("draft.html", "utf8");
for (const [label, needle] of [
  ["teamStrength", "function teamStrength"],
  ["gradeTeams", "function gradeTeams"],
  ["renderSummary", "function renderSummary"],
  ["team-grade CSS", ".team-grade"],
  ["summary CSS", ".sum-row"],
  ["End draft button", "End draft"],
  ["the projection caveat", "not a predicted finish"],
]) console.log(label + ":", html.includes(needle));
console.log("no leftover module syntax:", !/^\s*(import|export)\s/m.test(html));
'
```

Expected: every line `true`.

- [ ] **Step 3: Drive it end to end against the real pool**

No test renders the summary from real state, so drive it once against the shipped pool:

```bash
node --input-type=module -e '
import { installDomStub } from "./tests/dom-stub.js";
installDomStub();
const { createState, applyPick, rostersByTeam } = await import("./src/core/state.js");
const { gradeTeams } = await import("./src/core/grade.js");
const { renderSummary } = await import("./src/ui/summary.js");
const { DEFAULT_SLOTS } = await import("./src/core/roster.js");
const all = JSON.parse(await (await import("node:fs/promises")).readFile("data/players.json","utf8"));

let state = createState({ numTeams: 10, rounds: 15, myTeamIndex: 4 });
for (let i = 0; i < 90; i += 1) state = applyPick(state, all[i].id);

const rows = gradeTeams(rostersByTeam(state, all), DEFAULT_SLOTS, state.config.teams);
const c = document.createElement("div");
renderSummary(c, { rows, myTeamIndex: 4 }, { onBack(){} });
const walk = (n, o = []) => { o.push(n); for (const x of n.children || []) walk(x, o); return o; };
const cells = (cls) => walk(c).filter((n) => n.className === cls).map((n) => n.textContent);

console.log("teams listed :", cells("sum-name").length, "(expect 10)");
console.log("ranks        :", cells("sum-rank").join(","));
console.log("grades       :", cells("sum-grade").join(","));
console.log("any NaN      :", walk(c).some((n) => String(n.textContent).includes("NaN")));
console.log("strengths desc:", rows.every((r, i) => i === 0 || rows[i - 1].strength >= r.strength));
console.log("my team marked:", walk(c).filter((n) => String(n.className).includes("mine")).length === 1);
'
```

Expected: ten teams, ranks `1,2,…,10`, real letters, no `NaN`, strengths descending, one marked row.

- [ ] **Step 4: Commit**

```bash
git add draft.html
git commit -m "chore: rebuild draft.html"
```

---

## Verification

Chunk F is done when:

- `npm test` passes with more tests than the 306 this chunk started from.
- `data/players.json` and `data/fetched-at.json` are untouched.
- The bundle check in Task 4 prints `true` on every line.
- In the live page: every board column shows a grade under the team name, clicking a header shows that team's roster, needs and grade, and **End draft** opens a ranking of all ten teams with grades and projected points, with a **Back to draft** that returns you to the board.
