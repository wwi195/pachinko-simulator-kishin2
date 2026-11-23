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
  enzokuMissStreak: 0,   // 先バレはずれの連続回数
  tanpatsuStreak: 0,     // 単発の連続回数
  lastChainSpins: 0,     // 最後に2連以上したRUSH終了時の通常時総回転数
  hitHistory: [],        // 大当たり履歴 [{games, chain}]（新しい順。chain=null は結果待ち）
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
  recordSlump();
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
    // 白鯨戦になるかは先バレの時点で決めておき、白鯨戦なら鬼がかり予告は出さない
    const isHit = result === 'hit';
    const hitType = isHit ? rollNormalHitType() : null;
    const hakugei = isHit ? hitType === 'b3000' : rollHakugeiOnFalseEnzoku();
    const onigakari = rollOnigakari(isHit, hakugei);
    game.pending = { type: result, interval, spentSinceLastHit, onigakari, hitType, preHakugei: hakugei };
    addLog(`${interval}回転で先バレ発生！${onigakari ? '（鬼がかり予告）' : ''}`, onigakari ? 'rush' : '');
    setState('enzoku');
    if (onigakari) playOniWalk();
    return true;
  }
  return false;
}

function resolveNormalHit(interval) {
  const hitType = game.pending.hitType || rollNormalHitType();
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
  game.hitHistory.unshift({ games: interval, chain: null });
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
  // 何も起きなかった回転は「はずれ」画面を出さず、通常画面のまま
  if (!runNormalSpin()) {
    setState('normal_idle');
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
    game.enzokuMissStreak = 0;
    resolveNormalHit(game.pending.interval);
  } else if ((game.enzokuMissStreak++, game.pending.preHakugei)) {
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
    game.tanpatsuStreak++;
    setLatestHitChain(1);
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

// 6000ボーナス：6 → 60 → 600 → 6000 と桁が段階的に叩きつけられ、
// 最後に金色の「鬼がかり」が上に降りてくる。タップ（最後まで出た後）か自動で結果画面へ。
const R6_STAGES = ['6', '60', '600', '6000'];
const R6_STAGE_MS = 240;
const R6_ONI_DELAY_MS = 700;
const R6_HOLD_MS = 500;
// 鬼がかり予告：角のある人影が上を見ながら左から中央へのそのそ歩き、
// 中央でズームアップして薄い色が画面を覆って消える。その後「先バレ発生！」の下へ
// ひっそり予告文を出す（演出中は判定ボタンを押せない）
const ONI_WALK_MS = 2000;
const ONI_ZOOM_MS = 900;
const ONI_TINT_MS = 1500;
function playOniWalk() {
  const walker = document.getElementById('oni-walker');
  const tint = document.getElementById('oni-tint');
  const note = document.getElementById('onigakari-note');
  const btn = document.getElementById('enzoku-judge-btn');
  if (!walker) return;
  if (note) note.classList.add('hidden-note');
  if (btn) btn.disabled = true;
  walker.classList.remove('walking', 'zooming');
  void walker.offsetWidth;
  walker.classList.add('walking');
  setTimeout(() => {
    walker.classList.remove('walking');
    walker.classList.add('zooming');
    if (tint) { tint.classList.remove('on'); void tint.offsetWidth; tint.classList.add('on'); }
  }, ONI_WALK_MS);
  setTimeout(() => {
    walker.classList.remove('zooming');
    if (tint) tint.classList.remove('on');
    const n = document.getElementById('onigakari-note');
    const b = document.getElementById('enzoku-judge-btn');
    if (n) n.classList.remove('hidden-note');
    if (b) b.disabled = false;
  }, ONI_WALK_MS + ONI_TINT_MS);
}

// 6000ボーナス：レインボーの枠だけを1秒見せ、その後に「6000ボーナス」を表示して継続ボタンを解放
const BOX6000_BLANK_MS = 1000;
const SHITAZARA_NOTE_RATE = 0.05;
function reveal6000AfterBlank() {
  const box = document.getElementById('rush-hit-box');
  const btn = document.getElementById('rush-hit-continue');
  if (!box || !btn) return;
  box.classList.add('blank');
  btn.disabled = true;
  // 5%で、空白の枠にあらかじめ「下皿が満タンです」を表示しておく
  let shitazara = null;
  if (Math.random() < SHITAZARA_NOTE_RATE) {
    shitazara = document.createElement('p');
    shitazara.className = 'shitazara-note';
    shitazara.textContent = '下皿が満タンです';
    box.appendChild(shitazara);
  }
  const reveal = () => {
    if (shitazara) shitazara.remove();
    box.classList.remove('blank');
    box.classList.add('revealed');
    btn.disabled = false;
  };
  // 下皿満タン以外のときは、6000の前に一瞬だけ別のボーナスを表示する（ガセ表示）
  const fake = shitazara ? null : rollFake6000Label();
  setTimeout(() => {
    if (!fake) { reveal(); return; }
    const note = document.createElement('div');
    note.className = 'fake-6000-note';
    note.innerHTML = `<p class="bonus-main ${fake.rank}">${BONUS_LABELS[fake.type]}</p>
      <p class="bonus-sub">${fake.sub}</p>`;
    box.appendChild(note);
    setTimeout(() => { note.remove(); reveal(); }, FAKE6000_SHOW_MS);
  }, BOX6000_BLANK_MS);
}

// 6000の空白枠から、一瞬だけ見せる別ボーナス。全体での割合は
//   そのまま6000 45% ／ 1500ボーナス 30% ／ 300ボーナス 10% ／ リスタート 10% ／ 下皿満タン 5%
// （下皿満タン以外の95%の中で抽選するため、ここでは 全体の割合 ÷ 0.95 で持つ）
const FAKE6000_SHOW_MS = 300;
const NOT_SHITAZARA = 1 - SHITAZARA_NOTE_RATE;
const FAKE6000_TABLE = [
  { type: 'b300',    rate: 0.10 / NOT_SHITAZARA, rank: 'small',    sub: '＋280球獲得' },
  { type: 'restart', rate: 0.10 / NOT_SHITAZARA, rank: 'small',    sub: `ST${RUSH_ST_COUNT}回 再セット` },
  { type: 'b1500',   rate: 0.30 / NOT_SHITAZARA, rank: 'standard', sub: '＋1,400球獲得' },
];
function rollFake6000Label() {
  let r = Math.random();
  for (const f of FAKE6000_TABLE) {
    if (r < f.rate) return f;
    r -= f.rate;
  }
  return null;
}

function play6000Rainbow(callback) {
  const el = document.getElementById('rainbow-6000');
  const num = document.getElementById('rainbow-6000-num');
  const oni = document.getElementById('rainbow-6000-oni');
  const timers = [];
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    el.classList.remove('active');
    el.onclick = null;
    callback();
  };
  const setNum = (text) => {
    num.querySelectorAll('span').forEach((sp) => { sp.textContent = text; });
    num.classList.remove('slam', 'final');
    void num.offsetWidth;
    num.classList.add('slam');
  };
  oni.classList.remove('show');
  el.onclick = null;
  el.classList.add('active');
  R6_STAGES.forEach((text, i) => {
    timers.push(setTimeout(() => setNum(text), i * R6_STAGE_MS));
  });
  const lastAt = (R6_STAGES.length - 1) * R6_STAGE_MS;
  timers.push(setTimeout(() => {
    oni.classList.add('show');
    num.classList.add('final');
    el.onclick = finish;
  }, lastAt + R6_ONI_DELAY_MS));
  timers.push(setTimeout(finish, lastAt + R6_ONI_DELAY_MS + R6_HOLD_MS));
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
      // ST中の外れは「外れ」画面を出さず、そのまま続けて押せるようにする
      handleRushMissContinue();
      return true;
    }
    return false;
  }

  if (outcome === 'st_end') {
    setLatestHitChain(game.rush.chainCount + 1);
    // 1連で終われば単発、2連以上なら単発カウントとハマり起点をリセット
    if (game.rush.chainCount === 0) {
      game.tanpatsuStreak++;
    } else {
      game.tanpatsuStreak = 0;
      game.lastChainSpins = game.totalSpins;
    }
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
    addLog(`リスタート！ ST${RUSH_ST_COUNT}回再セット (${rushState.chainCount + 1}連)`, 'rush');
  } else {
    addLog(`${BONUS_LABELS[hitType]}！ ＋${actual}球 (${rushState.chainCount + 1}連)`, 'rush');
  }
  if (hitType === 'b6000') {
    setState('rush_hit_result');
    reveal6000AfterBlank(); // 6000は枠だけレインボーで1秒空にしてから表示
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
  game.enzokuMissStreak = 0;
  game.tanpatsuStreak  = 0;
  game.lastChainSpins  = 0;
  game.hitHistory      = [];
  game.slump = [{ x: 0, y: 0 }];
  game.log             = [];
  render();
}

