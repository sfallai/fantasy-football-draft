# Chunk E — Pick Editing and Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user correct a wrong pick by clicking its cell and typing the right player, instead of undoing back to it — and let them save the draft to a file and restore it.

**Architecture:** Editing *replaces* a pick's player and never empties the cell, which is what keeps `currentPickNumber` — the invariant two dozen tests are pinned to — completely untouched. The state change is one new pure function plus a ten-line history migration. Backup and import touch no state-model logic at all.

**Tech Stack:** Node 22+, `node:test`, `node:assert/strict`, `tests/dom-stub.js`. No npm dependencies. File save/load uses browser-native Blob and FileReader.

**Spec:** `docs/superpowers/specs/2026-08-29-post-draft-improvements-design.md` (chunk E)

## Global Constraints

- **Node >= 22.** Zero npm dependencies, permanently.
- **`draft.html` is a build artifact.** Never hand-edit. `tests/build.test.js` rebuilds in-process and asserts byte equality. **Every dispatch that touches `src/` ends with a rebuild.**
- **Modules under `src/` may only use** `import { a } from './rel.js';` on ONE line and `export function|const|class`. The bundler is a regex transform: no default exports, no export lists, no namespace imports, no multi-line imports. A violation silently breaks `draft.html` rather than failing the build.
- **Do not run `npm run fetch`.** `data/players.json` must be byte-identical before and after this chunk.
- **`currentPickNumber` must not change.** If a task seems to require it, stop and report — the whole shape of this chunk exists to avoid that.
- **Editing never empties a cell.** `setPick` refuses an unfilled pick.
- **Double-click, never single click, commits a pick** in the centre panel. The board editor is its own surface and opens on a single click, because a board cell has no competing action.

---

### Task 1: Replace a pick, and let undo reverse it

**Files:**
- Modify: `src/core/state.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Produces:
  - `setPick(state, pickNumber, playerId) -> state` — replaces the player at an already-filled pick. Throws on an unfilled pick or on a player drafted elsewhere. Returns the state unchanged if the player is already the one there.
  - `history` entries become `{ pick: number, previous: string | null }`. `previous: null` means the slot was empty before (an ordinary pick); a string means it held that player (an edit).
  - `deserialize` normalises a legacy `history` of bare pick numbers.

- [ ] **Step 1: Write the failing tests**

Add to `tests/state.test.js`, extending its existing import with `setPick`.

```js
test('setPick replaces the player at an already-made pick', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = setPick(state, 1, 'b');
  assert.equal(state.picks[1].playerId, 'b');
});

test('setPick keeps the pick on the same team', () => {
  // teamIndex comes from the pick number, and editing must never move a pick to
  // another manager's roster.
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  const before = state.picks[2].teamIndex;
  state = setPick(state, 2, 'c');
  assert.equal(state.picks[2].teamIndex, before);
});

test('setPick refuses a player already drafted somewhere else', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  assert.throws(() => setPick(state, 1, 'b'), /already drafted/);
});

test('setPick allows re-setting a pick to the player it already holds', () => {
  // The duplicate check must not trip on the pick being edited.
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  assert.equal(setPick(state, 1, 'a').picks[1].playerId, 'a');
});

test('setPick refuses a pick that has not been made', () => {
  // Editing never creates a pick out of order — that is what the normal flow is for.
  const state = createState({ numTeams: 2, rounds: 2 });
  assert.throws(() => setPick(state, 3, 'a'), /not been made/);
});

test('setPick preserves a keeper flag', () => {
  const state = createState({
    numTeams: 2, rounds: 2,
    teams: [{ name: 'A', keeper: { playerId: 'k', round: 1 } }, { name: 'B', keeper: null }],
  });
  const edited = setPick(state, 1, 'k2');
  assert.equal(edited.picks[1].isKeeper, true, 'it is still the keeper slot, with a different player');
});

test('setPick does not mutate the state it is given', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  setPick(state, 1, 'b');
  assert.equal(state.picks[1].playerId, 'a');
});

