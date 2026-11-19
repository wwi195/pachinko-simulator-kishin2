'use strict';

const MACHINE_NAME = 'リゼロ鬼がかり2';
const RUSH_NAME = 'RUSH';
const ACCENT = '#1f5fd6';

const BONUS_LABELS = {
  b6000: '6000ボーナス',
  b3000: '3000ボーナス',
  b1500: '1500ボーナス',
  b300: '300ボーナス',
  restart: 'リスタート',
};

const game = {
  state: 'normal_idle',
  mode: 'normal',
  spinRate: DEFAULT_SPIN_RATE,
  mochiDama: 0,
  toushi: 0,
  totalSpins: 0,
  currentSpins: 0,
  lastHitSpins: 0,
  lastHitToushi: 0,
  normalHitCounts: { direct3000: 0, rushEntry: 0, single: 0 },
  totalRushHits: 0,
  allRushStats: { rushTotalSpins: 0, b6000: 0, b1500: 0, b300: 0, restart: 0 },
  rush: null,
  rushCycleSpins: 0,
  rushEntryBonus: null,
  pending: {},
  eigyoAlertShown: false,
  log: [],
};

function addLog(text, type = '') {
  game.log.unshift({ text, type });
  if (game.log.length > 50) game.log.pop();
  renderLog();
}

// ---- 球数・投資 ----

function consumeSpinCost() {
  const cost = calcSpinCost(game.spinRate);
  if (game.mochiDama >= cost) {
    game.mochiDama -= cost;
  } else {
    const shortfall = cost - game.mochiDama;
    game.mochiDama = 0;
    const units = Math.ceil(shortfall / 250);
    game.toushi   += units * 1000;
    game.mochiDama = units * 250 - shortfall;
  }
}

function addBalls(n) {
  game.mochiDama += n;
}

function handleSpinRateChange(value) {
  game.spinRate = Number(value);
  render();
}

// ---- 通常時ハンドラ ----

function checkEigyoAlert() {
  if (!game.eigyoAlertShown && game.totalSpins >= 2000) {
    game.eigyoAlertShown = true;
    setState('eigyo_alert');
    return true;
  }
  return false;
}

// 1回転処理。演出発生など画面遷移が起きたら true を返す
function runNormalSpin() {
  game.totalSpins++;
  game.currentSpins++;
  consumeSpinCost();
  const result = spinNormal();
  const interval = game.totalSpins - game.lastHitSpins;

  if (result === 'hit' || result === 'false_enzoku') {
    const spentSinceLastHit = game.toushi - game.lastHitToushi;
    game.pending = { type: result, interval, spentSinceLastHit };
    addLog(`${interval}回転で先バレ発生！`);
    setState('enzoku');
    return true;
  }
  return false;
}

function resolveNormalHit(interval) {
  const hitType = rollNormalHitType();
  game.pending = { ...game.pending, interval, hitType };
  // 3000ボーナスは必ず白鯨戦（勝利）を経由する
  if (hitType === 'b3000') {
    addLog('3000白鯨戦 突入！', 'rush');
    setState('hakugei');
    return;
  }
  applyNormalHit(hitType, interval);
}

// 3000白鯨戦の勝敗（先バレの時点で確定済み：当たり=勝利、はずれ=敗北）
function handleHakugeiBattle() {
  if (game.pending.type === 'hit') {
    game.pending.hakugei = 'win';
    addLog('白鯨戦 勝利！', 'rush');
    applyNormalHit('b3000', game.pending.interval);
  } else {
    game.pending.hakugei = 'lose';
    addLog('白鯨戦 敗北… はずれ');
    setState('lose_result');
  }
}

function applyNormalHit(hitType, interval) {
  const bonus = NORMAL_HIT_TYPES[hitType];
  game.currentSpins = 0;
  game.lastHitSpins = game.totalSpins;
  game.lastHitToushi = game.toushi;
  addBalls(bonus.actual);
  addLog(`${interval}回転で${BONUS_LABELS[hitType]} ＋${bonus.actual}球`, bonus.rushDirect ? 'rush' : 'win');

  if (bonus.rushDirect) {
    game.normalHitCounts.direct3000++;
    enterRush({ label: BONUS_LABELS[hitType], nominal: bonus.nominal, actual: bonus.actual });
    addLog(`${RUSH_NAME}直行！`, 'rush');
    playFlash(() => setState('normal_hit_direct'));
  } else {
    setState('normal_hit_result');
  }
}

