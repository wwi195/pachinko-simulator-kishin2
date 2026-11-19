'use strict';

const SPIN_RATE_OPTIONS = [14, 16, 18, 20];
const DEFAULT_SPIN_RATE = 16;

function calcSpinCost(spinRate) {
  return 250 / spinRate;
}

function rollWeighted(table, order) {
  const r = Math.random();
  let cumulative = 0;
  for (const key of order) {
    cumulative += table[key].weight;
    if (r < cumulative) return key;
  }
  return order[order.length - 1];
}

// ---- 通常時 ----

const P_HIT = 1 / 349.9;

const ENZOKU_CONFIDENCE = 40;

function falseEnzokuProbability() {
  return P_HIT * ((100 - ENZOKU_CONFIDENCE) / ENZOKU_CONFIDENCE);
}

// 先バレのみのシンプルな予告方式。本物の当たり(P_HIT)と、外れなのに先バレが
// 出る偽陽性(falseEnzokuProbability)の合算が「先バレ発生率」となり、その中で
// 本物が占める割合が信頼度(固定40%)と一致する。
function spinNormal() {
  if (Math.random() < P_HIT) return 'hit';
  if (Math.random() < falseEnzokuProbability()) return 'false_enzoku';
  return 'miss';
}

// 初当たりの振り分け。3000ボーナスはRUSH直行、1500ボーナスはその後
// RUSH突入ジャッジ(50%)へ進む。合計のRUSH突入率は 10% + 90%×50% = 55%。
const NORMAL_HIT_TYPES = {
  b3000: { weight: 0.10, nominal: 3000, actual: 2800, rushDirect: true },
  b1500: { weight: 0.90, nominal: 1500, actual: 1400, rushDirect: false },
};
const NORMAL_HIT_TYPE_ORDER = ['b3000', 'b1500'];

function rollNormalHitType() {
  return rollWeighted(NORMAL_HIT_TYPES, NORMAL_HIT_TYPE_ORDER);
}

// 3000白鯨戦：先バレ発生時に突入。勝利=3000ボーナス(RUSH直行)、敗北=はずれ。
// 成功率約33%になるよう、3000ボーナス1回につき、はずれ先バレ2回を白鯨戦(敗北)に回す。
// はずれ先バレ(当たりの1.5倍)のうち白鯨戦になる割合 = 2×10% ÷ 150% ≒ 13.3%。
const HAKUGEI_SUCCESS_RATE = 1 / 3;
function hakugeiRateGivenFalseEnzoku() {
  const pWin = P_HIT * NORMAL_HIT_TYPES.b3000.weight;
  const pLose = pWin * (1 - HAKUGEI_SUCCESS_RATE) / HAKUGEI_SUCCESS_RATE;
  return pLose / falseEnzokuProbability();
}
function rollHakugeiOnFalseEnzoku() {
  return Math.random() < hakugeiRateGivenFalseEnzoku();
}

const P_RUSH_ENTRY = 0.5;

function rollRushEntry() {
  return Math.random() < P_RUSH_ENTRY;
}

// ---- RUSH(ST)中 ----

const P_RUSH = 1 / 99.9;
const RUSH_ST_COUNT = 144;

function spinRush() {
  return Math.random() < P_RUSH ? 'hit' : 'miss';
}

// リスタートは出玉なしでST144回を最初からやり直す当たり。
const RUSH_HIT_TYPES = {
  b6000:   { weight: 0.25, nominal: 6000, actual: 5600 },
  b1500:   { weight: 0.55, nominal: 1500, actual: 1400 },
  b300:    { weight: 0.06, nominal: 300,  actual: 280  },
  restart: { weight: 0.14, nominal: 0,    actual: 0    },
};
const RUSH_HIT_TYPE_ORDER = ['b6000', 'b1500', 'b300', 'restart'];

function rollRushHitType() {
  return rollWeighted(RUSH_HIT_TYPES, RUSH_HIT_TYPE_ORDER);
}

function createRushState() {
  return {
    stRemaining: RUSH_ST_COUNT,
    chainCount: 0,
    counts: { b6000: 0, b1500: 0, b300: 0, restart: 0 },
    actualBalls: 0,
    nominalBalls: 0,
  };
}

function applyRushSpin(rushState) {
  const result = spinRush();
  const stRemaining = rushState.stRemaining - 1;

  if (result === 'miss') {
    if (stRemaining <= 0) {
      return { rushState: { ...rushState, stRemaining: 0 }, outcome: 'st_end' };
    }
    return { rushState: { ...rushState, stRemaining }, outcome: 'miss' };
  }

  const hitType = rollRushHitType();
  const { nominal, actual } = RUSH_HIT_TYPES[hitType];

  const newState = {
    stRemaining: RUSH_ST_COUNT,
    chainCount: rushState.chainCount + 1,
    counts: { ...rushState.counts, [hitType]: rushState.counts[hitType] + 1 },
    actualBalls: rushState.actualBalls + actual,
    nominalBalls: rushState.nominalBalls + nominal,
  };

  return { rushState: newState, outcome: 'hit_' + hitType };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SPIN_RATE_OPTIONS,
    DEFAULT_SPIN_RATE,
    calcSpinCost,
    P_HIT,
    ENZOKU_CONFIDENCE,
    falseEnzokuProbability,
    spinNormal,
    NORMAL_HIT_TYPES,
    NORMAL_HIT_TYPE_ORDER,
    rollNormalHitType,
    HAKUGEI_SUCCESS_RATE,
    hakugeiRateGivenFalseEnzoku,
    rollHakugeiOnFalseEnzoku,
    P_RUSH_ENTRY,
    rollRushEntry,
    P_RUSH,
    RUSH_ST_COUNT,
    spinRush,
    RUSH_HIT_TYPES,
    RUSH_HIT_TYPE_ORDER,
    rollRushHitType,
    createRushState,
    applyRushSpin,
  };
}
