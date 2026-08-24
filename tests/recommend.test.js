import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NEED_MULTIPLIER, maxPositiveVbd, scorePlayer, reasonsFor, recommend,
} from '../src/core/recommend.js';
import { replacementPoints, withVbd } from '../src/core/vbd.js';
import { DEFAULT_SLOTS, positionalNeeds, benchDepthIfAdded, assignSlots, countByPosition } from '../src/core/roster.js';
import { DEFAULT_CONFIG, createState, currentPickNumber, applyPick, availablePlayers, rosterFor } from '../src/core/state.js';
import { pickToSlot } from '../src/core/snake.js';

const p = (over) => ({
  id: over.id, name: over.id, team: 'XX',
  position: over.position, overallRank: over.overallRank,
  positionRank: over.positionRank ?? 1,
  projectedPoints: over.projectedPoints ?? 200,
  vbd: over.vbd ?? 50, adp: over.adp ?? null, bye: over.bye ?? null,
});

const allLow = { QB: 'low', RB: 'low', WR: 'low', TE: 'low', K: 'low', DEF: 'low' };

// A realistic board: 400 ranked players spread over six positions, with VBD
// decaying with rank the way real projections do. Two-player fixtures cannot test
// the need multiplier at all — poolSize collapses to the top rank, which inflates
// the BPA term far beyond anything a real pool produces.
function syntheticPool() {
  const shape = { QB: [1, 40, 60], RB: [2, 120, 130], WR: [3, 140, 120], TE: [4, 50, 70], K: [5, 25, 8], DEF: [6, 25, 10] };
  const players = [];
  for (const [position, [offset, count, topVbd]] of Object.entries(shape)) {
    for (let i = 0; i < count; i += 1) {
      players.push(p({
        id: `${position}${i + 1}`,
        position,
        // Interleave positions so ranks are not blocked by position.
        overallRank: offset + i * 6,
        projectedPoints: 300 - i * 2,
        vbd: Math.round((topVbd - (i / count) * topVbd * 2) * 10) / 10,
      }));
    }
  }
  return players.sort((a, b) => a.overallRank - b.overallRank);
}

function realPool() {
  const players = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url)));
  return withVbd(players, replacementPoints(players, 10, DEFAULT_SLOTS));
}

test('a better rank scores higher when need and VBD are equal', () => {
  const ctx = { poolSize: 100, vbdScale: 100, needs: allLow };
  const good = scorePlayer(p({ id: 'a', position: 'RB', overallRank: 1 }), ctx);
  const worse = scorePlayer(p({ id: 'b', position: 'RB', overallRank: 50 }), ctx);
  assert.ok(good > worse);
});

test('a high-need multiplier beats a low-need one at equal value', () => {
  const base = { poolSize: 100, vbdScale: 100 };
  const player = p({ id: 'a', position: 'RB', overallRank: 10 });
  const high = scorePlayer(player, { ...base, needs: { ...allLow, RB: 'high' } });
  const low = scorePlayer(player, { ...base, needs: allLow });
  assert.ok(high > low);
  assert.equal(Math.round((high / low) * 100) / 100, NEED_MULTIPLIER.high);
});

test('scores never go negative even at the bottom of the pool', () => {
  const ctx = { poolSize: 100, vbdScale: 100, needs: allLow };
  const score = scorePlayer(p({ id: 'z', position: 'K', overallRank: 100, vbd: -100 }), ctx);
  assert.ok(score >= 0, `expected a non-negative score, got ${score}`);
});

test('maxPositiveVbd ignores below-replacement outliers', () => {
  const pool = [p({ id: 'a', position: 'RB', vbd: 40, overallRank: 1 }),
    p({ id: 'b', position: 'QB', vbd: -288.3, overallRank: 2 })];
  assert.equal(maxPositiveVbd(pool), 40);
});

test('maxPositiveVbd falls back to 1 when nothing is above replacement', () => {
  const pool = [p({ id: 'a', position: 'K', vbd: -5, overallRank: 1 })];
  assert.equal(maxPositiveVbd(pool), 1, 'never divides by zero');
});

