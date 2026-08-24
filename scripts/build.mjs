#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

// Resolve './x.js' or '../ui/x.js' relative to the importing module's key.
function resolveKey(fromKey, spec) {
  const base = posix.dirname(fromKey);
  return posix.normalize(posix.join(base, spec)).replace(/^\.\//, '');
}

export function transformModule(source, moduleKey) {
  let out = source;

  // import { a, b } from './x.js';  ->  const { a, b } = __req('x.js');
  out = out.replace(
    /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, names, spec) => `const {${names}} = __req('${resolveKey(moduleKey, spec)}');`,
  );

  const exported = [];
  out = out.replace(
    /^export\s+(function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm,
    (_m, kind, name) => {
      exported.push(name);
      return `${kind} ${name}`;
    },
  );

  if (exported.length) {
    out += `\n${exported.map((n) => `__exports.${n} = ${n};`).join('\n')}\n`;
  }

  return out;
}

function listModules(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listModules(full));
    else if (entry.endsWith('.js')) files.push(full);
  }
  return files;
}

export function bundle({ srcDir, entry, players, css, html }) {
  const modules = listModules(srcDir).map((file) => {
    const key = relative(srcDir, file).split(/[\\/]/).join('/');
    return { key, code: transformModule(readFileSync(file, 'utf8'), key) };
  });

  // Lazy registry: definition order does not matter, __req resolves on first use.
  const registry = [
    '(function () {',
    '"use strict";',
    'const __mods = {};',
    'const __cache = {};',
    'function __def(key, fn) { __mods[key] = fn; }',
    'function __req(key) {',
    '  if (__cache[key]) return __cache[key];',
    '  const fn = __mods[key];',
    '  if (!fn) throw new Error("Unknown module: " + key);',
    '  const __exports = {};',
    '  __cache[key] = __exports;',
    '  fn(__exports, __req);',
    '  return __exports;',
    '}',
    ...modules.map(
      ({ key, code }) =>
        `__def(${JSON.stringify(key)}, function (__exports, __req) {\n${code}\n});`,
    ),
    `__req(${JSON.stringify(entry)});`,
    '})();',
  ].join('\n');

  const dataScript = `window.PLAYERS = ${JSON.stringify(players)};`;

  // Function replacements, not strings: a string replacement would treat $&, $`, $'
  // and $n inside a player name or CSS rule as substitution patterns.
  return html
    .replace('/*<!--STYLES-->*/', () => css)
    .replace('/*<!--DATA-->*/', () => dataScript)
    .replace('/*<!--SCRIPT-->*/', () => registry);
}

function main() {
  const players = JSON.parse(readFileSync(join(ROOT, 'data', 'players.json'), 'utf8'));
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
  const html = readFileSync(join(SRC, 'index.html'), 'utf8');

  const out = bundle({ srcDir: SRC, entry: 'ui/app.js', players, css, html });
  writeFileSync(join(ROOT, 'draft.html'), out);
  console.log(`Wrote draft.html (${(out.length / 1024).toFixed(0)} KB, ${players.length} players)`);
}

// fileURLToPath, not a `file://` template: the latter mismatches on any path
// containing a space or a non-ASCII character, and the build would exit 0 having
// written nothing.
if (fileURLToPath(import.meta.url) === process.argv[1]) main();
