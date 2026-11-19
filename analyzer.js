// Analisi dello screenshot: trova le etichette colorate sulla colonna dei prezzi
// e converte i testi letti dall'OCR in numeri. Nessuna IA, solo colori.

// Colori delle etichette di FX Replay riconosciuti per TONALITÀ (non per valori fissi):
// così funzionano anche se l'etichetta è più chiara o più scura. Il buffer di Electron è in ordine BGRA.
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return { h, s: mx ? d / mx : 0, v: mx / 255 };
}
// colori standard (FX Replay): verde, arancione, blu. Ogni piattaforma può averne di propri,
// "insegnati" nella calibrazione cliccando sulle etichette: { TP: { h, tol }, ... }
const DEFAULT_HUES = { TP: { h: 135, tol: 40 }, SL: { h: 34, tol: 16 }, ENTRY: { h: 217, tol: 18 } };
function hueTest(spec) {
  const { h, tol } = spec;
  return (r, g, b) => {
    const q = hsv(r, g, b);
    if (q.s <= 0.4 || q.v <= 0.35) return false;
    const d = Math.abs(q.h - h);
    return Math.min(d, 360 - d) <= tol;          // la tonalità è un cerchio: 355° e 5° sono vicini
  };
}
const testsFor = (hues) => Object.fromEntries(Object.keys(DEFAULT_HUES).map((k) => [k, hueTest((hues && hues[k]) || DEFAULT_HUES[k])]));
const isKind = (name, r, g, b, hues) => testsFor(hues)[name](r, g, b);

// buf = pixel BGRA della colonna prezzi, width/height = sue dimensioni.
// Restituisce per ogni colore la fascia verticale (y0, y1) dell'etichetta più alta trovata.
function findLabels(buf, width, height, hues) {
  const minCount = Math.max(4, Math.round(width * 0.15));
  const result = {};
  for (const [name, test] of Object.entries(testsFor(hues))) {
    const rows = [];
    for (let y = 0; y < height; y++) {
      let c = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (test(buf[i + 2], buf[i + 1], buf[i])) c++;
      }
      if (c >= minCount) rows.push(y);
    }
    if (!rows.length) { result[name] = null; continue; }
    // unisce righe vicine (il testo "interrompe" il colore dell'etichetta)
    const groups = [[rows[0], rows[0]]];
    for (const y of rows.slice(1)) {
      const g = groups[groups.length - 1];
      if (y - g[1] <= 6) g[1] = y; else groups.push([y, y]);
    }
    // più sottile di 5 pixel = è una linea, non un'etichetta. Tengo tutte le candidate,
    // dalla più alta: chi chiama sceglie quella con il riquadro dell'ordine accanto
    const all = groups.filter((g) => g[1] - g[0] >= 5).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).map((g) => ({ y0: g[0], y1: g[1] }));
    result[name] = all.length ? { ...all[0], all } : null;
  }
  return result;
}

// Quanto è "solida" l'etichetta di ogni colore dentro la finestra: per ogni candidata (fascia di righe) la quota di pixel del colore
// nel rettangolo. Un'etichetta vera della colonna dei prezzi è un blocco pieno (alta); linee tratteggiate, bordi dei riquadri
// degli ordini e puntini sono sottili o piccoli (bassa). Serve a ritrovare la colonna quando si sposta.
function labelCoverage(buf, width, height, hues) {
  const L = findLabels(buf, width, height, hues), tests = testsFor(hues), out = {};
  for (const name of Object.keys(tests)) {
    out[name] = 0;
    if (!L[name]) continue;
    for (const g of L[name].all) {
      let c = 0;
      for (let y = g.y0; y <= g.y1; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; if (tests[name](buf[i + 2], buf[i + 1], buf[i])) c++; }
      out[name] = Math.max(out[name], c / (width * (g.y1 - g.y0 + 1)));
    }
  }
  return out;
}