test('a zero-projection outlier does not set the VBD scale for the whole engine', () => {
  const pool = syntheticPool();
  const junk = p({ id: 'zero-qb', position: 'QB', overallRank: 400, projectedPoints: 0, vbd: -288.3 });
  const ctx = { needs: allLow, currentPick: 20, nextPick: 21, round: 2 };
  const clean = recommend(pool, ctx, 3).map((r) => r.player.id);
  const polluted = recommend([...pool, junk], ctx, 3).map((r) => r.player.id);
  assert.deepEqual(polluted, clean, 'one garbage row must not move the recommendations');
});

test('need does not let a marginal player leapfrog a far better one', () => {
  // Realistic 400-player board, mid-draft: the top 43 are gone, TE is the open slot.
  const pool = realPool().filter((pl) => pl.overallRank > 43);
  const needs = { QB: 'low', RB: 'low', WR: 'low', TE: 'high', K: 'none', DEF: 'none' };
  const ctx = {
    needs, currentPick: 44, nextPick: 57, round: 5, vbdScale: maxPositiveVbd(realPool()),
  };
  const top = recommend(pool, ctx, 3);

  const bestWr = pool.filter((pl) => pl.position === 'WR')
    .sort((a, b) => a.overallRank - b.overallRank)[0];
  for (const rec of top) {
    assert.ok(
      rec.player.overallRank <= bestWr.overallRank + 15,
      `${rec.player.name} (#${rec.player.overallRank}) is far below the best available `
      + `player at #${bestWr.overallRank} — need is a tiebreaker, not an override`,
    );
  }
  assert.ok(
    new Set(top.map((r) => r.player.position)).size > 1,
    `need swept the board: ${top.map((r) => `${r.player.name} ${r.player.position}`).join(', ')}`,
  );
});

test('a high need never outweighs a clearly better player at the same board state', () => {
  const pool = realPool().filter((pl) => pl.overallRank > 43);
  const scale = maxPositiveVbd(realPool());
  const base = { QB: 'low', RB: 'low', WR: 'low', TE: 'low', K: 'none', DEF: 'none' };

  // Every position in turn is made a high need; the top pick must never fall more
  // than a round's worth of ranks behind the best player on the board.
  const bestRank = Math.min(...pool.map((pl) => pl.overallRank));
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const ctx = {
      needs: { ...base, [pos]: 'high' }, currentPick: 44, nextPick: 57, round: 5, vbdScale: scale,
    };
    const [top] = recommend(pool, ctx, 1);
    assert.ok(
      top.player.overallRank - bestRank <= 20,
      `${pos} high need pulled #${top.player.overallRank} over #${bestRank}`,
    );
  }
});

test('need breaks the tie when two players are close in value', () => {
  const pool = syntheticPool();
  const ctx = { needs: allLow, currentPick: 30, nextPick: 43, round: 3, vbdScale: maxPositiveVbd(syntheticPool()) };
  const [neutral] = recommend(pool, ctx, 1);

  // The runner-up sits within a couple of ranks and a couple of VBD points of the
  // leader — a genuine near-tie. Making its position a need must flip the order.
  const ranked = recommend(pool, ctx, 5);
  const rival = ranked.find((r) => r.player.position !== neutral.player.position);
  assert.ok(rival, 'fixture must offer a rival at another position');
  assert.ok(
    Math.abs(rival.player.overallRank - neutral.player.overallRank) <= 6,
    'fixture must be a genuine near-tie',
  );

  const [withNeed] = recommend(pool, {
    ...ctx, needs: { ...allLow, [rival.player.position]: 'high' },
  }, 1);
  assert.equal(withNeed.player.id, rival.player.id,
    'a near-tie must resolve toward the position that fills a need');
});

test('recommend returns at most the requested number, best first', () => {
  const ctx = { needs: allLow, currentPick: 4, nextPick: 17, round: 1 };
  const pool = Array.from({ length: 10 }, (_, i) =>
    p({ id: `p${i}`, position: 'RB', overallRank: i + 1, vbd: 100 - i * 5 }));
  const out = recommend(pool, ctx, 3);
  assert.equal(out.length, 3);
  assert.ok(out[0].score >= out[1].score && out[1].score >= out[2].score);
  assert.equal(out[0].need, 'low');
  assert.ok(Array.isArray(out[0].reasons));
});

test('recommend on an empty pool returns an empty array', () => {
  assert.deepEqual(recommend([], { needs: allLow, currentPick: 1, nextPick: 2, round: 1 }), []);
});

