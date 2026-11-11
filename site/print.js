import { CONTENT_MODES, genToken, makeContent, makeQr, qrVersion, qrSvg, dummyApplication, esc } from './common.js';

const MODES = ['t22', 'u22', 't43'];
const ECCS = ['M', 'Q'];
const SIZES_MM = [40, 30, 20];

function render() {
  const cards = [];
  let no = 1;
  for (const size of SIZES_MM) {
    for (const m of MODES) {
      for (const e of ECCS) {
        const mode = CONTENT_MODES[m];
        const token = genToken(mode.bytes);
        const qr = makeQr(makeContent(token, mode.url), e);
        const app = dummyApplication(token);
        cards.push(`
          <div class="card">
            <div class="code" style="width:${size}mm">${qrSvg(qr)}</div>
            <p><strong>No.${no}</strong> ${esc(mode.short)} / ${e} / ${size}mm</p>
            <p>先頭 ${esc(token.slice(0, 6))}・V${qrVersion(qr)}・${esc(app.number)}</p>
          </div>`);
        no++;
      }
    }
  }
  document.getElementById('sheet').innerHTML = cards.join('');
}

document.getElementById('print').addEventListener('click', () => window.print());
document.getElementById('regen').addEventListener('click', render);
render();
