const $ = (id) => document.getElementById(id);
const img = $('shot'), sel = $('sel'), wrap = $('wrap'), done = $('done');
const steps = [
  { key: 'priceRect', cls: 'price', text: 'Trascina un rettangolo sulla <b>colonna dei prezzi</b> del grafico su cui fai trading: dall\'alto al basso del grafico, largo quanto le etichette dei prezzi.' },
  { key: 'TP', click: true, optional: true, text: 'Dentro il <b>riquadro verde</b> della colonna dei prezzi, clicca sull\'<b>etichetta colorata del take profit</b> (quella con il prezzo, non il riquadro "+… USD" nel grafico).' },
  { key: 'SL', click: true, optional: true, text: 'Sempre dentro il riquadro verde, clicca sull\'<b>etichetta colorata dello stop loss</b>.' },
  { key: 'ENTRY', click: true, optional: true, text: 'Sempre dentro il riquadro verde, clicca sull\'<b>etichetta colorata del prezzo di ingresso</b> (di solito blu).' },
  { key: 'balanceRect', cls: 'balance', text: 'Trascina un rettangolo stretto intorno al <b>saldo</b> del conto (solo il numero, per esempio $50,000.00).' },
  { key: 'symbolRect', cls: 'symbol', optional: true, text: 'Trascina un rettangolo intorno al <b>nome dello strumento</b> (per esempio MNQ, in alto a sinistra sul grafico o nella barra in alto). Se lo salti, il simbolo lo scrivi tu la prima volta.' },
  { key: 'clockRect', cls: 'clock', optional: true, text: '<b>Solo per i backtest:</b> trascina un rettangolo intorno all\'<b>orologio del replay</b> (per esempio 10:49:59 UTC+2).' },
  { key: 'axisRect', cls: 'axis', optional: true, text: '<b>Solo per i backtest:</b> trascina un rettangolo lungo e basso sulla <b>striscia delle ore sotto il grafico</b>: è lì che compare la data quando il mouse è sul grafico.' },
  { key: 'shotRect', cls: 'shot', optional: true, text: '<b>Facoltativo:</b> trascina un rettangolo intorno alla parte dello schermo da salvare come screenshot nel journal (di solito la <b>finestra del browser</b>, senza barra delle applicazioni). Per leggere i valori si usa comunque tutto lo schermo. Se salti, nel journal va tutto lo schermo.' },
];
// lo screenshot riempie lo schermo, mantenendo le proporzioni
function fit() {
  if (!img.naturalWidth) return;
  const s = Math.min(innerWidth / img.naturalWidth, innerHeight / img.naturalHeight), w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
  wrap.style.left = Math.round((innerWidth - w) / 2) + 'px'; wrap.style.top = Math.round((innerHeight - h) / 2) + 'px';
}
addEventListener('resize', fit);
// pannello dei passi spostabile
(function () {
  const panel = $('panel'), grip = $('grip'); let off = null;
  grip.addEventListener('pointerdown', (e) => { const r = panel.getBoundingClientRect(); off = { x: e.clientX - r.left, y: e.clientY - r.top }; grip.classList.add('drag'); grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointermove', (e) => {
    if (!off) return;
    const r = panel.getBoundingClientRect();
    panel.style.left = Math.min(Math.max(0, e.clientX - off.x), Math.max(0, innerWidth - r.width)) + 'px';
    panel.style.top = Math.min(Math.max(0, e.clientY - off.y), Math.max(0, innerHeight - 40)) + 'px';
  });
  const end = () => { off = null; grip.classList.remove('drag'); };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
})();
let plan = steps, step = 0, start = null, rects = { hues: {} }, platform = '', autoOffer = null;
const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });

