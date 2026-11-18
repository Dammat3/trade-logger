/* Condividi un trade come post (Instagram e altri social): una card nel tuo tema e un testo già scritto.
   La card si disegna qui, sul PC. Per pubblicare: si salva l'immagine, si copia il testo e si apre il social. */
const POST_FORMATS = { feed: { w: 1080, h: 1350, label: 'Feed (4:5)' }, square: { w: 1080, h: 1080, label: 'Quadrato (1:1)' }, story: { w: 1080, h: 1920, label: 'Storia (9:16)' } };
const POST_DISCLAIMER = 'Non è consulenza finanziaria. I risultati passati non garantiscono quelli futuri.';

function postDefaults() {
  return { handle: '', hashtags: '#trading #futures #daytrading #tradingjournal', emoji: true, mode: 'R', format: 'feed', ...(S.settings.share || {}) };
}
const postAccount = (t) => S.accounts.find((a) => a.id === t.account_id) || S.accounts.find((a) => a.id === S.accountId) || {};

// ---------- dati della card ----------
function postSpec(t, o) {
  const acc = postAccount(t), R = rOf(t);
  const mode = o.mode === 'R' && R == null ? 'hide' : o.mode;                 // senza stop in dollari il risultato in R non si può calcolare
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');
  let result = null, value = t.pnl;
  if (mode === 'R') { result = `${sign(R)}${fmt(Math.abs(R), 2).replace(',00', '').replace(/,(\d)0$/, ',$1')}R`; value = R; }
  else if (mode === 'USD') result = `${t.pnl > 0 ? '+' : ''}${moneyPlain(t.pnl)}`;
  const outcome = t.outcome === 'TP' ? 'Take profit' : t.outcome === 'SL' ? 'Stop loss' : t.outcome === 'MANUALE' ? 'Chiuso a mano' : (t.pnl > 0 ? 'In profitto' : t.pnl < 0 ? 'In perdita' : 'In pareggio');
  // curva: ultimi trade chiusi del conto fino a questo (in R se quasi tutti hanno il rischio, altrimenti in risultato)
  const all = S.trades.filter((x) => x.status !== 'aperto' && (x.account_id === t.account_id || !x.account_id)).sort(sortTrades);
  const upto = all.filter((x) => sortTrades(x, t) <= 0).slice(-25);
  const withR = upto.filter((x) => rOf(x) != null).length >= Math.max(2, Math.ceil(upto.length * 0.6));
  let acc2 = 0; const curve = upto.map((x) => (acc2 += withR ? (rOf(x) ?? 0) : x.pnl));
  const dir = t.direction === 'LONG' ? 'Long' : t.direction === 'SHORT' ? 'Short' : '';
  return { t, acc, backtest: acc.kind === 'backtest', mode, result, value, outcome, dir, curve, curveInR: withR, n: upto.length };
}