test('reasonsFor flags a positional cliff', () => {
  const ctx = { needs: allLow, currentPick: 10, nextPick: 11, round: 1 };
  const target = p({ id: 'a', position: 'RB', overallRank: 1, projectedPoints: 280, vbd: 100 });
  const pool = [target, p({ id: 'b', position: 'RB', overallRank: 2, projectedPoints: 200, vbd: 20 })];
  const reasons = reasonsFor(target, pool, ctx);
  assert.ok(reasons.some((r) => /drop-off/i.test(r)), reasons.join(' | '));
  assert.ok(reasons.some((r) => /80/.test(r)), 'names the size of the gap');
});

test('reasonsFor states which need is filled', () => {
  const ctx = { needs: { ...allLow, RB: 'high' }, currentPick: 4, nextPick: 17, round: 1 };
  const target = p({ id: 'a', position: 'RB', overallRank: 1, vbd: 100 });
  const reasons = reasonsFor(target, [target], ctx);
  assert.ok(reasons.some((r) => /high need/i.test(r)), reasons.join(' | '));
});

test('reasonsFor calls out a player falling past his ADP, rounded', () => {
  const ctx = { needs: allLow, currentPick: 40, nextPick: 41, round: 4 };
  const target = p({ id: 'a', position: 'WR', overallRank: 20, adp: 22.4, vbd: 60 });
  const reasons = reasonsFor(target, [target], ctx);
  const line = reasons.find((r) => /past his ADP/i.test(r));
  assert.ok(line, reasons.join(' | '));
  assert.match(line, /ADP of 22\b/);
  assert.doesNotMatch(line, /22\.4/, 'ADP is rounded for display');
});

test('reasonsFor warns when a pick is well ahead of ADP, rounded', () => {
  const ctx = { needs: allLow, currentPick: 10, nextPick: 11, round: 1 };
  const target = p({ id: 'a', position: 'WR', overallRank: 40, adp: 55.4, vbd: 10 });
  const reasons = reasonsFor(target, [target], ctx);
  const line = reasons.find((r) => /reach/i.test(r));
  assert.ok(line, reasons.join(' | '));
  assert.match(line, /ADP is 55\b/);
  assert.doesNotMatch(line, /55\.4/, 'ADP is rounded for display');
});

test('reasonsFor signs a below-replacement VBD correctly', () => {
  const ctx = { needs: allLow, currentPick: 140, nextPick: 141, round: 14 };
  const target = p({ id: 'a', position: 'K', overallRank: 300, projectedPoints: 90, vbd: -37 });
  const [line] = reasonsFor(target, [target], ctx);
  assert.match(line, /\(-37 over replacement\)/);
  assert.doesNotMatch(line, /\+-/);
});

test('reasonsFor caps output at two lines', () => {
  const ctx = { needs: { ...allLow, RB: 'high' }, currentPick: 40, nextPick: 41, round: 4 };
  const target = p({ id: 'a', position: 'RB', overallRank: 1, projectedPoints: 280, adp: 50, vbd: 120 });
  const pool = [target, p({ id: 'b', position: 'RB', overallRank: 2, projectedPoints: 150, vbd: 5 })];
  assert.ok(reasonsFor(target, pool, ctx).length <= 2);
});

