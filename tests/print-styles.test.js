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
  // Every one of these paints a large area or a lot of glyphs. Leaving any at its dark
  // value puts a slab of ink on the page.
  const block = printBlock();
  for (const token of ['--bg', '--panel', '--panel-2', '--text', '--muted', '--accent']) {
    assert.match(block, new RegExp(`${token}:`), `${token} is given a print value`);
  }
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
