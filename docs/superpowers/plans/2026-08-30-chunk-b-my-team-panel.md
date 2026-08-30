# Chunk B — My Team Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each rostered player's team and bye week on his slot row in the left panel, and add a position-count line above the positional needs.

**Architecture:** Both changes live in `src/ui/myteam.js`. The formatting logic is extracted into two pure exported functions so it can be unit-tested directly, matching how `needSummary` in the same file is already tested. `renderMyTeam` then consumes them. Two CSS rules support the new layout. Nothing in `src/core/` changes.

**Tech Stack:** Node 22+, `node:test`, `node:assert/strict`. No npm dependencies. Plain DOM via the `el()` helper in `src/ui/dom.js`.

**Spec:** `docs/superpowers/specs/2026-08-29-post-draft-improvements-design.md` (chunk B)

## Global Constraints

- **Node >= 22.** No npm dependencies, permanently — `npm install` is not part of any workflow.
- **`draft.html` is a build artifact.** Never hand-edit it; regenerate with `node scripts/build.mjs`.
- **`npm test` must pass before `npm run build`.** A test now enforces that `draft.html` matches `data/players.json`, so a `src/` change requires a rebuild before the suite is green.
- **Modules under `src/` may only use** `import { a } from './rel.js';` on ONE line and `export function|const|class`. The bundler is a regex transform: it does not understand default exports, export lists, namespace imports, or a multi-line import. Violating this produces a broken `draft.html`, not a build error.
- **Do not run `npm run fetch`.** Chunk B does not touch player data. `data/players.json` must be identical before and after this chunk.
- A player is a rookie when `experience !== null && experience <= 1 && prior === null`. Not used in this chunk — chunk C renders the badge and should introduce a shared helper for it then.

---

### Task 1: The two display helpers

Both are pure string formatters, exported so they can be tested without a DOM. `src/ui/myteam.js` already exports `needSummary` and is tested this way in `tests/myteam.test.js`.

**Files:**
- Modify: `src/ui/myteam.js` (add `slotMeta` and `positionCountLine`)
- Test: `tests/myteam.test.js`

**Interfaces:**
- Consumes: `countByPosition` and `ALL_POSITIONS` from `../core/roster.js` — both are already imported by `src/ui/myteam.js`; do not add a second import line for them.
- Produces:
  - `slotMeta(player) -> string` — `''` when `player` is falsy.
  - `positionCountLine(roster) -> string`

- [ ] **Step 1: Write the failing tests**

Add to `tests/myteam.test.js`, extending the existing import from `../src/ui/myteam.js` to include both new names. Note the existing `p()` helper in that file builds players with `team: 'XX'` and `bye: null`; these tests build their own where they need specific values.

```js
test('slotMeta shows the team and bye week', () => {
  assert.equal(slotMeta({ team: 'DET', bye: 6 }), 'DET · bye 6');
});

test('slotMeta says so when a player has no bye on record', () => {
  // A free agent has no pro team, so no bye. An em-dash here would read as
  // "week —", which is worse than saying there isn't one.
  assert.equal(slotMeta({ team: 'FA', bye: null }), 'FA · no bye');
});

test('slotMeta is empty for an unfilled slot', () => {
  assert.equal(slotMeta(null), '');
  assert.equal(slotMeta(undefined), '');
});

test('positionCountLine reports every position, including the ones at zero', () => {
  // A zero is the point: it is how you see at a glance that you have no kicker.
  const roster = [p('a', 'RB'), p('b', 'RB'), p('c', 'WR'), p('d', 'QB')];
  assert.equal(positionCountLine(roster), 'QB:1  RB:2  WR:1  TE:0  K:0  DEF:0');
});

test('positionCountLine on an empty roster is all zeros, not blank', () => {
  assert.equal(positionCountLine([]), 'QB:0  RB:0  WR:0  TE:0  K:0  DEF:0');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/myteam.test.js`
Expected: FAIL — `slotMeta is not a function`.

- [ ] **Step 3: Implement both helpers**

Add to `src/ui/myteam.js`, above `renderMyTeam`:

```js
// Team and bye belong on the row, not in a title attribute — a tooltip you have to
// hover for is no use when you are scanning the roster for a bye-week clash on the clock.
export function slotMeta(player) {
  if (!player) return '';
  return `${player.team} · ${player.bye === null || player.bye === undefined ? 'no bye' : `bye ${player.bye}`}`;
}

// Two spaces between entries: at 12px a single space runs "QB:1 RB:2" together.
export function positionCountLine(roster) {
  const counts = countByPosition(roster);
  return ALL_POSITIONS.map((position) => `${position}:${counts[position]}`).join('  ');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/myteam.test.js`
