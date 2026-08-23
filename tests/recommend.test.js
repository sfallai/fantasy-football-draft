import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEED_MULTIPLIER, scorePlayer, reasonsFor, recommend,
} from '../src/core/recommend.js';

const p = (over) => ({
  id: over.id, name: over.id, team: 'XX',
  position: over.position, overallRank: over.overallRank,
  positionRank: over.positionRank ?? 1,
  projectedPoints: over.projectedPoints ?? 200,
  vbd: over.vbd ?? 50, adp: over.adp ?? null, bye: over.bye ?? null,
});

const allLow = { QB: 'low', RB: 'low', WR: 'low', TE: 'low', K: 'low', DEF: 'low' };

test('a better rank scores higher when need and VBD are equal', () => {
  const ctx = { poolSize: 100, maxAbsVbd: 100, needs: allLow };
  const good = scorePlayer(p({ id: 'a', position: 'RB', overallRank: 1 }), ctx);
  const worse = scorePlayer(p({ id: 'b', position: 'RB', overallRank: 50 }), ctx);
  assert.ok(good > worse);
});

test('a high-need multiplier beats a low-need one at equal value', () => {
  const base = { poolSize: 100, maxAbsVbd: 100 };
  const player = p({ id: 'a', position: 'RB', overallRank: 10 });
  const high = scorePlayer(player, { ...base, needs: { ...allLow, RB: 'high' } });
  const low = scorePlayer(player, { ...base, needs: allLow });
  assert.ok(high > low);
  assert.equal(Math.round((high / low) * 100) / 100, NEED_MULTIPLIER.high);
});

test('scores never go negative even at the bottom of the pool', () => {
  const ctx = { poolSize: 100, maxAbsVbd: 100, needs: allLow };
  const score = scorePlayer(p({ id: 'z', position: 'K', overallRank: 100, vbd: -100 }), ctx);
  assert.ok(score >= 0, `expected a non-negative score, got ${score}`);
});

test('need does not let a marginal player leapfrog a far better one', () => {
  const ctx = { needs: { ...allLow, TE: 'high' }, currentPick: 4, nextPick: 17, round: 1 };
  const pool = [
    p({ id: 'elite-rb', position: 'RB', overallRank: 1, vbd: 120 }),
    p({ id: 'weak-te', position: 'TE', overallRank: 60, vbd: 5 }),
  ];
  const [top] = recommend(pool, ctx);
  assert.equal(top.player.id, 'elite-rb', 'need is a tiebreaker, not an override');
});

test('need breaks the tie when two players are close in value', () => {
  const ctx = { needs: { ...allLow, WR: 'high' }, currentPick: 4, nextPick: 17, round: 1 };
  const pool = [
    p({ id: 'rb', position: 'RB', overallRank: 5, vbd: 80 }),
    p({ id: 'wr', position: 'WR', overallRank: 6, vbd: 78 }),
  ];
  const [top] = recommend(pool, ctx);
  assert.equal(top.player.id, 'wr');
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

test('reasonsFor calls out a player falling past his ADP', () => {
  const ctx = { needs: allLow, currentPick: 40, nextPick: 41, round: 4 };
  const target = p({ id: 'a', position: 'WR', overallRank: 20, adp: 22, vbd: 60 });
  const reasons = reasonsFor(target, [target], ctx);
  assert.ok(reasons.some((r) => /past his ADP/i.test(r)), reasons.join(' | '));
});

test('reasonsFor warns when a pick is well ahead of ADP', () => {
  const ctx = { needs: allLow, currentPick: 10, nextPick: 11, round: 1 };
  const target = p({ id: 'a', position: 'WR', overallRank: 40, adp: 55, vbd: 10 });
  const reasons = reasonsFor(target, [target], ctx);
  assert.ok(reasons.some((r) => /reach/i.test(r)), reasons.join(' | '));
});

test('reasonsFor caps output at two lines', () => {
  const ctx = { needs: { ...allLow, RB: 'high' }, currentPick: 40, nextPick: 41, round: 4 };
  const target = p({ id: 'a', position: 'RB', overallRank: 1, projectedPoints: 280, adp: 50, vbd: 120 });
  const pool = [target, p({ id: 'b', position: 'RB', overallRank: 2, projectedPoints: 150, vbd: 5 })];
  assert.ok(reasonsFor(target, pool, ctx).length <= 2);
});