test('undo reverses an edit, restoring the player that was there', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = setPick(state, 1, 'b');
  state = undoPick(state);
  assert.equal(state.picks[1].playerId, 'a');
  assert.equal(currentPickNumber(state), 2, 'undoing an edit does not un-make the pick');
});

test('undo still removes an ordinary pick', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = undoPick(state);
  assert.equal(state.picks[1], undefined);
  assert.equal(currentPickNumber(state), 1);
});

test('undo unwinds edits and picks in the order they happened', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  state = applyPick(state, 'b');
  state = setPick(state, 1, 'c');
  state = undoPick(state);
  assert.equal(state.picks[1].playerId, 'a', 'the edit came last, so it goes first');
  state = undoPick(state);
  assert.equal(state.picks[2], undefined);
});

test('deserialize accepts a legacy history of bare pick numbers', () => {
  // A draft saved before this chunk. Losing it on reload mid-draft is unacceptable.
  const legacy = JSON.stringify({
    version: 1,
    config: DEFAULT_CONFIG,
    picks: { 1: { playerId: 'a', teamIndex: 1, isKeeper: false } },
    history: [1],
  });
  const state = deserialize(legacy);
  assert.deepEqual(state.history, [{ pick: 1, previous: null }]);
  assert.equal(undoPick(state).picks[1], undefined, 'and it still undoes correctly');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/state.test.js`
Expected: FAIL — `setPick is not a function`.

- [ ] **Step 3: Implement**

In `src/core/state.js`, change `applyPick`'s history push to record the shape:

```js
    history: [...state.history, { pick, previous: null }],
```

Add `setPick`:

```js
// Editing replaces a player; it never empties a cell. That is deliberate:
// currentPickNumber returns the first UNFILLED pick, so a hole in the middle of a
// draft would make the clock mean the wrong thing and misroute every later pick.
// A cell whose player is genuinely unknown is what the off-list sentinel is for.
export function setPick(state, pickNumber, playerId) {
  const entry = state.picks[pickNumber];
  if (!entry) throw new Error(`Pick ${pickNumber} has not been made yet`);

  const id = String(playerId);
  if (entry.playerId === id) return state;

  for (const [number, other] of Object.entries(state.picks)) {
    if (Number(number) !== pickNumber && other.playerId === id) {
      throw new Error(`Player ${playerId} is already drafted`);
    }
  }

  return {
    ...state,
    // Spread the existing entry so teamIndex and isKeeper survive — a pick must never
    // change hands, and a keeper slot stays a keeper slot.
    picks: { ...state.picks, [pickNumber]: { ...entry, playerId: id } },
    history: [...state.history, { pick: pickNumber, previous: entry.playerId }],
  };
}
```

Rewrite `undoPick` to reverse whichever action came last:

```js
export function undoPick(state) {
  if (state.history.length === 0) return state;
  const history = [...state.history];
  const last = history.pop();
  const picks = { ...state.picks };

  if (last.previous === null) delete picks[last.pick];
  else picks[last.pick] = { ...picks[last.pick], playerId: last.previous };

  return { ...state, picks, history };
}
```

And normalise legacy history in `deserialize`:

```js
// Drafts saved before pick editing stored history as bare pick numbers. Mid-draft
// reloads have to keep working across the upgrade.
function normalizeHistory(raw) {
  return (raw || []).map((entry) => (
    typeof entry === 'number' ? { pick: entry, previous: null } : entry
  ));
}
```

with `deserialize` returning `history: normalizeHistory(raw.history)`.

- [ ] **Step 4: Verify**

Run: `npm test`. Every test must pass except `tests/build.test.js`'s freshness check, which stays red until a later task rebuilds. **`currentPickNumber`'s existing tests must all still pass untouched** — if any needed changing, stop and report.

- [ ] **Step 5: Commit**

```bash
git add src/core/state.js tests/state.test.js
git commit -m "feat(state): replace a pick's player, and let undo reverse it"
```

---

### Task 2: Move `matchesQuery` where both panels can reach it

The board's pick editor needs the same name-or-team matching the centre panel's filter uses. It currently lives in `src/ui/center.js`. A UI module importing logic from another UI module is the wrong direction; it belongs in `src/core/` beside the other pure player predicates.

**Files:**
- Modify: `src/core/player.js`, `src/ui/center.js`
- Test: `tests/player.test.js`, `tests/center.test.js`

**Interfaces:**
- Produces: `matchesQuery(player, query)` moves from `src/ui/center.js` to `src/core/player.js`. Behaviour is unchanged.

- [ ] **Step 1: Move the tests**

Move the four `matchesQuery` tests from `tests/center.test.js` to `tests/player.test.js`, changing the import to `../src/core/player.js`. Remove `matchesQuery` from `tests/center.test.js`'s import.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/player.test.js`
Expected: FAIL — no export named `matchesQuery`.

- [ ] **Step 3: Move the function**

Cut `matchesQuery` from `src/ui/center.js` and paste it into `src/core/player.js`, comment intact. Add it to `center.js`'s existing single-line import from `../core/player.js`.

- [ ] **Step 4: Verify**

Run: `npm test` — only build-freshness may fail.

- [ ] **Step 5: Commit**

```bash
git add src/core/player.js src/ui/center.js tests/player.test.js tests/center.test.js
git commit -m "refactor(core): move matchesQuery beside the other player predicates"
```

---

### Task 3: Click a board cell to correct it

**Files:**
- Create: `src/ui/pickeditor.js`
- Modify: `src/ui/board.js`, `src/ui/app.js`, `src/styles.css`
- Test: `tests/pickeditor.test.js`

**Interfaces:**
- Consumes: `matchesQuery` (Task 2), `showPopover` / `closePopover` from `./popover.js`, `el` from `./dom.js`.
- Produces: `pickEditor(cell, pool, onCommit) -> HTMLElement` — the popover body for editing one pick. `cell` carries `{ pick, player }`; `pool` is every player available to be set there; `onCommit(playerId)` is called when one is chosen.

- [ ] **Step 1: Write the failing tests**

Create `tests/pickeditor.test.js`, using `tests/dom-stub.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';

installDomStub();
const { pickEditor } = await import('../src/ui/pickeditor.js');

const pl = (id, name, position, team) => ({
  id, name, position, team, overallRank: 1, projectedPoints: 100, bye: 9,
});
const POOL = [pl('1', 'Jahmyr Gibbs', 'RB', 'DET'), pl('2', "Ja'Marr Chase", 'WR', 'CIN')];
const walk = (n, out = []) => { out.push(n); for (const c of n.children || []) walk(c, out); return out; };

test('the editor names the pick it is editing and who holds it', () => {
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, () => {});
  const text = walk(node).map((n) => n.textContent).join(' ');
  assert.match(text, /43/);
  assert.match(text, /Jahmyr Gibbs/);
});

test('typing filters the candidate list by name or team', () => {
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, () => {});
  const input = walk(node).find((n) => n.tagName === 'input');
  input.listeners.input[0]({ target: { value: 'CIN' } });
  const names = walk(node).filter((n) => n.className === 'cand').map((n) => n.textContent);
  assert.equal(names.length, 1);
  assert.match(names[0], /Chase/);
});

test('choosing a candidate commits that player', () => {
  let committed = null;
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, (id) => { committed = id; });
  const input = walk(node).find((n) => n.tagName === 'input');
  input.listeners.input[0]({ target: { value: 'chase' } });
  walk(node).find((n) => n.className === 'cand').listeners.click[0]();
  assert.equal(committed, '2');
});

test('an empty query shows nothing rather than the whole pool', () => {
  // 400 rows inside a popover would be unusable; the editor is a search, not a browser.
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, () => {});
  assert.equal(walk(node).filter((n) => n.className === 'cand').length, 0);
});

test('the editor offers no way to empty the cell', () => {
  // Deliberate: an empty cell in the middle of a draft would move the clock.
  // A pick whose player is unknown is what Skip / off-list marks.
  const node = pickEditor({ pick: 43, player: POOL[0] }, POOL, () => {});
  const labels = walk(node).map((n) => String(n.textContent || '').toLowerCase());
  assert.equal(labels.some((t) => t === 'clear' || t === 'empty' || t === 'remove'), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/pickeditor.test.js` — FAIL, module not found.

- [ ] **Step 3: Implement the editor**

Create `src/ui/pickeditor.js`:

```js
import { el, clear } from './dom.js';
import { matchesQuery } from '../core/player.js';

// How many candidates to offer. A popover is a search surface, not a second player
// table — showing the whole pool here would be unusable and duplicate the centre panel.
const MAX_CANDIDATES = 8;

export function pickEditor(cell, pool, onCommit) {
  const list = el('div', { class: 'cand-list' }, []);

  const input = el('input', {
    type: 'text', placeholder: 'Type the right player…', autocomplete: 'off',
    onInput: (e) => {
      clear(list);
      const query = e.target.value;
      // Blank shows nothing: matchesQuery passes everything through on an empty
      // query, which would drop the entire pool into the popover.
      if (!query.trim()) return;
      for (const candidate of pool.filter((p) => matchesQuery(p, query)).slice(0, MAX_CANDIDATES)) {
        list.appendChild(el('div', {
          class: 'cand',
          text: `${candidate.name} — ${candidate.position} ${candidate.team}`,
          onClick: () => onCommit(candidate.id),
        }, []));
      }
    },
  }, []);

  return el('div', { class: 'pop editor' }, [
    el('h3', { text: `Pick ${cell.pick}` }, []),
    el('div', { class: 'meta', text: cell.player ? `Currently ${cell.player.name}` : 'Currently off-list' }, []),
    input,
    list,
  ]);
}
```

- [ ] **Step 4: Wire it into the board**

In `src/ui/board.js`, add single-line imports for `pickEditor` and for `showPopover` (already imported). Give each **filled** cell an `onClick` that opens the editor:

```js
        onClick: cell.player || cell.isOffList
          ? (e) => {
            e.stopPropagation();
            showPopover(pickEditor(cell, ctx.editablePool, (playerId) => {
              closePopover();
              ctx.onEditPick(cell.pick, playerId);
            }), e);
          }
          : null,
```

`renderBoard`'s `ctx` gains `editablePool` (every player not currently drafted, plus the one this cell holds) and `onEditPick(pickNumber, playerId)`.

In `src/ui/app.js`, add `setPick` to the existing single-line state import and add a handler:

```js
function handleEditPick(pickNumber, playerId) {
  try {
    state = setPick(state, pickNumber, playerId);
  } catch (err) {
    window.alert(err.message);
    return;
  }
  persist();
  renderDraft();
}
```

Pass `editablePool: availablePlayers(state, allPlayers)` and `onEditPick: handleEditPick` to `renderBoard`. A player already drafted elsewhere is excluded from the candidate list, and `setPick` rejects one anyway — belt and braces, because the list is the affordance and the throw is the guarantee.

- [ ] **Step 5: Add the CSS**

```css
.pop.editor input { width: 100%; margin-top: 6px; }
.cand-list { margin-top: 6px; max-height: 200px; overflow: auto; }
.cand { padding: 5px 6px; cursor: pointer; border-radius: 4px; }
.cand:hover { background: #2b3140; }
table.board td.cell { cursor: pointer; }
```

- [ ] **Step 6: Verify**

Run: `npm test` — only build-freshness may fail.

- [ ] **Step 7: Commit**

```bash
git add src/ui/pickeditor.js src/ui/board.js src/ui/app.js src/styles.css tests/pickeditor.test.js
git commit -m "feat(board): click a pick to correct the player in it"
```

---

### Task 4: Save a backup, restore one, and rebuild

**Files:**
- Modify: `src/core/state.js`, `src/ui/app.js`, `src/styles.css`
- Modify: `draft.html` (rebuilt)
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: `serialize` / `deserialize` (already in `state.js`), `resetView` from `../ui/center.js`.
- Produces: `backupFilename(state) -> string`.

- [ ] **Step 1: Write the failing test**

```js
test('backupFilename names the league and round so two files never collide', () => {
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  const name = backupFilename(state);
  assert.match(name, /^ffdraft-/);
  assert.match(name, /\.json$/);
  assert.match(name, /r1/, 'the round it was taken at, so a later backup sorts after an earlier one');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/state.test.js` — FAIL, `backupFilename is not a function`.

- [ ] **Step 3: Implement**

In `src/core/state.js`:

```js
// No timestamp: the page has no clock the user trusts more than the draft itself, and
// a round-stamped name sorts in draft order, which is how someone looks for the file.
export function backupFilename(state) {
  const made = Object.keys(state.picks).length;
  const round = Math.max(1, Math.ceil(made / state.config.numTeams));
  return `ffdraft-${state.config.numTeams}team-r${round}-p${made}.json`;
}
```

- [ ] **Step 4: Wire the buttons**

In `src/ui/app.js`, add `serialize`, `deserialize` and `backupFilename` to the existing state import, and `resetView` to the `center.js` import. Add two handlers beside `handleReset`:

```js
// Blob and FileReader, not a library: the page ships as one self-contained file and
// takes no dependency, ever.
function handleBackup() {
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: backupFilename(state) }, []);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function handleImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let restored;
    try {
      restored = deserialize(String(reader.result));
    } catch {
      window.alert('That file is not a saved draft.');
      return;
    }
    if (!window.confirm('Replace the current draft with this backup?')) return;
    state = restored;
    replacement = replacementPoints(allPlayers, state.config.numTeams, state.config.slots);
    vbdScale = scaleFromReplacement();
    // The centre panel's sort, filter and position targeting are module state that
    // outlives a draft. Without this an imported draft inherits the last one's targeting.
    resetView();
    persist();
    renderDraft();
  };
  reader.readAsText(file);
}
```

Render the controls under the left panel's Reset button:

```js
  left.appendChild(el('button', { text: 'Save backup', style: { marginTop: '8px' }, onClick: handleBackup }, []));
  const importInput = el('input', {
    type: 'file', accept: '.json,application/json', style: { display: 'none' },
    onChange: (e) => { if (e.target.files && e.target.files[0]) handleImport(e.target.files[0]); },
  }, []);
  left.appendChild(el('button', { text: 'Import backup', style: { marginTop: '8px' }, onClick: () => importInput.click() }, []));
  left.appendChild(importInput);
```

Note the baselines are recomputed on import for the same reason `startDraft` recomputes them: a backup may carry a different league size or slot layout than the draft currently loaded.

- [ ] **Step 5: Verify, rebuild, verify again**

```bash
npm test          # build-freshness still red
npm run build
npm test          # 0 failures
```

- [ ] **Step 6: Confirm the bundle, and check the download path by hand**

```bash
node -e '
const html = require("fs").readFileSync("draft.html", "utf8");
for (const [label, needle] of [
  ["setPick", "function setPick"],
  ["backupFilename", "function backupFilename"],
  ["pickEditor", "function pickEditor"],
  ["matchesQuery in core", "function matchesQuery"],
  ["editor CSS", ".pop.editor"],
  ["candidate CSS", ".cand-list"],
]) console.log(label + ":", html.includes(needle));
console.log("currentPickNumber unchanged:", html.includes("function currentPickNumber"));
console.log("no leftover module syntax:", !/^\s*(import|export)\s/m.test(html));
'
```

Expected: every line `true`.

**Then open `draft.html` in Chrome and confirm by hand**, because no test can: Save backup actually produces a file, and importing it restores the draft. A `download` attribute on a `file://` page is the one part of this chunk that browsers may treat differently from a served page. If it does not work, **stop and report** rather than inventing a fallback — the right answer depends on how the app will be distributed, which is not yet decided.

- [ ] **Step 7: Commit**

```bash
git add src/core/state.js src/ui/app.js src/styles.css tests/state.test.js draft.html
git commit -m "feat(app): save the draft to a file and restore it"
```

---

## Verification

Chunk E is done when:

- `npm test` passes with more tests than the 240 this chunk started from.
- **`currentPickNumber` and every test pinned to it are untouched.** `git diff main -- src/core/state.js` shows no change to that function.
- `data/players.json` is untouched.
- The bundle check in Task 4 prints `true` on every line.
- In `draft.html`: clicking a filled board cell opens an editor naming that pick, typing finds a player, choosing one replaces the pick without moving it to another team, and Undo puts the old player back. Save backup writes a file; Import restores it.