// ---- 状態セット & レンダリング ----

function setState(state) {
  game.state = state;
  render();
}

// ---- 差玉推移グラフ ----
// 差玉 = 持ち玉 − 投資玉（1000円=250玉）。横軸は通常時の総回転数
function currentDiffBalls() {
  return Math.round(game.mochiDama - game.toushi / 4);
}
function recordSlump() {
  if (!game.slump) game.slump = [{ x: 0, y: 0 }];
  const y = currentDiffBalls();
  const pts = game.slump;
  const last = pts[pts.length - 1];
  if (last.x === game.totalSpins && last.y === y) return;
  pts.push({ x: game.totalSpins, y });
  if (pts.length > 40000) game.slump = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
}
function slumpNiceStep(range) {
  const raw = range / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
function renderSlumpGraph() {
  const el = document.getElementById('slump-svg');
  if (!el) return;
  recordSlump();
  const pts = game.slump;
  const W = 360, H = 170, L = 46, R = 8, T = 10, B = 22;
  const maxX = Math.max(100, pts[pts.length - 1].x);
  let minY = 0, maxY = 0;
  pts.forEach((p) => { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
  if (maxY - minY < 1000) { maxY += 500; minY -= 500; }
  const step = slumpNiceStep(maxY - minY);
  minY = Math.floor(minY / step) * step;
  maxY = Math.ceil(maxY / step) * step;
  const sx = (x) => L + (x / maxX) * (W - L - R);
  const sy = (y) => T + (1 - (y - minY) / (maxY - minY)) * (H - T - B);
  let grid = '';
  for (let v = minY; v <= maxY + 1e-9; v += step) {
    const y = sy(v).toFixed(1);
    grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" class="${v === 0 ? 'sl-zero' : 'sl-grid'}"/>`;
    grid += `<text x="${L - 4}" y="${(+y + 3).toFixed(1)}" class="sl-ylab">${v.toLocaleString()}</text>`;
  }
  const xStep = slumpNiceStep(maxX);
  for (let v = 0; v <= maxX + 1e-9; v += xStep) {
    const anchor = sx(v) > W - R - 16 ? ' style="text-anchor:end"' : '';
    grid += `<text x="${sx(v).toFixed(1)}" y="${H - 6}" class="sl-xlab"${anchor}>${v.toLocaleString()}</text>`;
  }
  const maxPts = (W - L - R) * 2;
  const stride = Math.max(1, Math.floor(pts.length / maxPts));
  const line = pts.filter((_, i) => i % stride === 0 || i === pts.length - 1)
    .map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const cur = pts[pts.length - 1];
  const cls = cur.y >= 0 ? 'plus' : 'minus';
  // 0より上はプラス色、下はマイナス色で塗り分ける
  const zeroOff = Math.min(1, Math.max(0, (sy(0) - T) / (H - T - B))).toFixed(4);
  el.innerHTML = `<defs><linearGradient id="sl-grad" gradientUnits="userSpaceOnUse" x1="0" y1="${T}" x2="0" y2="${H - B}">
      <stop offset="${zeroOff}" stop-color="#2e9e5e"/><stop offset="${zeroOff}" stop-color="#d64545"/>
    </linearGradient></defs>
    ${grid}
    <polyline points="${line}" class="sl-line" stroke="url(#sl-grad)"/>
    <circle cx="${sx(cur.x).toFixed(1)}" cy="${sy(cur.y).toFixed(1)}" r="3" class="sl-dot ${cls}"/>`;
  document.getElementById('slump-now').innerHTML =
    `現在 <b class="${cls}">${cur.y >= 0 ? '+' : ''}${cur.y.toLocaleString()}玉</b>（${game.totalSpins.toLocaleString()}回転）`;
}

function render() {
  renderHeader();
  renderModeBadge();
  renderMainScreen();
  renderRushStats();
  renderHitHistory();
  renderSlumpGraph();
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

// ---- 出現率の表示 ----
function pctText(prob) {
  const pct = prob * 100;
  return pct >= 1 ? pct.toFixed(1) : pct >= 0.01 ? pct.toFixed(2) : pct.toPrecision(2);
}
function rareText(prob) {
  return prob * 100 < 1 ? `<br>約${Math.round(1 / prob).toLocaleString()}回に1回の割合です` : '';
}
function rareNote(html) {
  return `<p class="rare-note">${html}</p>`;
}

// 初当たりのハマり：1000回転超・100回転未満は出現率を表示
function hitIntervalProbHtml(n) {
  if (n > 1000) {
    const p = hitIntervalProbability(n).atLeast;
    return rareNote(`${n.toLocaleString()}回転以上ハマる確率 ${pctText(p)}%${rareText(p)}`);
  }
  if (n < 100) {
    const p = hitIntervalProbability(n).within;
    return rareNote(`${n}回転以内に当たる確率 ${pctText(p)}%${rareText(p)}`);
  }
  return '';
}

// 先バレはずれの連続（5回連続目から）
const ENZOKU_MISS_NOTICE_MIN = 5;
function enzokuMissNoticeHtml() {
  const n = game.enzokuMissStreak;
  if (n < ENZOKU_MISS_NOTICE_MIN) return '';
  const p = Math.pow(1 - ENZOKU_CONFIDENCE / 100, n);
  return rareNote(`先バレはずれ　${n}回連続中<br>発生率 ${pctText(p)}%${rareText(p)}`);
}

// 単発の連続（7回連続目から）＋前回の連チャンからのハマり
const TANPATSU_NOTICE_MIN = 7;
function tanpatsuNoticeHtml() {
  const n = game.tanpatsuStreak;
  if (n < TANPATSU_NOTICE_MIN) return '';
  const p = Math.pow(P_TANPATSU, n);
  const hamari = game.totalSpins - game.lastChainSpins;
  return rareNote(`単発　${n}回連続中<br>発生率 ${pctText(p)}%${rareText(p)}<br>前回の連チャンから ${hamari.toLocaleString()}回転ハマり`);
}

// RUSHリザルトの連チャン分布
function chainProbRowHtml(label, prob) {
  const rare = prob * 100 < 1 ? `<p class="rr-rare">約${Math.round(1 / prob).toLocaleString()}回に1回の割合です</p>` : '';
  return `<div class="result-row">
      <span class="rr-label">${label}</span>
      <span class="rr-val">${pctText(prob)}%</span>
    </div>${rare}`;
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
        ${game.pending.onigakari
          ? `<p class="onigakari-note" id="onigakari-note">鬼がかり予告（信頼度${ONIGAKARI_CONFIDENCE}%に上昇）</p>`
          : ''}
        <p class="result-sub">前回大当たりから ${game.pending.spentSinceLastHit.toLocaleString()}円使用</p>
        ${game.pending.onigakari ? '' : `<p class="shinraido">信頼度 ${ENZOKU_CONFIDENCE}%</p>`}
        <button class="btn-action" id="enzoku-judge-btn" onclick="handleEnzokuJudge()">▶ 判定に進む</button>
      </div>`;

    case 'lose_result':
      return `<div class="screen">
        ${game.pending.hakugei === 'lose' ? '<p class="result-main lose" style="font-size:22px;">白鯨戦 敗北…</p>' : ''}
        <p class="result-main lose">はずれ</p>
        ${enzokuMissNoticeHtml()}
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
        ${hitIntervalProbHtml(game.pending.interval)}
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
        ${hitIntervalProbHtml(game.pending.interval)}
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
        ${tanpatsuNoticeHtml()}
        <button class="btn-sub" onclick="handleAfterRushEntry()" style="margin-top:12px;">続ける</button>
      </div>`;

    case 'rush_idle': {
      const skipDisabled = game.rush.stRemaining <= 10;
      return `<div class="screen">
        <p class="chain-label">${game.rush.chainCount + 1}連チャン中</p>
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
        <p class="chain-label">${game.rush.chainCount + 1}連チャン中</p>
        <div class="vibun-box rush-box${hitType === 'b6000' ? ' box-6000' : ''}" id="rush-hit-box">
          <p class="bonus-main ${rankClass}">${BONUS_LABELS[hitType]}</p>
          <p class="bonus-sub">${sub}</p>
        </div>
        <button class="btn-action" id="rush-hit-continue" onclick="handleRushHitContinue()" style="margin-top:16px;">▶ RUSH継続へ</button>
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
      const dist         = chainProbability(totalHits);

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
          <p class="rr-section">連チャン分布（ST当選率 ${(P_ST_HIT * 100).toFixed(1)}%）</p>
          ${chainProbRowHtml(`${totalHits}連で終わる確率`, dist.exact)}
          ${chainProbRowHtml(`${totalHits}連以上に届く確率`, dist.atLeast)}
          <hr class="result-hr">
          <p class="rr-section">ボーナス内訳</p>
          ${lines.join('')}
        </div>
        ${tanpatsuNoticeHtml()}
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

function setLatestHitChain(chain) {
  if (game.hitHistory.length && game.hitHistory[0].chain === null) game.hitHistory[0].chain = chain;
}

// ---- 大当たり履歴グラフ ----
const HIST_BLOCK = 100;
const HIST_MAX_BLOCKS = 7;
function histColHtml(cls, games, typeLabel, idxLabel) {
  const blocks = Math.min(HIST_MAX_BLOCKS, Math.max(1, Math.ceil(games / HIST_BLOCK)));
  const more = games >= HIST_BLOCK * HIST_MAX_BLOCKS ? '<div class="hist-more">▲</div>' : '';
  return `<div class="hist-col ${cls}">
    <div class="hist-g">${games}</div>${more}
    ${'<div class="hist-block"></div>'.repeat(blocks)}
    <div class="hist-type">${typeLabel}</div>
    <div class="hist-idx">${idxLabel}</div>
  </div>`;
}
function renderHitHistory() {
  const el = document.getElementById('hist-cols');
  if (!el) return;
  let html = histColHtml('now', game.currentSpins, '現在', '');
  game.hitHistory.forEach((h, i) => {
    const cls = h.chain === null ? 'pending' : h.chain >= 10 ? 'big-chain' : h.chain >= 2 ? 'chain' : 'single';
    const label = h.chain === null ? '…' : h.chain >= 2 ? `${h.chain}連` : '単発';
    html += histColHtml(cls, h.games, label, `${i + 1}`);
  });
  if (game.hitHistory.length === 0) html += '<div class="hist-empty">まだ大当たりがありません</div>';
  el.innerHTML = html;
}

function renderLog() {
  const el = document.getElementById('log-list');
  el.innerHTML = game.log.map(item =>
    `<div class="log-item ${item.type}">${item.text}</div>`
  ).join('');
}

render();
