const app = document.getElementById('app');
const fmt = (v) => (v === null || v === undefined ? '' : String(v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/^\//, '');
const num = (text) => { // stessa logica di analyzer.js: "18.889,00", "$50,000.00", "-616"
  if (text === null || text === undefined) return null;
  let s = String(text).replace(/[^0-9.,\-]/g, '');
  if (!/\d/.test(s)) return null;
  const neg = s.startsWith('-'); s = s.replace(/-/g, '');
  const hasDot = s.includes('.'), hasCom = s.includes(',');
  let dec = null;
  if (hasDot && hasCom) dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  else if (hasDot || hasCom) { const sep = hasDot ? '.' : ','; const parts = s.split(sep); if (parts.length === 2 && parts[1].length !== 3) dec = sep; }
  let n;
  if (dec) { const k = s.lastIndexOf(dec); n = parseFloat(s.slice(0, k).replace(/[.,]/g, '') + '.' + s.slice(k + 1)); }
  else n = parseFloat(s.replace(/[.,]/g, ''));
  return isNaN(n) ? null : (neg ? -n : n);
};

// tendina dei setup: quelli già usati + "Nuovo setup…" che apre un campo di testo
function setupField(current, list) {
  const items = [...new Set([...(list || []), current].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  return `<label for="setupSel">Setup</label>
    <select id="setupSel">
      <option value="">— nessuno —</option>
      ${items.map((x) => `<option value="${esc(x)}" ${x === current ? 'selected' : ''}>${esc(x)}</option>`).join('')}
      <option value="__new__">+ Nuovo setup…</option>
    </select>
    <input id="setupNew" hidden placeholder="Nome del nuovo setup" aria-label="Nome del nuovo setup">`;
}
function bindSetup() {
  const sel = document.getElementById('setupSel'), nw = document.getElementById('setupNew');
  sel.addEventListener('change', () => { nw.hidden = sel.value !== '__new__'; if (!nw.hidden) nw.focus(); });
}
const tagChips = (cur, all) => [...new Set([...(all || []), ...(cur || [])])].map((g) => `<button type="button" class="tagchip ${(cur || []).includes(g) ? 'on' : ''}" data-tag="${esc(g)}">${esc(g)}</button>`).join('') || '<span class="muted">Nessun tag.</span>';
const tagsValue = () => [...document.querySelectorAll('#tagPick .tagchip.on')].map((b) => b.dataset.tag);
const setupValue = () => {
  const sel = document.getElementById('setupSel');
  return sel.value === '__new__' ? document.getElementById('setupNew').value.trim().replace(/\s+/g, ' ') : sel.value;
};

function field(id, labelText, value, cls = '', sub = '') {
  const missing = value === null || value === undefined || value === '';
  return `<div class="${cls}"><label for="${id}">${labelText}</label>
    <input id="${id}" value="${esc(fmt(value))}" class="${missing ? 'warn' : ''}">${sub}</div>`;
}
// testo grezzo letto dallo schermo: se qualcosa è sbagliato si vede subito cosa ha letto il programma
const readLine = (raw, note = '', warn = false) => (raw || note ? `<small class="rd ${warn ? 'fix' : ''}">${raw ? `Letto: «${esc(raw)}»` : ''}${note ? `${raw ? ' · ' : ''}${esc(note)}` : ''}</small>` : '');

function renderOpen(p) {
  const missing = ['entry', 'sl', 'tp', 'balance'].filter((k) => p[k] == null).length;
  app.innerHTML = `
    <h1>Nuovo trade</h1>
    <div class="muted">Controlla i valori letti dallo schermo e correggi se serve.</div>
    <img class="shot" id="shot" src="${fileUrl(p.shot)}" alt="Screenshot di apertura" title="Clicca per ingrandire">
    ${p.layoutNote ? `<div class="muted-note">${esc(p.layoutNote)}</div>` : ''}
    <div class="grid">
      ${field('symbol', 'Simbolo', p.symbol, '', readLine(p.symbolRaw, p.symbolFixed ? `corretto da «${p.symbolFixed}»: controlla` : '', !!p.symbolFixed))}
      <div><label for="direction">Direzione</label>
        <select id="direction" class="${p.direction ? '' : 'warn'}">
          <option value="LONG" ${p.direction === 'LONG' ? 'selected' : ''}>LONG</option>
          <option value="SHORT" ${p.direction === 'SHORT' ? 'selected' : ''}>SHORT</option>
        </select></div>
      ${field('entry', 'Ingresso', p.entry, 'price-entry')}
      ${field('contracts', 'Contratti / lotti', p.contracts)}
      ${field('tpUsd', 'Valore TP ($)', p.tpUsd, 'price-tp' + (p.moneyCheck ? ' check' : ''))}
      ${field('slUsd', 'Valore SL ($)', p.slUsd, 'price-sl' + (p.moneyCheck ? ' check' : ''))}
      ${p.moneyCheck ? '<div class="hint date-hint">Valori di TP e SL da controllare: uno non era leggibile o non tornava con i prezzi.</div>' : ''}
      <div><label for="tradeDate">Data${p.backtest ? ' (replay)' : ''}</label><input id="tradeDate" type="date" class="${p.dateFrom && p.dateFrom !== 'replay' ? 'warn' : ''}" value="${esc(p.tradeDate || '')}">${p.backtest ? readLine(p.dateRaw, p.dateConf === 'ok' ? 'giorno della settimana verificato' : p.dateConf === 'unchecked' ? 'giorno della settimana non letto' : '', false) : ''}</div>
      <div><label for="tradeTime">Orario</label><input id="tradeTime" type="time" value="${esc(p.tradeTime || '')}"></div>
      ${p.dateHint ? `<div class="hint date-hint">${esc(p.dateHint)}</div>` : p.backtest ? '<div class="ok-hint">Data e ora lette dal replay.</div>' : ''}
      ${field('tp', 'Take profit', p.tp, 'price-tp')}
      ${field('sl', 'Stop loss', p.sl, 'price-sl')}
      ${p.priceHint ? `<div class="hint date-hint">${esc(p.priceHint)}</div>` : ''}
    </div>
    ${field('balanceBefore', 'Saldo all\'apertura', p.balance)}
    ${setupField(p.setup, p.setups)}
    ${p.tags && p.tags.length ? `<label>Tag</label><div class="tags">${p.tags.map((g) => `<span>${esc(g)}</span>`).join('')}</div>` : ''}
    <label for="note">Note (motivo dell'ingresso…)</label>
    <textarea id="note">${esc(p.note || '')}</textarea>
    ${missing ? `<div class="hint">${missing} valori non letti: sono evidenziati in arancione, compilali a mano.</div>` : ''}
    <div class="actions"><button id="cancel">Annulla</button><button id="save" class="primary">Salva trade</button></div>`;
  document.getElementById('save').onclick = () => {
    const v = (id) => document.getElementById(id).value;
    api.saveConfirm({ mode: 'open', symbol: v('symbol'), direction: v('direction'), entry: v('entry'), sl: v('sl'), tp: v('tp'),
      contracts: v('contracts'), balanceBefore: v('balanceBefore'), note: v('note'), tpUsd: v('tpUsd'), slUsd: v('slUsd'),
      tradeDate: v('tradeDate'), tradeTime: v('tradeTime'), setup: setupValue() });
  };
  bindSetup();
}

function renderClose(p) {
  const t = p.trade;
  app.innerHTML = `
    <h1>Chiusura trade</h1>
    <div class="summary">
      <div><span class="muted">Trade</span><b>${esc(t.symbol || '—')} ${esc(t.direction || '')}</b></div>
      <div><span class="muted">Ingresso</span><span>${fmt(t.entry)}</span></div>
      <div><span class="muted">Saldo all'apertura</span><span>${fmt(t.balanceBefore)}</span></div>
    </div>
    <img class="shot" id="shot" src="${fileUrl(p.shot)}" alt="Screenshot di chiusura" title="Clicca per ingrandire">
    ${p.layoutNote ? `<div class="muted-note">${esc(p.layoutNote)}</div>` : ''}
    <div class="grid">
      <div><label for="outcome">Esito</label>
        <select id="outcome">
          <option value="TP" ${p.outcome === 'TP' ? 'selected' : ''}>Take profit</option>
          <option value="SL" ${p.outcome === 'SL' ? 'selected' : ''}>Stop loss</option>
          <option value="MANUALE" ${p.outcome === 'MANUALE' ? 'selected' : ''}>Chiuso a mano</option>
        </select></div>
      ${field('balanceAfter', 'Saldo dopo', p.balanceAfter)}
    </div>
    ${p.pnlHint ? `<div class="hint">${esc(p.pnlHint)}</div>` : ''}
    <label for="pnl">Risultato (P&amp;L)</label>
    <input id="pnl" class="big ${p.pnl == null ? 'warn' : ''}" value="${fmt(p.pnl)}">
    ${setupField(t.setup, p.setups)}
    <label>Tag (clicca per aggiungere o togliere)</label>
    <div class="tags pick" id="tagPick">${tagChips(t.tags, p.allTags)}</div>
    <label for="note">Note (cosa è andato bene o male)</label>
    <textarea id="note"></textarea>
    <div class="actions"><button id="cancel">Annulla</button><button id="save" class="primary">Chiudi trade</button></div>`;
  const pnl = document.getElementById('pnl');
  const colour = () => { const n = num(pnl.value); pnl.classList.toggle('pos', n > 0); pnl.classList.toggle('neg', n < 0); };
  document.getElementById('balanceAfter').oninput = (e) => {
    const after = num(e.target.value);
    if (after != null && t.balanceBefore != null) pnl.value = Math.round((after - t.balanceBefore) * 100) / 100;
    colour();
  };
  pnl.oninput = colour; colour();
  document.getElementById('tagPick').addEventListener('click', (e) => { const b = e.target.closest('.tagchip'); if (b) b.classList.toggle('on'); });
  document.getElementById('save').onclick = () => {
    const v = (id) => document.getElementById(id).value;
    api.saveConfirm({ mode: 'close', tradeId: p.tradeId, outcome: v('outcome'), balanceAfter: v('balanceAfter'), pnl: v('pnl'), note: v('note'), setup: setupValue(), tags: tagsValue() });
  };
}

api.getPending().then((p) => {
  if (!p) { app.textContent = 'Nessun dato.'; return; }
  p.mode === 'open' ? renderOpen(p) : renderClose(p);
  document.getElementById('cancel').onclick = () => api.cancelConfirm();
  document.getElementById('shot').onclick = () => api.openFile(p.shot);
});
