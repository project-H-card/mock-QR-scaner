// 申込 QR の mock で、表示側と読み取り側が共通で使う処理。
// サーバーも DB も使わない。参加者などのダミーの内容は、QR の値から毎回同じものを作る。

export const URL_PREFIX = 'https://entry.highsto.net/c/';

// QR の中身の種類。値の長さで QR の細かさ（バージョン）が変わる。
export const CONTENT_MODES = {
  t22: { label: '値のみ・22文字（128bit）', short: '値22字', bytes: 16, url: false },
  u22: { label: 'URL＋値22文字', short: 'URL', bytes: 16, url: true },
  t43: { label: '値のみ・43文字（256bit）', short: '値43字', bytes: 32, url: false },
};

export const ECC_LEVELS = {
  L: 'L（約7%まで復元）',
  M: 'M（約15%まで復元）',
  Q: 'Q（約25%まで復元）',
  H: 'H（約30%まで復元）',
};

const TOKEN_RE = /^(?:[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{43})$/;

export function tokenLength(bytes) {
  return Math.ceil((bytes * 4) / 3);
}

// 推測できない値（base64url、パディングなし）
export function genToken(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function makeContent(token, url) {
  return url ? URL_PREFIX + token : token;
}

// 読み取った文字列から値を取り出す。この mock の QR でなければ null。
export function parseContent(text) {
  const t = String(text).trim();
  if (TOKEN_RE.test(t)) return { token: t, type: t.length === 22 ? 't22' : 't43' };
  if (t.startsWith(URL_PREFIX)) {
    const rest = t.slice(URL_PREFIX.length);
    if (TOKEN_RE.test(rest)) return { token: rest, type: rest.length === 22 ? 'u22' : 'u43' };
  }
  return null;
}

// ---- ダミーの申込 ----

const SESSIONS = [
  { label: '1/10(土) 第1部', kind: '体験会', league: false },
  { label: '1/10(土) 第2部', kind: 'バトル会', league: true },
  { label: '1/24(土)', kind: '大会', league: true },
];
const NICKNAMES = [
  'ゆうと', 'はるか', 'そうた', 'みお', 'けんた', 'りん',
  'たくみ', 'さくら', 'ひなた', 'こうき', 'あおい', 'れん',
];
const LEAGUES = ['ビギナー', 'レギュラー', '未定'];

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dummyApplication(token) {
  const seed = fnv1a(token);
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const session = pick(SESSIONS);
  const count = 1 + Math.floor(rand() * rand() * 5); // 1〜5人、少人数が多め
  const names = [...NICKNAMES];
  const participants = [];
  for (let i = 0; i < count; i++) {
    const nickname = names.splice(Math.floor(rand() * names.length), 1)[0];
    participants.push({
      id: i,
      nickname,
      league: session.league ? pick(LEAGUES) : null,
      first: session.kind === '体験会' ? rand() < 0.6 : null,
      noPhoto: rand() < 0.2,
    });
  }
  return { number: 'E' + String(1000 + (seed % 9000)), session, participants };
}

// ---- QR の描画（qrcode-generator を window.qrcode として読み込んでおく）----

export function makeQr(text, ecc) {
  const qr = window.qrcode(0, ecc);
  qr.addData(text);
  qr.make();
  return qr;
}

export function qrVersion(qr) {
  return (qr.getModuleCount() - 17) / 4;
}

export function qrSvg(qr, margin = 4) {
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QRコード">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
  );
}

export function qrCanvas(qr, scale = 12, margin = 4) {
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    }
  }
  return canvas;
}

// ---- 小物 ----

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // プライベートブラウズなどで保存できなくても、画面は動かす
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 古いブラウザ向け
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export function participantBadges(p) {
  const out = [];
  if (p.league) out.push(`<span class="badge">${esc(p.league)}</span>`);
  if (p.first) out.push('<span class="badge first">初めて</span>');
  if (p.noPhoto) out.push('<span class="badge nophoto">撮影NG</span>');
  return out.join('');
}
