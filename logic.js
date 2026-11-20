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

// 鬼がかり予告：先バレの一部で発生し、その変動の信頼度を75%に引き上げる。
// 大当たり確率・先バレ発生率は変えず、先バレの「当たり/はずれ」のうち一部に
// 予告を付けるだけ。当たり先バレの30%に付け、はずれ先バレへの付与率を逆算する。
//   P(当たり|予告) = 0.4×a ÷ (0.4×a + 0.6×b) = 0.75 → b = a × 0.4×0.25 ÷ (0.6×0.75)
const ONIGAKARI_CONFIDENCE = 75;
const ONIGAKARI_RATE_GIVEN_HIT = 0.30;
function onigakariRateGivenMiss() {
  const c = ENZOKU_CONFIDENCE / 100, t = ONIGAKARI_CONFIDENCE / 100;
  return ONIGAKARI_RATE_GIVEN_HIT * c * (1 - t) / ((1 - c) * t);
}
function rollOnigakari(isHit) {
  return Math.random() < (isHit ? ONIGAKARI_RATE_GIVEN_HIT : onigakariRateGivenMiss());
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

// ---- 出現率の計算 ----

// 通常時：n回転目で当たった時の出現率
function hitIntervalProbability(n) {
  return {
    atLeast: Math.pow(1 - P_HIT, n - 1),   // n回転以上ハマる確率
    within: 1 - Math.pow(1 - P_HIT, n),    // n回転以内に当たる確率
  };
}

// ST144回中に1回以上当たる確率（約76.5%）
const P_ST_HIT = 1 - Math.pow(1 - P_RUSH, RUSH_ST_COUNT);

// RUSHのN連(初当たり込み)：ST中の当たりk=N-1回。exact=q^k(1-q)、atLeast=q^k
function chainProbability(totalChain) {
  const k = Math.max(0, totalChain - 1);
  const atLeast = Math.pow(P_ST_HIT, k);
  return { exact: atLeast * (1 - P_ST_HIT), atLeast };
}

// 単発：1500ボーナス後のRUSH突入ジャッジ失敗、またはRUSH突入後1連(ST中の当たりなし)で終了
const P_RUSH_FROM_HIT = NORMAL_HIT_TYPES.b3000.weight + NORMAL_HIT_TYPES.b1500.weight * P_RUSH_ENTRY;
const P_TANPATSU = (1 - P_RUSH_FROM_HIT) + P_RUSH_FROM_HIT * (1 - P_ST_HIT);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SPIN_RATE_OPTIONS,
    DEFAULT_SPIN_RATE,
    calcSpinCost,
    P_HIT,
    ENZOKU_CONFIDENCE,
    ONIGAKARI_CONFIDENCE,
    ONIGAKARI_RATE_GIVEN_HIT,
    onigakariRateGivenMiss,
    rollOnigakari,
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
    hitIntervalProbability,
    P_ST_HIT,
    chainProbability,
    P_RUSH_FROM_HIT,
    P_TANPATSU,
  };
}