// Regression: found by running a full practice draft in the browser. When rival
// teams draft strictly by overall rank, quarterbacks fall far past their VBD-implied
// value and pile up in the pool. Before the 'bench' tier existed, a filled position
// still scored at multiplier 1.0, so the engine recommended a sixth QB — one who can
// never enter the lineup — over an unfilled starting WR, and finished the draft with
// WR1 and WR2 empty.
test('following the top recommendation fills every starting slot, even when rivals draft pure BPA', () => {
  const players = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url)));
  const replacement = replacementPoints(players, 10, DEFAULT_SLOTS);
  const vbdScale = maxPositiveVbd(withVbd(players, replacement));

  let state = createState({ ...DEFAULT_CONFIG, myTeamIndex: 4 });
  while (currentPickNumber(state) !== null) {
    const pick = currentPickNumber(state);
    const { round, teamIndex } = pickToSlot(pick, 10);
    const available = availablePlayers(state, players);

    let chosen;
    if (teamIndex === 4) {
      const pool = withVbd(available, replacement);
      const mine = rosterFor(state, 4, players);
      const needs = positionalNeeds(mine, DEFAULT_SLOTS, round, 15);
      const surplus = benchDepthIfAdded(mine, DEFAULT_SLOTS);
      chosen = recommend(pool, { needs, surplus, currentPick: pick, nextPick: pick + 1, round, vbdScale }, 1)[0].player;
    } else {
      chosen = available.reduce((best, x) => (x.overallRank < best.overallRank ? x : best));
    }
    state = applyPick(state, chosen.id);
  }

  const finalRoster = rosterFor(state, 4, players);
  const unfilled = assignSlots(finalRoster, DEFAULT_SLOTS)
    .filter((slot) => !slot.label.startsWith('BN') && slot.player === null)
    .map((slot) => slot.label);

  assert.deepEqual(unfilled, [], `starting slots left empty: ${unfilled.join(', ')}`);

  const counts = countByPosition(finalRoster);
  assert.ok(counts.QB <= 3, `hoarded ${counts.QB} QBs for one starting slot`);
  assert.ok(counts.WR >= 2, `only ${counts.WR} WRs for two starting slots`);

  // A backup kicker or defense can never play — you stream them off waivers.
  assert.equal(counts.K, 1, `drafted ${counts.K} kickers`);
  assert.equal(counts.DEF, 1, `drafted ${counts.DEF} defenses`);

  // And the bench should carry at least some cover for the five RB/WR/FLEX slots.
  const benchDepth = assignSlots(finalRoster, DEFAULT_SLOTS)
    .filter((s2) => s2.label.startsWith('BN') && s2.player)
    .filter((s2) => s2.player.position === 'RB' || s2.player.position === 'WR').length;
  assert.ok(benchDepth >= 1, 'no RB/WR cover on the bench for five starting slots');
});

// Companion to the test above, with rivals drafting in ADP order — how real drafters
// actually behave, and the model that exposed the bench problem. Before bench depth
// decayed, this finished with four tight ends and two QBs backing up two starting
// slots, and zero cover for the five RB/WR/FLEX slots that carry a lineup.
test('bench cover is spread across the positions that actually start, vs ADP rivals', () => {
  const players = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url)));
  const replacement = replacementPoints(players, 10, DEFAULT_SLOTS);
  const vbdScale = maxPositiveVbd(withVbd(players, replacement));

  let state = createState({ ...DEFAULT_CONFIG, myTeamIndex: 4 });
  while (currentPickNumber(state) !== null) {
    const pick = currentPickNumber(state);
    const { round, teamIndex } = pickToSlot(pick, 10);
    const available = availablePlayers(state, players);

    let chosen;
    if (teamIndex === 4) {
      const mine = rosterFor(state, 4, players);
      const needs = positionalNeeds(mine, DEFAULT_SLOTS, round, 15);
      const surplus = benchDepthIfAdded(mine, DEFAULT_SLOTS);
      const pool = withVbd(available, replacement);
      chosen = recommend(pool, { needs, surplus, currentPick: pick, nextPick: pick + 1, round, vbdScale }, 1)[0].player;
    } else {
      chosen = [...available].sort((a, b) => (a.adp ?? 999) - (b.adp ?? 999) || a.overallRank - b.overallRank)[0];
    }
    state = applyPick(state, chosen.id);
  }

  const finalRoster = rosterFor(state, 4, players);
  const slots = assignSlots(finalRoster, DEFAULT_SLOTS);
  const counts = countByPosition(finalRoster);

  const unfilled = slots.filter((s2) => !s2.label.startsWith('BN') && !s2.player).map((s2) => s2.label);
  assert.deepEqual(unfilled, [], `starting slots left empty: ${unfilled.join(', ')}`);

  assert.equal(counts.K, 1, `drafted ${counts.K} kickers — a backup kicker can never play`);
  assert.equal(counts.DEF, 1, `drafted ${counts.DEF} defenses`);

  const bench = slots.filter((s2) => s2.label.startsWith('BN') && s2.player).map((s2) => s2.player);
  const cover = bench.filter((b) => b.position === 'RB' || b.position === 'WR').length;
  assert.ok(cover >= 1, `bench has no RB/WR cover for five starting slots: ${bench.map((b) => b.position).join(',')}`);

  const mostAtOnePosition = Math.max(...Object.values(bench.reduce((m, b) => {
    m[b.position] = (m[b.position] || 0) + 1; return m;
  }, {})));
  assert.ok(mostAtOnePosition <= 3, `bench stacked ${mostAtOnePosition} deep at one position`);
});
