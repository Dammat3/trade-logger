'use strict';
// Condivisione locale: un piccolo servizio che gira SOLO su questo PC (127.0.0.1) e offre trade e screenshot
// a siti autorizzati (per esempio un journal online che non ha un database), senza account e senza internet.
// Sicurezza: ascolta solo su loopback; controlla Host (contro il DNS rebinding) e Origin (elenco di siti
// autorizzati); la lista dei trade richiede una chiave; gli screenshot hanno indirizzi casuali e non indovinabili.
const http = require('http');
const crypto = require('crypto');

const API_VERSION = 1;
const SHOT_ID = /^[a-f0-9]{24}$/;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

// trade interno della barra -> formato pubblico (chiavi in inglese, valori semplici)
function tradeToApi(t, ids, base) {
  const shots = [];
  for (const [kind, label] of [['open', 'Apertura'], ['close', 'Chiusura']]) {
    if (ids[kind]) shots.push({ kind, label, png: `${base}/s/${ids[kind]}.png`, jpg: `${base}/s/${ids[kind]}.jpg` });
  }
  const outcome = t.outcome === 'MANUALE' ? 'MANUAL' : (t.outcome || null);
  return {
    id: String(t.id), rev: Number(t.rev) || 0, status: t.status === 'aperto' ? 'open' : 'closed',
    date: t.tradeDate || (t.openedAt ? String(t.openedAt).slice(0, 10) : null), time: t.tradeTime || null,
    openedAt: t.openedAt || null, closedAt: t.closedAt || null,
    symbol: t.symbol || '', direction: t.direction === 'LONG' || t.direction === 'SHORT' ? t.direction : null,
    entry: num(t.entry), stopLoss: num(t.sl), takeProfit: num(t.tp), contracts: num(t.contracts),
    tpValue: num(t.tpUsd), slValue: num(t.slUsd), pnl: num(t.pnl), outcome,
    balanceBefore: num(t.balanceBefore), balanceAfter: num(t.balanceAfter),
    setup: t.setup || '', tags: Array.isArray(t.tags) ? t.tags : [], notes: t.note || '',
    screenshots: shots,
  };
}

