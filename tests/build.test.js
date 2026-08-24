import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