// ---------- testo del post ----------
function postCaption(sp, o, variant) {
  const { t } = sp, e = (x) => (o.emoji ? x : ''), when = `${itDate(t.trade_date)}${t.trade_time ? ' ' + t.trade_time : ''}`;
  const good = sp.value > 0, bad = sp.value < 0;
  const mark = good ? e('✅ ') : bad ? e('❌ ') : e('➖ ');
  const arrow = t.direction === 'LONG' ? e('📈 ') : t.direction === 'SHORT' ? e('📉 ') : '';
  const sym = t.symbol || 'Trade', res = sp.result ? ` ${sp.result}` : '';
  const note = (t.notes || '').trim().split(/\n/)[0].slice(0, 220);
  const lines = [];
  if (variant % 3 === 0) {
    lines.push(`${mark}${sym} ${sp.dir}${sp.result ? ' — ' + sp.result : ''}`.trim());
    if (t.setup) lines.push(`Setup: ${t.setup}`);
    lines.push(sp.backtest ? `Backtest (replay del ${when}): non è operatività reale.` : `Chiuso a ${sp.outcome.toLowerCase()} il ${when}.`);
    if (note) lines.push('', note);
  } else if (variant % 3 === 1) {
    lines.push(`${e('📓 ')}Dal diario di trading: ${sym} ${sp.dir}${res}`.trim());
    lines.push(sp.backtest ? `Test in backtest, replay del ${when}.` : `Trade del ${when}, ${sp.outcome.toLowerCase()}.`);
    if (t.setup) lines.push(`Setup usato: ${t.setup}.`);
    lines.push(note ? `Nota: ${note}` : 'Ogni trade annotato è una lezione in più.');
  } else {
    lines.push(`${arrow}${sym} ${sp.dir}${res} ${good ? e('🔥') : ''}`.trim());
    if (t.setup) lines.push(t.setup);
    if (sp.backtest) lines.push('Backtest, non operatività reale.');
    if (note) lines.push(note);
  }
  lines.push('', sp.backtest ? 'Risultato di un backtest, non di operatività reale. Non è consulenza finanziaria.' : POST_DISCLAIMER);
  const tags = [o.hashtags.trim(), t.symbol ? `#${t.symbol.replace(/[^A-Za-z0-9]/g, '')}` : ''].filter(Boolean).join(' ');
  if (tags) lines.push('', tags);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- disegno della card ----------
function rrPath(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function fitFont(c, text, weight, family, size, maxW) { let s = size; for (; s > 18; s -= 2) { c.font = `${weight} ${s}px ${family}`; if (c.measureText(text).width <= maxW) break; } return s; }
function wrapText(c, text, maxW) {
  const out = []; let line = '';
  for (const w of text.split(/\s+/)) { const test = line ? `${line} ${w}` : w; if (c.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test; }
  if (line) out.push(line); return out;
}
async function loadBlobImage(blob) {
  const url = URL.createObjectURL(blob);
  try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}
async function postImageBlob(imgRec) {
  if (!imgRec) return null;
  try {
    if (S.local) {
      const r = await S.db.call('readImage', { path: imgRec.path });
      const u8 = r instanceof Uint8Array ? r : new Uint8Array(r.data || r);
      return new Blob([u8]);
    }
    const urls = await S.db.imageUrls([imgRec.path]); const res = await fetch(urls[imgRec.path]); return res.ok ? await res.blob() : null;
  } catch { return null; }
}

async function drawPostCard(canvas, sp, o, shot) {
  const t = sp.t, F = POST_FORMATS[o.format] || POST_FORMATS.feed, W = F.w, H = F.h;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d'), cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || d).trim() || d;
  const bg = v('--bg', '#0d0f12'), text = v('--text', '#e9ebef'), muted = v('--muted', '#8a919d'), faint = v('--faint', '#5b616c'), profit = v('--profit', '#30c27a'), loss = v('--loss', '#e35d5f'), accent = v('--accent', '#3d7bff'), gold = v('--gold', '#e8b64a');
  const rgb = (n, d) => v(n, d), light = document.documentElement.dataset.theme === 'ghiaccio';
  const fd = v('--font-display', 'sans-serif'), fb = v('--font', 'sans-serif');
  try { await Promise.all([document.fonts.load(`600 80px ${fd}`), document.fonts.load(`500 30px ${fb}`), document.fonts.load(`700 30px ${fb}`)]); } catch { /* si usa il carattere di riserva */ }
  const resCol = sp.value > 0 ? profit : sp.value < 0 ? loss : muted, resRgb = sp.value > 0 ? rgb('--rgb-profit', '48,194,122') : sp.value < 0 ? rgb('--rgb-loss', '227,93,95') : rgb('--rgb-neutral', '138,145,157');
  const P = 72, story = H > 1500, tall = H > 1300, wantShot = !!shot, wantCurve = o.curve && sp.curve.length >= 2, tight = wantShot && !story;
  // sfondo
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  let g = c.createRadialGradient(W * 0.08, 0, 0, W * 0.08, 0, W * 0.9); g.addColorStop(0, `rgba(${rgb('--rgb-accent', '61,123,255')}, ${light ? 0.16 : 0.22})`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  g = c.createRadialGradient(W, H, 0, W, H, W * 0.95); g.addColorStop(0, `rgba(${resRgb}, ${light ? 0.14 : 0.2})`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.strokeStyle = light ? 'rgba(22,52,112,.05)' : 'rgba(255,255,255,.035)'; c.lineWidth = 2;
  for (let x = 0; x <= W; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let y = 0; y <= H; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  // intestazione: marchio e (backtest) etichetta
  let y = story ? 120 : 72;
  rrPath(c, P, y, 64, 64, 16); c.fillStyle = light ? '#fff' : 'rgba(255,255,255,.08)'; c.fill(); c.strokeStyle = faint; c.lineWidth = 2; c.stroke();
  c.beginPath(); c.moveTo(P + 14, y + 44); c.lineTo(P + 26, y + 30); c.lineTo(P + 36, y + 38); c.lineTo(P + 52, y + 18); c.strokeStyle = profit; c.lineWidth = 6; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
  c.fillStyle = text; c.textBaseline = 'middle'; c.font = `600 40px ${fd}`; c.textAlign = 'left'; c.fillText('Journal', P + 82, y + 33);
  if (sp.backtest) {
    c.font = `700 30px ${fb}`; const w = c.measureText('BACKTEST').width + 52; rrPath(c, W - P - w, y + 8, w, 52, 26); c.fillStyle = `rgba(${rgb('--rgb-gold', '232,182,74')}, .16)`; c.fill(); c.strokeStyle = gold; c.lineWidth = 3; c.stroke();
    c.fillStyle = gold; c.textAlign = 'center'; c.fillText('BACKTEST', W - P - w / 2, y + 35); c.textAlign = 'left';
  } else if (o.handle) { c.font = `500 32px ${fb}`; c.fillStyle = muted; c.textAlign = 'right'; c.fillText(o.handle, W - P, y + 33); c.textAlign = 'left'; }
  y += story ? 200 : 140;
  // simbolo e direzione
  const sym = t.symbol || 'Trade';
  const ss = fitFont(c, sym, 700, fd, story ? 190 : tight ? 124 : 160, W - 2 * P - 280); c.font = `700 ${ss}px ${fd}`; c.fillStyle = text; c.textBaseline = 'alphabetic'; c.fillText(sym, P, y + ss * 0.8);
  const symW = c.measureText(sym).width;
  if (sp.dir) {
    const dc = t.direction === 'LONG' ? profit : loss, label = `${sp.dir.toUpperCase()} ${t.direction === 'LONG' ? '▲' : '▼'}`;
    c.font = `700 40px ${fb}`; const w = c.measureText(label).width + 56, px = P + symW + 36;
    rrPath(c, px, y + ss * 0.8 - 62, w, 64, 32); c.fillStyle = `rgba(${t.direction === 'LONG' ? rgb('--rgb-profit', '48,194,122') : rgb('--rgb-loss', '227,93,95')}, .16)`; c.fill(); c.strokeStyle = dc; c.lineWidth = 3; c.stroke();
    c.fillStyle = dc; c.textBaseline = 'middle'; c.fillText(label, px + 28, y + ss * 0.8 - 29); c.textBaseline = 'alphabetic';
  }
  y += ss * 0.8 + (tight ? 40 : 52);
  const sub = [t.setup, `${itDate(t.trade_date)}${t.trade_time ? ' · ' + t.trade_time : ''}`].filter(Boolean).join('   ·   ');
  const sz = fitFont(c, sub, 500, fb, 38, W - 2 * P); c.font = `500 ${sz}px ${fb}`; c.fillStyle = muted;
  c.fillText(sub, P, y); y += story ? 80 : tight ? 44 : 56;
  // risultato
  if (sp.result) {
    const rs = fitFont(c, sp.result, 700, fd, story ? 250 : tight ? 160 : 220, W - 2 * P);
    c.font = `700 ${rs}px ${fd}`; c.shadowColor = `rgba(${resRgb}, ${light ? 0.25 : 0.55})`; c.shadowBlur = light ? 18 : 42; c.fillStyle = resCol; c.fillText(sp.result, P, y + rs * 0.85); c.shadowBlur = 0; c.shadowColor = 'transparent';
    y += rs * 0.85 + (tight ? 36 : 50);
  } else y += 8;
  c.font = `600 42px ${fb}`; c.fillStyle = text; c.fillText(sp.outcome, P, y); y += story ? 80 : tight ? 40 : 56;
  // pannelli: screenshot e/o curva, nello spazio che resta
  const footerH = 150, bottom = H - footerH, avail = bottom - y;
  if ((wantShot || wantCurve) && avail > 220) {
    const gap = 28, panels = (wantShot ? 1 : 0) + (wantCurve ? 1 : 0), ph = wantShot && wantCurve ? Math.min((avail - gap) * 0.68, avail - gap - 200) : avail;
    const panel = (px, py, pw, phh) => { rrPath(c, px, py, pw, phh, 28); c.fillStyle = light ? 'rgba(22,52,112,.05)' : 'rgba(255,255,255,.045)'; c.fill(); c.strokeStyle = light ? 'rgba(22,52,112,.16)' : 'rgba(255,255,255,.14)'; c.lineWidth = 2; c.stroke(); };
    let py = y;
    if (wantShot) {
      panel(P, py, W - 2 * P, ph); c.save(); rrPath(c, P + 2, py + 2, W - 2 * P - 4, ph - 4, 26); c.clip();
      const sc = Math.max((W - 2 * P) / shot.width, ph / shot.height), dw = shot.width * sc, dh = shot.height * sc; c.drawImage(shot, P + (W - 2 * P - dw) / 2, py + (ph - dh) / 2, dw, dh); c.restore();
      py += ph + gap;
    }
    if (wantCurve) {
      const chh = wantShot ? avail - ph - gap : Math.min(avail, 420);
      panel(P, py, W - 2 * P, chh);
      const cx = P + 36, cy = py + 78, cw = W - 2 * P - 72, ch = chh - 78 - 36, vals = sp.curve, mn = Math.min(0, ...vals), mx = Math.max(0, ...vals), span = mx - mn || 1;
      const X = (i) => cx + (i / (vals.length - 1)) * cw, Y = (val) => cy + ch - ((val - mn) / span) * ch;
      c.font = `500 30px ${fb}`; c.fillStyle = muted; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(`Ultimi ${sp.n} trade`, cx, py + 50);
      if (sp.curveInR) { const last = vals[vals.length - 1]; c.textAlign = 'right'; c.fillStyle = last >= 0 ? profit : loss; c.font = `700 32px ${fd}`; c.fillText(`${last > 0 ? '+' : last < 0 ? '−' : ''}${fmt(Math.abs(last), 1)}R`, cx + cw, py + 50); c.textAlign = 'left'; }
      c.setLineDash([10, 10]); c.strokeStyle = light ? 'rgba(22,52,112,.3)' : 'rgba(255,255,255,.25)'; c.lineWidth = 2; c.beginPath(); c.moveTo(cx, Y(0)); c.lineTo(cx + cw, Y(0)); c.stroke(); c.setLineDash([]);
      const lc = vals[vals.length - 1] >= 0 ? profit : loss, lr = vals[vals.length - 1] >= 0 ? rgb('--rgb-profit', '48,194,122') : rgb('--rgb-loss', '227,93,95');
      const grad = c.createLinearGradient(0, cy, 0, cy + ch); grad.addColorStop(0, `rgba(${lr}, .32)`); grad.addColorStop(1, `rgba(${lr}, 0)`);
      c.beginPath(); vals.forEach((val, i) => (i ? c.lineTo(X(i), Y(val)) : c.moveTo(X(i), Y(val)))); c.lineTo(X(vals.length - 1), cy + ch); c.lineTo(X(0), cy + ch); c.closePath(); c.fillStyle = grad; c.fill();
      c.beginPath(); vals.forEach((val, i) => (i ? c.lineTo(X(i), Y(val)) : c.moveTo(X(i), Y(val)))); c.lineWidth = 6; c.strokeStyle = lc; c.lineJoin = 'round'; c.lineCap = 'round'; c.shadowColor = `rgba(${lr}, .6)`; c.shadowBlur = light ? 0 : 16; c.stroke(); c.shadowBlur = 0;
      c.beginPath(); c.arc(X(vals.length - 1), Y(vals[vals.length - 1]), 11, 0, Math.PI * 2); c.fillStyle = lc; c.fill();
    }
  }
  // piede: avviso
  c.textBaseline = 'alphabetic'; c.fillStyle = faint; c.font = `500 27px ${fb}`; c.textAlign = 'left';
  const disc = sp.backtest ? 'Risultato di un backtest (replay), non di operatività reale. Non è consulenza finanziaria.' : POST_DISCLAIMER;
  wrapText(c, disc, W - 2 * P).forEach((ln, i) => c.fillText(ln, P, H - 78 + i * 36));
  if (o.handle && sp.backtest) { c.textAlign = 'right'; c.fillStyle = muted; c.font = `500 28px ${fb}`; c.fillText(o.handle, W - P, H - 120); c.textAlign = 'left'; }
}

// ---------- finestra ----------
async function openPostDialog(t) {
  if (t.status === 'aperto') { toast('Il trade è ancora aperto: condividilo quando l\'hai chiuso.', true); return; }
  const st = { o: { ...postDefaults(), curve: true, image: '', setup: true }, variant: 0, caption: '', edited: false, steps: false };
  const imgs = (t.trade_images || []);
  const ov = document.createElement('div'); ov.className = 'overlay';
  const optImg = (id, sel) => `<option value="${esc(id)}" ${sel ? 'selected' : ''}>${esc(id === '' ? 'Nessuna' : (imgs.find((i) => i.id === id) || {}).timeframe || 'Foto')}</option>`;
  const acc = postAccount(t);
  ov.innerHTML = `<div class="modal post-modal" role="dialog" aria-modal="true" aria-label="Condividi il trade come post">
    <div class="modal-head"><h2>Condividi il trade come post</h2><button class="btn ghost icon" data-close aria-label="Chiudi">✕</button></div>
    <div class="post-body">
      <div class="post-prev"><canvas id="postCanvas"></canvas></div>
      <div class="post-ctl">
        <div class="field-row">
          <label class="field"><span>Formato</span><select class="input" id="pFormat">${Object.entries(POST_FORMATS).map(([k, f]) => `<option value="${k}" ${st.o.format === k ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label>
          <label class="field"><span>Risultato</span><select class="input" id="pMode"><option value="R" ${st.o.mode === 'R' ? 'selected' : ''}>In R (rischio)</option><option value="USD" ${st.o.mode === 'USD' ? 'selected' : ''}>In dollari</option><option value="hide" ${st.o.mode === 'hide' ? 'selected' : ''}>Nascondi il numero</option></select></label>
        </div>
        <label class="field"><span>Immagine</span><select class="input" id="pImg"><option value="">Nessuna</option>${imgs.map((i) => `<option value="${esc(i.id)}">${esc(i.timeframe || 'Foto')}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" id="pCurve" checked> Mostra la curva degli ultimi trade</label>
        <label class="chk"><input type="checkbox" id="pEmoji" ${st.o.emoji ? 'checked' : ''}> Emoji nel testo</label>
        <label class="field"><span>Il tuo @profilo (sulla card)</span><input class="input" id="pHandle" maxlength="30" placeholder="@nomeprofilo" value="${esc(st.o.handle)}"></label>
        <label class="field"><span>Hashtag</span><input class="input" id="pTags" maxlength="200" value="${esc(st.o.hashtags)}"></label>
        ${acc.kind === 'backtest' ? '<p class="small" style="color:var(--gold);margin:0">Conto backtest: la card e il testo dicono sempre che è un backtest, non operatività reale.</p>' : ''}
        <p class="small muted" id="pNote" style="margin:0"></p>
      </div>
      <div class="post-cap">
        <div class="post-cap-head"><span class="muted small">Testo del post</span><span class="muted small" id="pCount"></span><button class="btn ghost" id="pVar" type="button">Altra versione</button></div>
        <textarea class="input" id="pCaption" rows="7" spellcheck="true"></textarea>
        <div class="post-steps" id="pSteps" hidden></div>
      </div>
    </div>
    <div class="modal-foot post-foot"><button class="btn" id="pSave">Salva immagine…</button><button class="btn" id="pCopyT">Copia testo</button><button class="btn" id="pCopyI">Copia immagine</button><span class="grow"></span><button class="btn primary" id="pInsta">Prepara per Instagram</button></div>
  </div>`;
  document.body.appendChild(ov);
  const $$o = (s) => $(s, ov), canvas = $$o('#postCanvas'); let token = 0, sp = null;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  $$o('[data-close]').onclick = close; ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  const read = () => {
    st.o.format = $$o('#pFormat').value; st.o.mode = $$o('#pMode').value; st.o.image = $$o('#pImg').value; st.o.curve = $$o('#pCurve').checked; st.o.emoji = $$o('#pEmoji').checked;
    st.o.handle = $$o('#pHandle').value.trim(); st.o.hashtags = $$o('#pTags').value;
  };
  const count = () => { const n = $$o('#pCaption').value.length, tags = ($$o('#pCaption').value.match(/#\w+/g) || []).length; $$o('#pCount').textContent = `${n} / 2200 caratteri · ${tags} hashtag (max 30)`; $$o('#pCount').style.color = n > 2200 || tags > 30 ? 'var(--loss)' : ''; };
  const redraw = async (newCaption = true) => {
    read(); const my = ++token; sp = postSpec(t, st.o);
    $$o('#pNote').textContent = st.o.mode === 'R' && sp.mode !== 'R' ? 'Il risultato in R non si può calcolare (manca lo stop loss in dollari): il numero è nascosto.' : '';
    if (newCaption && !st.edited) $$o('#pCaption').value = postCaption(sp, st.o, st.variant);
    count();
    const rec = imgs.find((i) => i.id === st.o.image); const shot = rec ? await postImageBlob(rec).then((b) => (b ? loadBlobImage(b) : null)) : null;
    if (my !== token) return;
    await drawPostCard(canvas, sp, st.o, shot);
  };
  let timer = null; const later = (nc = true) => { clearTimeout(timer); timer = setTimeout(() => redraw(nc), 160); };
  $$o('#pImg').addEventListener('change', () => { $$o('#pCurve').checked = !$$o('#pImg').value; });
  ['#pFormat', '#pMode', '#pImg', '#pCurve', '#pEmoji', '#pHandle', '#pTags'].forEach((s) => { $$o(s).addEventListener('input', () => later(true)); $$o(s).addEventListener('change', () => later(true)); });
  $$o('#pCaption').addEventListener('input', () => { st.edited = true; count(); });
  $$o('#pVar').onclick = () => { st.variant++; st.edited = false; redraw(true); };
  const blob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));
  const bytesOf = async (b) => new Uint8Array(await b.arrayBuffer());
  const fname = `post_${(t.symbol || 'trade').replace(/[^\w]/g, '')}_${t.trade_date}${(t.trade_time || '').replace(':', '')}.jpg`;
  const remember = async () => { read(); S.settings.share = { handle: st.o.handle, hashtags: st.o.hashtags, emoji: st.o.emoji, mode: st.o.mode, format: st.o.format }; try { await S.db.saveSettings(S.settings); } catch { /* non è grave */ } };
  async function save() {
    const b = await blob('image/jpeg', 0.93);
    if (S.local) { const r = await S.db.call('postSave', { bytes: await bytesOf(b), name: fname }); return r.file; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = fname; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); return fname;
  }
  async function copyText() { const tx = $$o('#pCaption').value; if (S.local) await S.db.call('postCopyText', { text: tx }); else await navigator.clipboard.writeText(tx); }
  $$o('#pSave').onclick = async () => { try { const f = await save(); await remember(); toast(S.local ? 'Immagine salvata ✓' : 'Immagine scaricata ✓'); if (S.local) await S.db.call('postReveal', { file: f }); } catch (e) { toast(errMsg(e), true); } };
  $$o('#pCopyT').onclick = async () => { try { await copyText(); await remember(); toast('Testo copiato ✓'); } catch (e) { toast(errMsg(e), true); } };
  $$o('#pCopyI').onclick = async () => {
    try { const b = await blob('image/png'); if (S.local) await S.db.call('postCopyImage', { bytes: await bytesOf(b) }); else await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('Immagine copiata ✓'); } catch (e) { toast(errMsg(e), true); }
  };
  $$o('#pInsta').onclick = async () => {
    try {
      const f = await save(); await copyText(); await remember();
      if (S.local) await S.db.call('postReveal', { file: f });
      const box = $$o('#pSteps'); box.hidden = false;
      box.innerHTML = `<b>Fatto: l'immagine è salvata e il testo è copiato.</b><ol><li>Su Instagram premi <b>+</b> (Crea), poi <b>Post</b>.</li><li>Scegli il file <b>${esc(String(f).split(/[\\/]/).pop())}</b> (la cartella è già aperta).</li><li>Nella descrizione premi <b>Ctrl+V</b> per incollare il testo.</li><li>Premi <b>Condividi</b>.</li></ol>`;
      window.open('https://www.instagram.com/', '_blank', 'noopener');
    } catch (e) { toast(errMsg(e), true); }
  };
  await redraw(true);
}