function createLocalApi(deps) {
  // deps: getTrades(), getConfig() -> { origins:[], key }, shotId(trade, kind) -> id|null, shotFile(id) -> path|null,
  //       readImage(file, { jpeg, maxWidth }) -> Buffer, version
  let server = null, port = null;
  const cfg = () => deps.getConfig() || {};
  const safeEq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
  const isLoopbackOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(o);
  const originAllowed = (o) => isLoopbackOrigin(o) || (cfg().origins || []).includes(o);
  const hostAllowed = (h) => { h = String(h || '').toLowerCase(); return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`; };
  const base = () => `http://127.0.0.1:${port}`;

  function send(res, status, body, headers) {
    res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
    res.end(body);
  }
  const json = (res, status, obj, headers) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

  function listTrades(u) {
    let list = deps.getTrades().slice();
    const st = u.searchParams.get('status'), from = u.searchParams.get('from'), to = u.searchParams.get('to');
    if (st === 'open') list = list.filter((t) => t.status === 'aperto'); else if (st === 'closed') list = list.filter((t) => t.status !== 'aperto');
    if (from) list = list.filter((t) => (t.tradeDate || '') >= from);
    if (to) list = list.filter((t) => (t.tradeDate || '') <= to);
    list.sort((a, b) => ((a.tradeDate || '') + (a.tradeTime || '')).localeCompare((b.tradeDate || '') + (b.tradeTime || '')));
    return list.map((t) => tradeToApi(t, { open: deps.shotId(t, 'open'), close: deps.shotId(t, 'close') }, base()));
  }

  function landing(key) {
    const ok = key && safeEq(key, cfg().key);
    let body = `<h1>Trade Logger: condivisione locale</h1><p>Il servizio è attivo su questo PC (versione ${esc(deps.version)}).</p>`;
    if (!ok) {
      body += '<p>Per vedere i trade apri questa pagina dal menu di Trade Logger (tre puntini &gt; Impostazioni &gt; Condivisione locale &gt; Apri pagina di prova).</p>';
    } else {
      const trades = listTrades(new URL('http://x/?status=')).slice(-30).reverse();
      body += `<p>${trades.length ? `Ultimi ${trades.length} trade` : 'Ancora nessun trade.'}</p>` + trades.map((t) => `
        <div class="t"><b>${esc(t.date)} ${esc(t.time || '')}</b> · ${esc(t.symbol)} ${esc(t.direction || '')} · ${t.status === 'open' ? 'aperto' : `P&amp;L ${t.pnl ?? '—'}`}${t.setup ? ` · ${esc(t.setup)}` : ''}
        <div>${t.screenshots.map((s) => `<a href="${s.png}" target="_blank" rel="noopener"><img src="${s.jpg}" alt="${esc(s.label)}"></a>`).join('')}</div></div>`).join('');
    }
    const html = `<!doctype html><html lang="it"><meta charset="utf-8"><title>Trade Logger</title><style>body{font:14px/1.5 system-ui,sans-serif;background:#0d0f12;color:#e9ebef;max-width:880px;margin:30px auto;padding:0 16px}h1{font-size:20px}.t{border:1px solid #2f3540;border-radius:10px;padding:10px 14px;margin:10px 0;background:#14171c}img{height:110px;border-radius:6px;margin:6px 8px 0 0;border:1px solid #2f3540}a{color:#8fb0ff}</style><body>${body}</body></html>`;
    return html;
  }

  function handle(req, res) {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      // contro il DNS rebinding: la richiesta deve essere indirizzata a questo PC
      if (!hostAllowed(req.headers.host)) return send(res, 421, 'Host non valido', { 'Content-Type': 'text/plain; charset=utf-8' });
      const origin = req.headers.origin;
      const cors = {};
      if (origin) {
        if (!originAllowed(origin)) return json(res, 403, { error: 'origin_not_allowed', message: 'Questo sito non è nell\'elenco dei siti autorizzati in Trade Logger.' });
        Object.assign(cors, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'X-Key, Content-Type', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' });
      }
      if (req.method === 'OPTIONS') return send(res, 204, '', cors);
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' }, cors);
      const key = req.headers['x-key'] || u.searchParams.get('k');
      const p = u.pathname;

      if (p === '/') return send(res, 200, landing(key), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...cors });
      if (p === '/api/status') return json(res, 200, { app: 'Trade Logger', version: deps.version, api: API_VERSION, keyRequired: true, trades: deps.getTrades().length }, cors);

      const shot = p.match(/^\/s\/([a-f0-9]{24})\.(png|jpg)$/);
      if (shot) {
        const file = SHOT_ID.test(shot[1]) ? deps.shotFile(shot[1]) : null;
        if (!file) return json(res, 404, { error: 'not_found' }, cors);
        const jpeg = shot[2] === 'jpg';
        const buf = deps.readImage(file, { jpeg, maxWidth: jpeg ? 1600 : 0 });
        if (!buf) return json(res, 404, { error: 'not_found' }, cors);
        return send(res, 200, buf, { 'Content-Type': jpeg ? 'image/jpeg' : 'image/png', 'Cache-Control': 'private, max-age=86400', ...cors });
      }

      if (p === '/api/trades' || p.startsWith('/api/trades/')) {
        if (!safeEq(key, cfg().key)) return json(res, 401, { error: 'key_required', message: 'Manca la chiave (intestazione X-Key o parametro k).' }, cors);
        if (p === '/api/trades') return json(res, 200, { api: API_VERSION, generatedAt: new Date().toISOString(), trades: listTrades(u) }, cors);
        const id = decodeURIComponent(p.slice('/api/trades/'.length));
        const one = listTrades(new URL('http://x/')).find((t) => t.id === id);
        return one ? json(res, 200, one, cors) : json(res, 404, { error: 'not_found' }, cors);
      }
      return json(res, 404, { error: 'not_found' }, cors);
    } catch (e) {
      try { json(res, 500, { error: 'internal', message: String(e && e.message || e) }); } catch { /* connessione chiusa */ }
    }
  }

  return {
    start(p) {
      return new Promise((resolve, reject) => {
        if (server) return resolve(port);
        const s = http.createServer(handle);
        s.once('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error(`La porta ${p} è già usata da un altro programma: scegline un'altra.`) : e));
        s.listen(p, '127.0.0.1', () => { server = s; port = s.address().port; resolve(port); });
      });
    },
    stop() { return new Promise((resolve) => { if (!server) return resolve(); const s = server; server = null; port = null; s.close(() => resolve()); s.closeAllConnections && s.closeAllConnections(); }); },
    isRunning: () => !!server,
    port: () => port,
  };
}
module.exports = { createLocalApi, tradeToApi, API_VERSION };
