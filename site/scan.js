import { parseContent, dummyApplication, load, save, esc, copyText, participantBadges } from './common.js';

const QR_SCANNER_URL = 'https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js';
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js';

// 同じ QR を映し続けている間は、読み直しとして数えない。
// いったん枠から外れて、この時間が過ぎてから映ったら「読み直し」として扱う。
const SAME_CODE_HOLD_MS = 2000;
const LOG_LIMIT = 500;

const KIND_LABEL = { new: '新規', dup: '受付済み', bad: '対象外' };
const TYPE_LABEL = { t22: '値22字', u22: 'URL', t43: '値43字', u43: 'URL+43字', other: 'その他' };

const $ = (id) => document.getElementById(id);

const settings = Object.assign(
  { engine: 'qr-scanner', camera: '', memo: '', sound: true, vibrate: true },
  load('mockqr.settings', {}),
);
const checkins = load('mockqr.checkins', {}); // 値 -> { at, cancelled: [参加者id] }
let log = load('mockqr.log', []);
if (!Array.isArray(log)) log = [];

let engine = null;
let starting = false;
let resumeOnVisible = false;
let session = newSession();
let current = null; // いま映っている QR
let audioCtx = null;
let torchOn = false;
let nativeQr = null;
let cameraLabel = '';

function newSession() {
  const now = performance.now();
  return { lastAt: now, count: 0, first: null, intervals: [] };
}

// ---- 読み取りエンジン ----

let QrScanner = null;
async function startQrScanner(video) {
  if (!QrScanner) QrScanner = (await import(QR_SCANNER_URL)).default;
  const scanner = new QrScanner(video, (r) => onDecode(r.data), {
    returnDetailedScanResult: true,
    preferredCamera: settings.camera || 'environment',
    highlightScanRegion: true,
    highlightCodeOutline: true,
    maxScansPerSecond: 15,
    onDecodeError: () => {},
  });
  await scanner.start();
  return {
    name: 'qr-scanner',
    stop: () => { scanner.stop(); scanner.destroy(); },
    hasFlash: () => scanner.hasFlash(),
    setTorch: async (on) => { if (scanner.isFlashOn() !== on) await scanner.toggleFlash(); },
  };
}

const scriptPromises = {};
function loadScript(src) {
  if (!scriptPromises[src]) {
    scriptPromises[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { delete scriptPromises[src]; reject(new Error('ライブラリを読み込めませんでした')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromises[src];
}

async function startZxing(video) {
  await loadScript(ZXING_URL);
  const ZX = window.ZXingBrowser;
  if (!ZX) throw new Error('ZXing を読み込めませんでした');
  const reader = new ZX.BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 60 });
  const constraints = {
    audio: false,
    video: settings.camera ? { deviceId: { exact: settings.camera } } : { facingMode: 'environment' },
  };
  const controls = await reader.decodeFromConstraints(constraints, video, (result) => {
    if (result) onDecode(result.getText());
  });
  return {
    name: 'zxing',
    stop: () => controls.stop(),
    hasFlash: async () => typeof controls.switchTorch === 'function',
    setTorch: async (on) => controls.switchTorch(on),
  };
}

// ---- カメラの起動と停止 ----

function freshVideo() {
  const viewer = $('viewer');
  for (const el of [...viewer.children]) if (el.id !== 'viewerMsg') el.remove();
  const v = document.createElement('video');
  v.id = 'video';
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  viewer.prepend(v);
  return v;
}

function setMsg(text) {
  $('viewerMsg').textContent = text;
}

function setRunningUi(running, busy = false) {
  $('startBtn').hidden = running;
  $('startBtn').disabled = busy;
  $('startBtn').textContent = busy ? '起動しています…' : 'カメラを起動';
  $('stopBtn').hidden = !running;
  if (!running) $('torchBtn').hidden = true;
}

async function start() {
  if (starting) return;
  starting = true;
  ensureAudio();
  stopEngine();
  const video = freshVideo();
  setMsg('カメラを起動しています…');
  setRunningUi(false, true);
  try {
    engine = settings.engine === 'zxing' ? await startZxing(video) : await startQrScanner(video);
    session = newSession();
    current = null;
    setMsg('');
    setRunningUi(true);
    updateStats();
    await afterStart(video);
  } catch (err) {
    stopEngine();
    setMsg('カメラを起動できませんでした。\n' + describeError(err));
    setRunningUi(false);
  } finally {
    starting = false;
  }
}

async function afterStart(video) {
  const track = video.srcObject?.getVideoTracks?.()[0];
  cameraLabel = track?.label || '';
  await refreshCameras();
  let flash = false;
  try { flash = await engine.hasFlash(); } catch { flash = false; }
  torchOn = false;
  $('torchBtn').hidden = !flash;
  $('torchBtn').textContent = 'ライト';
  renderEnv();
}

function stopEngine() {
  if (engine) {
    try { engine.stop(); } catch { /* 止まっていれば何もしない */ }
    engine = null;
  }
  const v = $('video');
  if (v?.srcObject) {
    v.srcObject.getTracks().forEach((t) => t.stop());
    v.srcObject = null;
  }
  torchOn = false;
}

function stop() {
  stopEngine();
  setMsg('停止しました');
  setRunningUi(false);
}

async function refreshCameras() {
  let devices = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  } catch {
    devices = [];
  }
  const sel = $('camera');
  sel.innerHTML = '';
  sel.add(new Option('背面カメラ（自動）', ''));
  devices.forEach((d, i) => sel.add(new Option(d.label || `カメラ ${i + 1}`, d.deviceId)));
  sel.value = devices.some((d) => d.deviceId === settings.camera) ? settings.camera : '';
}

function describeError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'カメラの使用が許可されていません。ブラウザの設定で、このサイトのカメラを許可してください。';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'カメラが見つかりません。設定で別のカメラを選んでください。';
  }
  if (name === 'NotReadableError') return 'ほかのアプリがカメラを使っています。そのアプリを閉じてください。';
  return String(err?.message || err);
}

