import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A string test, and a weak one — nothing here has a layout engine, so no test in this
// repo can see a printed page. It exists for one regression only: the app is dark-on-dark
// and prints as a black rectangle without this block. That failure is silent, invisible to
// every other test, and only ever discovered by a person holding the paper.
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function printBlock() {
  const at = css.indexOf('@media print');
  assert.notEqual(at, -1, 'there is a print stylesheet at all');
  // Brace-count to the matching close, so a later @media block cannot be read as part
  // of this one.
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced braces in the print block');
}

test('printing flips the page to ink on white', () => {
  const block = printBlock();
  assert.match(block, /--bg:\s*#fff/, 'the ground is white, not the dark theme');
  assert.match(block, /--text:\s*#000/, 'and the text is black');
});

test('the print sheet redefines the tokens the dark theme sets', () => {
  // VALUES, not presence. An earlier version of this test only checked that each token
  // appeared, and leaving --muted at the dark theme's #8b93a5 passed the whole suite —
  // the exact failure class this file exists to catch. --muted is the one that matters
  // most: it paints every section heading, .rep-note, .rep-label, .sum-head and the
  // freshness line, and unlike a background it is never suppressed by the browser's
  // background-graphics default. It always prints, so it is always visible on paper.
  const block = printBlock();
  const dark = {
    '--bg': '#0f1116',
    '--panel': '#181b23',
    '--panel-2': '#1f232d',
    '--border': '#2a2f3a',
    '--text': '#e6e8ed',
    '--muted': '#8b93a5',
    '--accent': '#fbbf24',
  };
  for (const [token, screenValue] of Object.entries(dark)) {
    const declared = block.match(new RegExp(`${token}:\\s*([^;]+);`));
    assert.ok(declared, `${token} is given a print value`);
    assert.notEqual(declared[1].trim().toLowerCase(), screenValue,
      `${token} is not left at its screen value`);
  }
});

test('your own team is still marked on paper', () => {
  // The only mark on the page saying which of twelve teams belongs to the reader.
  // It must not be a box-shadow: browsers print with background graphics off by
  // default and drop shadows along with backgrounds. Borders always print.
  const block = printBlock();
  const rule = block.match(/\.sum-row\.mine\s*\{[^}]*\}/);
  assert.ok(rule, 'the row is given print treatment at all');
  assert.match(rule[0], /border-left:/, 'a border, which prints');
  assert.doesNotMatch(rule[0], /box-shadow/, 'not a shadow, which does not');
});

test('a screen that was never designed for print is at least not truncated', () => {
  // Ctrl+P works everywhere and someone will press it on the draft board. Panels are
  // overflow:auto inside a 100vh grid, so without this it prints one page and silently
  // loses everything below each fold.
  const block = printBlock();
  assert.match(block, /\.layout\s*\{[^}]*height:\s*auto/);
  assert.match(block, /overflow:\s*visible/);
  assert.match(block, /position:\s*static/, 'and sticky headers stop being sticky');
});

test('controls are not printed', () => {
  const block = printBlock();
  assert.match(block, /\.sum-title button/, 'the header buttons go');
  assert.match(block, /\.rep-back/, 'and the one at the foot of the report');
});

test('a team block is not split across a page', () => {
  // A bye-week clash that lands on the next page reads as the following team's.
  const block = printBlock();
  assert.match(block, /\.rep-team[^{]*\{[^}]*break-inside:\s*avoid/);
  assert.match(block, /page-break-inside:\s*avoid/, 'and the legacy property, for older engines');
});

test('the printed page is not held to the 620px reading column', () => {
  assert.match(printBlock(), /\.summary\s*\{[^}]*max-width:\s*none/);
});

test('the board prints whole names, not the screen\'s ellipsis', () => {
  // On screen a truncated cell is a hover away from its full name and the row has to
  // stay one line tall so fifteen rounds fit. On paper there is no hover and nothing
  // to scroll, so ellipsis is permanent data loss in an export.
  const rule = printBlock().match(/table\.board td\s*\{[^}]*\}/);
  assert.ok(rule, 'board cells are given print treatment');
  assert.match(rule[0], /white-space:\s*normal/, 'names wrap');
  assert.match(rule[0], /overflow:\s*visible/, 'and are not clipped');
  assert.match(rule[0], /overflow-wrap:\s*break-word/,
    'and a name wider than its column breaks rather than painting over the next team');
});

test('the board prints in ink, not in position colours', () => {
  // board.js sets the position colour as an INLINE style on every filled cell, and an
  // inline style outranks any rule without !important. Without it the printed board is
  // 10px text in #22c55e and #9ca3af — about half-tone grey on a mono printer, and the
  // colour ink this whole sheet exists to avoid on a colour one.
  const rule = printBlock().match(/table\.board td\s*\{[^}]*\}/);
  assert.match(rule[0], /color:\s*#000\s*!important/,
    'the one place here that needs !important, because it is fighting an inline style');
});

test('the four-hundred-row player table is not printed', () => {
  // Ten pages of noise, and the one panel with nothing to say once the draft is over.
  assert.match(printBlock(), /\.panel\.center\s*\{[^}]*display:\s*none/);
});

test('your own column is still marked on the printed board', () => {
  const rule = printBlock().match(/table\.board td\.mine-col\s*\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /border-left:/, 'a border, which prints');
  assert.match(rule[0], /background:\s*none/, 'not the screen fill, which does not');
});

test('the board starts its own page, not wherever the roster ended', () => {
  // The roster and the board are two different documents on paper. Left to flow, the
  // board began at whatever height the roster happened to finish at, which orphaned
  // the first rounds at the foot of page one and split the table at an arbitrary row.
  // Deliberately break-BEFORE the board rather than break-inside: avoid on the roster:
  // a block taller than a page that refuses to break gets pushed to a fresh page and
  // then breaks anyway, wasting the sheet it was pushed off.
  const rule = printBlock().match(/\.panel\.right\s*\{[^}]*\}/);
  assert.ok(rule, 'the board panel is given a page of its own');
  assert.match(rule[0], /break-before:\s*page/);
  assert.match(rule[0], /page-break-before:\s*always/, 'and the legacy property, for older engines');
});
