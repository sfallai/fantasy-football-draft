import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { transformModule, bundle } from '../scripts/build.mjs';

test('transformModule rewrites a named import into a registry lookup', () => {
  const out = transformModule("import { pickToSlot, slotToPick } from './snake.js';\n", 'core/app.js');
  assert.match(out, /const \{ pickToSlot, slotToPick \} = __req\('core\/snake\.js'\)/);
  assert.doesNotMatch(out, /^import /m);
});

test('transformModule resolves parent-relative imports', () => {
  const out = transformModule("import { el } from '../ui/dom.js';\n", 'core/app.js');
  assert.match(out, /__req\('ui\/dom\.js'\)/);
});

test('transformModule converts exported functions, consts, and classes', () => {
  const out = transformModule(
    'export function go() { return 1; }\nexport const X = 2;\nexport class Y {}\n',
    'core/a.js',
  );
  assert.match(out, /^function go\(\)/m);
  assert.match(out, /^const X = 2;/m);
  assert.match(out, /^class Y \{\}/m);
  assert.match(out, /__exports\.go = go/);
  assert.match(out, /__exports\.X = X/);
  assert.match(out, /__exports\.Y = Y/);
  assert.doesNotMatch(out, /^export /m);
});

test('transformModule leaves non-export code alone', () => {
  const out = transformModule('const hidden = 5;\nfunction helper() {}\n', 'core/a.js');
  assert.match(out, /const hidden = 5;/);
  assert.doesNotMatch(out, /__exports\.hidden/);
});

test('bundle inlines $ substitution patterns literally', () => {
  // String replacements treat $&, $`, $' and $n as substitution patterns, so a
  // player name or CSS rule containing one would silently corrupt the bundle.
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));
  const out = bundle({
    srcDir,
    entry: 'ui/app.js',
    players: [{ id: '1', name: "Ja'$&Marr $` $' $1 Chase" }],
    css: '.a::after { content: "$&$`"; }',
    html: 'X/*<!--STYLES-->*/Y/*<!--DATA-->*/Z/*<!--SCRIPT-->*/W',
  });
  assert.ok(out.includes('.a::after { content: "$&$`"; }'), 'CSS survives verbatim');
  assert.ok(out.includes("Ja'$&Marr $` $' $1 Chase"), 'player data survives verbatim');
});

test('bundle inlines the fetched-at stamp beside the player data', () => {
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));
  const out = bundle({
    srcDir, entry: 'ui/app.js', players: [{ id: '1', name: 'A' }],
    css: '', html: 'X/*<!--STYLES-->*/Y/*<!--DATA-->*/Z/*<!--SCRIPT-->*/W',
    fetchedAt: '2026-08-30T11:00:00.000Z',
  });
  assert.ok(out.includes('window.DATA_FETCHED_AT = "2026-08-30T11:00:00.000Z";'));
});

test('bundle omits the stamp rather than writing undefined', () => {
  // A fresh clone has no data/fetched-at.json. The page must still build.
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));
  const out = bundle({
    srcDir, entry: 'ui/app.js', players: [{ id: '1', name: 'A' }],
    css: '', html: 'X/*<!--STYLES-->*/Y/*<!--DATA-->*/Z/*<!--SCRIPT-->*/W',
  });
  assert.ok(out.includes('window.DATA_FETCHED_AT = null;'));
  // Scoped to the stamp assignment, not the whole bundle: real src/ legitimately
  // contains `=== undefined` checks (dom.js, player.js, ...) that a bundle-wide
  // /undefined/ regex would trip on regardless of this feature — do not widen this
  // back to matching the whole bundle.
  assert.doesNotMatch(out, /DATA_FETCHED_AT = undefined/,
    'a missing default would inline the literal `undefined` here');
});

test('built draft.html is self-contained and has no module syntax left', () => {
  const path = new URL('../draft.html', import.meta.url);
  assert.ok(existsSync(path), 'run `node scripts/build.mjs` first');
  const html = readFileSync(path, 'utf8');

  assert.doesNotMatch(html, /<script[^>]+src=/i, 'no external scripts');
  assert.doesNotMatch(html, /<link[^>]+href=/i, 'no external stylesheets');
  assert.doesNotMatch(html, /\bfetch\s*\(/, 'no network access at runtime');
  assert.doesNotMatch(html, /^\s*import\s+\{/m, 'all imports were rewritten');
  assert.doesNotMatch(html, /^\s*export\s+(function|const|class)/m, 'all exports were rewritten');

  assert.match(html, /__PLAYERS__|window\.PLAYERS/, 'player data is inlined');
  assert.ok(html.length > 50_000, `expected a substantial bundle, got ${html.length} bytes`);
});

test('draft.html was rebuilt from the committed data/players.json', () => {
  const html = readFileSync(new URL('../draft.html', import.meta.url), 'utf8');
  const players = readFileSync(new URL('../data/players.json', import.meta.url), 'utf8');
  assert.ok(
    html.includes(`window.PLAYERS = ${JSON.stringify(JSON.parse(players))};`),
    'draft.html does not match data/players.json — run `node scripts/build.mjs`',
  );
});

test('draft.html matches a fresh build of the committed src/ — run `node scripts/build.mjs`', () => {
  // Mirrors how scripts/build.mjs's own main() assembles its inputs, so a src/
  // change with no rebuild fails this test instead of shipping a stale artifact.
  const root = fileURLToPath(new URL('..', import.meta.url));
  const srcDir = join(root, 'src');
  const players = JSON.parse(readFileSync(join(root, 'data', 'players.json'), 'utf8'));
  const css = readFileSync(join(srcDir, 'styles.css'), 'utf8');
  const html = readFileSync(join(srcDir, 'index.html'), 'utf8');

  // A fresh clone has never fetched. Build anyway; the page simply omits the line.
  let fetchedAt = null;
  const stampPath = join(root, 'data', 'fetched-at.json');
  if (existsSync(stampPath)) fetchedAt = JSON.parse(readFileSync(stampPath, 'utf8')).fetchedAt;

  const rebuilt = bundle({ srcDir, entry: 'ui/app.js', players, css, html, fetchedAt });
  const committed = readFileSync(join(root, 'draft.html'), 'utf8');

  assert.equal(rebuilt, committed, 'draft.html does not match src/ — run `node scripts/build.mjs`');
});

test('the repository root redirects to the built page', () => {
  // GitHub Pages serves a directory; without this the shared URL ends /draft.html.
  const root = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(root, /url=draft\.html/);
  assert.match(root, /<a href="draft\.html"/, 'and a link, for anyone the redirect fails for');
});
