# Chunk C — Player List and Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the centre panel's filter box the single way to find a player, show every player in the table (drafted ones greyed with their owner), and surface the rookie flag, age, and last season's line that chunk A put in the data.

**Architecture:** Pure predicates and formatters land in `src/core/` (`player.js`) and `src/core/state.js`, where they are unit-tested directly. `src/ui/center.js` consumes them. A popover mechanism is extracted from `src/ui/board.js` into `src/ui/popover.js` so that one shared module owns "at most one popover is open" — without that, the board's popover and the centre panel's could both be open at once. `src/ui/app.js` is wired last.

**Tech Stack:** Node 22+, `node:test`, `node:assert/strict`, plus `tests/dom-stub.js` (built in chunk B) for render-side assertions. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-29-post-draft-improvements-design.md` (chunk C)

## Global Constraints

- **Node >= 22.** Zero npm dependencies, permanently — `npm install` is not part of any workflow.
- **`draft.html` is a build artifact.** Never hand-edit it. `tests/build.test.js` rebuilds in-process and asserts byte equality, so any `src/` change needs `npm run build` before the suite is green.
- **`npm test` must pass before `npm run build`.**
- **Modules under `src/` may only use** `import { a } from './rel.js';` on ONE line and `export function|const|class`. The bundler is a regex transform: no default exports, no export lists, no namespace imports, no multi-line imports. A violation silently breaks `draft.html` rather than failing the build.
- **Do not run `npm run fetch`.** `data/players.json` must be byte-identical before and after this chunk.
- **A player is a rookie when** `experience !== null && experience <= 1 && prior === null`.
- **Double-click, not single click, commits a pick.** A stray click must never burn a pick.

---

### Task 1: Player-level predicates and formatters

**Files:**
- Create: `src/core/player.js`
- Test: `tests/player.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isRookie(player) -> boolean`
  - `priorSummary(player) -> string | null` — `null` when there is no prior season.

- [ ] **Step 1: Write the failing tests**

Create `tests/player.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRookie, priorSummary } from '../src/core/player.js';

test('isRookie is true for a first-year player with no prior season', () => {
  assert.equal(isRookie({ experience: 0, prior: null }), true);
  assert.equal(isRookie({ experience: 1, prior: null }), true);
});

test('isRookie is false for a veteran who has a prior season on record', () => {
  // The one experience===1 player in the shipped pool is 27 years old with a
  // 2025 season. ESPN's experience counter is not self-consistent, so the
  // absence of a prior season is what actually settles it.
  assert.equal(isRookie({ experience: 1, prior: { points: 22.7, games: 4, ppg: 5.7 } }), false);
  assert.equal(isRookie({ experience: 5, prior: null }), false);
});

test('isRookie is false when experience is unknown', () => {
  // Defenses and failed athlete lookups both land here. Absent evidence is not
  // evidence of a rookie.
  assert.equal(isRookie({ experience: null, prior: null }), false);
});

test('priorSummary reads as a stat line', () => {
  assert.equal(
    priorSummary({ prior: { points: 289.9, games: 17, ppg: 17.1 } }),
    '289.9 pts in 17 games · 17.1 ppg',
  );
});

test('priorSummary is null when there is no prior season', () => {
  assert.equal(priorSummary({ prior: null }), null);
  assert.equal(priorSummary({}), null);
});