function handleStart() {
  if (checkEigyoAlert()) return;
  if (!runNormalSpin()) {
    game.pending.hakugei = null;
    setState('lose_result');
  }
}

function autoSpin(count) {
  for (let i = 0; i < count; i++) {
    if (checkEigyoAlert()) return;
    if (runNormalSpin()) return;
  }
  setState('normal_idle');
}

function handleEnzokuJudge() {
  if (game.pending.type === 'hit') {
    resolveNormalHit(game.pending.interval);
  } else if (rollHakugeiOnFalseEnzoku()) {
    addLog('3000白鯨戦 突入！', 'rush');
    setState('hakugei');
  } else {
    game.pending.hakugei = null;
    addLog('はずれ');
    setState('lose_result');
  }
}

function backToNormal() {
  game.mode = 'normal';
  setState('normal_idle');
}

function handleNormalHitContinue() {
  setState('rush_entry_challenge');
}

function handleRushEntryJudge() {
  if (rollRushEntry()) {
    game.normalHitCounts.rushEntry++;
    const b = NORMAL_HIT_TYPES.b1500;
    enterRush({ label: BONUS_LABELS.b1500, nominal: b.nominal, actual: b.actual });
    addLog(`${RUSH_NAME}突入！`, 'rush');
    setState('rush_entry_win');
  } else {
    game.normalHitCounts.single++;
    addLog(`${RUSH_NAME}突入ならず…`);
    setState('rush_entry_lose');
  }
}

function handleAfterRushEntry() {
  setState(game.mode === 'rush' ? 'rush_idle' : 'normal_idle');
}

// 中心の十字が閉じていく0.3秒の暗転演出。終了後にcallbackで画面を切り替える。
function playFlash(callback) {
  const el = document.getElementById('tv-off-flash');
  el.classList.add('active');
  setTimeout(() => {
    el.classList.remove('active');
    callback();
  }, 300);
}