// Riquadro dell'ordine a sinistra dell'etichetta (es. "8 | -496.00 USD | x"):
// cerco il suo bordo colorato nelle righe appena sopra l'etichetta. buf = striscia a sinistra dell'asse.
// per ogni colonna: il riquadro colorato dell'etichetta c'è? Guardo le righe appena sopra e appena sotto il testo
// (dove c'è solo il colore di fondo): le cifre bianche non interrompono la ricerca.
function boxColumns(buf, width, height, name, hues) {
  const test = testsFor(hues)[name], rows = height >= 6 ? [1, 2, height - 3, height - 2] : [0, height - 1], cols = [];
  for (let x = 0; x < width; x++) {
    let hit = 0;
    for (const y of rows) { const i = (y * width + x) * 4; if (test(buf[i + 2], buf[i + 1], buf[i])) hit++; }
    cols.push(hit >= 2);
  }
  return cols;
}

function findOrderBox(buf, width, height, name, hues) {
  const test = testsFor(hues)[name];
  let min = Infinity, max = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (test(buf[i + 2], buf[i + 1], buf[i])) { if (x < min) min = x; if (x > max) max = x; }
    }
  }
  return max - min > 30 ? { x0: min, x1: max } : null;
}

// "8 | -496.00 USD | x" -> 8
function parseContracts(text) {
  const m = String(text || '').match(/^\W{0,4}(\d{1,4}(?:[.,]\d{1,3})?)(?![\d.,])/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

// "8 | -496.00 USD | x" -> -496 ; "8 | +$728.00" -> 728 (importo in denaro del riquadro dell'ordine)
function parseBoxMoney(text) {
  const t = String(text || '').replace(/[−–—]/g, '-');
  const m = t.match(/([+-])\s*\$?\s*(\d[\d.,]*\d|\d)/) || t.match(/(\d[\d.,]*\d)\s*(?:USD|\$)/);
  if (!m) return null;
  if (m.length === 3) { const n = parseNumber(m[2]); return n == null ? null : (m[1] === '-' ? -n : n); }
  return parseNumber(m[1]);
}

// colore cliccato -> tonalità da riconoscere
function hueOf(r, g, b) { const q = hsv(r, g, b); return q.s > 0.25 && q.v > 0.25 ? Math.round(q.h) : null; }

// "$50,000.00 • +$0.00" -> 50000 (il primo importo con i centesimi; il secondo è il P&L in corso)
// "$104.147" (TradeSea, punto per le migliaia) -> 104147
function parseBalance(text) {
  const t = String(text || '').replace(/(\d)\s+(?=[\d.,])/g, '$1');      // "$1 04.253" -> "$104.253"
  const m = t.match(/\d{1,3}(?:[.,]\d{3})+[.,]\d{2}(?!\d)|\d+[.,]\d{2}(?!\d)/);
  if (m) return parseNumber(m[0]);
  // altrimenti il numero più lungo (un bordo letto come "1" non deve vincere)
  const all = t.match(/\d[\d.,]*\d|\d/g) || [];
  const best = all.sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length)[0];
  return best ? parseNumber(best) : null;
}

// Prezzo di un'etichetta: le cifre sono affidabili, i separatori no (l'OCR li scambia o li perde).
// Le piattaforme mostrano sempre lo stesso numero di decimali, quindi conto solo le cifre.
function decimalsOf(texts) {
  const counts = {};
  texts.forEach((t) => { const m = String(t || '').match(/[.,](\d{1,5})\s*$/); if (m) counts[m[1].length] = (counts[m[1].length] || 0) + 1; });
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? Number(best[0]) : null;
}
function priceCandidates(text, dec) {
  const d = String(text || '').replace(/\D/g, '');
  if (d.length < 2) return [];
  const out = [Number(d) / 10 ** dec];
  if (d.length > 3) out.push(Number(d.slice(1)) / 10 ** dec);    // cifra in più all'inizio (bordo letto come "1")
  return out;
}
// sceglie per ogni etichetta il candidato coerente con le altre (TP, SL e ingresso stanno a pochi % di distanza)
function pickPrices(texts, dec) {
  const keys = Object.keys(texts), cand = {};
  keys.forEach((k) => { cand[k] = priceCandidates(texts[k], dec); });
  let best = null;
  const combos = (i, acc) => {
    if (i === keys.length) {
      const v = Object.values(acc).filter((x) => x != null);
      if (!v.length) return;
      const mid = v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)];
      const spread = v.reduce((s, x) => s + Math.abs(x - mid) / mid, 0);
      const extra = Object.keys(acc).filter((k) => acc[k] != null && cand[k][0] !== acc[k]).length;
      const score = spread + 0.001 * extra;
      if (!best || score < best.score) best = { score, acc: { ...acc } };
      return;
    }
    const k = keys[i];
    if (!cand[k].length) return combos(i + 1, { ...acc, [k]: null });
    cand[k].forEach((c) => combos(i + 1, { ...acc, [k]: c }));
  };
  combos(0, {});
  if (!best) return Object.fromEntries(keys.map((k) => [k, null]));
  // un valore ancora lontano dagli altri è una lettura sbagliata
  const v = Object.values(best.acc).filter((x) => x != null);
  const mid = v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)];
  return Object.fromEntries(keys.map((k) => [k, best.acc[k] != null && v.length > 1 && Math.abs(best.acc[k] - mid) / mid > 0.05 ? null : best.acc[k]]));
}