// ----- calibrazione automatica -----
const CLS = { priceRect: 'price', balanceRect: 'balance', clockRect: 'clock', axisRect: 'axis' };
const LBL = { priceRect: 'colonna dei prezzi', balanceRect: 'saldo', clockRect: 'orologio del replay', axisRect: 'riga della data' };
function btns(show) { for (const id of ['auto', 'accept', 'manual', 'skip']) $(id).hidden = !show.includes(id); }
function offerAuto() {
  plan = []; step = 0; autoOffer = null; wrap.style.cursor = 'default';
  $('msg').innerHTML = `<b>${platform ? platform + ' — ' : ''}calibrazione.</b> Provo a trovare da solo colonna dei prezzi, saldo, orologio e riga della data. Serve un <b>trade aperto</b> con take profit e stop loss visibili sul grafico. Se non va bene, disegni tu i rettangoli.`;
  btns(['auto', 'manual']);
}
function startManual() { plan = steps; step = 0; autoOffer = null; done.innerHTML = ''; rects = { hues: {} }; showStep(); }
async function runAuto() {
  btns([]); wrap.style.cursor = 'wait'; $('redo').disabled = true;
  const t0 = Date.now(), tick = () => { $('msg').innerHTML = `<div class="busy"><span class="spin" aria-hidden="true"></span><div><b>Sto leggendo lo schermo…</b><br><span class="muted">${Math.round((Date.now() - t0) / 1000)} secondi — di solito ne bastano circa 6. Non toccare niente.</span></div></div><div class="bar"><i></i></div>`; };
  tick(); const timer = setInterval(tick, 1000);
  let r; try { r = await api.calibAuto(); } finally { clearInterval(timer); wrap.style.cursor = 'default'; $('redo').disabled = false; }
  if (!r) { offerAuto(); return; }
  autoOffer = r; done.innerHTML = '';
  const k = img.naturalWidth / img.clientWidth;
  for (const key of Object.keys(CLS)) {
    const q = r.rects[key]; if (!q) continue;
    const b = document.createElement('div'); b.className = 'box ' + CLS[key];
    boxStyle(b, { x: q.x / k, y: q.y / k }, { x: (q.x + q.width) / k, y: (q.y + q.height) / k }); done.appendChild(b);
  }
  const list = Object.keys(CLS).map((key) => `<li>${r.found[key] ? '✅' : (key === 'clockRect' || key === 'axisRect') ? '➖' : '❌'} ${LBL[key]}${r.found[key] ? '' : (key === 'clockRect' || key === 'axisRect') ? ' (serve solo per i backtest)' : ' non trovato'}</li>`).join('');
  const ok = r.found.priceRect && r.found.balanceRect;
  $('msg').innerHTML = `<b>Ecco cosa ho trovato</b> (i riquadri colorati sullo schermo).<ul class="found">${list}</ul>${(r.notes || []).map((n) => `<p class="neg">${n}</p>`).join('')}${r.multiple ? '<p class="muted">Ci sono più colonne con etichette: ho scelto la più chiara.</p>' : ''}${ok ? 'Controlla che i riquadri siano al posto giusto.' : 'Quello che manca lo disegni tu.'}`;
  $('accept').textContent = ok ? 'Va bene, continua' : 'Completo a mano quello che manca';
  btns(['accept', 'manual']);
}
function acceptAuto() {
  const r = autoOffer; if (!r) return;
  rects = { ...r.rects, hues: r.hues || {} };
  plan = steps.filter((s) => !r.found[s.key] && !(s.click && r.found.priceRect));   // restano i passi che l'automatico non ha coperto (e quelli facoltativi: simbolo, area screenshot)
  step = 0; autoOffer = null;
  if (!plan.length) { finish(); return; }
  showStep();
}

function showStep() {
  btns(plan[step] && plan[step].optional ? ['skip'] : []);
  const st = plan[step];
  $('msg').innerHTML = st ? `<b>${platform ? platform + ' — ' : ''}passo ${step + 1} di ${plan.length}.</b> ${st.text}` : 'Leggo i valori…';
  $('skip').textContent = st && st.click ? 'Salta (colore standard)' : 'Salta';
  wrap.style.cursor = st && st.click ? 'pointer' : 'crosshair';
}
function reset() { plan = steps; step = 0; rects = { hues: {} }; done.innerHTML = ''; $('result').hidden = true; offerAuto(); }
function next() { step++; showStep(); if (step === plan.length) finish(); }

function hueAt(nx, ny) {
  // media 3x3 intorno al punto cliccato, poi tonalità (0-360)
  const d = ctx.getImageData(Math.max(0, nx - 1), Math.max(0, ny - 1), 3, 3).data;
  let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  r /= 9; g /= 9; b /= 9;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn;
  if (!mx || dd / mx < 0.25 || mx < 64) return null;   // grigio o troppo scuro: non è un'etichetta colorata
  let h = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  h *= 60; if (h < 0) h += 360;
  return { h: Math.round(h), rgb: `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})` };
}