Expected: PASS. Then `npm test` — 0 failures. (`draft.html` is untouched so far, so the build-freshness test still passes.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/myteam.js tests/myteam.test.js
git commit -m "feat(myteam): add slot meta and position count formatters"
```

---

### Task 2: Render them, and rebuild

`renderMyTeam` currently prints the team inside the name (`${player.name} (${player.team})`) and hides the bye in a `title` attribute. The team moves out of the name and into the new meta column, so it must be removed from the name to avoid printing `DET` twice on one row.

**Files:**
- Modify: `src/ui/myteam.js` (`renderMyTeam`)
- Modify: `src/styles.css`
- Modify: `draft.html` (rebuilt, never hand-edited)

**Interfaces:**
- Consumes: `slotMeta(player)` and `positionCountLine(roster)` from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Add the two CSS rules**

In `src/styles.css`, in the `/* ---- My team ---- */` block, after the `.slot .name.empty` rule:

```css
.slot .meta { color: var(--muted); font-size: 11px; flex: none; white-space: nowrap; }
.pos-counts { margin-top: 14px; color: var(--muted); font-size: 12px; letter-spacing: 0.02em; }
```

`.slot` is already `display: flex` with `justify-content: space-between`, so a third child needs no further layout work.

- [ ] **Step 2: Rewrite the slot row and add the count line**

In `src/ui/myteam.js`, replace the whole `for (const slot of assignSlots(roster, slots))` loop with:

```js
  for (const slot of assignSlots(roster, slots)) {
    const player = slot.player;
    container.appendChild(el('div', { class: 'slot' }, [
      el('span', { class: 'label', text: slot.label }, []),
      el('span', {
        class: `name${player ? '' : ' empty'}`,
        text: player ? player.name : 'empty',
        style: player ? { color: POSITION_COLORS[player.position] } : {},
        title: player ? `${player.position} · ${player.projectedPoints} proj` : '',
      }, []),
      el('span', { class: 'meta', text: slotMeta(player) }, []),
    ]));
  }

  container.appendChild(el('div', {
    class: 'pos-counts',
    text: positionCountLine(roster),
  }, []));
```

Two things to notice: the team is gone from the `name` span (it now lives in `meta`), and the bye is gone from the `title` (same reason). The `title` keeps position and projected points, which still have nowhere else to go.

- [ ] **Step 3: Verify the suite still passes, then rebuild**

Run: `npm test`
Expected: PASS, 0 failures.

Then run: `npm run build`
Expected: `Wrote draft.html (NNN KB, 400 players)`.

Then run `npm test` once more.
Expected: PASS. The `draft.html was rebuilt from the committed data/players.json` test in `tests/build.test.js` only passes once the page has been regenerated; running the suite after the build is what confirms the artifact and the source agree.

- [ ] **Step 4: Confirm the page actually renders the change**

The unit tests cover the formatters, not the DOM. Confirm the rendered output directly:

```bash
node -e '
const html = require("fs").readFileSync("draft.html", "utf8");
console.log("slotMeta bundled:", html.includes("function slotMeta"));
console.log("positionCountLine bundled:", html.includes("function positionCountLine"));
console.log("pos-counts CSS present:", html.includes(".pos-counts"));
console.log("slot meta CSS present:", html.includes(".slot .meta"));
console.log("no leftover module syntax:", !/^\s*export\s+function/m.test(html));
'
```

Expected: all five `true`. If `slotMeta bundled` is false, the bundler's regex did not match the export — check that the export is a single-line `export function` declaration.

- [ ] **Step 5: Commit**

```bash
git add src/ui/myteam.js src/styles.css draft.html
git commit -m "feat(myteam): show team and bye per slot, add position counts"
```

---

## Verification

Chunk B is done when:

- `npm test` passes, with more tests than the 150 this chunk started from.
- `git diff --stat` for the chunk shows `data/players.json` untouched.
- `draft.html` was rebuilt after `src/` changed — enforced by `tests/build.test.js`.
- Opening `draft.html` and starting a draft shows each filled roster slot as `RB1 | Jahmyr Gibbs | DET · bye 6`, and a line like `QB:1  RB:2  WR:1  TE:0  K:0  DEF:0` between the roster and Positional Needs.
