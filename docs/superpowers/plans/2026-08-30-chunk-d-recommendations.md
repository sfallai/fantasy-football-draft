# Chunk D — Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user say which positions they want recommended, surface a separate short list of gambles, stop ranking positions whose starting slots are already full, and warn when a candidate would collide with a same-position starter's bye week.

**Architecture:** All four features are scoring or selection logic, so the substance lands in `src/core/` (`recommend.js`, `roster.js`) as pure functions with direct unit tests. `src/ui/center.js` turns the existing position button row into a multi-select that drives both the table and the recommendations, and renders the sleepers panel. Two findings carried forward from chunk C are fixed here because this chunk is what makes them bite.

**Tech Stack:** Node 22+, `node:test`, `node:assert/strict`, `tests/dom-stub.js`. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-29-post-draft-improvements-design.md` (chunk D, plus "Carried forward from chunk C")

## Global Constraints

- **Node >= 22.** Zero npm dependencies, permanently.
- **`draft.html` is a build artifact.** Never hand-edit. `tests/build.test.js` rebuilds in-process and asserts byte equality, so any `src/` change needs `npm run build` before the suite is green. **Every dispatch that touches `src/` ends with a rebuild.**
- **Modules under `src/` may only use** `import { a } from './rel.js';` on ONE line and `export function|const|class`. The bundler is a regex transform: no default exports, no export lists, no namespace imports, no multi-line imports. A violation silently breaks `draft.html` rather than failing the build.
- **Do not run `npm run fetch`.** `data/players.json` must be byte-identical before and after this chunk.
- **Double-click, never single click, commits a pick.**
- **`vbdScale` and the VBD replacement baselines are whole-pool values, fixed for the draft.** Never recompute either from a filtered pool — that is what keeps VBD comparable across rounds.

---

### Task 1: Sleepers

A separate short list of gambles, never mixed into the top three. Two independent ways to qualify.

**Files:**
- Modify: `src/core/recommend.js`
- Test: `tests/recommend.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `SLEEPER_ADP_GAP = 15`, `SLEEPER_RANK_BAND = 20`, `SLEEPER_PROJECTION_EDGE = 15` (exported constants)
  - `sleepers(pool, ctx, limit = 2) -> [{ player, why }]` where `ctx` carries `currentPick` and optionally `excludeIds` (a `Set`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/recommend.test.js`, extending its existing import. Follow the fixture style already in that file.

```js
test('sleepers flags a player still available well past his ADP', () => {
  const pool = [
    { id: 'a', name: 'Faller', position: 'WR', overallRank: 50, projectedPoints: 120, vbd: 10, adp: 30 },
    { id: 'b', name: 'On Time', position: 'WR', overallRank: 51, projectedPoints: 119, vbd: 9, adp: 52 },
  ];
  const found = sleepers(pool, { currentPick: 55 });
  assert.equal(found.length, 1);
  assert.equal(found[0].player.id, 'a', '25 picks past ADP clears the 15-pick gap');
  assert.match(found[0].why, /past his ADP/);
});

test('sleepers ignores a player with no ADP on the falling test', () => {
  // A null ADP is missing data, not evidence that the market forgot him.
  const pool = [{ id: 'a', position: 'WR', overallRank: 50, projectedPoints: 120, vbd: 10, adp: null }];
  assert.deepEqual(sleepers(pool, { currentPick: 200 }), []);
});

test('sleepers flags a player out-projecting the players ranked around him', () => {
  const pool = [
    { id: 'star', position: 'RB', overallRank: 100, projectedPoints: 160, vbd: 5, adp: 100 },
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `f${i}`, position: 'RB', overallRank: 95 + i + (i >= 5 ? 1 : 0),
      projectedPoints: 100, vbd: 0, adp: 95 + i,
    })),
  ];
  const found = sleepers(pool, { currentPick: 100 });
  assert.equal(found[0].player.id, 'star', '60 points over the local median clears the 15-point edge');
  assert.match(found[0].why, /projects/);
});