async function finish() {
  $('skip').hidden = true;
  const r = await api.saveCalibration(rects);
  const v = (x) => (x === null || x === undefined ? '<span class="neg">non letto</span>' : x);
  $('msg').innerHTML = `<b>Calibrazione salvata${platform ? ' per ' + platform : ''}.</b> Controlla qui sotto cosa ho letto. Se qualcosa è sbagliato premi Ricomincia.`;
  $('result').hidden = false;
  $('result').innerHTML = `<table>
    <tr><td class="muted">Take profit</td><td>${v(r.tp)}</td><td class="muted">valore</td><td>${v(r.tpUsd)}</td></tr>
    <tr><td class="muted">Stop loss</td><td>${v(r.sl)}</td><td class="muted">valore</td><td>${v(r.slUsd)}</td></tr>
    <tr><td class="muted">Ingresso</td><td>${v(r.entry)}</td><td class="muted">contratti</td><td>${v(r.contracts)}</td></tr>
    <tr><td class="muted">Direzione</td><td>${v(r.direction)}</td><td class="muted">saldo</td><td>${v(r.balance)}</td></tr>
    <tr><td class="muted">Screenshot nel journal</td><td>${r.hasShot ? 'solo l\'area scelta' : 'tutto lo schermo'}</td><td></td><td></td></tr>
        <tr><td class="muted">Simbolo</td><td>${r.hasSymbol ? v(r.symbol) : '<span class="muted">saltato</span>'}</td><td></td><td></td></tr>
    <tr><td class="muted">Ora del replay</td><td>${r.hasClock ? v(r.replayTime) : '<span class="muted">saltato</span>'}</td><td class="muted">data</td><td>${r.hasAxis ? (r.replayDate || '<span class="muted">non visibile ora</span>') : '<span class="muted">saltato</span>'}</td></tr></table>
    <div class="muted note">Se non c'era un trade aperto sullo schermo è normale che prezzi, valori e contratti risultino "non letti".</div>`;
}

function pos(e) {
  const r = img.getBoundingClientRect();
  return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) };
}
function boxStyle(el, a, b) {
  el.style.left = Math.min(a.x, b.x) + 'px'; el.style.top = Math.min(a.y, b.y) + 'px';
  el.style.width = Math.abs(a.x - b.x) + 'px'; el.style.height = Math.abs(a.y - b.y) + 'px';
}

wrap.addEventListener('mousedown', (e) => {
  if (step >= plan.length) return;
  const st = plan[step], k = img.naturalWidth / img.clientWidth, p = pos(e);
  if (st.click) {
    const pr = rects.priceRect, nx = p.x * k, ny = p.y * k;
    if (pr && (nx < pr.x - 4 || nx > pr.x + pr.width + 4 || ny < pr.y - 4 || ny > pr.y + pr.height + 4)) {
      $('msg').innerHTML = `<span class="neg">Hai cliccato fuori dalla colonna dei prezzi.</span> ${st.text}`; return;
    }
    const c = hueAt(Math.round(p.x * k), Math.round(p.y * k));
    if (!c) { $('msg').innerHTML = `<span class="neg">Lì non c'è un colore deciso.</span> ${st.text} (clicca sul fondo colorato dell'etichetta, non sulle cifre)`; return; }
    rects.hues[st.key] = c.h;
    const dot = document.createElement('div'); dot.className = 'pick'; dot.style.left = p.x + 'px'; dot.style.top = p.y + 'px'; dot.style.background = c.rgb; dot.title = st.key; done.appendChild(dot);
    next(); return;
  }
  start = p; sel.hidden = false; boxStyle(sel, start, start);
});
window.addEventListener('mousemove', (e) => { if (start) boxStyle(sel, start, pos(e)); });
window.addEventListener('mouseup', (e) => {
  if (!start) return;
  const end = pos(e); const a = start; start = null; sel.hidden = true;
  if (Math.abs(a.x - end.x) < 5 || Math.abs(a.y - end.y) < 5) return;
  const k = img.naturalWidth / img.clientWidth;
  rects[plan[step].key] = {
    x: Math.round(Math.min(a.x, end.x) * k), y: Math.round(Math.min(a.y, end.y) * k),
    width: Math.round(Math.abs(a.x - end.x) * k), height: Math.round(Math.abs(a.y - end.y) * k),
  };
  const box = document.createElement('div'); box.className = 'box ' + plan[step].cls; boxStyle(box, a, end); done.appendChild(box);
  next();
});

// Esc chiude la calibrazione (sempre una via d'uscita)
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !start) api.closeCalibration(); });
$('skip').onclick = () => next();
$('auto').onclick = runAuto;
$('manual').onclick = startManual;
$('accept').onclick = acceptAuto;
$('redo').onclick = reset;
$('close').onclick = () => api.closeCalibration();
api.getCalibration().then((c) => {
  if (!c) return;
  platform = c.platform || '';
  img.onload = () => { fit(); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; ctx.drawImage(img, 0, 0); reset(); };
  img.src = c.image;
});
