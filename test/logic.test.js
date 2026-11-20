'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../logic.js');

function withMockRandom(values, fn) {
  const original = Math.random;
  let i = 0;
  Math.random = () => values[Math.min(i++, values.length - 1)];
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test('SPIN_RATE_OPTIONS lists the four selectable rates with 16 as default', () => {
  assert.deepEqual(logic.SPIN_RATE_OPTIONS, [14, 16, 18, 20]);
  assert.equal(logic.DEFAULT_SPIN_RATE, 16);
});

test('calcSpinCost returns balls-per-spin for a given spins-per-1000-yen rate', () => {
  assert.equal(logic.calcSpinCost(16), 250 / 16);
});

test('P_HIT is 1/349.9 and ENZOKU_CONFIDENCE is fixed at 40%', () => {
  assert.equal(logic.P_HIT, 1 / 349.9);
  assert.equal(logic.ENZOKU_CONFIDENCE, 40);
  assert.equal(logic.falseEnzokuProbability(), logic.P_HIT * (60 / 40));
});

test('spinNormal returns hit / false_enzoku / miss by draw', () => {
  assert.equal(withMockRandom([0], () => logic.spinNormal()), 'hit');
  assert.equal(withMockRandom([0.999, 0], () => logic.spinNormal()), 'false_enzoku');
  assert.equal(withMockRandom([0.999, 0.999], () => logic.spinNormal()), 'miss');
});

test('NORMAL_HIT_TYPES: 3000 (10%, RUSH direct) and 1500 (90%, goes to judge)', () => {
  assert.deepEqual(logic.NORMAL_HIT_TYPES.b3000, { weight: 0.10, nominal: 3000, actual: 2800, rushDirect: true });
  assert.deepEqual(logic.NORMAL_HIT_TYPES.b1500, { weight: 0.90, nominal: 1500, actual: 1400, rushDirect: false });
});

test('rollNormalHitType picks 3000 under 10%, 1500 otherwise', () => {
  assert.equal(withMockRandom([0],    () => logic.rollNormalHitType()), 'b3000');
  assert.equal(withMockRandom([0.09], () => logic.rollNormalHitType()), 'b3000');
  assert.equal(withMockRandom([0.10], () => logic.rollNormalHitType()), 'b1500');
  assert.equal(withMockRandom([0.999], () => logic.rollNormalHitType()), 'b1500');
});

test('P_RUSH_ENTRY is 50% and rollRushEntry follows it', () => {
  assert.equal(logic.P_RUSH_ENTRY, 0.5);
  assert.equal(withMockRandom([0.49], () => logic.rollRushEntry()), true);
  assert.equal(withMockRandom([0.5],  () => logic.rollRushEntry()), false);
});

test('overall RUSH entry rate from a first hit is 55%', () => {
  const t = logic.NORMAL_HIT_TYPES;
  const rate = t.b3000.weight + t.b1500.weight * logic.P_RUSH_ENTRY;
  assert.ok(Math.abs(rate - 0.55) < 1e-12);
});

test('P_RUSH is 1/99.9 and RUSH_ST_COUNT is 144', () => {
  assert.equal(logic.P_RUSH, 1 / 99.9);
  assert.equal(logic.RUSH_ST_COUNT, 144);
});

test('spinRush returns hit when the draw beats P_RUSH, miss otherwise', () => {
  assert.equal(withMockRandom([0], () => logic.spinRush()), 'hit');
  assert.equal(withMockRandom([0.5], () => logic.spinRush()), 'miss');
});

test('RUSH_HIT_TYPES: 6000 25% / 1500 55% / 300 6% / restart 14%', () => {
  assert.deepEqual(logic.RUSH_HIT_TYPES.b6000,   { weight: 0.25, nominal: 6000, actual: 5600 });
  assert.deepEqual(logic.RUSH_HIT_TYPES.b1500,   { weight: 0.55, nominal: 1500, actual: 1400 });
  assert.deepEqual(logic.RUSH_HIT_TYPES.b300,    { weight: 0.06, nominal: 300,  actual: 280  });
  assert.deepEqual(logic.RUSH_HIT_TYPES.restart, { weight: 0.14, nominal: 0,    actual: 0    });
  const sum = logic.RUSH_HIT_TYPE_ORDER.reduce((s, k) => s + logic.RUSH_HIT_TYPES[k].weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
});

test('rollRushHitType picks by cumulative weight order', () => {
  assert.equal(withMockRandom([0],     () => logic.rollRushHitType()), 'b6000');
  assert.equal(withMockRandom([0.30],  () => logic.rollRushHitType()), 'b1500');
  assert.equal(withMockRandom([0.82],  () => logic.rollRushHitType()), 'b300');
  assert.equal(withMockRandom([0.90],  () => logic.rollRushHitType()), 'restart');
  assert.equal(withMockRandom([0.999], () => logic.rollRushHitType()), 'restart');
});

test('createRushState starts with 144 ST and zeroed counters', () => {
  assert.deepEqual(logic.createRushState(), {
    stRemaining: 144,
    chainCount: 0,
    counts: { b6000: 0, b1500: 0, b300: 0, restart: 0 },
    actualBalls: 0,
    nominalBalls: 0,
  });
});

test('applyRushSpin on a miss decrements stRemaining; last miss reports st_end', () => {
  let r = withMockRandom([0.5], () => logic.applyRushSpin(logic.createRushState()));
  assert.equal(r.outcome, 'miss');
  assert.equal(r.rushState.stRemaining, 143);
  r = withMockRandom([0.5], () => logic.applyRushSpin({ ...logic.createRushState(), stRemaining: 1 }));
  assert.equal(r.outcome, 'st_end');
  assert.equal(r.rushState.stRemaining, 0);
});

test('applyRushSpin on a 6000 hit resets ST to 144 and adds 5600/6000', () => {
  const { rushState, outcome } = withMockRandom([0, 0], () => logic.applyRushSpin(logic.createRushState()));
  assert.equal(outcome, 'hit_b6000');
  assert.equal(rushState.stRemaining, 144);
  assert.equal(rushState.chainCount, 1);
  assert.equal(rushState.counts.b6000, 1);
  assert.equal(rushState.actualBalls, 5600);
  assert.equal(rushState.nominalBalls, 6000);
});

test('applyRushSpin on a restart resets ST to 144, counts the hit, adds no balls', () => {
  const start = { ...logic.createRushState(), stRemaining: 3 };
  const { rushState, outcome } = withMockRandom([0, 0.95], () => logic.applyRushSpin(start));
  assert.equal(outcome, 'hit_restart');
  assert.equal(rushState.stRemaining, 144);
  assert.equal(rushState.chainCount, 1);
  assert.equal(rushState.counts.restart, 1);
  assert.equal(rushState.actualBalls, 0);
  assert.equal(rushState.nominalBalls, 0);
});

test('3000白鯨戦：3000ボーナス1回につきはずれ先バレ2回が白鯨戦（成功率1/3）', () => {
  const r = logic.hakugeiRateGivenFalseEnzoku();
  const win = logic.P_HIT * 0.10;
  const lose = logic.falseEnzokuProbability() * r;
  assert.ok(Math.abs(win / (win + lose) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(r - 0.2 / 1.5) < 1e-12);
});

test('出現率：ST当選率・連チャン分布・単発率', () => {
  assert.ok(Math.abs(logic.P_ST_HIT - 0.7651) < 0.001);
  assert.equal(logic.chainProbability(1).atLeast, 1);
  assert.ok(Math.abs(logic.P_TANPATSU - (0.45 + 0.55 * (1 - logic.P_ST_HIT))) < 1e-12);
  assert.ok(Math.abs(logic.hitIntervalProbability(1000).atLeast - Math.pow(1 - 1 / 349.9, 999)) < 1e-12);
});

test('鬼がかり予告：白鯨戦以外の先バレで信頼度75%', () => {
  const c = 0.4, a = logic.ONIGAKARI_RATE_GIVEN_HIT, b = logic.onigakariRateGivenMiss();
  const hitPool = c * 0.9, missPool = (1 - c) * (1 - logic.hakugeiRateGivenFalseEnzoku());
  assert.ok(Math.abs((hitPool * a) / (hitPool * a + missPool * b) - 0.75) < 1e-12);
  assert.equal(logic.rollOnigakari(true, true), false);
});