test('sleepers never repeats a player already in the top three', () => {
  // A player cannot be both the safe pick and the gamble.
  const pool = [{ id: 'a', position: 'WR', overallRank: 50, projectedPoints: 120, vbd: 10, adp: 30 }];
  assert.deepEqual(sleepers(pool, { currentPick: 55, excludeIds: new Set(['a']) }), []);
});

test('sleepers honours its limit and puts the biggest faller first', () => {
  const pool = [
    { id: 'small', position: 'WR', overallRank: 50, projectedPoints: 100, vbd: 1, adp: 33 },
    { id: 'big', position: 'WR', overallRank: 51, projectedPoints: 100, vbd: 1, adp: 10 },
    { id: 'mid', position: 'WR', overallRank: 52, projectedPoints: 100, vbd: 1, adp: 20 },
  ];
  const found = sleepers(pool, { currentPick: 55 }, 2);
  assert.equal(found.length, 2);
  assert.equal(found[0].player.id, 'big');
});

test('sleepers returns nothing from an empty pool', () => {
  assert.deepEqual(sleepers([], { currentPick: 10 }), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/recommend.test.js`
Expected: FAIL — `sleepers is not a function`.

- [ ] **Step 3: Implement**

Add to `src/core/recommend.js`:

```js
// A sleeper is a gamble, so the bar is deliberately higher than the "Value" reason
// already shown on recommendation cards (ADP_VALUE_GAP, 8 picks). Anything lower and
// the two lists would say the same thing about the same player.
export const SLEEPER_ADP_GAP = 15;
// How many overall ranks either side to compare a player's projection against.
export const SLEEPER_RANK_BAND = 20;
export const SLEEPER_PROJECTION_EDGE = 15;

// Enough neighbours that a median means something; below this the band is too sparse
// near the very top or bottom of the pool to judge anyone against.
const MIN_BAND_NEIGHBOURS = 3;

function picksPastAdp(player, currentPick) {
  if (player.adp === null || player.adp === undefined) return null;
  return currentPick - player.adp;
}

function projectionEdge(player, pool) {
  const near = pool.filter((x) => x.id !== player.id
    && Math.abs(x.overallRank - player.overallRank) <= SLEEPER_RANK_BAND / 2);
  if (near.length < MIN_BAND_NEIGHBOURS) return null;
  const points = near.map((x) => x.projectedPoints).sort((a, b) => a - b);
  const median = points[Math.floor(points.length / 2)];
  return player.projectedPoints - median;
}

// Gambles, kept apart from the top three on purpose: mixing them in would let a flier
// displace the best available player without the user ever choosing to take the risk.
export function sleepers(pool, ctx, limit = 2) {
  const exclude = ctx.excludeIds || new Set();
  const found = [];

  for (const player of pool) {
    if (exclude.has(player.id)) continue;

    const past = picksPastAdp(player, ctx.currentPick);
    if (past !== null && past >= SLEEPER_ADP_GAP) {
      found.push({
        player,
        rank: past,
        why: `Still here ${Math.round(past)} picks past his ADP of ${Math.round(player.adp)}`,
      });
      continue;
    }

    const edge = projectionEdge(player, pool);
    if (edge !== null && edge >= SLEEPER_PROJECTION_EDGE) {
      found.push({
        player,
        rank: edge,
        why: `Projects ${Math.round(edge)} pts above the players ranked around him`,
      });
    }
  }

  return found
    .sort((a, b) => b.rank - a.rank || a.player.overallRank - b.player.overallRank)
    .slice(0, limit)
    .map(({ player, why }) => ({ player, why }));
}
```

- [ ] **Step 4: Verify**

Run: `node --test tests/recommend.test.js` → PASS. Then `npm test` — only the build-freshness test may fail.

- [ ] **Step 5: Commit**

```bash
git add src/core/recommend.js tests/recommend.test.js
git commit -m "feat(recommend): surface sleepers as a separate list of gambles"
```

---

### Task 2: Same-position bye collisions

**Files:**
- Modify: `src/core/roster.js`
- Test: `tests/roster.test.js`

**Interfaces:**
- Consumes: `assignSlots` (already in the file).
- Produces: `byeConflict(player, roster, slots) -> string | null` — the name of a projected **starter** at the same position sharing the player's bye week, or `null`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/roster.test.js`, extending its existing import.

```js
const pl = (id, position, bye, points) => ({
  id, name: id, position, bye, projectedPoints: points, team: 'XX',
});

test('byeConflict names a starter at the same position on the same bye', () => {
  const roster = [pl('rb1', 'RB', 9, 200), pl('wr1', 'WR', 9, 180)];
  const conflict = byeConflict(pl('rb2', 'RB', 9, 150), roster, DEFAULT_SLOTS);
  assert.equal(conflict, 'rb1');
});

test('byeConflict ignores a collision at a different position', () => {
  // Bench depth is position-specific: an RB and a WR sharing a bye is coverable,
  // RB1 and RB2 sharing one is not.
  const roster = [pl('wr1', 'WR', 9, 180)];
  assert.equal(byeConflict(pl('rb1', 'RB', 9, 150), roster, DEFAULT_SLOTS), null);
});

test('byeConflict ignores a collision with a bench player', () => {
  // Twelve running backs deep, two of them share a bye — that is what a bench is for.
  const roster = Array.from({ length: 8 }, (_, i) => pl(`rb${i}`, 'RB', 9, 200 - i));
  const conflict = byeConflict(pl('new', 'RB', 9, 1), roster, DEFAULT_SLOTS);
  assert.equal(conflict, 'rb0', 'only the projected starter counts, and it is the best one');
});

test('byeConflict is null when nothing shares the bye', () => {
  const roster = [pl('rb1', 'RB', 9, 200)];
  assert.equal(byeConflict(pl('rb2', 'RB', 11, 150), roster, DEFAULT_SLOTS), null);
});

test('byeConflict is null when either bye is unknown', () => {
  const roster = [pl('rb1', 'RB', null, 200)];
  assert.equal(byeConflict(pl('rb2', 'RB', null, 150), roster, DEFAULT_SLOTS), null,
    'two unknown byes are not a known collision');
});

test('byeConflict is null on an empty roster', () => {
  assert.equal(byeConflict(pl('rb1', 'RB', 9, 150), [], DEFAULT_SLOTS), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/roster.test.js`
Expected: FAIL — `byeConflict is not a function`.

- [ ] **Step 3: Implement**

Add to `src/core/roster.js`:

```js
// Only a projected STARTER at the SAME position counts. Bench depth is
// position-specific, so an RB and a WR sharing a bye is coverable while RB1 and RB2
// sharing one leaves a slot empty that week. A null bye is missing data, never a
// collision — two unknowns are not a known clash.
export function byeConflict(player, roster, slots) {
  if (player.bye === null || player.bye === undefined) return null;

  const starter = assignSlots(roster, slots)
    .filter((slot) => !slot.label.startsWith('BN') && slot.player)
    .map((slot) => slot.player)
    .find((other) => other.position === player.position && other.bye === player.bye);

  return starter ? starter.name : null;
}
```

- [ ] **Step 4: Verify**

Run: `node --test tests/roster.test.js` → PASS. Then `npm test` — only build-freshness may fail.

- [ ] **Step 5: Commit**

```bash
git add src/core/roster.js tests/roster.test.js
git commit -m "feat(roster): flag a bye clash with a same-position starter"
```

---

### Task 3: Stop *ranking* a position whose starters are full

The row stays — it is the only place that confirms a position is handled — but it
leaves the ranking. Superseded the original "drop the row" design after review.

**Files:**
- Modify: `src/ui/myteam.js` (`needLabel`, `needSummary`, `renderMyTeam`)
- Modify: `src/styles.css`
- Test: `tests/myteam.test.js`

**Interfaces:**
- Produces: `needSummary` entries gain `set: boolean` (true when tier is `bench`);
  `set` entries sort last and render without a tier chip.

Measured against the real engine before writing these, since the tiers are not obvious:

```
empty roster -> QB: high,  RB: high
1 QB         -> QB: bench, RB: high     <- one QB already fills the only QB slot
2 RB         -> QB: high,  RB: low      <- a FLEX slot can still start a third RB
```

- [ ] **Step 1: Write the failing tests**

```js
test('a position whose starters are full keeps its row, marked set', () => {
  const summary = needSummary([p('q1', 'QB')], DEFAULT_SLOTS, 5, 15);
  const qb = summary.find((n) => n.position === 'QB');
  assert.ok(qb, 'the row survives — it is what confirms you have a quarterback');
  assert.equal(qb.set, true);
  assert.equal(qb.label, 'QB set');
});

test('set positions sort below everything still needed', () => {
  const summary = needSummary([p('q1', 'QB')], DEFAULT_SLOTS, 5, 15);
  const firstSet = summary.findIndex((n) => n.set);
  assert.ok(firstSet > 0);
  assert.ok(summary.slice(firstSet).every((n) => n.set),
    'once the set rows start, nothing unset follows — including none-tier K/DEF, '
    + 'which are needs you have not reached yet rather than needs you have met');
});

test('a position that can still start someone is not set', () => {
  const rb = needSummary([p('a', 'RB'), p('b', 'RB')], DEFAULT_SLOTS, 5, 15)
    .find((n) => n.position === 'RB');
  assert.equal(rb.tier, 'low');
  assert.equal(rb.set, false);
});

test('needSummary still lists every position on an empty roster', () => {
  const summary = needSummary([], DEFAULT_SLOTS, 1, 15);
  assert.equal(summary.length, 6);
  assert.equal(summary.some((n) => n.set), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/myteam.test.js` — FAIL, `set` is undefined and the label reads
`QB set — depth only`.

- [ ] **Step 3: Implement**

In `needLabel`, return `` `${position} set` `` for the `bench` tier — replacing both the
`QB set — depth only` and `FLEX / bench depth` wordings, whose "depth" framing reads as a
weak suggestion to keep drafting there.

In `needSummary`, add `set: needs[position] === 'bench'` to each entry, and sort unset
entries first (by `NEED_TIERS`) with every `set` entry after them.

In `renderMyTeam`, a `set` row renders its label with class `need-row set` and **no** tier
chip — it is no longer a ranking. Add `.need-row.set { color: var(--muted); }` to
`src/styles.css`.

- [ ] **Step 4: Verify**

`npm test` — only the build-freshness test may fail.

- [ ] **Step 5: Commit**

```bash
git add src/ui/myteam.js src/styles.css tests/myteam.test.js
git commit -m "feat(myteam): keep a filled position visible but out of the ranking"
```

---

### Task 4: Multi-select position targeting

The position button row stops being a single choice and starts driving both the table and the recommendations.

**Files:**
- Modify: `src/ui/center.js`
- Test: `tests/center.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `filterByPositions(pool, positions) -> Player[]` replaces `filterByPosition`. An empty array means everything.
  - `view.positions` (an array) replaces `view.filter`.

- [ ] **Step 1: Rewrite the position-filter tests**

In `tests/center.test.js`, replace the `filterByPosition` import and its test with:

```js
test('filterByPositions narrows to the selected positions', () => {
  assert.deepEqual(filterByPositions(POOL, ['RB']).map((x) => x.id), ['1', '2']);
  assert.deepEqual(filterByPositions(POOL, ['RB', 'WR']).map((x) => x.id), ['1', '2', '3']);
});

test('an empty selection means everything, never nothing', () => {
  // ALL is the clear button, and a blank board would be a worse answer than the
  // full one — the recommendations must never render empty.
  assert.equal(filterByPositions(POOL, []).length, 5);
});

test('filterByPositions does not mutate its input', () => {
  const before = POOL.map((x) => x.id);
  filterByPositions(POOL, ['RB']);
  assert.deepEqual(POOL.map((x) => x.id), before);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/center.test.js`
Expected: FAIL — `filterByPositions is not a function`.

- [ ] **Step 3: Implement**

Replace `filterByPosition` in `src/ui/center.js`:

```js
export function filterByPositions(pool, positions) {
  if (!positions || positions.length === 0) return [...pool];
  return pool.filter((pl) => positions.includes(pl.position));
}
```

Change `DEFAULT_VIEW` from `filter: 'ALL'` to `positions: []`, and update `visiblePlayers` to call `filterByPositions(sortPlayers(...), view.positions)`.

Rebuild the button row so `ALL` is the clear control, not a member of the set:

```js
    ...POSITION_FILTERS.map((position) => el('button', {
      class: position === 'ALL'
        ? (view.positions.length === 0 ? 'selected' : '')
        : (view.positions.includes(position) ? 'selected' : ''),
      text: position,
      title: position === 'ALL'
        ? 'Show every position'
        : `Target ${position} — filters the list and the recommendations`,
      // A full re-render, not redrawTable: these buttons now drive the
      // recommendations as well as the table, and a partial redraw would leave the
      // recommendations stale with no visible symptom.
      onClick: () => {
        if (position === 'ALL') view.positions = [];
        else if (view.positions.includes(position)) {
          view.positions = view.positions.filter((x) => x !== position);
        } else {
          view.positions = [...view.positions, position];
        }
        rerender();
      },
    }, [])),
```

- [ ] **Step 4: Verify**

Run: `npm test` — only build-freshness may fail.

- [ ] **Step 5: Commit**

```bash
git add src/ui/center.js tests/center.test.js
git commit -m "feat(center): multi-select position targeting"
```

---

### Task 5: Render the targeting, the sleepers, and the bye warnings

**Files:**
- Modify: `src/ui/center.js`
- Modify: `src/styles.css`
- Test: `tests/render-center.test.js`

**Interfaces:**
- Consumes: `sleepers` (Task 1), `byeConflict` (Task 2), `filterByPositions` (Task 4).
- Produces: `renderCenter`'s `ctx` gains `myRoster` and `slots` (both already computed in `app.js`; `myRoster` is already passed).

- [ ] **Step 1: Add the CSS**

```css
.rec.sleeper { border-left-style: dashed; }
.rec .gamble { font-size: 9px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 0 4px; margin-left: 6px; }
.rec .bye-warn { color: var(--te); font-size: 11.5px; margin-top: 3px; }
```

- [ ] **Step 2: Write the failing render tests**

Add to `tests/render-center.test.js`. Build a ctx where it is your pick, with a roster that sets up a bye clash.

```js
test('recommendations are restricted to the targeted positions', () => {
  const pool = [
    player({ id: 'wr', name: 'A Receiver', position: 'WR', overallRank: 2 }),
    player({ id: 'rb', name: 'A Back', position: 'RB', overallRank: 1 }),
  ];
  const container = document.createElement('div');
  renderCenter(container, { ...ctx(pool), pool, isMyPick: true, needs: { WR: 'high', RB: 'high' } },
    { onPick() {}, onUndo() {}, onOffList() {} });
  // Drive the WR button through its real handler.
  const wrBtn = find(container, (n) => n.tagName === 'button' && n.textContent === 'WR')[0];
  wrBtn.listeners.click[0]();
  const names = find(document.body || container, (n) => n.className === 'pname').map((n) => n.textContent);
  assert.ok(!names.includes('A Back'), 'an untargeted position cannot be recommended');
});

test('a sleeper renders in its own list, marked as a gamble', () => {
  const faller = player({ id: 'f', name: 'Falling Guy', overallRank: 40, adp: 5 });
  const container = document.createElement('div');
  renderCenter(container, { ...ctx([faller]), pool: [faller], isMyPick: true, currentPick: 40 },
    { onPick() {}, onUndo() {}, onOffList() {} });
  const gambles = find(container, (n) => n.className === 'gamble');
  assert.equal(gambles.length, 1);
  assert.equal(gambles[0].textContent, 'GAMBLE');
});

test('a candidate sharing a bye with a same-position starter is flagged', () => {
  const cand = player({ id: 'c', name: 'Clash', position: 'RB', bye: 9 });
  const starter = { id: 's', name: 'My Back', position: 'RB', bye: 9, projectedPoints: 250, team: 'XX' };
  const container = document.createElement('div');
  renderCenter(container, {
    ...ctx([cand]), pool: [cand], isMyPick: true, needs: { RB: 'high' },
    myRoster: [starter], slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BENCH: 6 },
  }, { onPick() {}, onUndo() {}, onOffList() {} });
  const warn = find(container, (n) => n.className === 'bye-warn');
  assert.equal(warn.length, 1);
  assert.match(warn[0].textContent, /My Back/);
});
```

- [ ] **Step 3: Implement**

Add single-line imports for `sleepers` and `byeConflict`. In `renderCenter`, where recommendations are built:

```js
  if (isMyPick && pool.length) {
    // The same selection drives the table and the recommendations — one control, one
    // meaning. vbdScale stays the whole-pool value passed in ctx, so narrowing the
    // input here cannot change what a VBD point is worth.
    const targeted = filterByPositions(pool, view.positions);
    const recs = recommend(targeted, { needs, surplus, currentPick, nextPick, round, vbdScale }, 3);

    container.appendChild(el('h2', {
      text: view.positions.length ? `Recommended — ${view.positions.join(', ')}` : 'Recommended',
    }, []));
    for (const rec of recs) container.appendChild(recommendationCard(rec, myRoster, slots));

    const gambles = sleepers(targeted, {
      currentPick,
      excludeIds: new Set(recs.map((r) => r.player.id)),
    }, 2);
    if (gambles.length) {
      container.appendChild(el('h2', { text: 'Sleepers' }, []));
      for (const g of gambles) container.appendChild(sleeperCard(g, myRoster, slots));
    }
  }
```

Give `recommendationCard` the roster and slots so it can warn, and add the sleeper card:

```js
function byeWarning(player, myRoster, slots) {
  const clash = myRoster && slots ? byeConflict(player, myRoster, slots) : null;
  return clash ? el('div', { class: 'bye-warn', text: `⚠ Bye ${player.bye} — same week as your ${player.position} ${clash}` }, []) : null;
}

function sleeperCard(gamble, myRoster, slots) {
  const pl = gamble.player;
  return el('div', { class: 'rec sleeper', style: { borderLeftColor: POSITION_COLORS[pl.position] } }, [
    el('div', { class: 'top' }, [
      el('span', { class: 'pname' }, [
        el('span', { text: pl.name }, []),
        el('span', { class: 'gamble', text: 'GAMBLE' }, []),
      ]),
      el('span', { class: 'meta', text: `${pl.position} · ${pl.team} · #${pl.overallRank}` }, []),
    ]),
    el('div', { class: 'why', text: gamble.why }, []),
    byeWarning(pl, myRoster, slots),
  ]);
}
```

Add `byeWarning(pl, myRoster, slots)` as the last child of `recommendationCard` too. `el()` skips null children, so a player with no clash renders nothing extra.

- [ ] **Step 4: Verify**

Run: `npm test` — only build-freshness may fail.

- [ ] **Step 5: Commit**

```bash
git add src/ui/center.js src/styles.css tests/render-center.test.js
git commit -m "feat(center): targeted recommendations, sleepers, and bye warnings"
```

---

### Task 6: Make the table height stop guessing, close popovers on re-render, rebuild

Both are findings carried forward from chunk C's review, recorded in the spec. This chunk is what makes the first one bite: the sleepers panel is new chrome above the table.

**Files:**
- Modify: `src/styles.css`
- Modify: `src/ui/center.js`
- Modify: `src/ui/app.js`
- Modify: `draft.html` (rebuilt)

- [ ] **Step 1: Replace the magic number with a layout that measures itself**

`.tablewrap` currently carries `max-height: calc(100vh - 320px)`, where 320 is the height of the chrome above it. This chunk adds a sleepers panel to that chrome, so the constant is now wrong, and it would be wrong again after any future change.

In `src/styles.css`, make the centre panel a flex column and let the table take whatever is left:

```css
.panel.center { display: flex; flex-direction: column; }
.panel.center .tablewrap { flex: 1 1 auto; min-height: 120px; }
```

and drop the `max-height` from `.tablewrap`, keeping `overflow: auto` (which is what makes the sticky header pin).

`min-height: 0` is not enough on its own here — a floor of `120px` keeps a few rows visible even when the recommendations and sleepers are both long.

In `src/ui/app.js`, give the centre panel the extra class:

```js
  const center = el('div', { class: 'panel center' }, []);
```

- [ ] **Step 2: Close any open popover when the panel re-renders**

`renderBoard` calls `closePopover()` at the top of every render; `renderCenter` does not, so a pick-driven re-render can leave a detail or glossary popover on screen pointing at replaced DOM. Add `closePopover` to the existing single-line import from `./popover.js` and call it at the top of `renderCenter`, beside the existing `clear(container)`.

- [ ] **Step 3: Add a test for the popover teardown**

In `tests/render-center.test.js`:

```js
test('re-rendering the panel closes an open popover', () => {
  // A stale popover would point at DOM the re-render has already replaced — harmless
  // for a read-only detail card, not harmless for chunk E's pick editor.
  const container = document.createElement('div');
  const draw = () => renderCenter(container, ctx([player()]), { onPick() {}, onUndo() {}, onOffList() {} });
  draw();
  find(container, (n) => n.className === 'pname')[0].listeners.click[0]({ clientX: 10, clientY: 10 });
  assert.equal(document.body.children.filter((n) => n.className.includes('pop')).length, 1);
  draw();
  assert.equal(document.body.children.filter((n) => n.className.includes('pop')).length, 0);
});
```

- [ ] **Step 4: Verify, rebuild, verify again**

```bash
npm test          # build-freshness still red — expected
npm run build
npm test          # 0 failures
```

- [ ] **Step 5: Confirm the bundle carries the chunk**

```bash
node -e '
const html = require("fs").readFileSync("draft.html", "utf8");
for (const [label, needle] of [
  ["sleepers", "function sleepers"],
  ["byeConflict", "function byeConflict"],
  ["filterByPositions", "function filterByPositions"],
  ["GAMBLE chip", "GAMBLE"],
  ["bye-warn CSS", ".bye-warn"],
  ["sleeper CSS", ".rec.sleeper"],
  ["centre panel flex", ".panel.center"],
]) console.log(label + ":", html.includes(needle));
console.log("magic max-height gone:", !html.includes("calc(100vh - 320px)"));
console.log("filterByPosition (singular) gone:", !/function filterByPosition\b/.test(html));
console.log("no leftover module syntax:", !/^\s*(import|export)\s/m.test(html));
'
```

Expected: every line `true`.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css src/ui/center.js src/ui/app.js tests/render-center.test.js draft.html
git commit -m "feat(center): size the table from the layout, close popovers on re-render"
```

---

## Verification

Chunk D is done when:

- `npm test` passes with more tests than the 205 this chunk started from.
- `data/players.json` is untouched.
- The bundle check in Task 6 prints `true` on every line.
- Opening `draft.html`: clicking `WR` then `RB` targets both, the heading reads `Recommended — WR, RB`, and the table shows only those positions; `ALL` clears it; a Sleepers list appears below the top three when anyone qualifies; and a candidate sharing a bye with a same-position starter carries an orange warning.
