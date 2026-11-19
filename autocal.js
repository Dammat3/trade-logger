// Calibrazione automatica: dallo screenshot con un trade aperto trova da solo la colonna dei prezzi, il saldo, l'orologio del replay
// e la riga della data. Le etichette dei prezzi si riconoscono dal colore (blocchi pieni di TP, SL, ingresso); il resto dal testo letto
// dall'OCR su tutto lo schermo. Funzioni pure: lo screenshot e le parole arrivano da fuori, così si possono provare senza il programma.
const { labelCoverage, findLabels } = require('./analyzer');

const COL_W = 64;                     // larghezza della colonna calibrata (circa quanto le etichette dei prezzi)

// img: { getSize(), crop(rect) -> img con toBitmap() }. Restituisce la colonna con più etichette piene, oppure null.
function findPriceColumn(img, hues) {
  const { width: W, height: H } = img.getSize();
  const y0 = Math.round(H * 0.08), y1 = Math.round(H * 0.95), h = y1 - y0;     // salto la barra del browser in alto
  const scoreAt = (x) => {
    const c = img.crop({ x, y: y0, width: COL_W, height: h }), cov = labelCoverage(c.toBitmap(), COL_W, h, hues);
    const vals = ['TP', 'SL', 'ENTRY'].map((n) => cov[n]).filter((v) => v >= 0.4);
    return { n: vals.length, sum: vals.reduce((a, b) => a + b, 0) };
  };
  const pts = [];
  for (let x = 0; x + COL_W <= W; x += 4) pts.push({ x, ...scoreAt(x) });
  const maxN = Math.max(...pts.map((p) => p.n));
  if (maxN < 2) return null;
  const top = Math.max(...pts.filter((p) => p.n === maxN).map((p) => p.sum));
  const good = pts.filter((p) => p.n === maxN && p.sum >= top * 0.97);
  const groups = []; let cur = null;
  for (const p of good) { if (cur && p.x - cur.to <= 4) { cur.to = p.x; cur.sum = Math.max(cur.sum, p.sum); } else { cur = { from: p.x, to: p.x, sum: p.sum }; groups.push(cur); } }
  groups.sort((a, b) => b.sum - a.sum);
  const x = Math.round((groups[0].from + groups[0].to) / 2);
  const c = img.crop({ x, y: y0, width: COL_W, height: h }), L = findLabels(c.toBitmap(), COL_W, h, hues), labels = {};
  for (const n of ['TP', 'SL', 'ENTRY']) if (L[n]) labels[n] = [L[n].y0 + y0, L[n].y1 + y0];
  return { x, width: COL_W, n: maxN, labels, multiple: groups.length > 1 };
}

const median = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const num = (t) => Number(String(t).replace(/[$,\s]/g, ''));

// words: [{ t, x0, y0, x1, y1 }] letti dall'OCR sullo schermo intero; size: { width, height }; col: risultato di findPriceColumn
function buildRects(size, col, words) {
  const { width: W, height: H } = size, rects = {}, found = {}, notes = [];
  const clampR = (r) => { const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y)); return { x, y, width: Math.max(8, Math.min(Math.round(r.width), W - x)), height: Math.max(8, Math.min(Math.round(r.height), H - y)) }; };

  if (col) {
    // altezza della colonna: dal primo all'ultimo numero dell'asse (più un passo), per coprire tutto il grafico anche se il prezzo si muove
    const axis = words.filter((w) => w.x0 >= col.x - 14 && w.x1 <= col.x + col.width + 14 && /^\d[\d.,]{3,}$/.test(w.t)).sort((a, b) => a.y0 - b.y0);
    const ly = Object.values(col.labels).flat();
    let top, bottom;
    if (axis.length >= 3) {
      const step = Math.max(20, median(axis.slice(1).map((w, i) => w.y0 - axis[i].y0).filter((d) => d > 8)));
      top = axis[0].y0 - step; bottom = axis[axis.length - 1].y1 + step;
    } else { top = H * 0.1; bottom = H * 0.9; notes.push('Non ho letto bene i numeri della colonna: ho usato quasi tutta l\'altezza dello schermo.'); }
    if (ly.length) { top = Math.min(top, Math.min(...ly) - 12); bottom = Math.max(bottom, Math.max(...ly) + 12); }
    top = Math.max(0, top); bottom = Math.min(H, bottom);
    rects.priceRect = clampR({ x: col.x, y: top, width: col.width, height: bottom - top });
    found.priceRect = true;
  } else notes.push('Non ho trovato la colonna dei prezzi: serve un trade aperto con take profit e stop loss visibili sul grafico.');

  // saldo: l'importo con il dollaro (il più grande, se ce n'è più di uno)
  const AMT = /\$\d{1,3}(?:,\d{3})*\.\d{2}|\$\d+\.\d{2}/;
  const bal = words.filter((w) => AMT.test(w.t)).sort((a, b) => num(b.t.match(AMT)[0]) - num(a.t.match(AMT)[0]))[0];
  if (bal) { rects.balanceRect = clampR({ x: bal.x0 - 8, y: bal.y0 - 6, width: Math.min(bal.x1 - bal.x0, 150) + 16, height: bal.y1 - bal.y0 + 12 }); found.balanceRect = true; }
  else notes.push('Saldo non trovato: lo indichi tu.');

  // orologio del replay (solo backtest): "15:47:59 UTC+2"
  const clk = words.filter((w) => /UTC/.test(w.t) && /\d{4,}/.test(w.t) || /^\d{2}:\d{2}:\d{2}$/.test(w.t)).sort((a, b) => b.y0 - a.y0)[0];
  if (clk) { rects.clockRect = clampR({ x: clk.x0 - 10, y: clk.y0 - 6, width: Math.min(clk.x1 - clk.x0, 120) + 20, height: clk.y1 - clk.y0 + 12 }); found.clockRect = true; }

  // riga dell'asse del tempo sotto il grafico (dove compare la data con il mouse sul grafico)
  const limit = col ? col.x + col.width : W;
  const times = words.filter((w) => w.y0 > H * 0.75 && w.x1 <= limit && /^(\d{2}:?\d{2}|\d{4})$/.test(w.t));
  if (times.length >= 3) {
    const cy = median(times.map((w) => (w.y0 + w.y1) / 2)), row = times.filter((w) => Math.abs((w.y0 + w.y1) / 2 - cy) < 14);
    if (row.length >= 3) {
      const x0 = Math.max(0, Math.min(...row.map((w) => w.x0)) - 30);
      rects.axisRect = clampR({ x: x0, y: cy - 17, width: (col ? col.x - 6 : limit) - x0, height: 34 }); found.axisRect = true;
    }
  }
  return { rects, found, notes };
}

module.exports = { findPriceColumn, buildRects, COL_W };