test('priorSummary reports a season that happened but produced nothing', () => {
  // Distinct from having no prior season at all — the player was around and
  // did not score, which is worth seeing.
  assert.equal(
    priorSummary({ prior: { points: 0, games: 0, ppg: 0 } }),
    '0 pts in 0 games · 0 ppg',
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/player.test.js`
Expected: FAIL — cannot find module `../src/core/player.js`.

- [ ] **Step 3: Implement**

Create `src/core/player.js`:

```js
// ESPN's `experience` counts the current rookie class as 0 and the previous one as 2,
// so it cannot be trusted as a years-played number. Requiring no prior season is what
// makes this independent of whichever convention ESPN is using in a given year.
export function isRookie(player) {
  return player.experience !== null
    && player.experience !== undefined
    && player.experience <= 1
    && !player.prior;
}

// A rookie has no prior season, and that absence is informative — so return null
// rather than a line of zeroes the reader would have to decode.
export function priorSummary(player) {
  const prior = player && player.prior;
  if (!prior) return null;
  return `${prior.points} pts in ${prior.games} games · ${prior.ppg} ppg`;
}
```

- [ ] **Step 4: Verify**

Run: `node --test tests/player.test.js` → PASS. Then `npm test` → 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/core/player.js tests/player.test.js
git commit -m "feat(core): add isRookie and priorSummary player helpers"
```

---

### Task 2: Every player, with the team that drafted him

The table must list drafted players too, labelled with their owner. That mapping belongs in `src/core/state.js` beside `rostersByTeam`, where it can be tested without a DOM.

**Files:**
- Modify: `src/core/state.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `playersWithOwners(state, allPlayers) -> Player[]` — every player in `allPlayers`, in the same order, each with an added `ownerName: string | null` (`null` when undrafted). Never mutates the inputs.

- [ ] **Step 1: Write the failing tests**

Add to `tests/state.test.js`, extending the existing import from `../src/core/state.js` to include `playersWithOwners`. Match the fixtures already used in that file.

```js
test('playersWithOwners labels a drafted player with the team that took him', () => {
  const players = [
    { id: 'a', name: 'A', position: 'RB' },
    { id: 'b', name: 'B', position: 'WR' },
  ];
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');

  const out = playersWithOwners(state, players);
  assert.equal(out.length, 2, 'every player is listed, drafted or not');
  assert.equal(out.find((p) => p.id === 'a').ownerName, 'Team 1');
  assert.equal(out.find((p) => p.id === 'b').ownerName, null, 'undrafted players own nothing');
});

test('playersWithOwners preserves input order', () => {
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const state = createState({ numTeams: 2, rounds: 2 });
  assert.deepEqual(playersWithOwners(state, players).map((p) => p.id), ['a', 'b', 'c']);
});

test('playersWithOwners does not mutate the players it is given', () => {
  const players = [{ id: 'a' }];
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyPick(state, 'a');
  playersWithOwners(state, players);
  assert.equal('ownerName' in players[0], false);
});

test('playersWithOwners survives an off-list pick', () => {
  // An off-list pick's id matches no player. It must not throw and must not
  // invent a row.
  const players = [{ id: 'a' }];
  let state = createState({ numTeams: 2, rounds: 2 });
  state = applyOffListPick(state);
  const out = playersWithOwners(state, players);
  assert.equal(out.length, 1);
  assert.equal(out[0].ownerName, null);
});

test('playersWithOwners labels a keeper with his team', () => {
  const players = [{ id: 'k' }];
  const state = createState({
    numTeams: 2,
    rounds: 2,
    teams: [{ name: 'Alpha', keeper: { playerId: 'k', round: 1 } }, { name: 'Beta', keeper: null }],
  });
  assert.equal(playersWithOwners(state, players)[0].ownerName, 'Alpha');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/state.test.js`
Expected: FAIL — `playersWithOwners is not a function`.

- [ ] **Step 3: Implement**

Add to `src/core/state.js`:

```js
// The table shows drafted players too, greyed and unpickable, so the user can see
// where someone went instead of wondering whether they mistyped the name. Returns a
// copy per player: mutating the shared pool would leak owner names into the
// recommendation path, which must never see a drafted player at all.
export function playersWithOwners(state, allPlayers) {
  const ownerByPlayerId = new Map();
  for (const entry of Object.values(state.picks)) {
    const team = state.config.teams[entry.teamIndex - 1];
    if (team) ownerByPlayerId.set(entry.playerId, team.name);
  }
  return allPlayers.map((pl) => ({ ...pl, ownerName: ownerByPlayerId.get(pl.id) ?? null }));
}
```

- [ ] **Step 4: Verify**

Run: `node --test tests/state.test.js` → PASS. Then `npm test` → 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/core/state.js tests/state.test.js
git commit -m "feat(state): list every player with the team that drafted him"
```

---

### Task 3: One matching predicate for the filter

The pick-entry box is being removed, so `searchPlayers` loses its only caller. Its matching behaviour lives on as `matchesQuery`, which the table filter uses — today that filter matches names only, which is why typing a team abbreviation finds nothing.

**Files:**
- Modify: `src/ui/center.js` (replace `searchPlayers` with `matchesQuery`)
- Test: `tests/center.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `matchesQuery(player, query) -> boolean` — case-insensitive substring match against name **or** team. A blank query matches everything.

- [ ] **Step 1: Rewrite the search tests as matching tests**

In `tests/center.test.js`, change the import to bring in `matchesQuery` instead of `searchPlayers`, and replace the six `searchPlayers` tests with:

```js
test('matchesQuery matches a partial name, case-insensitively', () => {
  assert.equal(matchesQuery(POOL[0], 'gib'), true);
  assert.equal(matchesQuery(POOL[1], 'ROBIN'), true);
  assert.equal(matchesQuery(POOL[0], 'robin'), false);
});

test('matchesQuery matches a team abbreviation by substring', () => {
  // Typing a team is how you find a QB-WR stack.
  assert.equal(matchesQuery(POOL[2], 'cin'), true);
  assert.equal(matchesQuery(POOL[2], 'ci'), true);
});

test('matchesQuery handles apostrophes in names', () => {
  assert.equal(matchesQuery(POOL[2], "ja'marr"), true);
});

test('matchesQuery passes everything through for a blank query', () => {
  // The table shows the whole pool until the user types, so blank cannot mean
  // "match nothing" the way it did for the old autocomplete.
  assert.equal(matchesQuery(POOL[0], ''), true);
  assert.equal(matchesQuery(POOL[0], '   '), true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/center.test.js`
Expected: FAIL — `matchesQuery is not a function`.

- [ ] **Step 3: Implement, and delete the dead function**

In `src/ui/center.js`, replace the whole `searchPlayers` function with:

```js
// Name or team, so typing "CIN" surfaces a quarterback and his receiver together.
// A blank query matches everything: the table shows the full pool until you type.
export function matchesQuery(player, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return player.name.toLowerCase().includes(needle)
    || player.team.toLowerCase().includes(needle);
}
```

`searchPlayers` had one caller, `pickEntry`, which Task 6 removes. Leave `pickEntry` alone for now; it will not compile against a deleted `searchPlayers`, so **also update `pickEntry`'s `input` listener in this task** to use the new predicate so the tree stays working between commits:

```js
    matches = pool.filter((pl) => matchesQuery(pl, input.value)).slice(0, 8);
```

(with `input.value` blank, `matchesQuery` returns true for everything, so guard the call site: `matches = input.value.trim() ? pool.filter(...).slice(0, 8) : [];`)

- [ ] **Step 4: Verify**

Run: `node --test tests/center.test.js` → PASS. Then `npm test` → 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/ui/center.js tests/center.test.js
git commit -m "refactor(center): one matching predicate for name and team"
```

---

### Task 4: Extract the popover mechanism

`src/ui/board.js` owns `openPopover` / `closePopover` as module-local state. Chunk C adds two more popovers in `src/ui/center.js`. A second copy of that state means two popovers can be open at once — the board's team roster and the centre panel's player detail — with neither closing the other.

**Files:**
- Create: `src/ui/popover.js`
- Modify: `src/ui/board.js` (use the shared module)
- Test: `tests/popover.test.js`

**Interfaces:**
- Consumes: `el`, `clear` from `./dom.js` are NOT needed here; this module manipulates nodes it is handed.
- Produces:
  - `showPopover(node, event)` — closes any open popover, positions `node` near the pointer, appends it to `document.body`, and arms a one-shot document click to dismiss it.
  - `closePopover()` — closes whatever is open. Safe to call when nothing is.

- [ ] **Step 1: Write the failing tests**

Create `tests/popover.test.js`. The chunk B stub does not model `document.body` or `removeChild`, so extend it locally in the test:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';
import { showPopover, closePopover } from '../src/ui/popover.js';

function stubWithBody() {
  const document = installDomStub();
  const body = document.createElement('body');
  body.removeChild = (child) => {
    body.childNodes = body.childNodes.filter((c) => c !== child);
    body.children = body.children.filter((c) => c !== child);
    return child;
  };
  document.body = body;
  document.addEventListener = () => {};
  globalThis.window = { innerWidth: 1200, innerHeight: 800 };
  return { document, body };
}

test('showPopover attaches the node to the body', () => {
  const { document, body } = stubWithBody();
  const node = document.createElement('div');
  showPopover(node, { clientX: 10, clientY: 20 });
  assert.equal(body.children.length, 1);
  closePopover();
});

test('opening a second popover closes the first', () => {
  // Two panels each opening their own popover is exactly the bug this module
  // exists to prevent.
  const { document, body } = stubWithBody();
  const first = document.createElement('div');
  const second = document.createElement('div');
  showPopover(first, { clientX: 0, clientY: 0 });
  showPopover(second, { clientX: 0, clientY: 0 });
  assert.equal(body.children.length, 1);
  assert.equal(body.children[0], second);
  closePopover();
});

test('closePopover is safe when nothing is open', () => {
  stubWithBody();
  closePopover();
  closePopover();
});

test('showPopover keeps the node inside the viewport', () => {
  const { document } = stubWithBody();
  const node = document.createElement('div');
  showPopover(node, { clientX: 1190, clientY: 790 });
  assert.ok(parseInt(node.style.left, 10) <= 1200 - 280);
  assert.ok(parseInt(node.style.top, 10) <= 800 - 400);
  closePopover();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/popover.test.js`
Expected: FAIL — cannot find module `../src/ui/popover.js`.

- [ ] **Step 3: Implement, moving the logic out of board.js**

Create `src/ui/popover.js`:

```js
// One module owns the open popover, so a second panel opening one closes the first.
// Two independent copies of this state let the board's roster popover and the centre
// panel's player detail sit on screen at the same time, each unaware of the other.
let openNode = null;

export function closePopover() {
  if (openNode && openNode.parentNode) openNode.parentNode.removeChild(openNode);
  openNode = null;
}

export function showPopover(node, event) {
  closePopover();
  node.style.left = `${Math.min(event.clientX, window.innerWidth - 280)}px`;
  node.style.top = `${Math.min(event.clientY, window.innerHeight - 400)}px`;
  document.body.appendChild(node);
  openNode = node;
  // Deferred, or the click that opened this popover immediately closes it.
  setTimeout(() => document.addEventListener('click', closePopover, { once: true }), 0);
}
```

In `src/ui/board.js`: delete the module-local `openPopover` variable and the `closePopover` function, add `import { showPopover, closePopover } from './popover.js';`, and replace the tail of `showRosterPopover` (the two `pop.style` lines, the `appendChild`, the assignment and the `setTimeout`) with `showPopover(pop, event);`. `renderBoard` already calls `closePopover()` — it now calls the imported one.

- [ ] **Step 4: Verify**

Run: `npm test` → 0 failures. Confirm `board.js` no longer declares its own `closePopover`:

```bash
grep -c 'function closePopover' src/ui/board.js
```

Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/popover.js src/ui/board.js tests/popover.test.js
git commit -m "refactor(ui): one module owns the open popover"
```

---

### Task 5: The table shows every player

**Files:**
- Modify: `src/ui/center.js` (`playerTable`, `renderCenter` signature)
- Modify: `src/styles.css`
- Test: `tests/render-center.test.js` (new)

**Interfaces:**
- Consumes: `isRookie` from `../core/player.js`; `matchesQuery` (Task 3).
- Produces: `renderCenter(container, ctx, handlers)` where `ctx` now also carries `tablePlayers` — every player, with `vbd` and `ownerName`. `ctx.pool` keeps its existing meaning (available only) and still feeds recommendations.

- [ ] **Step 1: Add the CSS**

In `src/styles.css`, after the `table.players` rules:

```css
.tablewrap { overflow-x: auto; }
table.players tr.taken td { color: #545b6b; }
table.players tr.taken:hover td { background: transparent; }
table.players td.owner { color: var(--muted); font-style: italic; white-space: nowrap; }
table.players td.pname { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rookie { font-size: 9px; font-weight: 600; letter-spacing: 0.04em; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 0 3px; margin-left: 5px; vertical-align: middle; }
```

- [ ] **Step 2: Write the failing render tests**

Create `tests/render-center.test.js` using the chunk B stub. Assert against the table only.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStub } from './dom-stub.js';

installDomStub();
const { renderCenter } = await import('../src/ui/center.js');

const player = (over) => ({
  id: 'p1', name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', overallRank: 1,
  positionRank: 1, projectedPoints: 297.1, vbd: 80, adp: 1.4, bye: 6,
  age: 24, experience: 4, prior: { points: 289.9, games: 17, ppg: 17.1 },
  ownerName: null, ...over,
});

function ctx(tablePlayers) {
  return {
    pool: [], tablePlayers, needs: {}, surplus: {}, currentPick: 1, nextPick: 4,
    round: 1, numTeams: 10, isMyPick: false, pickingTeamName: 'Team 1',
    notes: [], vbdScale: 100,
  };
}

function render(tablePlayers) {
  const container = document.createElement('div');
  renderCenter(container, ctx(tablePlayers), { onPick() {}, onUndo() {}, onOffList() {} });
  return container;
}

// Walk the stub tree, since it models no querySelector.
function find(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) find(child, predicate, out);
  return out;
}

test('the table lists drafted players as well as available ones', () => {
  const container = render([player(), player({ id: 'p2', name: 'Taken Guy', ownerName: 'Team 3' })]);
  const rows = find(container, (n) => n.tagName === 'tr' && n.children.some((c) => c.tagName === 'td'));
  assert.equal(rows.length, 2, 'a drafted player still gets a row');
});

test('a drafted row is marked taken and names the owner', () => {
  const container = render([player({ ownerName: 'Team 3' })]);
  const taken = find(container, (n) => n.className === 'taken');
  assert.equal(taken.length, 1);
  const owner = find(container, (n) => n.className === 'owner');
  assert.equal(owner[0].textContent, 'Team 3');
});

test('an undrafted row is not marked taken and shows no owner', () => {
  const container = render([player()]);
  assert.equal(find(container, (n) => n.className === 'taken').length, 0);
  assert.equal(find(container, (n) => n.className === 'owner')[0].textContent, '');
});

test('a drafted row cannot be double-clicked into a pick', () => {
  // The guard that stops you re-drafting someone already gone.
  const container = render([player({ ownerName: 'Team 3' })]);
  const taken = find(container, (n) => n.className === 'taken')[0];
  assert.equal((taken.listeners.dblclick || []).length, 0);
});

test('an available row commits a pick on double-click, not on a single click', () => {
  let picked = null;
  const container = document.createElement('div');
  renderCenter(container, ctx([player()]), {
    onPick: (id) => { picked = id; }, onUndo() {}, onOffList() {},
  });
  const row = find(container, (n) => n.tagName === 'tr' && n.children.some((c) => c.tagName === 'td'))[0];
  assert.equal((row.listeners.click || []).length, 0, 'a stray click must never burn a pick');
  row.listeners.dblclick[0]();
  assert.equal(picked, 'p1');
});

test('a rookie is badged and a veteran is not', () => {
  const rookieContainer = render([player({ experience: 0, prior: null })]);
  assert.equal(find(rookieContainer, (n) => n.className === 'rookie').length, 1);
  const vetContainer = render([player()]);
  assert.equal(find(vetContainer, (n) => n.className === 'rookie').length, 0);
});

test('age renders, and is blank for a defense', () => {
  const container = render([player({ age: 24 }), player({ id: 'd', age: null, position: 'DEF' })]);
  const cells = find(container, (n) => n.className === 'age');
  assert.deepEqual(cells.map((c) => c.textContent), ['24', '']);
});
```

- [ ] **Step 3: Rewrite `playerTable`**

In `src/ui/center.js`, add `import { isRookie } from '../core/player.js';` on its own single line, and replace `playerTable` with:

```js
function playerTable(tablePlayers, onPick) {
  const rows = filterByPosition(sortPlayers(tablePlayers, view.sortKey), view.filter)
    .filter((pl) => matchesQuery(pl, view.query))
    .map((pl) => {
      const taken = pl.ownerName !== null && pl.ownerName !== undefined;
      const name = el('td', { class: 'pname', title: pl.name }, [
        el('span', { text: pl.name }, []),
        isRookie(pl) ? el('span', { class: 'rookie', text: 'R' }, []) : null,
      ]);
      return el('tr', {
        class: taken ? 'taken' : '',
        // Only an available player can be drafted, and only on a double click.
        onDblclick: taken ? null : () => onPick(pl.id),
      }, [
        el('td', { text: String(pl.overallRank) }, []),
        name,
        el('td', { text: pl.position, style: { color: POSITION_COLORS[pl.position] } }, []),
        el('td', { text: pl.team }, []),
        el('td', { class: 'age', text: pl.age === null || pl.age === undefined ? '' : String(pl.age) }, []),
        el('td', { text: String(pl.projectedPoints) }, []),
        el('td', { text: String(Math.round(pl.vbd)) }, []),
        el('td', { text: pl.adp === null ? '—' : String(pl.adp) }, []),
        el('td', { text: pl.bye === null ? '—' : String(pl.bye) }, []),
        el('td', { class: 'owner', text: taken ? pl.ownerName : '' }, []),
      ]);
    });

  const header = (label, key) => el('th', {
    text: view.sortKey === key ? `${label} ▾` : label,
    onClick: key ? () => { view.sortKey = key; rerender(); } : null,
  }, []);

  return el('div', { class: 'tablewrap' }, [
    el('table', { class: 'players' }, [
      el('thead', {}, [el('tr', {}, [
        header('#', 'overallRank'), header('Player', null), header('Pos', 'position'),
        header('Tm', null), header('Age', null), header('Proj', null), header('VBD', 'vbd'),
        header('ADP', 'adp'), header('Bye', null), header('Drafted By', null),
      ])]),
      el('tbody', {}, rows),
    ]),
  ]);
}
```

In `renderCenter`, destructure `tablePlayers` from `ctx` and pass it to `playerTable`. The heading above the table counts what the table shows, so change it to:

```js
  container.appendChild(el('h2', { text: `Players (${pool.length} available)` }, []));
```

Note `el()` skips `null` children and skips `null` attribute values, so the conditional badge and the conditional `onDblclick` both work as written.

- [ ] **Step 4: Verify**

Run: `node --test tests/render-center.test.js` → PASS. Then `npm test` → 0 failures. `draft.html` is stale at this point, so `tests/build.test.js` will fail — that is expected until Task 7 rebuilds. **If it fails only on the build-freshness test, continue; if anything else fails, stop.**

- [ ] **Step 5: Commit**

```bash
git add src/ui/center.js src/styles.css tests/render-center.test.js
git commit -m "feat(center): show every player with age, rookie badge, and owner"
```

---

### Task 6: The control bar and the two popovers

**Files:**
- Modify: `src/ui/center.js`
- Modify: `src/styles.css`
- Test: `tests/render-center.test.js`

**Interfaces:**
- Consumes: `showPopover` from `./popover.js` (Task 4); `priorSummary` from `../core/player.js` (Task 1).
- Produces: no new exports.

- [ ] **Step 1: Add the CSS**

```css
.pop { position: fixed; z-index: 30; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; max-width: 300px; font-size: 12px; box-shadow: 0 6px 20px rgba(0,0,0,0.45); }
.pop h3 { margin: 0 0 6px; font-size: 13px; }
.pop dt { color: var(--accent); font-weight: 600; margin-top: 6px; }
.pop dd { margin: 0; color: var(--muted); }
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/render-center.test.js`:

```js
test('the pick-entry box is gone and the filter is the only text input', () => {
  const container = render([player()]);
  const inputs = find(container, (n) => n.tagName === 'input');
  assert.equal(inputs.length, 1, 'one text input, not two');
  assert.equal(inputs[0].attributes.placeholder, 'Filter by name or team…');
});

test('Undo and Skip survive the removal of the pick box', () => {
  const container = render([player()]);
  const labels = find(container, (n) => n.tagName === 'button').map((b) => b.textContent);
  assert.ok(labels.includes('Undo'));
  assert.ok(labels.includes('Skip / off-list'));
});

test('the clear button empties the filter', () => {
  const container = render([player()]);
  const clearBtn = find(container, (n) => n.tagName === 'button' && n.textContent === '✕')[0];
  assert.ok(clearBtn, 'a clear control exists');
  assert.equal(typeof clearBtn.listeners.click[0], 'function');
});

test('the glossary button is present and opens on click', () => {
  const container = render([player()]);
  const help = find(container, (n) => n.tagName === 'button' && n.textContent === '?')[0];
  assert.ok(help);
  assert.equal(typeof help.listeners.click[0], 'function');
});

test('a player name is clickable for detail', () => {
  const container = render([player()]);
  const nameCell = find(container, (n) => n.className === 'pname')[0];
  assert.equal(typeof nameCell.listeners.click[0], 'function');
});
```

- [ ] **Step 3: Implement**

Delete `pickEntry` entirely. Replace the `pickbar` construction in `renderCenter` with a control bar carrying only Undo and Skip, then a filter row:

```js
  container.appendChild(el('div', { class: 'pickbar' }, [
    el('button', { text: 'Undo', onClick: handlers.onUndo }, []),
    el('button', {
      text: 'Skip / off-list',
      title: 'Someone drafted a player who is not in this list — consume the pick slot',
      onClick: handlers.onOffList,
    }, []),
  ]));
```

The filter row (built where `filters` is built today) becomes the position buttons plus:

```js
    el('input', {
      type: 'text', placeholder: 'Filter by name or team…', value: view.query, autocomplete: 'off',
      onInput: (e) => { view.query = e.target.value; redrawTable(); },
    }, []),
    el('button', { text: '✕', title: 'Clear the filter', onClick: () => { view.query = ''; rerender(); } }, []),
    el('button', { text: '?', title: 'What do these columns mean?', onClick: (e) => showPopover(glossaryPopover(), e) }, []),
```

where `redrawTable()` replaces the `.tablewrap` node in place, mirroring what the current code does with `table.players`.

Add two popover builders:

```js
const GLOSSARY = [
  ['BPA', 'Best player available — the raw overall ranking, ignoring what you already have.'],
  ['VBD', 'Value based drafting — points above the last starter at this position. Compares across positions.'],
  ['ADP', 'Average draft pick — where this player usually goes. Far past it is value; well before it is a reach.'],
  ['Bye', 'The week this player does not play.'],
  ['Need', 'high: no starter yet · medium: a starting slot open · depth: bench only · not needed: slots full.'],
  ['R', 'Rookie — no prior NFL season on record.'],
];

function glossaryPopover() {
  return el('div', { class: 'pop' }, [
    el('h3', { text: 'What the columns mean' }, []),
    el('dl', {}, GLOSSARY.flatMap(([term, meaning]) => [
      el('dt', { text: term }, []),
      el('dd', { text: meaning }, []),
    ])),
  ]);
}

function playerPopover(pl) {
  const prior = priorSummary(pl);
  return el('div', { class: 'pop' }, [
    el('h3', { text: pl.name }, []),
    el('div', { text: `${pl.position} · ${pl.team} · #${pl.overallRank} overall${pl.age === null || pl.age === undefined ? '' : ` · age ${pl.age}`}` }, []),
    el('div', { style: { marginTop: '8px', color: '#8b93a5' }, text: 'Last season' }, []),
    // A rookie has no prior line, and saying so is better than printing zeroes.
    el('div', { text: prior || (isRookie(pl) ? 'Rookie — no NFL season yet' : 'No prior season on record') }, []),
  ]);
}
```

Wire the name cell: add `onClick: (e) => { e.stopPropagation(); showPopover(playerPopover(pl), e); }` to the `pname` `td` built in Task 5.

- [ ] **Step 4: Verify**

Run: `npm test`. Everything except the build-freshness test must pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/center.js src/styles.css tests/render-center.test.js
git commit -m "feat(center): filter-first control bar, glossary, and player detail"
```

---

### Task 7: Wire it up and rebuild

**Files:**
- Modify: `src/ui/app.js`
- Modify: `draft.html` (rebuilt, never hand-edited)

- [ ] **Step 1: Build `tablePlayers` and pass it**

In `src/ui/app.js`, add `playersWithOwners` to the existing single-line import from `../core/state.js`. In `renderDraft`, after the existing `pool` line:

```js
  // Every player, drafted or not, for the table. `pool` stays available-only so the
  // recommendation path structurally cannot see a drafted player.
  const tablePlayers = withVbd(playersWithOwners(state, allPlayers), replacement);
```

Add `tablePlayers,` to the object passed to `renderCenter`.

- [ ] **Step 2: Verify, rebuild, verify again**

```bash
npm test          # build-freshness test still failing — expected
npm run build
npm test          # now fully green
```

If anything other than the build-freshness test failed before the build, stop and report.

- [ ] **Step 3: Confirm the bundle carries the change**

```bash
node -e '
const html = require("fs").readFileSync("draft.html", "utf8");
for (const [label, needle] of [
  ["isRookie", "function isRookie"],
  ["priorSummary", "function priorSummary"],
  ["playersWithOwners", "function playersWithOwners"],
  ["matchesQuery", "function matchesQuery"],
  ["showPopover", "function showPopover"],
  ["Drafted By column", "Drafted By"],
  ["filter placeholder", "Filter by name or team"],
  ["glossary", "Best player available"],
  ["rookie CSS", ".rookie"],
  ["tablewrap CSS", ".tablewrap"],
]) console.log(label + ":", html.includes(needle));
console.log("pickEntry gone:", !html.includes("Type a player name"));
console.log("searchPlayers gone:", !html.includes("function searchPlayers"));
console.log("no leftover module syntax:", !/^\s*(import|export)\s/m.test(html));
'
```

Expected: every line `true`.

- [ ] **Step 4: Commit**

```bash
git add src/ui/app.js draft.html
git commit -m "feat(center): wire the full player table into the app"
```

---

## Verification

Chunk C is done when:

- `npm test` passes with more tests than the 159 this chunk started from.
- `data/players.json` is untouched by the chunk.
- The bundle check in Task 7 Step 3 prints `true` on every line.
- Opening `draft.html` and drafting a few players shows: one filter box (no pick-entry box), drafted players still listed but greyed with the drafting team in the last column, an `R` beside rookies, an `Age` column, a working `✕` and `?`, and a detail popover on clicking a name.