// 6000ボーナス：画面の大部分をレインボーにし、巨大な「6000」がカウントアップして跳ねる。
// タップか約2.8秒で結果画面へ。
const RAINBOW_6000_MS = 2800;
const RAINBOW_COUNT_MS = 900;
function play6000Rainbow(callback) {
  const el = document.getElementById('rainbow-6000');
  const num = document.getElementById('rainbow-6000-num');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.classList.remove('active');
    el.onclick = null;
    callback();
  };
  el.classList.add('active');
  const start = performance.now();
  const step = (now) => {
    if (done) return;
    const t = Math.min(1, (now - start) / RAINBOW_COUNT_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    num.textContent = Math.round(6000 * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
    else num.classList.add('landed');
  };
  num.classList.remove('landed');
  num.textContent = '0';
  requestAnimationFrame(step);
  setTimeout(() => { el.onclick = finish; }, RAINBOW_COUNT_MS);
  setTimeout(finish, RAINBOW_6000_MS);
}

function enterRush(entryBonus = null) {
  game.mode = 'rush';
  game.rush = createRushState();
  game.rushCycleSpins = 0;
  game.rushEntryBonus = entryBonus;
}

// ---- RUSH(ST)中ハンドラ ----

// 1回転処理。画面遷移が起きたら true を返す
function runRushSpin(opts = {}) {
  game.allRushStats.rushTotalSpins++;
  game.rushCycleSpins++;
  const { rushState, outcome } = applyRushSpin(game.rush);
  game.rush = rushState;

  if (outcome === 'miss') {
    if (!opts.silent) {
      addLog(`ST残り${rushState.stRemaining}回`);
      setState('rush_miss');
      return true;
    }
    return false;
  }

  if (outcome === 'st_end') {
    addLog('ST終了 → RUSHリザルトへ');
    setState('rush_result');
    return true;
  }

  const hitType = outcome.replace('hit_', '');
  const { nominal, actual } = RUSH_HIT_TYPES[hitType];
  game.totalRushHits++;
  game.allRushStats[hitType]++;
  addBalls(actual);
  game.pending = { hitType, nominal, actual, spinsThisCycle: game.rushCycleSpins };
  game.rushCycleSpins = 0;
  if (hitType === 'restart') {
    addLog(`リスタート！ ST${RUSH_ST_COUNT}回再セット (${rushState.chainCount}連)`, 'rush');
  } else {
    addLog(`${BONUS_LABELS[hitType]}！ ＋${actual}球 (${rushState.chainCount}連)`, 'rush');
  }
  if (hitType === 'b6000') {
    play6000Rainbow(() => setState('rush_hit_result'));
  } else {
    setState('rush_hit_result');
  }
  return true;
}

function handleRushSpin() {
  runRushSpin();
}

function handleRushSpin10() {
  for (let i = 0; i < 10; i++) {
    if (runRushSpin({ silent: true })) return;
  }
  setState('rush_idle');
}

function handleRushSkip() {
  for (;;) {
    if (runRushSpin({ silent: true })) return;
    if (game.rush.stRemaining <= 10) {
      setState('rush_idle');
      return;
    }
  }
}

function handleRushHitContinue() {
  setState('rush_idle');
}

function handleRushMissContinue() {
  setState('rush_idle');
}

function handleRushResultEnd() {
  addLog('RUSH終了 → 通常時へ');
  game.mode = 'normal';
  game.rush = null;
  game.rushCycleSpins = 0;
  game.rushEntryBonus = null;
  setState('normal_idle');
}

// ---- 営業終了・退店 ----

function handleEigyoHai() {
  setState(game.mode === 'rush' ? 'rush_idle' : 'normal_idle');
}

function handleEigyoIie() {
  setState('taiten_result');
}

function handleTaiten() {
  setState('taiten_result');
}

function resetGame() {
  game.state           = 'normal_idle';
  game.mode            = 'normal';
  game.spinRate        = DEFAULT_SPIN_RATE;
  game.mochiDama       = 0;
  game.toushi          = 0;
  game.totalSpins      = 0;
  game.currentSpins    = 0;
  game.lastHitSpins    = 0;
  game.lastHitToushi   = 0;
  game.normalHitCounts = { direct3000: 0, rushEntry: 0, single: 0 };
  game.totalRushHits   = 0;
  game.allRushStats    = { rushTotalSpins: 0, b6000: 0, b1500: 0, b300: 0, restart: 0 };
  game.rush            = null;
  game.rushCycleSpins  = 0;
  game.rushEntryBonus  = null;
  game.pending         = {};
  game.eigyoAlertShown = false;
  game.log             = [];
  render();
}

// ---- 状態セット & レンダリング ----

function setState(state) {
  game.state = state;
  render();
}

function render() {
  renderHeader();
  renderModeBadge();
  renderMainScreen();
  renderRushStats();
}

function renderHeader() {
  const mochiInt = Math.floor(game.mochiDama);
  document.getElementById('mochi-dama').textContent   = mochiInt.toLocaleString();
  document.getElementById('toushi-value').textContent = game.toushi.toLocaleString();

  const shuushi   = mochiInt * 4 - game.toushi;
  const shuushiEl = document.getElementById('shuushi-value');
  shuushiEl.textContent = (shuushi >= 0 ? '+' : '') + shuushi.toLocaleString();
  shuushiEl.className   = 'money-value ' + (shuushi >= 0 ? 'green' : 'red');
  document.getElementById('current-spins').textContent = game.currentSpins.toLocaleString();
  document.getElementById('total-spins-disp').textContent = game.totalSpins.toLocaleString();

  const rushCountEl = document.getElementById('rush-count');
  rushCountEl.textContent = game.mode === 'rush' ? `${game.rush.stRemaining}回` : '－';

  const { direct3000, rushEntry, single } = game.normalHitCounts;
  const rushEntries = direct3000 + rushEntry;
  const normalHits  = rushEntries + single;

  document.getElementById('rush-entry-count').textContent = rushEntries + '回';
  document.getElementById('rush-entry-rate').textContent =
    normalHits > 0 ? `(突入率${Math.round((rushEntries / normalHits) * 100)}%)` : '(突入率―%)';
  document.getElementById('single-count').textContent = single + '回';

  const grandTotal = normalHits + game.totalRushHits;
  document.getElementById('total-hit-count').textContent = grandTotal + '回';

  document.getElementById('normal-first-hit').textContent  = normalHits + '回';
  document.getElementById('normal-first-prob').textContent = normalHits > 0 && game.totalSpins > 0
    ? '1/' + Math.round(game.totalSpins / normalHits).toLocaleString()
    : '1/―';

  document.getElementById('fee-block').textContent = `${game.spinRate}回転/千円`;
}

function renderModeBadge() {
  const el = document.getElementById('mode-badge');
  if (game.mode === 'rush') {
    el.textContent = 'RUSH中';
    el.className = 'rush';
  } else {
    el.textContent = '通常時';
    el.className = '';
  }
}

function renderMainScreen() {
  document.getElementById('main-screen').innerHTML = buildScreen(game.state);
}

function spinRateOptionsHtml() {
  return SPIN_RATE_OPTIONS.map(rate =>
    `<option value="${rate}" ${rate === game.spinRate ? 'selected' : ''}>${rate}回転</option>`
  ).join('');
}

function tenThousandYenSpins() {
  return game.spinRate * 10;
}

function buildNormalIdleScreen(interactive) {
  const startAttr  = interactive ? ' onclick="handleStart()"' : '';
  const rateAttr   = interactive ? ' onchange="handleSpinRateChange(this.value)"' : '';
  const spinAttr   = interactive ? ` onclick="autoSpin(${tenThousandYenSpins()})"` : '';
  const taitenAttr = interactive ? ' onclick="handleTaiten()"' : '';
  return `<div class="screen">
    <button class="btn-start"${startAttr}>START</button>
    <p class="prob-hint">大当たり確率 1/349.9</p>
    <div class="spin-rate-block">
      <span class="spin-rate-label">1000円あたりの回転数</span>
      <select class="spin-rate-select"${rateAttr}>
        ${spinRateOptionsHtml()}
      </select>
    </div>
    <div class="auto-spin-btns">
      <div class="auto-spin-wrap">
        <button class="btn-auto"${spinAttr}>1万円分回す</button>
        <p class="spin-cost-hint">約${tenThousandYenSpins()}回転分</p>
      </div>
    </div>
    <button class="btn-taiten"${taitenAttr}>退店する</button>
  </div>`;
}

function resultRow(label, count) {
  return `<div class="result-row">
    <span class="rr-label">${label}</span>
    <span class="rr-val">×${count}回</span>
  </div>`;
}

function buildScreen(state) {
  switch (state) {

    case 'normal_idle':
      return buildNormalIdleScreen(true);

    case 'enzoku':
      return `<div class="screen">
        <p class="enzoku-label">${game.pending.interval}回転　先バレ発生！</p>
        <p class="result-sub">前回大当たりから ${game.pending.spentSinceLastHit.toLocaleString()}円使用</p>
        <p class="shinraido">信頼度 ${ENZOKU_CONFIDENCE}%</p>
        <button class="btn-action" onclick="handleEnzokuJudge()">▶ 判定に進む</button>
      </div>`;

    case 'lose_result':
      return `<div class="screen">
        ${game.pending.hakugei === 'lose' ? '<p class="result-main lose" style="font-size:22px;">白鯨戦 敗北…</p>' : ''}
        <p class="result-main lose">はずれ</p>
        <button class="btn-sub" onclick="backToNormal()" style="margin-top:8px;">続ける</button>
      </div>`;

    case 'hakugei':
      return `<div class="screen">
        <p class="hakugei-title">3000白鯨戦</p>
        <p class="result-sub">勝てば3000ボーナス＆${RUSH_NAME}直行 ／ 成功率 約33%</p>
        <button class="btn-action hakugei-btn" onclick="handleHakugeiBattle()">▶ 勝負！</button>
      </div>`;

    case 'normal_hit_result':
      return `<div class="screen">
        <p class="hit-interval"><span>${game.pending.interval.toLocaleString()}</span>回転</p>
        <div class="vibun-box">
          <p class="bonus-main standard">${BONUS_LABELS.b1500}</p>
          <p class="bonus-sub">＋${NORMAL_HIT_TYPES.b1500.actual.toLocaleString()}球獲得</p>
        </div>
        <button class="btn-action" onclick="handleNormalHitContinue()">▶ RUSH突入ジャッジへ</button>
      </div>`;

    case 'normal_hit_direct':
      return `<div class="screen">
        ${game.pending.hakugei === 'win' ? '<p class="hakugei-win">白鯨戦 勝利！</p>' : ''}
        <p class="hit-interval"><span>${game.pending.interval.toLocaleString()}</span>回転</p>
        <p class="add-rush-title">${RUSH_NAME}直行！</p>
        <div class="vibun-box rush-box">
          <p class="bonus-main premium">${BONUS_LABELS.b3000}</p>
          <p class="bonus-sub">＋${NORMAL_HIT_TYPES.b3000.actual.toLocaleString()}球獲得</p>
        </div>
        <button class="btn-action" onclick="handleAfterRushEntry()">▶ ${RUSH_NAME}へ</button>
      </div>`;

    case 'rush_entry_challenge':
      return `<div class="screen">
        <p class="add-rush-title">RUSH突入ジャッジ！</p>
        <p class="result-sub">成功率 ${Math.round(P_RUSH_ENTRY * 100)}%</p>
        <button class="btn-action" onclick="handleRushEntryJudge()">▶ 判定</button>
      </div>`;

    case 'rush_entry_win':
      return `<div class="screen">
        <p class="add-rush-title">${RUSH_NAME}突入！</p>
        <p class="result-sub">ST${RUSH_ST_COUNT}回 ／ 大当たり確率 1/99.9</p>
        <button class="btn-action" onclick="handleAfterRushEntry()">▶ ${RUSH_NAME}へ</button>
      </div>`;

    case 'rush_entry_lose':
      return `<div class="screen">
        <p class="result-main lose" style="font-size:26px;">${RUSH_NAME}突入ならず…</p>
        <button class="btn-sub" onclick="handleAfterRushEntry()" style="margin-top:12px;">続ける</button>
      </div>`;

    case 'rush_idle': {
      const skipDisabled = game.rush.stRemaining <= 10;
      return `<div class="screen">
        <p class="chain-label">${game.rush.chainCount}連チャン中</p>
        <p class="rush-title">${RUSH_NAME}</p>
        <p class="rush-sub">ST残り <span>${game.rush.stRemaining}</span> 回</p>
        <div class="rush-spin-btns">
          <button class="btn-rush-spin" onclick="handleRushSpin()">1回転</button>
          <button class="btn-rush-spin" onclick="handleRushSpin10()">10回転</button>
          <button class="btn-rush-spin skip" ${skipDisabled ? 'disabled' : 'onclick="handleRushSkip()"'}>スキップ</button>
        </div>
        <p class="prob-hint">大当たり確率 1/99.9</p>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;
    }

    case 'rush_hit_result': {
      const { hitType, actual, spinsThisCycle } = game.pending;
      const rankClass = hitType === 'b6000' ? 'premium'
        : hitType === 'b1500' ? 'standard'
        : 'small';
      const sub = hitType === 'restart'
        ? `ST${RUSH_ST_COUNT}回 再セット`
        : `＋${actual.toLocaleString()}球獲得`;
      return `<div class="screen">
        <p class="result-sub">${spinsThisCycle}回転で当選</p>
        <p class="chain-label">${game.rush.chainCount}連チャン中</p>
        <div class="vibun-box rush-box">
          <p class="bonus-main ${rankClass}">${BONUS_LABELS[hitType]}</p>
          <p class="bonus-sub">${sub}</p>
        </div>
        <button class="btn-action" onclick="handleRushHitContinue()" style="margin-top:16px;">▶ RUSH継続へ</button>
      </div>`;
    }

    case 'rush_miss':
      return `<div class="screen">
        <p class="result-main lose">外れ</p>
        <p style="color:${ACCENT}; font-size:18px; margin-top:4px;">ST残り ${game.rush.stRemaining}回</p>
        <button class="btn-sub" onclick="handleRushMissContinue()" style="margin-top:12px;">続ける</button>
      </div>`;

    case 'rush_result': {
      const s = game.rush;
      const bonus = game.rushEntryBonus;
      const lines = [];
      if (bonus) lines.push(resultRow(`初当たり ${bonus.label}`, 1));
      for (const key of RUSH_HIT_TYPE_ORDER) {
        if (s.counts[key] > 0) lines.push(resultRow(BONUS_LABELS[key], s.counts[key]));
      }
      if (lines.length === 0) lines.push(`<p style="color:#555; font-size:13px;">大当たりなし</p>`);

      const totalActual  = s.actualBalls  + (bonus ? bonus.actual  : 0);
      const totalNominal = s.nominalBalls + (bonus ? bonus.nominal : 0);
      const totalHits    = s.chainCount + (bonus ? 1 : 0);

      return `<div class="screen">
        <p class="rush-result-title">RUSH リザルト</p>
        <div class="rush-result-box">
          <div class="result-row highlight">
            <span class="rr-label">連チャン数</span>
            <span class="rr-val gold">${totalHits}連チャン</span>
          </div>
          <div class="result-row">
            <span class="rr-label">獲得出玉</span>
            <span class="rr-val gold">${totalActual.toLocaleString()}球</span>
          </div>
          <div class="result-row">
            <span class="rr-label">表示出玉</span>
            <span class="rr-val">${totalNominal.toLocaleString()}個</span>
          </div>
          <hr class="result-hr">
          <p class="rr-section">ボーナス内訳</p>
          ${lines.join('')}
        </div>
        <button class="btn-action" onclick="handleRushResultEnd()" style="margin-top:16px;">▶ 通常へ戻る</button>
      </div>`;
    }

    case 'eigyo_alert':
      return `<div class="screen">
        <p style="font-size:22px; font-weight:bold; color:${ACCENT}; text-align:center; line-height:1.6;">
          営業時間終了になりました
        </p>
        <p style="font-size:16px; color:#666; text-align:center;">このまま居座り続けますか？</p>
        <div style="display:flex; gap:16px; margin-top:8px;">
          <button class="btn-action" style="flex:1;" onclick="handleEigyoHai()">はい</button>
          <button class="btn-action" style="flex:1; background:linear-gradient(135deg,#999,#666); border-color:#ccc;"
            onclick="handleEigyoIie()">いいえ</button>
        </div>
      </div>`;

    case 'taiten_result': {
      const mochi    = Math.floor(game.mochiDama);
      const mochiYen = mochi * 4;
      const shuushi  = mochiYen - game.toushi;
      const shuushiColor = shuushi >= 0 ? '#2e9e5b' : '#d24141';
      const shuushiSign  = shuushi >= 0 ? '＋' : '';
      const n = game.normalHitCounts;
      return `<div class="screen">
        <p style="font-size:24px; font-weight:bold; color:#666;">退店します</p>
        <div class="rush-result-box" style="max-width:320px;">
          <p class="rr-section" style="margin-bottom:8px;">収支発表</p>
          <div class="result-row">
            <span class="rr-label">総回転数</span>
            <span class="rr-val">${game.totalSpins.toLocaleString()}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">投資金額</span>
            <span class="rr-val" style="color:#d24141;">${game.toushi.toLocaleString()}円</span>
          </div>
          <div class="result-row">
            <span class="rr-label">持ち球換算</span>
            <span class="rr-val">${mochiYen.toLocaleString()}円</span>
          </div>
          <hr class="result-hr">
          <div class="result-row highlight">
            <span class="rr-label" style="font-weight:bold;">収支</span>
            <span class="rr-val" style="color:${shuushiColor}; font-size:22px;">
              ${shuushiSign}${shuushi.toLocaleString()}円
            </span>
          </div>
          <hr class="result-hr">
          <div class="result-row">
            <span class="rr-label">RUSH突入（うち3000直行）</span>
            <span class="rr-val">${n.direct3000 + n.rushEntry}回（${n.direct3000}回）</span>
          </div>
          <div class="result-row">
            <span class="rr-label">単発</span>
            <span class="rr-val">${n.single}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">RUSH大当たり</span>
            <span class="rr-val">${game.totalRushHits}回</span>
          </div>
        </div>
        <button class="btn-action" onclick="resetGame()" style="margin-top:8px;">▶ 最初の画面に戻る</button>
      </div>`;
    }

    default:
      return `<div class="screen"><p>...</p></div>`;
  }
}

function renderRushStats() {
  const a     = game.allRushStats;
  const hits  = game.totalRushHits;
  const spins = a.rushTotalSpins;
  const prob  = hits > 0 && spins > 0
    ? '1/' + (spins / hits).toFixed(1)
    : '1/―';
  document.getElementById('rs-chain').textContent   = hits + '回';
  document.getElementById('rs-prob').textContent    = prob;
  document.getElementById('rs-spins').textContent   = spins + '回';
  document.getElementById('rs-6000').textContent    = a.b6000 + '回';
  document.getElementById('rs-1500').textContent    = a.b1500 + '回';
  document.getElementById('rs-300').textContent     = a.b300 + '回';
  document.getElementById('rs-restart').textContent = a.restart + '回';
}

function renderLog() {
  const el = document.getElementById('log-list');
  el.innerHTML = game.log.map(item =>
    `<div class="log-item ${item.type}">${item.text}</div>`
  ).join('');
}

render();