// estensione orizzontale dell'etichetta (per ritagliarla senza i bordi, che l'OCR legge come "1")
function labelSpan(buf, width, y0, y1, name, hues) {
  const test = testsFor(hues)[name];
  let min = Infinity, max = -1;
  for (let y = y0; y <= y1; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (test(buf[i + 2], buf[i + 1], buf[i])) { if (x < min) min = x; if (x > max) max = x; }
  }
  return max - min > 10 ? { x0: min, x1: max } : null;
}

// Controllo incrociato dei valori in denaro: il rapporto |valore SL| / |valore TP| deve essere uguale
// a |SL - ingresso| / |TP - ingresso|. Se l'OCR ha perso il punto dei decimali (720.00 -> 72000)
// provo a spostarlo; se manca uno dei due valori lo ricavo dall'altro.
const POINT_VALUES = [0.5, 1, 1.25, 2, 2.5, 5, 6.25, 10, 12.5, 20, 25, 50, 100];
// valore di un punto per contratto dei future più comuni (se il simbolo è noto si usa questo)
const SYMBOL_PV = { MNQ: 2, NQ: 20, MES: 5, ES: 50, MYM: 0.5, YM: 5, M2K: 5, RTY: 50, MGC: 10, GC: 100, MCL: 100, CL: 1000, SIL: 1000, SI: 5000, MBT: 0.1, FDXM: 5, FDAX: 25, FESX: 10 };