// ---- 読み取った時 ----

function onDecode(text) {
  const now = performance.now();
  if (current && current.text === text && now - current.lastSeen < SAME_CODE_HOLD_MS) {
    current.lastSeen = now;
    return;
  }
  current = { text, lastSeen: now };

  const sinceMs = Math.round(now - session.lastAt);
  const isFirst = session.count === 0;
  session.lastAt = now;
  session.count++;
  if (isFirst) session.first = sinceMs;
  else session.intervals.push(sinceMs);

  const parsed = parseContent(text);
  let kind;
  if (!parsed) {
    kind = 'bad';
    showBad(text);
  } else if (checkins[parsed.token]) {
    kind = 'dup';
    showApp(parsed.token, kind);
  } else {
    checkins[parsed.token] = { at: Date.now(), cancelled: [] };
    save('mockqr.checkins', checkins);
    kind = 'new';
    showApp(parsed.token, kind);
  }
  signal(kind);
  addLog({
    at: Date.now(),
    kind,
    sinceMs,
    isFirst,
    type: parsed?.type || 'other',
    len: text.length,
    head: parsed ? parsed.token.slice(0, 6) : '',
    engine: engine?.name || settings.engine,
    memo: settings.memo,
  });
  updateStats();
}

function showApp(token, kind) {
  const app = dummyApplication(token);
  const rec = checkins[token];
  const cancelled = new Set(rec.cancelled);
  const active = app.participants.length - app.participants.filter((p) => cancelled.has(p.id)).length;
  const headline = kind === 'new' ? '受付しました' : `受付済みです（${fmtTime(rec.at)} に受付）`;
  const box = $('result');
  box.className = 'result ' + kind;
  box.dataset.token = token;
  box.dataset.kind = kind;
  box.innerHTML = `
    <p class="headline">${esc(headline)}</p>
    <p class="meta">${esc(app.session.label)} ${esc(app.session.kind)}・申込番号 ${esc(app.number)}・<strong>${active}人</strong>${cancelled.size ? `（取消 ${cancelled.size}人）` : ''}</p>
    <ul>${app.participants.map((p) => `
      <li class="${cancelled.has(p.id) ? 'cancelled' : ''}">
        <span class="name">${esc(p.nickname)}${participantBadges(p)}</span>
        <label><input type="checkbox" data-id="${p.id}" ${cancelled.has(p.id) ? '' : 'checked'}> 受付</label>
      </li>`).join('')}
    </ul>`;
}

