import {
  CONTENT_MODES, ECC_LEVELS, genToken, tokenLength, makeContent,
  makeQr, qrVersion, qrCanvas, dummyApplication, esc, participantBadges,
} from './common.js';

const $ = (id) => document.getElementById(id);
const has = (obj, key) => key != null && Object.prototype.hasOwnProperty.call(obj, key);

// 状態は URL の # に持つ（再読み込みしても同じ QR が出る）
const params = new URLSearchParams(location.hash.slice(1));
const state = {
  m: has(CONTENT_MODES, params.get('m')) ? params.get('m') : 't22',
  e: has(ECC_LEVELS, params.get('e')) ? params.get('e') : 'M',
  s: ['100', '70', '45'].includes(params.get('s')) ? params.get('s') : '100',
  t: params.get('t') || '',
};

for (const [value, mode] of Object.entries(CONTENT_MODES)) $('mode').add(new Option(mode.label, value));
for (const [value, label] of Object.entries(ECC_LEVELS)) $('ecc').add(new Option(label, value));

let currentCanvas = null;

function render() {
  const mode = CONTENT_MODES[state.m];
  if (!/^[A-Za-z0-9_-]+$/.test(state.t) || state.t.length !== tokenLength(mode.bytes)) {
    state.t = genToken(mode.bytes);
  }
  const content = makeContent(state.t, mode.url);
  const qr = makeQr(content, state.e);
  currentCanvas = qrCanvas(qr, 12);
  $('qrImg').src = currentCanvas.toDataURL('image/png');
  $('qr').style.width = state.s + '%';

  const app = dummyApplication(state.t);
  $('appNo').textContent = app.number;
  $('session').textContent = `${app.session.label} ${app.session.kind}・${app.participants.length}人`;
  $('people').innerHTML = app.participants
    .map((p) => `<li>${esc(p.nickname)}${participantBadges(p)}</li>`)
    .join('');

  const n = qr.getModuleCount();
  $('info').textContent =
    `QR バージョン ${qrVersion(qr)}（${n}×${n} マス）・中身 ${content.length} 文字・先頭 ${state.t.slice(0, 6)}`;

  $('mode').value = state.m;
  $('ecc').value = state.e;
  $('size').value = state.s;
  history.replaceState(null, '', '#' + new URLSearchParams(state).toString());
}

$('mode').addEventListener('change', (e) => { state.m = e.target.value; render(); });
$('ecc').addEventListener('change', (e) => { state.e = e.target.value; render(); });
$('size').addEventListener('change', (e) => { state.s = e.target.value; render(); });
$('regen').addEventListener('click', () => { state.t = ''; render(); window.scrollTo({ top: 0 }); });

$('savePng').addEventListener('click', () => {
  if (!currentCanvas) return;
  currentCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `申込QR_${dummyApplication(state.t).number}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, 'image/png');
});

render();