// Se i prezzi e i valori in dollari non tornano tra loro, ma uno dei due prezzi è giusto (torna con il suo importo) e l'altro
// differisce dal prezzo ricavato dall'importo per UNA sola cifra (es. 24949.5 letto 24945.5), correggo la cifra.
// Serve quando le finestre sono piccole e l'OCR confonde 9 con 5, 8 con 6, ecc. Segno la correzione: la finestra si apre per il controllo.
function fixPriceFromMoney(r, dTp, dSl) {
  const pv = SYMBOL_PV[r.symbol], c = r.contracts;
  if (!pv || !c || r.tpUsd == null || r.slUsd == null) return;
  const aTp = Math.abs(r.tpUsd), aSl = Math.abs(r.slUsd);
  if (!aTp || !aSl) return;
  const okTp = Math.abs(aTp - dTp * pv * c) / aTp < 0.03, okSl = Math.abs(aSl - dSl * pv * c) / aSl < 0.03;
  if (okTp === okSl) return;                                    // o tornano entrambi, o nessuno: non so quale correggere
  const dec = Math.max(0, ...[r.tp, r.sl, r.entry].map((v) => (String(v).split('.')[1] || '').length));
  const oneDigit = (a, b) => { const x = a.toFixed(dec), y = b.toFixed(dec); if (x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++; return d === 1; };
  const key = okTp ? 'sl' : 'tp', usd = okTp ? aSl : aTp, cur = r[key];
  const sign = Math.sign(cur - r.entry) || 1;
  const implied = Math.round((r.entry + sign * usd / (pv * c)) * Math.pow(10, dec)) / Math.pow(10, dec);
  if (implied === cur || !oneDigit(cur, implied)) return;
  r.priceFixed = { field: key, from: cur, to: implied };
  r[key] = implied;
}

// Riquadri pieni sulla riga dell'asse del tempo (es. l'etichetta "Wed 15 Oct '25" del replay): fasce verticali di colore uniforme,
// diverse dallo sfondo, larghe come un'etichetta. buf = pixel BGRA della fascia, width/height = dimensioni.
// Restituisce [{x0, x1}] in coordinate della fascia.
function findAxisBoxes(buf, width, height, minW = 60, maxW = 340) {
  const q = (v) => v >> 4, key = (i) => (q(buf[i + 2]) << 8) | (q(buf[i + 1]) << 4) | q(buf[i]);
  const all = new Map();
  for (let i = 0; i < width * height * 4; i += 4 * 3) { const k = key(i); all.set(k, (all.get(k) || 0) + 1); }
  const bgK = [...all.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const rgb = (k) => [((k >> 8) & 15) * 16 + 8, ((k >> 4) & 15) * 16 + 8, (k & 15) * 16 + 8];
  const bg = rgb(bgK), dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const cols = [];
  for (let x = 0; x < width; x++) {
    const cnt = new Map();
    for (let y = 0; y < height; y++) { const k = key((y * width + x) * 4); cnt.set(k, (cnt.get(k) || 0) + 1); }
    const [k, n] = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    const c = rgb(k);
    cols.push(n / height >= 0.5 && dist(c, bg) > 40 ? c : null);
  }
  const boxes = []; let cur = null, gap = 0;
  for (let x = 0; x <= width; x++) {
    const c = x < width ? cols[x] : null;
    if (c && cur && dist(c, cur.c) < 40) { cur.x1 = x; gap = 0; }
    else if (c && !cur) { cur = { x0: x, x1: x, c }; gap = 0; }
    else if (cur && ++gap > 3) { if (cur.x1 - cur.x0 + 1 >= minW && cur.x1 - cur.x0 + 1 <= maxW) boxes.push({ x0: cur.x0, x1: cur.x1 }); cur = c ? { x0: x, x1: x, c } : null; gap = 0; }
  }
  return boxes;
}
function reconcileMoney(r) {
  if (r.tp == null || r.sl == null || r.entry == null) return r;
  let dTp = Math.abs(r.tp - r.entry), dSl = Math.abs(r.sl - r.entry);
  if (!dTp || !dSl) return r;
  fixPriceFromMoney(r, dTp, dSl);
  dTp = Math.abs(r.tp - r.entry); dSl = Math.abs(r.sl - r.entry);
  const ratio = dSl / dTp, round2 = (v) => Math.round(v * 100) / 100;
  const cands = (v) => (v == null ? [] : [v, v / 100, v / 10, v * 10, v * 100, v * 1000, v / 1000]);
  if (r.tpUsd != null && r.slUsd != null) {
    const conCands = r.contracts ? [r.contracts, r.contracts / 10, r.contracts / 100, r.contracts / 1000] : [null];
    let best = null;
    for (const a of cands(r.tpUsd)) for (const b of cands(r.slUsd)) for (const c of conCands) {
      if (!a || !b) continue;
      const err = Math.abs(Math.abs(b) / Math.abs(a) - ratio) / ratio;
      let score = err + 0.02 * ((a !== r.tpUsd) + (b !== r.slUsd) + (c !== r.contracts));
      // il valore di un punto per contratto deve essere realistico (MNQ 2, NQ 20, MES 5, ES 50, ...)
      if (c) {
        const pv = Math.abs(a) / (dTp * c), known = SYMBOL_PV[r.symbol];
        if (known ? Math.abs(pv - known) / known >= 0.03 : !POINT_VALUES.some((x) => Math.abs(pv - x) / x < 0.03)) score += 1;
      }
      // buon senso: tanti contratti o un rischio enorme rispetto al saldo indicano un punto perso
      if (c && c > 200) score += 0.5;
      if (r.balance && Math.abs(b) > r.balance * 0.25) score += 0.5;
      if (!best || score < best.score) best = { a, b, c, score, err };
    }
    if (best && best.err < 0.04) {
      r.tpUsd = round2(best.a); r.slUsd = round2(best.b);
      if (best.c != null && best.score < 0.5) r.contracts = Math.round(best.c * 1000) / 1000;
    } else r.moneyCheck = true;            // non tornano: li evidenzio da controllare
  } else if (r.tpUsd != null) { r.slUsd = round2(-Math.abs(r.tpUsd) * ratio); r.moneyCheck = true; }
  else if (r.slUsd != null) { r.tpUsd = round2(Math.abs(r.slUsd) / ratio); r.moneyCheck = true; }
  return r;
}

// "18.889,00" -> 18889 | "$50,000.00" -> 50000 | "18851.25" -> 18851.25
function parseNumber(text) {
  if (text === null || text === undefined) return null;
  let s = String(text).replace(/[^0-9.,\-]/g, '');
  if (!/\d/.test(s)) return null;
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  const hasDot = s.includes('.'), hasCom = s.includes(',');
  let dec = null;
  if (hasDot && hasCom) dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  else if (hasDot || hasCom) {
    const sep = hasDot ? '.' : ',';
    const parts = s.split(sep);
    if (parts[parts.length - 1].length !== 3) dec = sep;   // "18,805,75": l'ultimo separatore è quello dei decimali
  }
  let n;
  if (dec) {
    const k = s.lastIndexOf(dec);
    n = parseFloat(s.slice(0, k).replace(/[.,]/g, '') + '.' + s.slice(k + 1));
  } else {
    n = parseFloat(s.replace(/[.,]/g, ''));
  }
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

// Long se il TP è sopra l'ingresso (o lo stop è sotto), altrimenti short
function direction(v) {
  if (v.entry == null) return v.tp != null && v.sl != null && v.tp !== v.sl ? (v.tp > v.sl ? 'LONG' : 'SHORT') : null;
  if (v.tp != null) return v.tp > v.entry ? 'LONG' : 'SHORT';
  if (v.sl != null) return v.sl < v.entry ? 'LONG' : 'SHORT';
  return null;
}

module.exports = { findAxisBoxes, labelCoverage, findLabels, findOrderBox, labelSpan, decimalsOf, pickPrices, parseContracts, parseBoxMoney, parseBalance, reconcileMoney, parseNumber, direction, hueOf, DEFAULT_HUES };

// ---------- data e ora del replay (FX Replay, in inglese) ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n) => String(n).padStart(2, '0');

// "10:49:59 UTC+2" -> "10:49"
function parseReplayTime(text) {
  const m = String(text || '').match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${p2(h)}:${p2(mi)}` : null;
}

// "... Thu 10 Apr '25 10:50 ..." -> "2025-04-10" (l'OCR a volte legge l'apice come ")
function parseReplayDate(text) {
  const m = String(text || '').match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*['"’`‘]?\s*(\d{4}|\d{2})/i);
  if (!m) return null;
  const d = Number(m[1]), mo = MONTHS[m[2].toLowerCase()];
  let y = Number(m[3]); if (y < 100) y += 2000;
  if (!d || d > 31 || !mo) return null;
  return `${y}-${p2(mo)}-${p2(d)}`;
}

module.exports.parseReplayTime = parseReplayTime;
module.exports.parseReplayDate = parseReplayDate;

// ---------- simbolo ----------
const FUT_ROOTS = ['MNQ', 'NQ', 'MES', 'ES', 'MYM', 'YM', 'M2K', 'RTY', 'MGC', 'GC', 'MCL', 'CL', 'SIL', 'SI', 'HG', 'NG', 'ZB', 'ZN', 'ZF', 'ZT', '6E', 'M6E', '6B', '6J', '6A', 'FDAX', 'FDXM', 'FESX', 'BTC', 'MBT', 'ETH', 'MET'];
// nomi di borse e prodotti che stanno vicino al simbolo ma non sono il simbolo
const SYMBOL_STOP = new Set(['CME', 'CBOT', 'NYMEX', 'COMEX', 'ICE', 'EUREX', 'NASDAQ', 'NYSE', 'BINANCE', 'OANDA', 'FXCM', 'MINI', 'MICRO', 'EMINI', 'FUTURES', 'INDEX', 'FXREPLAY', 'TRADESEA', 'ON', 'FX']);
// lettere e cifre che l'OCR scambia tra loro: uso una forma "normalizzata" per confrontare
const CONFUSE = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' };
const normSym = (x) => String(x).replace(/./g, (c) => CONFUSE[c] || c);
function lev(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 3;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
// simboli "plausibili": servono per agganciare le letture (un simbolo sbagliato salvato in passato non deve diventare un riferimento)
const plausibleSymbol = (x) => /^[A-Z][A-Z0-9]{1,7}$/.test(x) && !SYMBOL_STOP.has(x) && !/(CME|CBOT|NYMEX|COMEX)/.test(x.slice(1));
const EX_PREFIX = '(?:CME|CBOT|NYMEX|COMEX|ICE|EUREX|MINI|MICRO|EMINI|FXREPLAY|ON)*';
// una parola letta dallo schermo -> simbolo noto (se riesce), altrimenti null
function resolveToken(raw, roots) {
  let s = raw.replace(/\d*!$/, '');                                          // continuo: MNQ1!
  const f = s.match(/^([A-Z0-9]{1,4})([FGHJKMNQUVXZ])(\d{1,2})$/);            // scadenza: MNQZ6, ESH25 (solo se la radice è nota: "NQ1" non è "N")
  if (f && roots.includes(f[1])) s = f[1];
  else { const d = s.match(/^([A-Z0-9]{2,4})(\d{1,2})$/); if (d && roots.includes(d[1])) s = d[1]; }
  if (roots.includes(s)) return { symbol: s, fixedFrom: null, known: true };
  // nome della borsa attaccato e qualche carattere in più (es. "CMEMNQ1!1IC" da "CME:MNQ1!"): cerco un simbolo noto all'inizio, dopo la borsa
  for (const r of [...roots].sort((x, y) => y.length - x.length)) {
    if (new RegExp(`^${EX_PREFIX}${r}(?:\\d{0,2}!?|[FGHJKMNQUVXZ]\\d{1,2})?[A-Z0-9!]{0,4}$`).test(s)) return { symbol: r, fixedFrom: null, known: true };
  }
  if (s.length > 6) { const root = roots.filter((r) => s.endsWith(r)).sort((x, y) => y.length - x.length)[0]; if (root) return { symbol: root, fixedFrom: null, known: true }; }
  // errore di lettura: stessa parola a meno di lettere/cifre confondibili (MNO, MN0 -> MNQ)
  const same = roots.filter((r) => normSym(r) === normSym(s));
  if (same.length === 1) return { symbol: same[0], fixedFrom: s, known: true };
  // oppure un solo carattere diverso (solo per parole di almeno 3 caratteri e se c'è un unico candidato)
  if (s.length >= 3) { const near = roots.filter((r) => r.length >= 3 && lev(r, s) <= 1); if (near.length === 1) return { symbol: near[0], fixedFrom: s, known: true }; }
  return { symbol: s.length >= 2 ? s : null, fixedFrom: null, known: false };
}
// legge il simbolo e lo "aggancia" ai simboli che conosco (future comuni + quelli che hai già usato)
function parseSymbolEx(text, known = []) {
  const roots = [...new Set([...FUT_ROOTS, ...known.map((x) => String(x || '').toUpperCase()).filter(plausibleSymbol)])];
  let t = String(text || '').toUpperCase().replace(/[^A-Z0-9:!()\s]/g, ' ');
  const par = t.match(/\(([A-Z0-9!]{2,12})\)/); if (par) t = par[1];          // tra parentesi, se c'è
  if (t.includes(':')) t = t.slice(t.lastIndexOf(':') + 1);                   // dopo la borsa
  const toks = (t.match(/[A-Z0-9][A-Z0-9!]{1,11}/g) || []).filter((x) => /[A-Z0-9]{2}/.test(x) && !SYMBOL_STOP.has(x.replace(/\d*!$/, '')));
  if (!toks.length) return { symbol: null, fixedFrom: null };
  // il primo che è un simbolo noto; altrimenti l'ultima parola (il simbolo viene dopo borsa e nome del prodotto)
  for (const tk of toks) { const r = resolveToken(tk, roots); if (r.known) return { symbol: r.symbol, fixedFrom: r.fixedFrom }; }
  const r = resolveToken(toks[toks.length - 1], roots);
  return { symbol: r.symbol, fixedFrom: r.fixedFrom };
}
function parseSymbol(text, known = []) { return parseSymbolEx(text, known).symbol; }
module.exports.parseSymbolEx = parseSymbolEx;
module.exports.boxColumns = boxColumns;
module.exports.parseSymbol = parseSymbol;

// ---------- data del replay, con controllo sul giorno della settimana ----------
// L'etichetta sotto il grafico è tipo "Thu 25 Sep '25 09:44". L'OCR può sbagliare una cifra o leggere
// l'apostrofo come cifra ('25 -> 125): il giorno della settimana ("Thu") serve da controllo e per correggere.
const WD3 = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DMAP = { O: '0', o: '0', D: '0', Q: '0', I: '1', i: '1', l: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', g: '9' };
const DIGIT_CONF = { 0: ['8', '6', '9'], 1: ['7', '4'], 2: ['7', '3'], 3: ['8', '5', '2'], 4: ['9', '1'], 5: ['6', '3', '8'], 6: ['5', '8', '0'], 7: ['1', '2'], 8: ['3', '0', '6', '9'], 9: ['8', '4', '0'] };
const fixDigits = (x) => String(x || '').replace(/./g, (c) => (DMAP[c] !== undefined ? DMAP[c] : c));
function pick3(tok, list) {
  const t = String(tok).toLowerCase().slice(0, 3);
  const i = list.indexOf(t); if (i >= 0) return { i, exact: true };
  const c = list.map((x, k) => [x, k]).filter(([x]) => lev(t, x) <= 1);
  return c.length === 1 ? { i: c[0][1], exact: false } : null;
}
function weekdayOf(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.getUTCDay() : -1;
}
// "310ct25" (spazi persi e O letta come zero) -> "31 Oct 25": provo a spezzare giorno / mese / anno e accetto solo se il mese torna
const DIG2LET = { 0: 'o', 1: 'l', 5: 's', 9: 'g' };
function unglueDates(text) {
  return String(text || '').replace(/(\d{1,2})\s*([0-9A-Za-z]{3})\s*['"’`‘´]?\s*(\d{4}|\d{2})(?!\d)/g, (all, d, m3, y) => {
    const m = m3.replace(/\d/g, (c) => DIG2LET[c] || c).toLowerCase();
    return MON3.includes(m) ? `${d} ${m} ${y}` : all;
  });
}
function dateTokens(text) {
  return unglueDates(text)
    .replace(/['"’`‘´]/g, " ' ")
    .replace(/(\d)(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi, '$1 $2')
    .replace(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d)/gi, '$1 $2')
    .replace(/(mon|tue|wed|thu|fri|sat|sun)(\d)/gi, '$1 $2')
    .split(/\s+/).filter(Boolean);
}
const DIGITISH = /^[0-9OoDQIil|SsBZzGg]+$/;
// -> { date: 'YYYY-MM-DD', conf: 'ok'|'unchecked'|'fixed'|'inferred'|'doubt', raw } oppure null
function parseReplayDateSmart(text, opts = {}) {
  const nowY = new Date().getFullYear();
  const toks = dateTokens(text);
  for (let i = 1; i < toks.length; i++) {
    const mtok = toks[i].replace(/[.,]$/, '');
    if (!/^[A-Za-z]{3,9}$/.test(mtok)) continue;
    const mo = pick3(mtok, MON3); if (!mo) continue;
    const dayTok = toks[i - 1]; if (!DIGITISH.test(dayTok) || dayTok.length > 2) continue;
    const wdTok = i >= 2 ? toks[i - 2].replace(/[.,]$/, '') : '';
    const wd = /^[A-Za-z]{3,9}$/.test(wdTok) ? pick3(wdTok, WD3) : null;
    let j = i + 1; while (toks[j] === "'") j++;
    const yTok = toks[j] && DIGITISH.test(toks[j]) && toks[j].length <= 4 ? toks[j] : '';
    const raw = toks.slice(Math.max(0, i - 2), j + 1).join(' ').replace(/ ' /g, " '");
    const month = mo.i + 1, day0 = Number(fixDigits(dayTok));
    const ys = fixDigits(yTok);
    let year0 = null;
    if (ys.length === 4 && Number(ys) >= 2005 && Number(ys) <= nowY + 1) year0 = Number(ys);
    else if (ys.length === 3) year0 = 2000 + Number(ys.slice(1));        // l'apostrofo letto come cifra
    else if (ys.length === 2) year0 = 2000 + Number(ys);
    if (!day0 || day0 > 31) continue;
    const hintYear = opts.hintYear || year0 || nowY;       // tra due correzioni equivalenti preferisco l'anno più vicino a quello atteso
    const baseOk = year0 && weekdayOf(year0, month, day0) >= 0;
    const fmt = (y, d) => `${y}-${p2(month)}-${p2(d)}`;
    // giorno della settimana affidabile solo se scritto esattamente (una lettera sbagliata non basta per "correggere")
    if (!wd || !wd.exact) {
      if (baseOk && wd && weekdayOf(year0, month, day0) === wd.i) return { date: fmt(year0, day0), conf: 'ok', raw };
      if (baseOk) return { date: fmt(year0, day0), conf: 'unchecked', raw };
      continue;
    }
    if (baseOk && weekdayOf(year0, month, day0) === wd.i) return { date: fmt(year0, day0), conf: 'ok', raw };
    // non torna: cerco la correzione più piccola (una cifra del giorno o dell'anno) che fa tornare il giorno della settimana
    const ds = String(day0), dayC = [{ d: day0, cost: 0 }];
    for (let k = 0; k < ds.length; k++) for (const alt of DIGIT_CONF[ds[k]] || []) { const v = Number(ds.slice(0, k) + alt + ds.slice(k + 1)); if (v >= 1 && v <= 31) dayC.push({ d: v, cost: 1 }); }
    const yearC = [];
    if (year0) { yearC.push({ y: year0, cost: 0 }); const last = year0 % 10; for (const alt of DIGIT_CONF[last] || []) yearC.push({ y: year0 - last + Number(alt), cost: 1 }); }
    else for (let y = nowY - 12; y <= nowY + 1; y++) yearC.push({ y, cost: 0.5 + 0.05 * Math.abs(y - hintYear) });
    const ok = [];
    for (const dc of dayC) for (const yc of yearC) if (weekdayOf(yc.y, month, dc.d) === wd.i) ok.push({ y: yc.y, d: dc.d, cost: dc.cost + yc.cost + 0.01 * Math.abs(yc.y - hintYear) });
    ok.sort((a, b) => a.cost - b.cost);
    if (ok.length && (ok.length === 1 || ok[1].cost - ok[0].cost > 0.005)) return { date: fmt(ok[0].y, ok[0].d), conf: year0 ? 'fixed' : 'inferred', raw };
    if (baseOk) return { date: fmt(year0, day0), conf: 'doubt', raw };
  }
  return null;
}
module.exports.parseReplayDateSmart = parseReplayDateSmart;