function showBad(text) {
  const box = $('result');
  box.className = 'result bad';
  delete box.dataset.token;
  const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;
  box.innerHTML = `
    <p class="headline">この QR は使えません</p>
    <p class="meta">申込 QR ではありません（${text.length}文字：${esc(preview)}）</p>`;
}

// 参加者ごとの受付の取り消し
$('result').addEventListener('change', (e) => {
  const input = e.target.closest('input[data-id]');
  const box = $('result');
  const token = box.dataset.token;
  if (!input || !token || !checkins[token]) return;
  const id = Number(input.dataset.id);
  const set = new Set(checkins[token].cancelled);
  if (input.checked) set.delete(id);
  else set.add(id);
  checkins[token].cancelled = [...set];
  save('mockqr.checkins', checkins);
  showApp(token, box.dataset.kind);
});

// ---- 音と振動 ----

function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

function beep(freq, dur, delay = 0) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function signal(kind) {
  if (settings.sound) {
    if (kind === 'new') beep(1320, 0.12);
    else if (kind === 'dup') { beep(880, 0.08); beep(880, 0.08, 0.14); }
    else beep(220, 0.3);
  }
  if (settings.vibrate && navigator.vibrate) {
    try { navigator.vibrate(kind === 'new' ? 80 : kind === 'dup' ? [60, 60, 60] : 300); } catch { /* 非対応 */ }
  }
}

// ---- 記録 ----

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('ja-JP', { hour12: false });
}
function fmtSec(ms) {
  return (ms / 1000).toFixed(1) + '秒';
}
function avg(list) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

function addLog(entry) {
  log.push(entry);
  if (log.length > LOG_LIMIT) log = log.slice(-LOG_LIMIT);
  save('mockqr.log', log);
  renderLog();
}

function renderLog() {
  const items = log.slice(-50).reverse().map((e) => `
    <li>
      <span>${fmtTime(e.at)}</span>
      <span class="k-${e.kind}">${KIND_LABEL[e.kind]}</span>
      <span>${e.isFirst ? '起動から' : '間隔'} ${fmtSec(e.sinceMs)}</span>
      <span>${esc(TYPE_LABEL[e.type] || 'その他')}</span>
      ${e.head ? `<span>${esc(e.head)}</span>` : ''}
    </li>`);
  $('log').innerHTML = items.join('') || '<li class="muted">まだ記録はありません</li>';
}

function updateStats() {
  $('statCount').textContent = String(session.count);
  $('statFirst').textContent = session.first == null ? '—' : fmtSec(session.first);
  const a = avg(session.intervals);
  $('statAvg').textContent = a == null ? '—' : fmtSec(a);
}

function envLines() {
  return [
    `端末: ${navigator.userAgent}`,
    `画面: ${screen.width}×${screen.height} @${window.devicePixelRatio}x`,
    `ネイティブの読み取り機能（BarcodeDetector）: ${nativeQr == null ? '確認中' : nativeQr ? 'あり' : 'なし'}`,
    `エンジン: ${settings.engine}`,
    `カメラ: ${cameraLabel || '（未起動）'}`,
  ];
}

function renderEnv() {
  $('env').textContent = envLines().join('\n');
}

function buildReport() {
  const lines = ['# QR 読み取りテストの記録', `コピーした日時: ${new Date().toLocaleString('ja-JP')}`, ...envLines(), ''];
  if (!log.length) {
    lines.push('（記録なし）');
    return lines.join('\n');
  }
  // 条件メモが同じものをまとめる
  const groups = [];
  for (const e of log) {
    const last = groups[groups.length - 1];
    if (last && last.memo === e.memo) last.items.push(e);
    else groups.push({ memo: e.memo, items: [e] });
  }
  let no = 1;
  for (const g of groups) {
    const firsts = g.items.filter((e) => e.isFirst).map((e) => e.sinceMs);
    const intervals = g.items.filter((e) => !e.isFirst).map((e) => e.sinceMs);
    const summary = [`${g.items.length}件`];
    if (firsts.length) summary.push(`起動→最初 平均${fmtSec(avg(firsts))}`);
    if (intervals.length) summary.push(`間隔 平均${fmtSec(avg(intervals))}`);
    const bad = g.items.filter((e) => e.kind === 'bad').length;
    if (bad) summary.push(`対象外 ${bad}件`);
    lines.push(`## 条件: ${g.memo || '（メモなし）'}（${summary.join('・')}）`);
    for (const e of g.items) {
      lines.push(
        `${no++}. ${fmtTime(e.at)} ${KIND_LABEL[e.kind]} ${e.isFirst ? '起動から' : '間隔'}${fmtSec(e.sinceMs)} ` +
        `${TYPE_LABEL[e.type] || 'その他'}(${e.len}字) ${e.head} [${e.engine}]`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---- 画面の操作 ----

function checkEnvironment() {
  const msgs = [];
  if (!window.isSecureContext) msgs.push('HTTPS で開いていないため、カメラを使えません。https:// の URL で開いてください。');
  if (!navigator.mediaDevices?.getUserMedia) msgs.push('このブラウザではカメラを使えません。');
  const ua = navigator.userAgent;
  if (/\bLine\//i.test(ua) || /FBAN|FBAV|Instagram/i.test(ua)) {
    msgs.push('アプリ内ブラウザで開いています。カメラが動かない場合は、Safari か Chrome で開き直してください。');
  }
  if (msgs.length) {
    $('warn').innerHTML = msgs.map(esc).join('<br>');
    $('warn').hidden = false;
  }
}

$('startBtn').addEventListener('click', start);
$('stopBtn').addEventListener('click', stop);
$('torchBtn').addEventListener('click', async () => {
  if (!engine) return;
  try {
    await engine.setTorch(!torchOn);
    torchOn = !torchOn;
    $('torchBtn').textContent = torchOn ? 'ライトを消す' : 'ライト';
  } catch {
    $('torchBtn').hidden = true;
  }
});

$('memo').value = settings.memo;
$('memo').addEventListener('input', (e) => { settings.memo = e.target.value.trim(); save('mockqr.settings', settings); });

$('engine').value = settings.engine;
$('engine').addEventListener('change', (e) => {
  settings.engine = e.target.value;
  save('mockqr.settings', settings);
  renderEnv();
  if (engine) start();
});

$('camera').addEventListener('change', (e) => {
  settings.camera = e.target.value;
  save('mockqr.settings', settings);
  if (engine) start();
});

$('sound').checked = settings.sound;
$('sound').addEventListener('change', (e) => { settings.sound = e.target.checked; save('mockqr.settings', settings); ensureAudio(); });
$('vibrate').checked = settings.vibrate;
$('vibrate').addEventListener('change', (e) => { settings.vibrate = e.target.checked; save('mockqr.settings', settings); });

$('copyBtn').addEventListener('click', async () => {
  const text = buildReport();
  const ok = await copyText(text);
  if (ok) {
    $('copyMsg').textContent = 'コピーしました。Discord に貼ってください。';
  } else {
    $('copyMsg').innerHTML =
      'コピーできませんでした。下の文字を長押ししてコピーしてください。' +
      `<textarea readonly rows="8" style="width:100%;margin-top:6px">${esc(text)}</textarea>`;
  }
});

$('resetCheckins').addEventListener('click', () => {
  if (!confirm('受付状態をリセットしますか？読んだ QR を、もう一度「新規」として読めるようになります。')) return;
  for (const k of Object.keys(checkins)) delete checkins[k];
  save('mockqr.checkins', checkins);
  current = null;
  $('result').className = 'result';
  $('result').innerHTML = '<p class="muted">QR を枠の中に入れてください</p>';
});

$('clearLog').addEventListener('click', () => {
  if (!confirm('記録を消しますか？先に「記録をコピー」で送ったか確かめてください。')) return;
  log = [];
  save('mockqr.log', log);
  session = newSession();
  renderLog();
  updateStats();
  $('copyMsg').textContent = '';
});

// 画面を離れたらカメラを止め、戻ったら再開する
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (engine) {
      resumeOnVisible = true;
      stopEngine();
      setRunningUi(false);
      setMsg('一時停止中');
    }
  } else if (resumeOnVisible) {
    resumeOnVisible = false;
    start();
  }
});

(async () => {
  try {
    nativeQr = 'BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code');
  } catch {
    nativeQr = false;
  }
  renderEnv();
})();

checkEnvironment();
renderLog();
updateStats();
renderEnv();
