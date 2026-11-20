const { app, BrowserWindow, ipcMain, systemPreferences, desktopCapturer, screen, nativeImage, shell, dialog, Menu, globalShortcut, net, clipboard } = require('electron');
const crypto = require('crypto');
const updaterLib = require('./updater');
const { createLocalApi } = require('./localapi');
const { fetchEvents } = require('./newsfetch');
const path = require('path');
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const { parseSymbolEx, parseReplayDateSmart, findAxisBoxes } = require('./analyzer');
const autocal = require('./autocal');
const { labelCoverage, boxColumns, findLabels, findOrderBox, labelSpan, decimalsOf, pickPrices, parseContracts, parseBoxMoney, parseBalance, reconcileMoney, parseNumber, direction, parseReplayTime, parseReplayDate } = require('./analyzer');
const { createClient } = require('@supabase/supabase-js');

const store = require('./store');
let DATA, CONFIG_FILE;
let updater = null;
let toolbar = null, confirmWin = null, calibWin = null, journalWin = null, linkWin = null;
let worker = null;
let pending = null;      // dati in attesa nella finestra di conferma
let calib = null;        // screenshot usato per la calibrazione
let busy = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (n) => Math.round(n * 100) / 100;
const alive = (w) => w && !w.isDestroyed();

// ---------- salvataggio dati ----------
function readJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } }
function writeJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }
// Piattaforme (FX Replay, TradeSea, ...): ognuna ha la sua calibrazione e i suoi colori.
// Il resto del programma legge cfg.priceRect ecc. come prima: getConfig li prende dalla piattaforma attiva.
const PLAT_KEYS = ['priceRect', 'balanceRect', 'clockRect', 'axisRect', 'symbolRect', 'shotRect', 'displayId', 'calibSize', 'readLog', 'hues'];
// Ogni piattaforma può avere due calibrazioni: "normale" (le chiavi sopra, dentro la piattaforma) e "schermo intero"
// (le stesse chiavi dentro platform.full). layoutNow dice quale delle due getConfig/saveConfig leggono e scrivono;
// la sceglie chooseLayout guardando lo schermo, e l'oggetto restituito da getConfig si ricorda da quale layout viene (__layout).
let layoutNow = 'normal', lastLayout = 'normal';
function migrate(c) {
  if (!c.platforms) {
    const p = { name: 'FX Replay' };
    PLAT_KEYS.forEach((k) => { if (c[k] !== undefined) p[k] = c[k]; delete c[k]; });
    c.platforms = { fxreplay: p }; c.activePlatform = 'fxreplay';
  }
  if (!c.activePlatform || !c.platforms[c.activePlatform]) c.activePlatform = Object.keys(c.platforms)[0];
  return c;
}
function getConfig() {
  const c = migrate(readJSON(CONFIG_FILE, {}));
  const p = c.platforms[c.activePlatform] || {};
  const full = layoutNow === 'full', src = full ? (p.full || {}) : p;
  PLAT_KEYS.forEach((k) => {
    delete c[k];
    let v = src[k];
    if (v === undefined && full && k === 'hues') v = p.hues;          // i colori insegnati valgono anche a schermo intero, se non li hai insegnati di nuovo
    if (v !== undefined) c[k] = v;
  });
  c.layoutMode = p.layoutMode || 'auto';
  c.__layout = full ? 'full' : 'normal';
  return c;
}
function saveConfig(c) {
  const o = { ...c };
  const full = o.__layout === 'full', mode = o.layoutMode;
  delete o.__layout; delete o.layoutMode;
  const platforms = { ...(o.platforms || migrate(readJSON(CONFIG_FILE, {})).platforms) };
  const p = { ...(platforms[o.activePlatform] || {}) };
  if (mode !== undefined) { if (mode === 'auto') delete p.layoutMode; else p.layoutMode = mode; }
  if (full) {
    const f = { ...(p.full || {}) };
    PLAT_KEYS.forEach((k) => {
      const same = k === 'hues' && f.hues === undefined && JSON.stringify(o.hues) === JSON.stringify(p.hues);   // colori ereditati: non li duplico
      if (o[k] !== undefined && !same) f[k] = o[k]; else delete f[k];
      delete o[k];
    });
    if (Object.keys(f).length) p.full = f; else delete p.full;
  } else {
    PLAT_KEYS.forEach((k) => { if (o[k] !== undefined) p[k] = o[k]; else delete p[k]; delete o[k]; });
  }
  platforms[o.activePlatform] = p;
  o.platforms = platforms;
  writeJSON(CONFIG_FILE, o);
}
// ---------- layout: normale o schermo intero ----------
// Con il browser a schermo intero (F11) la barra del browser sparisce e tutto si sposta. In modalità automatica la barra
// prova ogni calibrazione sullo schermo e usa quella che legge davvero: etichette di prezzo trovate (con il riquadro
// dell'ordine accanto) e, a pari merito, saldo leggibile e vicino all'ultimo conosciuto. Non indovina dall'aspetto dello schermo.
const layoutName = (l) => (l === 'full' ? 'schermo intero' : 'normale');
function layoutCfg(raw, layout) {
  const p = raw.platforms[raw.activePlatform] || {}, src = layout === 'full' ? (p.full || {}) : p, o = {};
  PLAT_KEYS.forEach((k) => { let v = src[k]; if (v === undefined && layout === 'full' && k === 'hues') v = p.hues; if (v !== undefined) o[k] = v; });
  return o;
}
// quante etichette (TP, SL, ingresso) trova questa calibrazione sullo schermo, contando di più se c'è il riquadro dell'ordine
function colorScore(img, cfg) {
  if (!cfg.priceRect) return -1;
  const r = clampRect(cfg.priceRect, img), crop = img.crop(r), { width, height } = crop.getSize(), hues = cfg.hues, imgH = img.getSize().height;
  const labels = findLabels(crop.toBitmap(), width, height, hues);
  let score = 0;
  for (const name of ['TP', 'SL', 'ENTRY']) {
    const L = labels[name]; if (!L) continue;
    score++;
    if (r.x < 40) continue;
    for (const cand of L.all) {
      const sx = Math.max(0, r.x - 380), sy = Math.min(Math.max(0, r.y + cand.y0 - 7), imgH - 9), strip = img.crop({ x: sx, y: sy, width: r.x - sx, height: 9 }), sz = strip.getSize();
      if (findOrderBox(strip.toBitmap(), sz.width, sz.height, name, hues)) { score++; break; }
    }
  }
  return score;
}
function lastKnownBalance() {
  const act = activeAccount(), list = getTrades().filter((t) => (!act || t.accountId === act.id) && (t.balanceAfter != null || t.balanceBefore != null));
  const t = list[list.length - 1];
  return t ? (t.balanceAfter != null ? t.balanceAfter : t.balanceBefore) : null;
}
// Sceglie il layout da usare per questa lettura e lo imposta (layoutNow). Restituisce anche una nota da mostrare.
async function chooseLayout(img) {
  const raw = migrate(readJSON(CONFIG_FILE, {})), p = raw.platforms[raw.activePlatform] || {};
  const normalOk = !!(p.priceRect && p.balanceRect), fullOk = !!(p.full && p.full.priceRect && p.full.balanceRect), mode = p.layoutMode || 'auto';
  let layout = 'normal', how = '';
  if (!fullOk) layout = 'normal';
  else if (!normalOk) { layout = 'full'; how = 'è l\'unica calibrata'; }
  else if (mode === 'normal' || mode === 'full') { layout = mode; how = 'scelto da te'; }
  else {
    const cfgN = layoutCfg(raw, 'normal'), cfgF = layoutCfg(raw, 'full'), cN = colorScore(img, cfgN), cF = colorScore(img, cfgF);
    if (cN !== cF) { layout = cF > cN ? 'full' : 'normal'; how = 'riconosciuto da solo'; }
    else {
      // stesse etichette: decide il saldo (con il layout sbagliato la zona del saldo è un'altra parte dello schermo)
      const [bN, bF] = [await readBalance(img, cfgN), await readBalance(img, cfgF)], last = lastKnownBalance();
      const good = (r) => r.balance != null && /\d[.,]\d{2}(?!\d)/.test(r.text || '');
      const off = (r) => (last == null ? 0 : Math.abs(r.balance - last) / Math.max(1, Math.abs(last)));
      if (good(bN) && !good(bF)) { layout = 'normal'; how = 'riconosciuto da solo'; }
      else if (!good(bN) && good(bF)) { layout = 'full'; how = 'riconosciuto da solo'; }
      else if (good(bN) && good(bF) && last != null && Math.abs(off(bN) - off(bF)) > 0.02) { layout = off(bF) < off(bN) ? 'full' : 'normal'; how = 'riconosciuto da solo'; }
      else { layout = lastLayout; how = 'non riuscito a distinguere: uso l\'ultimo usato'; }
    }
  }
  layoutNow = layout; lastLayout = layout;
  return { layout, how, note: fullOk ? `Layout: ${layoutName(layout)}${how ? ' (' + how + ')' : ''}.` : '' };
}
// Finestre affiancate (due grafici sullo schermo): se trascini il divisore, la colonna dei prezzi si sposta in orizzontale e il
// rettangolo calibrato non la trova più. Allora cerco la colonna dei prezzi lungo tutta la larghezza dello schermo (solo colori,
// niente OCR, quindi è veloce) e uso quella posizione per questa lettura.
const SHIFT_KEYS = ['priceRect'];   // si sposta solo la colonna dei prezzi: saldo, orologio e simbolo restano dove sono
function relocateCfg(img, cfg) {
  try {
    if (!cfg.priceRect) return { cfg, dx: 0 };
    const r = clampRect(cfg.priceRect, img), imgW = img.getSize().width;
    // punteggio di una colonna larga come quella calibrata, messa in x: somma della "solidità" delle etichette TP, SL, ingresso
    // (conta solo chi supera la soglia; linee tratteggiate e riquadri degli ordini restano sotto)
    const scoreAt = (x) => {
      const rr = clampRect({ ...cfg.priceRect, x }, img), c = img.crop(rr), sz = c.getSize(), cov = labelCoverage(c.toBitmap(), sz.width, sz.height, cfg.hues);
      const vals = ['TP', 'SL', 'ENTRY'].map((n) => cov[n]).filter((v) => v >= 0.4);
      return { n: vals.length, sum: vals.reduce((a, b) => a + b, 0) };
    };
    const base = scoreAt(r.x);
    if (base.n >= 2) return { cfg, dx: 0 };                      // la calibrazione trova già le etichette: non tocco niente
    const pts = [];
    for (let x = 0; x + r.width <= imgW; x += 6) { const q = scoreAt(x); pts.push({ x, n: q.n, sum: q.sum }); }
    const maxN = Math.max(...pts.map((q) => q.n));
    if (maxN < 2 || maxN <= base.n) return { cfg, dx: 0 };
    const top = Math.max(...pts.filter((q) => q.n === maxN).map((q) => q.sum));
    // le posizioni quasi ottime formano gruppi: scelgo il più vicino a dove ero e ne prendo il centro
    const good = pts.filter((q) => q.n === maxN && q.sum >= top * 0.97);
    const groups = []; let cur = null;
    for (const q of good) { if (cur && q.x - cur.to <= 6) cur.to = q.x; else { cur = { from: q.x, to: q.x }; groups.push(cur); } }
    groups.sort((g1, g2) => Math.abs((g1.from + g1.to) / 2 - r.x) - Math.abs((g2.from + g2.to) / 2 - r.x));
    const nx = Math.round((groups[0].from + groups[0].to) / 2), dx = nx - r.x;
    if (!dx) return { cfg, dx: 0 };
    const out = { ...cfg };
    for (const k of SHIFT_KEYS) if (cfg[k]) { const x2 = cfg[k].x + dx; if (x2 >= 0 && x2 + cfg[k].width <= imgW) out[k] = { ...cfg[k], x: x2 }; }
    return { cfg: out, dx };
  } catch (e) { return { cfg, dx: 0 }; }
}
async function layoutFor(img) {
  const info = await chooseLayout(img);
  const rel = relocateCfg(img, getConfig());
  if (rel.dx) info.note = ((info.note || '') + ` Finestra spostata di ${rel.dx} px: trovata da sola.`).trim();
  return { cfg: rel.cfg, info };
}
function isCalibrated() {
  const p = migrate(readJSON(CONFIG_FILE, {})); const pl = p.platforms[p.activePlatform] || {};
  return !!((pl.priceRect && pl.balanceRect) || (pl.full && pl.full.priceRect && pl.full.balanceRect));
}
// I trade stanno in un archivio condiviso (store.js): il Journal è un altro programma che legge e scrive gli stessi file.
const getTrades = () => store.readTrades();
function tradesChanged() {
  if (alive(journalWin)) journalWin.webContents.send('trades:changed');
  refreshToolbar();
  replaySync();
}
// conto attivo (locale): il programma funziona anche senza nessun collegamento online
function activeAccount() {
  const l = getConfig().link || {}, a = store.readAccounts().filter((x) => !x.shared);     // i conti "condivisi" (importati da un'altra persona) servono solo a studiare
  return a.find((x) => x.id === l.accountId) || a[0] || null;
}
const sharedIds = () => new Set(store.readAccounts().filter((x) => x.shared).map((x) => x.id));
const activeKind = () => ((activeAccount() || {}).kind === 'backtest' ? 'backtest' : 'conto');
function ensureActiveAccount() {
  const act = activeAccount();
  if (!act) return;
  const c = getConfig();
  if ((c.link || {}).accountId !== act.id) { c.link = { ...(c.link || {}), accountId: act.id, accountName: act.name, accountKind: act.kind === 'backtest' ? 'backtest' : 'conto' }; saveConfig(c); }
}

function status(text) { if (alive(toolbar)) toolbar.webContents.send('status', text); }
function refreshToolbar() {
  if (!alive(toolbar)) return;
  const open = getTrades().filter((t) => t.status === 'aperto').pop();
  const link = getConfig().link || {};
  const act = activeAccount();
  const pending = getTrades().filter(needsSync).length;
  const c = getConfig();
  toolbar.webContents.send('state', {
    open: open ? { symbol: open.symbol, direction: open.direction, count: getTrades().filter((t) => t.status === 'aperto').length } : null,
    online: (link.url && link.key && link.email) ? { account: act ? act.name : '' } : null,       // copia online facoltativa
    pending,
    rec: !!rec,
    mode: barModeOf(c),
    values: curValues(),
  });
}

// ---------- OCR ----------
// I dati della lingua per l'OCR sono inclusi nel programma (cartella ocr-data): funziona anche senza internet e senza
// dipendere da un servizio esterno. Si passano come "cache" in sola lettura: dentro Electron è l'unico modo che legge dal disco.
const OCR_DIR = path.join(__dirname, 'ocr-data');
async function getWorker() {
  if (!worker) {
    const local = fs.existsSync(path.join(OCR_DIR, 'eng.traineddata'));
    worker = await createWorker('eng', 1, local ? { cachePath: OCR_DIR, cacheMethod: 'readOnly' } : {});
  }
  return worker;
}
// scala di grigi: l'OCR legge molto meglio le cifre bianche sulle etichette colorate
function toGray(image) {
  const { width, height } = image.getSize();
  const b = Buffer.from(image.toBitmap());
  for (let i = 0; i < b.length; i += 4) {
    const v = Math.round(0.114 * b[i] + 0.587 * b[i + 1] + 0.299 * b[i + 2]);
    b[i] = b[i + 1] = b[i + 2] = v;
  }
  return nativeImage.createFromBitmap(b, { width, height });
}
async function ocr(img, rect, whitelist, gray = false) {
  const crop = img.crop(rect);
  let big = crop.resize({ width: rect.width * 4, height: rect.height * 4, quality: 'best' });
  if (gray) big = toGray(big);
  const w = await getWorker();
  await w.setParameters({ tessedit_char_whitelist: whitelist, tessedit_pageseg_mode: '7' });
  const { data } = await w.recognize(big.toPNG());
  return data.text.trim();
}

function clampRect(r, img) {
  const { width, height } = img.getSize();
  const x = Math.max(0, Math.min(r.x, width - 1));
  const y = Math.max(0, Math.min(r.y, height - 1));
  return { x, y, width: Math.max(1, Math.min(r.width, width - x)), height: Math.max(1, Math.min(r.height, height - y)) };
}

// ---------- screenshot ----------
// registro delle ultime letture: se 3 delle ultime 5 sono andate male suggerisco di ricalibrare
function logRead(ok) {
  const c = getConfig(); const log = (c.readLog || []).concat(ok ? 1 : 0).slice(-5);
  c.readLog = log; saveConfig(c);
  return log.length >= 3 && log.filter((x) => !x).length >= 3
    ? 'Le ultime letture non sono andate bene (3 su 5). Probabile che la pagina sia cambiata (zoom, schermo, finestra): apri Impostazioni → "Prova la lettura" e, se serve, "Calibra".' : '';
}
// ---------- una calibrazione per ogni schermo ----------
// Ogni misura di schermo (es. 1920x1080) ha la sua calibrazione, normale e a schermo intero. La barra tiene quella in uso
// dentro la piattaforma e le altre in platform.screens; quando la schermata letta cambia misura passa da sola alla calibrazione giusta.
const skey = (sz) => `${sz.width}x${sz.height}`;
const sameSize = (a, b) => Math.abs(a.width - b.width) <= 4 && Math.abs(a.height - b.height) <= 4;
function pickKeys(p) { const o = {}; PLAT_KEYS.forEach((k) => { if (k !== 'hues' && k !== 'readLog' && p[k] !== undefined) o[k] = p[k]; }); return o; }
function stashCurrent(p, cur) {
  const screens = { ...(p.screens || {}) };
  screens[skey(cur)] = { normal: pickKeys(p), full: p.full || null };
  p.screens = screens;
  return screens;
}
function useScreenProfile(img, cfg) {
  try {
    const sz = img.getSize();
    const raw = migrate(readJSON(CONFIG_FILE, {})), p = raw.platforms[raw.activePlatform];
    const cur = p && (p.calibSize || (p.full && p.full.calibSize));
    if (!cur || sameSize(cur, sz)) { warnIfSizeChanged(img, cfg); return cfg; }
    const screens = stashCurrent(p, cur);
    const prof = screens[skey(sz)];
    if (!prof) { writeJSON(CONFIG_FILE, raw); warnIfSizeChanged(img, cfg); return cfg; }
    PLAT_KEYS.forEach((k) => { if (k !== 'hues' && k !== 'readLog') delete p[k]; });
    Object.assign(p, prof.normal); delete p.full; if (prof.full) p.full = prof.full;
    p.readLog = [];
    writeJSON(CONFIG_FILE, raw);
    status(`Schermo ${skey(sz)}: uso la calibrazione di questo schermo.`);
    return getConfig();
  } catch (e) { console.error('useScreenProfile', e); return cfg; }
}
// prima di salvare una calibrazione fatta su uno schermo di misura diversa, metto da parte quella vecchia
function stashBeforeCalib(size) {
  const raw = migrate(readJSON(CONFIG_FILE, {})), p = raw.platforms[raw.activePlatform];
  const cur = p && (p.calibSize || (p.full && p.full.calibSize));
  if (!cur || sameSize(cur, size)) return;
  stashCurrent(p, cur);
  PLAT_KEYS.forEach((k) => { if (k !== 'hues' && k !== 'readLog') delete p[k]; });
  delete p.full;
  writeJSON(CONFIG_FILE, raw);
}
const barModeOf = (c) => (['estesa', 'tasti'].includes(c.barMode) ? c.barMode : 'minimal');
function warnIfSizeChanged(img, cfg) {
  const a = img.getSize(), b = cfg.calibSize;
  if (b && (Math.abs(a.width - b.width) > 4 || Math.abs(a.height - b.height) > 4))
    status(`Attenzione: questo schermo è di misura diversa (${a.width}×${a.height}) da quello della calibrazione (${b.width}×${b.height}). Se legge male, ricalibra qui.`);
}
let captureBusy = false;
async function capture(displayId) {
  const displays = screen.getAllDisplays();
  const display = displays.find((d) => String(d.id) === String(displayId)) || screen.getDisplayMatching(toolbar.getBounds());
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    // su Mac senza il permesso lo schermo esce vuoto: lo spiego invece di leggere un'immagine nera
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    throw new Error('Il Mac non mi ha ancora dato il permesso di vedere lo schermo. Si è aperta la finestra "Registrazione schermo": attiva Trade Logger, poi chiudi e riapri Trade Logger e riprova.');
  }
  toolbar.hide();                 // la barra non deve coprire il grafico
  captureBusy = true;
  await sleep(300);
  try {
    const size = {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor),
    };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    const img = nativeImage.createFromBuffer(src.thumbnail.toPNG(), { scaleFactor: 1 });
    return { img, displayId: display.id };
  } finally {
    captureBusy = false;
    toolbar.showInactive();
  }
}

// screenshot salvato nel journal: la lettura usa sempre tutto lo schermo, ma se nella calibrazione hai indicato
// l'area da salvare (di solito la finestra del browser) nel journal finisce solo quella
function forJournal(img, cfg) {
  if (!cfg.shotRect) return img;
  const r = clampRect(cfg.shotRect, img);
  return r.width < 200 || r.height < 120 ? img : img.crop(r);
}
function saveShot(img, prefix) {
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${prefix}.png`;
  const { dir, fallback } = store.ensureShotsDir();            // la cartella scelta, o quella predefinita se non è disponibile (disco scollegato)
  if (fallback) status('Cartella screenshot non disponibile: uso quella predefinita');
  const file = path.join(dir, name);
  fs.writeFileSync(file, img.toPNG());
  return file;
}

async function readBalance(img, cfg, forceWide = false) {
  if (!cfg.balanceRect) return { balance: null, text: '' };
  // accanto al saldo, con un trade aperto, c'è il P&L in corso ("$50,000.00 • +$0.00"): prendo solo il primo importo
  const r = clampRect(cfg.balanceRect, img);
  let text = await ocr(img, r, '0123456789.,$+-', true);
  let balance = parseBalance(text), widened = false;
  // il saldo può spostarsi (es. FX Replay: chiuso il trade sparisce il P&L accanto e il saldo scorre a destra):
  // se nel rettangolo non c'è, lo cerco in una fascia più larga
  if (forceWide || balance == null || !/\d[.,]?\d{2}/.test(text)) {
    const x = Math.max(0, r.x - 200), w = clampRect({ x, y: Math.max(0, r.y - 3), width: r.x - x + r.width + 200, height: r.height + 6 }, img);
    const t2 = await ocr(img, w, '0123456789.,$+-', true);
    const b2 = parseBalance(t2);
    if (b2 != null) { balance = b2; text = t2; widened = true; }
  }
  return { balance, text, widened };
}

async function analyze(img, cfg) {
  const res = { tp: null, sl: null, entry: null };
  if (cfg.priceRect) {
    const r = clampRect(cfg.priceRect, img);
    const crop = img.crop(r);
    const { width, height } = crop.getSize();
    const hues = cfg.hues;
    const labels = findLabels(crop.toBitmap(), width, height, hues);
    const imgH = img.getSize().height;
    // riquadro dell'ordine a sinistra di un'etichetta ("8 | -496.00 USD | x"), se c'è
    const boxFor = (name, L) => {
      if (r.x < 40) return null;
      const sx = Math.max(0, r.x - 380), sy = Math.max(0, r.y + L.y0 - 7);
      const strip = img.crop({ x: sx, y: sy, width: r.x - sx, height: 9 });
      const sz = strip.getSize();
      const box = findOrderBox(strip.toBitmap(), sz.width, sz.height, name, hues);
      return box ? { x: sx + Math.max(0, box.x0 - 2), y: Math.max(0, r.y + L.y0 - 4), width: box.x1 - box.x0 + 5, height: L.y1 - L.y0 + 9 } : null;
    };
    // se ci sono più etichette dello stesso colore (es. indicatori), scelgo quella con il riquadro dell'ordine
    const boxes = {};
    for (const name of ['TP', 'SL', 'ENTRY']) {
      const L = labels[name]; if (!L) continue;
      for (const cand of L.all) { const b = boxFor(name, cand); if (b) { labels[name] = cand; boxes[name] = b; break; } }
      if (!boxes[name]) labels[name] = L.all[0];
    }
    // prezzi: ritaglio solo l'interno dell'etichetta (i bordi l'OCR li legge come "1"),
    // poi tengo le cifre e rimetto i decimali, scegliendo i valori coerenti tra loro
    const cbuf = crop.toBitmap();
    const rects = {}, texts = {};
    for (const [name, key] of [['TP', 'tp'], ['SL', 'sl'], ['ENTRY', 'entry']]) {
      const L = labels[name];
      if (!L) continue;
      const span = labelSpan(cbuf, width, L.y0, L.y1, name, hues) || { x0: 0, x1: width - 1 };
      const y = Math.max(0, r.y + L.y0 + 1);
      // Se il riquadro colorato continua oltre il rettangolo calibrato (colonna dei prezzi spostata di qualche pixel, per
      // esempio con un altro layout), allargo la lettura finché il colore dell'etichetta continua: altrimenti si perde la prima cifra.
      let x0 = span.x0, x1 = span.x1;
      const h = Math.max(6, Math.min(L.y1 - L.y0 + 1, imgH - (r.y + L.y0)));
      const imgW = img.getSize().width;
      const run = (rect, fromEnd) => {
        const cols = boxColumns(img.crop(rect).toBitmap(), rect.width, h, name, hues);
        let k = 0, gap = 0;
        for (let n = 0; n < cols.length; n++) { const i = fromEnd ? cols.length - 1 - n : n; if (cols[i]) { k = n + 1; gap = 0; } else if (++gap > 1) break; }
        return k;
      };
      if (span.x0 <= 2 && r.x > 4) x0 = -run({ x: r.x - Math.min(80, r.x), y: r.y + L.y0, width: Math.min(80, r.x), height: h }, true);
      if (span.x1 >= width - 3 && r.x + width < imgW - 4) x1 = width - 1 + run({ x: r.x + width, y: r.y + L.y0, width: Math.min(60, imgW - (r.x + width)), height: h }, false);
      rects[key] = { x: r.x + x0 + 3, y, width: Math.max(8, x1 - x0 - 6), height: Math.max(6, Math.min(L.y1 - L.y0, imgH - y)) };
      texts[key] = await ocr(img, rects[key], '0123456789.,', true);
    }
    const dec = decimalsOf(Object.values(texts)) ?? (cfg.decimals != null ? cfg.decimals : 2);
    let picked = pickPrices(texts, dec);
    // se qualcosa non torna, seconda lettura a colori per quell'etichetta
    for (const key of Object.keys(texts)) {
      if (picked[key] != null) continue;
      texts[key] = await ocr(img, rects[key], '0123456789.,', false);
      picked = pickPrices(texts, dec);
      if (picked[key] == null) {                      // ancora niente: riprovo con un ritaglio un po' più largo
        const w = clampRect({ x: rects[key].x - 4, y: rects[key].y, width: rects[key].width + 10, height: rects[key].height }, img);
        texts[key] = await ocr(img, w, '0123456789.,', true);
        picked = pickPrices(texts, dec);
      }
    }
    Object.assign(res, picked);
    // contratti e valore in denaro: dal riquadro dell'ordine ("8 | -496.00 USD")
    for (const [name, key] of [['SL', 'slUsd'], ['TP', 'tpUsd']]) {
      if (!boxes[name]) continue;
      // interno del riquadro, senza il bordo (con il bordo l'OCR perde il punto: 713.46 -> 71346)
      const bx = boxes[name], inner = { x: bx.x + 6, y: bx.y + 3, width: Math.max(10, bx.width - 10), height: Math.max(6, bx.height - 6) };
      let text = await ocr(img, clampRect(inner, img), '', true);
      if (parseBoxMoney(text) == null) text = await ocr(img, clampRect(bx, img), '', true);
      if (res.contracts == null) res.contracts = parseContracts(text);
      res[key] = parseBoxMoney(text);
    }
  }
  const b = await readBalance(img, cfg);
  res.balance = b.balance;
  // simbolo dello strumento (es. "CME MINI:MNQ" -> MNQ), se la zona è stata calibrata
  if (cfg.symbolRect) {
    const raw = await ocr(img, clampRect(cfg.symbolRect, img), 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:!()-', true);
    // simboli già usati: servono a correggere errori di lettura (MNO -> MNQ)
    const known = [...new Set([...getTrades().map((t) => t.symbol), cfg.lastSymbol, ...(cfg.knownSymbols || [])].filter(Boolean))];
    const sx = parseSymbolEx(raw, known);
    res.symbol = sx.symbol; res.symbolRaw = raw.trim(); res.symbolFixed = sx.fixedFrom;
  }
  reconcileMoney(res);
  res.direction = direction(res);
  return res;
}


// ---------- collegamento al journal online (Supabase) ----------
let sb = null, sbKey = '', syncing = false, noMoneyCols = false;
function sessionStore() {
  const f = path.join(DATA, 'sessione.json');
  return {
    getItem: (k) => { const v = readJSON(f, {})[k]; return v === undefined ? null : v; },
    setItem: (k, v) => { const d = readJSON(f, {}); d[k] = v; writeJSON(f, d); },
    removeItem: (k) => { const d = readJSON(f, {}); delete d[k]; writeJSON(f, d); },
  };
}
function getSb() {
  const l = getConfig().link || {};
  if (!l.url || !l.key) return null;
  if (!sb || sbKey !== l.url + l.key) {
    sb = createClient(l.url, l.key, { auth: { storage: sessionStore(), persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    sbKey = l.url + l.key;
  }
  return sb;
}
async function linkedUser() {
  const s = getSb(); if (!s) return null;
  const { data } = await s.auth.getSession();
  return data.session ? data.session.user : null;
}
// un trade va inviato se è stato creato/modificato dopo l'ultimo invio riuscito
const needsSync = (t) => !!t.rev && (t.syncedRev || 0) < t.rev;

function patchTrade(id, patch) {
  if (store.patchTrade(id, patch)) tradesChanged();
}

// il conto locale ha (se serve) un conto corrispondente online: lo creo la prima volta
async function remoteAccountOf(t) {
  const s = getSb(), accts = store.readAccounts(), l = getConfig().link || {};
  const acc = accts.find((a) => a.id === (t.accountId || l.accountId)) || accts[0];
  if (!acc) throw new Error('Nessun conto');
  if (acc.remoteId) return acc.remoteId;
  const { data, error } = await s.from('accounts').insert({ name: acc.name, kind: acc.kind }).select('id').single();
  if (error) throw error;
  store.patchAccount(acc.id, { remoteId: data.id });
  return data.id;
}
async function syncTrade(t, user) {
  const s = getSb();
  const remoteAcc = await remoteAccountOf(t);
  const row = {
    trade_date: t.tradeDate || t.openedAt.slice(0, 10), trade_time: t.tradeTime || '',
    symbol: t.symbol || '', direction: t.direction || '', pnl: t.pnl == null ? 0 : t.pnl, setup: t.setup || '',
    entry: t.entry, sl: t.sl, tp: t.tp, contracts: t.contracts,
    outcome: t.outcome || '', status: t.status, notes: t.note || '', tags: t.tags || [], source: 'trade-logger',
  };
  // valore in denaro di SL e TP: colonne aggiunte con aggiornamento-0.4.sql; se mancano, invio il resto
  if (!noMoneyCols) { row.sl_usd = t.slUsd == null ? null : t.slUsd; row.tp_usd = t.tpUsd == null ? null : t.tpUsd; }
  const missingCol = (e) => e && /sl_usd|tp_usd/.test(e.message || '');
  let remoteId = t.remoteId;
  if (!remoteId) {
    let { data, error } = await s.from('trades').insert({ ...row, account_id: remoteAcc }).select('id').single();
    if (missingCol(error)) {
      noMoneyCols = true; delete row.sl_usd; delete row.tp_usd;
      status('Per salvare i valori di TP e SL nel sito esegui aggiornamento-0.4.sql');
      ({ data, error } = await s.from('trades').insert({ ...row, account_id: remoteAcc }).select('id').single());
    }
    if (error) throw error;
    remoteId = data.id;
    patchTrade(t.id, { remoteId, remoteAccount: remoteAcc });   // salvo subito: niente doppioni se dopo qualcosa fallisce
  } else {
    let { error } = await s.from('trades').update({ ...row, updated_at: new Date().toISOString() }).eq('id', remoteId);
    if (missingCol(error)) {
      noMoneyCols = true; delete row.sl_usd; delete row.tp_usd;
      ({ error } = await s.from('trades').update({ ...row, updated_at: new Date().toISOString() }).eq('id', remoteId));
    }
    if (error) throw error;
  }
  const uploaded = { ...(t.uploaded || {}) };
  for (const [kind, rel, label] of [['open', t.shotOpen, 'Apertura'], ['close', t.shotClose, 'Chiusura']]) {
    const file = store.shotAbs(rel);
    if (!file || uploaded[kind] || !fs.existsSync(file)) continue;
    const jpg = nativeImage.createFromPath(file).toJPEG(85);
    const p = `${user.id}/${remoteId}/${kind}-${Date.now()}.jpg`;
    const up = await s.storage.from('trade-images').upload(p, jpg, { contentType: 'image/jpeg' });
    if (up.error) throw up.error;
    const ins = await s.from('trade_images').insert({ trade_id: remoteId, path: p, timeframe: label });
    if (ins.error) throw ins.error;
    uploaded[kind] = true;
    patchTrade(t.id, { uploaded });
  }
}

let syncAgain = false, syncTimer = null;
function scheduleSync(ms = 1500) { clearTimeout(syncTimer); syncTimer = setTimeout(syncAll, ms); }
async function syncAll() {
  if (syncing) { syncAgain = true; return; }
  if (!getSb()) { refreshToolbar(); return; }
  syncing = true;
  try {
    const user = await linkedUser();
    if (!user) { status('Collegamento scaduto: premi 🔗 e accedi'); return; }
    for (const t of getTrades().filter(needsSync)) {
      const rev = t.rev;
      try {
        status('Invio al journal…');
        await syncTrade(t, user);
        patchTrade(t.id, { syncedRev: rev, syncError: null });
        status('Inviato al journal ✓');
      } catch (e) {
        patchTrade(t.id, { syncError: String((e && e.message) || e) });
        status('Non inviato, riprovo più tardi');
      }
    }
  } finally {
    syncing = false; refreshToolbar();
    if (syncAgain) { syncAgain = false; scheduleSync(500); }
  }
}

function openLink() {
  if (alive(linkWin)) { linkWin.show(); linkWin.focus(); return; }
  linkWin = new BrowserWindow({
    width: 520, height: 680, backgroundColor: '#14161b', title: 'Collegamento al journal',
    icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  linkWin.setMenuBarVisibility(false);
  linkWin.loadFile('ui/link.html');
}

async function listAccounts() {
  const s = getSb();
  const { data, error } = await s.from('accounts').select('id, name, kind').order('created_at');
  if (error) throw error;
  if (data.length) return data;
  const r = await s.from('accounts').insert({ name: 'Personale', kind: 'conto' }).select('id, name, kind');
  if (r.error) throw r.error;
  return r.data;
}


// ---------- setup, tag e note dalla barra ----------
const PRESET_TAGS = ['Da manuale', 'Entrata in anticipo', 'Entrata in ritardo', 'Uscita anticipata', 'Uscita in ritardo',
  'Stop spostato', 'Size eccessiva', 'Revenge trade', 'Fuori piano', 'Mercato laterale'];
let lists = { setups: [], tags: [...PRESET_TAGS] };

const openTrade = () => getTrades().filter((t) => t.status === 'aperto').pop();
const getDraft = () => ({ setup: '', tags: [], note: '', ...(getConfig().draft || {}) });
// valori mostrati sulla barra: quelli del trade aperto, altrimenti la bozza per il prossimo trade
function curValues() {
  const o = openTrade();
  return o ? { setup: o.setup || '', tags: o.tags || [], note: o.note || '', target: 'trade' } : { ...getDraft(), target: 'draft' };
}
function setValues(patch) {
  const o = openTrade();
  if (o) {
    store.patchTrade(o.id, patch, { bump: true });
    tradesChanged(); scheduleSync();
  } else {
    const c = getConfig(); c.draft = { ...getDraft(), ...patch }; saveConfig(c); refreshToolbar();
  }
}

async function refreshLists() {
  const c = getConfig(), loc = store.readSettings();      // le liste vere stanno in settings.json, condiviso con il Journal
  const setups = new Set([...(c.setups || []), ...(loc.setups || [])]);
  const tags = new Set([...PRESET_TAGS, ...(c.customTags || []), ...(loc.customTags || [])]);
  const sh = sharedIds();
  getTrades().forEach((t) => { if (sh.has(t.accountId)) return; if (t.setup) setups.add(t.setup); (t.tags || []).forEach((g) => tags.add(g)); });
  (loc.hiddenTags || []).forEach((g) => tags.delete(g));
  try {
    const s = getSb();
    if (s && await linkedUser()) {                         // copia online facoltativa: aggiunge quello che c'è solo là
      const r = await s.from('trades').select('setup, tags').limit(3000);
      if (!r.error) r.data.forEach((x) => { if (x.setup) setups.add(x.setup); (x.tags || []).forEach((g) => tags.add(g)); });
      const st = await s.from('user_settings').select('data').maybeSingle();
      const sd = (!st.error && st.data && st.data.data) || {};
      (sd.customTags || []).forEach((g) => tags.add(g));
      (sd.setups || []).forEach((x) => setups.add(x));                 // setup aggiunti nelle Impostazioni del sito
      (sd.hiddenTags || []).forEach((g) => tags.delete(g));            // tag nascosti nel sito
      c.currency = sd.currency || c.currency;
      (loc.hiddenTags || []).forEach((g) => tags.delete(g));
    }
  } catch { /* uso quello che ho */ }
  lists = { setups: [...setups].sort((a, b) => a.localeCompare(b, 'it')), tags: [...tags] };
}

// i setup creati sulla barra vanno anche nel database (come i tag), così il sito li vede anche se non sono ancora usati in un trade.
// c.setups = elenco "da consegnare": una volta consegnato si svuota e la fonte diventa il database
// (quindi "Togli" nel sito funziona anche per la barra).
async function pushSetups() {
  const c = getConfig(), names = [...(c.setups || [])];
  if (!names.length) return;
  try {
    const s = getSb();
    if (!s || !(await linkedUser())) return;
    const st = await s.from('user_settings').select('data').maybeSingle();
    if (st.error) return;
    const data = (st.data && st.data.data) || {};
    data.setups = [...new Set([...(data.setups || []), ...names])];
    const up = await s.from('user_settings').upsert({ data }, { onConflict: 'user_id' });
    if (up.error) return;
    const c2 = getConfig(); c2.setups = (c2.setups || []).filter((x) => !names.includes(x)); saveConfig(c2);
  } catch { /* resta sul PC e riprova al prossimo giro */ }
}
async function pushCustomTag(name) {
  try {
    const s = getSb();
    if (!s || !(await linkedUser())) return;
    const st = await s.from('user_settings').select('data').maybeSingle();
    const data = (st.data && st.data.data) || {};
    data.customTags = [...new Set([...(data.customTags || []), name])];
    await s.from('user_settings').upsert({ data }, { onConflict: 'user_id' });
  } catch { /* resta salvato sul PC */ }
}

// finestrella per scrivere (note, nuovo setup, nuovo tag)
let promptWin = null, promptOpts = null, promptResolve = null;
function openPrompt(opts) {
  if (alive(promptWin)) { promptWin.focus(); return Promise.resolve(null); }
  promptOpts = opts;
  return new Promise((resolve) => {
    promptResolve = resolve;
    const b = toolbar.getBounds();
    promptWin = new BrowserWindow({
      width: 360, height: opts.multiline ? 250 : 150, x: b.x, y: b.y + b.height + 4,
      alwaysOnTop: true, resizable: true, minimizable: false, maximizable: false,
      backgroundColor: '#14161b', title: opts.title,
      icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    promptWin.setMenuBarVisibility(false);
    promptWin.loadFile('ui/prompt.html');
    promptWin.on('closed', () => { promptWin = null; if (promptResolve) { promptResolve(null); promptResolve = null; } });
  });
}
ipcMain.handle('prompt:get', () => promptOpts);
ipcMain.handle('prompt:done', (_e, value) => {
  const r = promptResolve; promptResolve = null;
  if (r) r(value);
  if (alive(promptWin)) promptWin.close();
});

async function newSetup() {
  const v = await openPrompt({ title: 'Nuovo setup', label: 'Nome del setup', value: '' });
  const name = (v || '').trim().replace(/\s+/g, ' ');
  if (!name) return;
  const c = getConfig(); c.setups = [...new Set([...(c.setups || []), name])]; saveConfig(c);
  store.updateSettings((st) => { st.setups = [...new Set([...(st.setups || []), name])]; });
  if (!lists.setups.includes(name)) lists.setups.push(name);
  setValues({ setup: name });
  pushSetups();
}
async function newTag() {
  const v = await openPrompt({ title: 'Nuovo tag', label: 'Nome del tag', value: '' });
  const name = (v || '').trim().replace(/\s+/g, ' ');
  if (!name) return;
  const known = lists.tags.find((g) => g.toLowerCase() === name.toLowerCase());
  const tag = known || name;
  if (!known) {
    const c = getConfig(); c.customTags = [...new Set([...(c.customTags || []), tag])]; saveConfig(c);
    store.updateSettings((st) => { st.customTags = [...new Set([...(st.customTags || []), tag])]; });
    lists.tags.push(tag); pushCustomTag(tag);
  }
  const cur = curValues().tags;
  if (!cur.includes(tag)) setValues({ tags: [...cur, tag] });
}

ipcMain.handle('toolbar:setup-menu', (_e, at) => {
  const cur = curValues();
  const items = lists.setups.map((name) => ({ label: name, type: 'radio', checked: cur.setup === name, click: () => setValues({ setup: name }) }));
  Menu.buildFromTemplate([
    { label: cur.target === 'trade' ? 'Setup del trade aperto' : 'Setup del prossimo trade', enabled: false },
    ...(items.length ? items : [{ label: 'Nessun setup salvato', enabled: false }]),
    { type: 'separator' },
    { label: 'Nessun setup', click: () => setValues({ setup: '' }) },
    { label: 'Nuovo setup…', click: newSetup },
  ]).popup({ window: toolbar, x: Math.round(at.x), y: Math.round(at.y) });
  refreshLists();
});
ipcMain.handle('toolbar:tag-menu', (_e, at) => {
  const cur = curValues();
  const toggle = (g) => { const now = curValues().tags; setValues({ tags: now.includes(g) ? now.filter((x) => x !== g) : [...now, g] }); };
  Menu.buildFromTemplate([
    { label: cur.target === 'trade' ? 'Tag del trade aperto' : 'Tag del prossimo trade', enabled: false },
    ...lists.tags.map((g) => ({ label: g, type: 'checkbox', checked: cur.tags.includes(g), click: () => toggle(g) })),
    { type: 'separator' },
    { label: 'Togli tutti i tag', enabled: cur.tags.length > 0, click: () => setValues({ tags: [] }) },
    { label: 'Nuovo tag…', click: newTag },
  ]).popup({ window: toolbar, x: Math.round(at.x), y: Math.round(at.y) });
  refreshLists();
});
ipcMain.handle('toolbar:note', (_e, value) => setValues({ note: String(value || '') }));
ipcMain.handle('toolbar:note-window', async () => {
  const cur = curValues();
  const v = await openPrompt({ title: cur.target === 'trade' ? 'Note del trade aperto' : 'Note del prossimo trade', label: 'Note', value: cur.note, multiline: true });
  if (v !== null && v !== undefined) setValues({ note: v });
});

// ---------- data e ora del trade ----------
// Conto live: data e ora del PC. Backtest: ora dall'orologio del replay, data dall'etichetta
// sotto il grafico (visibile solo con il mouse sul grafico) oppure l'ultima data usata.
async function readReplay(img, cfg, hintYear) {
  const out = { time: null, date: null, dateRaw: '', dateConf: null };
  if (cfg.clockRect) out.time = parseReplayTime(await ocr(img, clampRect(cfg.clockRect, img), '0123456789:.UTC+-'));
  if (cfg.axisRect) {
    const w = await getWorker();
    await w.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:'’\" .", tessedit_pageseg_mode: '7' });
    const r = clampRect(cfg.axisRect, img);
    const readAxis = async (rr) => {
      const big = img.crop(rr).resize({ width: rr.width * 3, height: rr.height * 3, quality: 'best' });
      return (await w.recognize(big.toPNG())).data;
    };
    let data = await readAxis(r);
    let pd = parseReplayDateSmart(data.text, { hintYear });
    if (!pd) {
      // la riga della data si allunga con la finestra (finestre affiancate): se nel rettangolo calibrato non c'è, riprovo su una fascia più larga
      const iw = img.getSize().width, x0 = Math.max(0, r.x - Math.round(r.width * 1.5)), x1 = Math.min(iw, r.x + r.width + Math.round(r.width * 1.5));
      const wide = clampRect({ x: x0, y: r.y, width: x1 - x0, height: r.height }, img);
      if (wide.width > r.width) { const d2 = await readAxis(wide), p2 = parseReplayDateSmart(d2.text, { hintYear }); if (p2) { data = d2; pd = p2; } }
    }
    if (!pd) {
      // ultimo tentativo: cerco sulla riga dell'asse, su tutta la larghezza, i riquadri pieni (l'etichetta della data è un riquadro colorato)
      // e leggo quelli, partendo dal più vicino alla colonna dei prezzi del grafico attivo
      try {
        const iw = img.getSize().width, band = clampRect({ x: 0, y: r.y, width: iw, height: r.height }, img), bm = img.crop(band);
        const boxes = findAxisBoxes(bm.toBitmap(), band.width, band.height), px = cfg.priceRect ? cfg.priceRect.x : r.x;
        boxes.sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - px) - Math.abs((b.x0 + b.x1) / 2 - px));
        for (const bx of boxes.slice(0, 4)) {
          const rr = clampRect({ x: Math.max(0, bx.x0 - 4), y: band.y, width: bx.x1 - bx.x0 + 9, height: band.height }, img);
          const d3 = await readAxis(rr), p3 = parseReplayDateSmart(d3.text, { hintYear });
          if (p3) { data = d3; pd = p3; break; }
        }
      } catch (e) { /* resta il messaggio "data non visibile" */ }
    }
    if (pd) { out.date = pd.date; out.dateRaw = pd.raw; out.dateConf = pd.conf; } else out.dateRaw = String(data.text || '').trim().slice(0, 60);
  }
  return out;
}
function nowParts() {
  const n = new Date(), p2 = (x) => String(x).padStart(2, '0');
  return { date: `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}`, time: `${p2(n.getHours())}:${p2(n.getMinutes())}` };
}
async function tradeWhen(img, cfg) {
  const link = cfg.link || {};
  const now = nowParts();
  if (activeKind() !== 'backtest') return { tradeDate: now.date, tradeTime: now.time, dateHint: '' };
  const last = (cfg.btDate || {})[link.accountId];
  const r = await readReplay(img, cfg, last ? Number(last.slice(0, 4)) : undefined);
  const hints = [];
  if (!cfg.clockRect || !cfg.axisRect) hints.push('Backtest: rifai la calibrazione per leggere data e ora del replay.');
  if (!r.time && cfg.clockRect) hints.push('Ora del replay non letta: controllala.');
  if (!r.date) hints.push(last ? 'Data non visibile sul grafico: ho messo l\'ultima data di questo backtest, controllala. (Usa Ctrl+Alt+T con il mouse sul grafico.)'
    : 'Data del replay non trovata: inseriscila. (Usa Ctrl+Alt+T con il mouse sul grafico.)');
  const q = r.dateRaw ? ` («${r.dateRaw}»)` : '';
  if (r.date && r.dateConf === 'fixed') hints.push(`Data letta${q} e corretta con il giorno della settimana: controllala.`);
  if (r.date && r.dateConf === 'inferred') hints.push(`Anno non letto${q}: dedotto dal giorno della settimana, controllalo.`);
  if (r.date && r.dateConf === 'doubt') hints.push(`La data letta${q} non torna con il giorno della settimana: controllala.`);
  return { tradeDate: r.date || last || now.date, tradeTime: r.time || '', dateHint: hints.join(' '), dateRaw: r.dateRaw, dateConf: r.dateConf, dateFrom: r.date ? (r.dateConf === 'ok' || r.dateConf === 'unchecked' ? 'replay' : 'dubbia') : (last ? 'ultima' : 'pc') };
}

// ---------- scorciatoie da tastiera (modificabili nelle Impostazioni) ----------
const DEFAULT_KEYS = { new: 'CommandOrControl+Alt+T', tp: 'CommandOrControl+Alt+P', sl: 'CommandOrControl+Alt+L', man: 'CommandOrControl+Alt+M' };
const getKeys = () => ({ ...DEFAULT_KEYS, ...(getConfig().shortcuts || {}) });
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const actions = { new: () => guarded(newTrade), tp: () => guarded(() => closeTrade('TP')), sl: () => guarded(() => closeTrade('SL')), man: () => guarded(() => closeTrade('MANUALE')) };
  const failed = [];
  for (const [k, acc] of Object.entries(getKeys())) {
    if (!acc || !actions[k]) continue;
    try { if (!globalShortcut.register(acc, actions[k])) failed.push(k); } catch { failed.push(k); }
  }
  return failed;
}

// ---------- finestra Impostazioni ----------
let settingsWin = null;
function openSettings() {
  if (alive(settingsWin)) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560, height: 780, backgroundColor: '#14161b', title: 'Impostazioni',
    icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile('ui/settings.html');
  settingsWin.on('closed', () => { settingsWin = null; registerShortcuts(); });
}
// i conti sono locali (accounts.json, condiviso con il Journal); l'email c'è solo se hai attivato la copia online
function accountsInfo() { return { email: (getConfig().link || {}).email || null, accounts: store.readAccounts().filter((x) => !x.shared) }; }
function selectAccount(a) {
  const c = getConfig();
  c.link = { ...(c.link || {}), accountId: a.id, accountName: a.name, accountKind: a.kind === 'backtest' ? 'backtest' : 'conto' };
  const pl = (c.accountPlatform || {})[a.id];
  saveConfig(c);
  if (pl && pl !== c.activePlatform) switchPlatform(pl, false);
  refreshToolbar(); refreshLists(); syncAll();
}
function switchPlatform(id, remember = true) {
  const raw = migrate(readJSON(CONFIG_FILE, {}));
  if (!raw.platforms[id]) return;
  raw.activePlatform = id;
  layoutNow = 'normal'; lastLayout = 'normal';        // ogni piattaforma riparte dal layout normale
  const acc = (raw.link || {}).accountId;
  if (remember && acc) raw.accountPlatform = { ...(raw.accountPlatform || {}), [acc]: id };   // il conto ricorda la sua piattaforma
  writeJSON(CONFIG_FILE, raw);
  refreshToolbar();
}
function platformList() {
  const raw = migrate(readJSON(CONFIG_FILE, {}));
  return { platforms: Object.entries(raw.platforms).map(([id, p]) => ({ id, name: p.name, calibrated: !!(p.priceRect && p.balanceRect), fullCalibrated: !!(p.full && p.full.priceRect && p.full.balanceRect), layoutMode: p.layoutMode || 'auto', customColors: !!p.hues })), activePlatform: raw.activePlatform };
}
ipcMain.handle('settings:get', async () => {
  const c = getConfig();
  return { keys: getKeys(), defaults: DEFAULT_KEYS, mode: barModeOf(c), quickSave: !!c.quickSave, replayRec: !!c.replayRec, replayEvery: replayEvery(), accountId: (activeAccount() || {}).id || '', ...platformList(), ...accountsInfo() };
});
ipcMain.handle('settings:platform', (_e, id) => { switchPlatform(id); return platformList(); });
function createPlatform(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('Scrivi il nome della piattaforma.');
  const raw = migrate(readJSON(CONFIG_FILE, {}));
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'piattaforma', n = 2;
  while (raw.platforms[id]) id = id.replace(/\d+$/, '') + n++;
  raw.platforms[id] = { name };
  writeJSON(CONFIG_FILE, raw);
  switchPlatform(id);
  return id;
}
ipcMain.handle('settings:create-platform', (_e, name) => { createPlatform(name); return platformList(); });
ipcMain.handle('settings:layout-mode', (_e, mode) => {
  const raw = migrate(readJSON(CONFIG_FILE, {})), p = raw.platforms[raw.activePlatform] || {};
  if (['normal', 'full'].includes(mode)) p.layoutMode = mode; else delete p.layoutMode;
  raw.platforms[raw.activePlatform] = p; writeJSON(CONFIG_FILE, raw);
  return platformList();
});
ipcMain.handle('settings:calibrate', async (_e, layout) => {
  // lo schermo da calibrare è quello dove stai lavorando adesso: dove si trovano le Impostazioni (o la configurazione guidata)
  const here = alive(settingsWin) && settingsWin.isVisible() ? settingsWin : (alive(wizardWin) && wizardWin.isVisible() ? wizardWin : null);
  const hint = here ? screen.getDisplayMatching(here.getBounds()) : null;
  // nascondo le Impostazioni, altrimenti finirebbero nello screenshot sopra il grafico
  if (alive(settingsWin)) settingsWin.hide();
  if (alive(wizardWin)) wizardWin.hide();
  const back = () => { if (alive(settingsWin)) settingsWin.show(); if (alive(wizardWin)) { wizardWin.show(); wizardWin.webContents.send('wizard:refresh'); } };
  await guarded(() => openCalibration(layout === 'full' ? 'full' : 'normal', hint));
  if (alive(calibWin)) calibWin.once('closed', back); else back();
});
// "Prova la lettura": nasconde le impostazioni, aspetta 4 secondi (tu metti in vista il grafico), legge e mostra cosa ha capito. Non salva nulla.
ipcMain.handle('settings:test-read', async () => {
  let cfg = getConfig();
  if (!isCalibrated()) throw new Error('Prima serve la calibrazione: premi "Calibra".');
  if (alive(settingsWin)) settingsWin.hide();
  if (alive(wizardWin)) wizardWin.hide();
  try {
    await sleep(4000);
    const { img } = await capture();
    cfg = useScreenProfile(img, cfg);
    const lay = await layoutFor(img); cfg = lay.cfg;
    const v = await analyze(img, cfg);
    let when = {};
    try { when = await tradeWhen(img, cfg) || {}; } catch {}
    const sz = img.getSize();
    return { layout: lay.info.note || '', size: `${sz.width}×${sz.height}`, entry: v.entry, tp: v.tp, sl: v.sl, symbol: v.symbol || null, balance: v.balance === undefined ? null : v.balance, date: when.tradeDate || null, time: when.tradeTime || null, hint: priceHint(v, v.symbol || cfg.lastSymbol || '') || '' };
  } finally { if (alive(settingsWin)) { settingsWin.show(); settingsWin.focus(); } if (alive(wizardWin)) { wizardWin.show(); wizardWin.focus(); } }
});
ipcMain.handle('settings:pause-keys', () => { globalShortcut.unregisterAll(); });   // mentre registri una scorciatoia
ipcMain.handle('settings:save-keys', (_e, keys) => {
  const c = getConfig(); c.shortcuts = keys; saveConfig(c);
  return registerShortcuts();
});
ipcMain.handle('settings:mode', (_e, mode) => { const c = getConfig(); c.barMode = ['estesa', 'tasti'].includes(mode) ? mode : 'minimal'; saveConfig(c); refreshToolbar(); });
ipcMain.handle('settings:account', async (_e, id) => {
  const a = store.readAccounts().find((x) => x.id === id);
  if (!a) throw new Error('Conto non trovato');
  selectAccount(a);
  return true;
});
ipcMain.handle('settings:create-account', async (_e, d) => {
  const name = String(d.name || '').trim();
  if (!name) throw new Error('Scrivi il nome del conto.');
  const a = store.addAccount({ name, kind: d.kind === 'backtest' ? 'backtest' : 'conto' });
  selectAccount(a);
  return { accounts: store.readAccounts(), accountId: a.id };
});
ipcMain.handle('settings:link', () => openLink());
ipcMain.handle('update:get', () => ({ url: updater.getUrl(), version: app.getVersion() }));
ipcMain.handle('update:set', (_e, url) => ({ url: updater.setUrl(url), version: app.getVersion() }));
ipcMain.handle('update:check', () => updater.check({ silent: false }));

// ---------- notizie economiche ----------
// Il browser non può leggere il calendario (blocco CORS), la barra sì: lo scarica e lo salva nel tuo database,
// da dove il sito lo legge. Si tiene lo storico, quindi col tempo il calendario mostra anche le notizie passate.
let newsBusy = false;
const hhmm = (ms) => new Date(ms).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
async function fetchNews(manual = false) {
  if (newsBusy) return { error: 'Aggiornamento già in corso.' };
  const now = Date.now(), meta = store.readNewsMeta();
  const last = Math.max(meta.lastTry || 0, getConfig().newsLastTry || 0);     // registro condiviso: se l'ha appena fatto il Journal non lo ripeto
  if (!manual && last && now - last < 3 * 3600e3) return { skipped: true };    // il servizio limita le richieste
  if (manual && last && now - last < 120e3) return { error: 'Appena aggiornate: riprova tra un paio di minuti.' };
  newsBusy = true;
  try {
    const { events, ok, lastErr } = await fetchEvents((u, o) => net.fetch(u, o));
    store.updateNewsMeta((m) => { m.lastTry = now; });
    const c1 = getConfig(); c1.newsLastTry = now; saveConfig(c1);
    if (!ok) return { error: `Non riesco a scaricare il calendario (${lastErr || 'nessuna risposta'}). Il servizio limita le richieste troppo frequenti: riprova più tardi.` };
    store.mergeNews(events);                                                  // sul PC: sempre
    store.updateNewsMeta((m) => { m.lastOk = now; m.count = events.length; });
    let remote = '';
    try {                                                                     // copia online: solo se l'hai attivata
      const s2 = getSb(), user = s2 && await linkedUser();
      if (user) {
        for (let i = 0; i < events.length; i += 200) {
          const { error } = await s2.from('news_events').upsert(events.slice(i, i + 200).map((e) => ({ ...e, user_id: user.id })), { onConflict: 'user_id,event_key' });
          if (error) throw error;
        }
      }
    } catch (e) {
      const msg = String(e && e.message || e);
      remote = /news_events|relation|schema cache/i.test(msg) ? 'La copia online non è stata aggiornata: nel database manca la tabella delle notizie (aggiornamento-0.7.sql).' : `La copia online non è stata aggiornata: ${msg}`;
    }
    const c2 = getConfig(); c2.newsLastOk = now; c2.newsCount = events.length; saveConfig(c2);
    return { count: events.length, remote };
  } catch (e) {
    return { error: String(e && e.message || e) };
  } finally { newsBusy = false; }
}
async function runNewsFetch() {
  status('Scarico le notizie…');
  const r = await fetchNews(true);
  status(r.error ? 'Notizie non aggiornate' : 'Notizie aggiornate ✓');
  await dialog.showMessageBox({ type: r.error ? 'warning' : 'info', message: r.error ? 'Notizie non aggiornate' : 'Notizie economiche aggiornate', detail: r.error || `${r.count} eventi salvati sul PC (settimana corrente e prossima). Li trovi nella pagina News del Journal e come puntino rosso nel calendario.${r.remote ? '\n\n' + r.remote : ''}` });
}

// ---------- condivisione locale (per siti senza database, es. un journal che salva i dati nel browser) ----------
// Un servizio che gira solo su questo PC: offre trade e screenshot ai siti autorizzati. Spento di default.
const LOCAL_DEFAULTS = { enabled: false, port: 47821, origins: ['https://eclipsejournal.netlify.app'] };
let localError = '';
function localCfg() {
  const c = getConfig();
  let l = c.localApi;
  if (!l || !l.key) {
    l = { ...LOCAL_DEFAULTS, ...(l || {}), key: crypto.randomBytes(16).toString('hex') };
    c.localApi = l; saveConfig(c);
  }
  return { ...LOCAL_DEFAULTS, ...l };
}
// ogni screenshot ha un indirizzo casuale e non indovinabile (così i link restano privati e stabili)
function shotIdFor(t, kind) {
  const rel = kind === 'open' ? t.shotOpen : t.shotClose;
  if (!rel) return null;
  const f = kind === 'open' ? 'shotOpenId' : 'shotCloseId';
  if (!t[f]) {
    const id = crypto.randomBytes(12).toString('hex');
    const x = store.patchTrade(t.id, (cur) => (cur[f] ? {} : { [f]: id }));    // senza cambiare rev: non è una modifica del trade
    if (!x) return null;
    t[f] = x[f];
  }
  return t[f];
}
function shotFileOf(id) {
  for (const t of getTrades()) {
    const rel = t.shotOpenId === id ? t.shotOpen : t.shotCloseId === id ? t.shotClose : null;
    const file = rel && store.shotAbs(rel);
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}
function readImageFile(file, { jpeg, maxWidth }) {
  try {
    if (!jpeg) return fs.readFileSync(file);
    let img = nativeImage.createFromPath(file);
    const w = img.getSize().width;
    if (maxWidth && w > maxWidth) img = img.resize({ width: maxWidth, quality: 'best' });
    return img.toJPEG(82);
  } catch { return null; }
}
const localApi = createLocalApi({
  getTrades: () => { const sh = sharedIds(); return getTrades().filter((t) => !sh.has(t.accountId)); }, getConfig: () => localCfg(), version: app.getVersion(),
  shotId: shotIdFor, shotFile: shotFileOf, readImage: readImageFile,
});
async function applyLocalApi() {
  const l = localCfg();
  localError = '';
  try {
    await localApi.stop();
    if (l.enabled) await localApi.start(l.port);
  } catch (e) { localError = String(e && e.message || e); }
  return localState();
}
function localState() {
  const l = localCfg();
  return { enabled: l.enabled, port: l.port, origins: l.origins, key: l.key, running: localApi.isRunning(), error: localError, address: `http://127.0.0.1:${l.port}` };
}
function normOrigins(list) {
  const out = [];
  for (const x of list || []) {
    try { const u = new URL(String(x).trim()); if (/^https?:$/.test(u.protocol)) out.push(u.origin); } catch { /* voce non valida */ }
  }
  return [...new Set(out)].slice(0, 10);
}
ipcMain.handle('local:get', () => localState());
ipcMain.handle('local:set', async (_e, d) => {
  const c = getConfig(), l = localCfg();
  const port = Number(d.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) { localError = 'La porta deve essere un numero tra 1024 e 65535.'; return { ...localState(), error: localError }; }
  c.localApi = { ...l, enabled: !!d.enabled, port, origins: normOrigins(d.origins) };
  saveConfig(c);
  return applyLocalApi();
});
ipcMain.handle('local:regen', () => { const c = getConfig(), l = localCfg(); c.localApi = { ...l, key: crypto.randomBytes(16).toString('hex') }; saveConfig(c); return localState(); });
ipcMain.handle('local:copy', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('local:open', () => { const st = localState(); if (st.running) shell.openExternal(`${st.address}/?k=${st.key}`); return st.running; });
// scorciatoia: copia il link dell'ultimo screenshot (da incollare, per esempio, nel campo link di un journal)
function copyLastShotLink() {
  const st = localState();
  if (!st.running) { dialog.showMessageBox({ type: 'info', message: 'Condivisione locale spenta', detail: 'Accendila da Impostazioni > Condivisione locale: serve per avere un link agli screenshot.' }); return; }
  const t = [...getTrades()].reverse().find((x) => x.shotClose || x.shotOpen);
  if (!t) { dialog.showMessageBox({ type: 'info', message: 'Ancora nessuno screenshot' }); return; }
  const id = shotIdFor(t, t.shotClose ? 'close' : 'open');
  clipboard.writeText(`${st.address}/s/${id}.png`);
  status('Link copiato ✓');
}

// ---------- azioni della barra ----------
async function guarded(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); }
  catch (err) {
    console.error(err);
    dialog.showMessageBox({ type: 'error', message: 'Qualcosa è andato storto', detail: String(err && err.message || err) });
    status('Errore');
  } finally { busy = false; }
}

// Protezione contro le cifre perse: il numero di cifre intere dei prezzi deve essere lo stesso fra loro
// e uguale all'ultimo trade sullo stesso simbolo (25345 non diventa 5345 senza che nessuno se ne accorga).
const intDigits = (n) => String(Math.floor(Math.abs(n))).length;
function priceHint(v, symbol) {
  const prices = [['ingresso', v.entry], ['take profit', v.tp], ['stop loss', v.sl]].filter(([, x]) => x != null);
  const msgs = [];
  if (prices.length >= 2) {
    const ds = prices.map(([, x]) => intDigits(x));
    if (Math.max(...ds) !== Math.min(...ds)) msgs.push('I prezzi letti non hanno lo stesso numero di cifre: forse ne manca una.');
  }
  const last = [...getTrades()].reverse().find((t) => t.symbol === symbol && t.entry != null);
  if (last) {
    const bad = prices.filter(([, x]) => intDigits(x) !== intDigits(last.entry)).map(([n, x]) => `${n} (${intDigits(x)} cifre intere)`);
    if (bad.length) msgs.push(`Controlla ${bad.join(', ')}: l'ultimo trade su ${symbol} aveva un ingresso di ${last.entry} (${intDigits(last.entry)} cifre intere). Forse manca una cifra.`);
  }
  return msgs.join(' ');
}
async function newTrade() {
  let cfg = getConfig();
  if (!isCalibrated()) {
    await dialog.showMessageBox({ type: 'info', message: 'Prima serve la calibrazione', detail: 'Ti mostro lo schermo: indica la colonna dei prezzi e il saldo.' });
    return openCalibration();
  }
  status('Leggo lo schermo…');
  const { img } = await capture();   // lo schermo dove si trova la barra: sposta barra e grafico insieme e funziona
  cfg = useScreenProfile(img, cfg);
  const lay = await layoutFor(img); cfg = lay.cfg;
  const shot = saveShot(forJournal(img, cfg), 'apertura');
  const v = await analyze(img, cfg);
  const calibNote = logRead(v.entry != null && !(v.tp == null && v.sl == null) && !priceHint(v, v.symbol || cfg.lastSymbol || ''));
  status('Controlla i dati');
  const when = await tradeWhen(img, cfg);
  const dv = curValues();
  const sym = v.symbol || cfg.lastSymbol || '';
  const od = { mode: 'open', shot, ...v, symbol: sym, symbolRead: !!v.symbol, priceHint: priceHint(v, sym), layoutNote: [lay.info.note, calibNote].filter(Boolean).join(' '), setup: dv.setup, tags: dv.tags, note: dv.note, ...when,
    backtest: activeKind() === 'backtest' };
  if (quickOpenOk(od)) saveQuick(od); else openConfirm(od);
}

async function closeTrade(outcome, tradeId = null) {
  const opens = getTrades().filter((t) => t.status === 'aperto');
  const trade = tradeId ? opens.find((t) => t.id === tradeId) : opens.pop();
  if (!trade) {
    await dialog.showMessageBox({ type: 'info', message: 'Non c\'è nessun trade aperto da chiudere.' });
    return;
  }
  let cfg = getConfig();
  status('Leggo il saldo…');
  const { img } = await capture();   // lo schermo dove si trova la barra: sposta barra e grafico insieme e funziona
  cfg = useScreenProfile(img, cfg);
  const lay = await layoutFor(img); cfg = lay.cfg;
  const shot = saveShot(forJournal(img, cfg), 'chiusura');
  let { balance } = await readBalance(img, cfg);
  const ref = Math.max(Math.abs(trade.tpUsd || 0), Math.abs(trade.slUsd || 0));
  const implausible = (b) => b != null && trade.balanceBefore != null && ref && Math.abs(b - trade.balanceBefore) > ref * 5;
  // un risultato lontanissimo dai valori di TP e SL è una lettura sbagliata: rileggo nella fascia larga
  if (balance == null || implausible(balance)) { const w = await readBalance(img, cfg, true); if (w.balance != null && !implausible(w.balance)) balance = w.balance; }
  let pnl = balance != null && trade.balanceBefore != null && !implausible(balance) ? round2(balance - trade.balanceBefore) : null;
  let pnlHint = implausible(balance) ? 'Il saldo letto non torna con i valori del trade. ' : '';
  if (pnl == null) {
    // saldo non leggibile: per TP e SL uso il valore in denaro letto all'apertura
    if (outcome === 'TP' && trade.tpUsd != null) { pnl = trade.tpUsd; pnlHint += 'Saldo non letto: il risultato è il valore del TP letto all\'apertura. Controllalo.'; }
    else if (outcome === 'SL' && trade.slUsd != null) { pnl = trade.slUsd; pnlHint += 'Saldo non letto: il risultato è il valore dello SL letto all\'apertura. Controllalo.'; }
    else pnlHint += 'Saldo non letto: scrivi il risultato a mano.';
  }
  status('Controlla i dati');
  const cd = { mode: 'close', tradeId: trade.id, outcome, shot, balanceAfter: balance, pnl, pnlHint, trade, layoutNote: lay.info.note };
  if (quickCloseOk(cd)) saveQuick(cd); else openConfirm(cd);
}

// Conto alla rovescia prima di fotografare lo schermo: serve il tempo di mettere il mouse sul grafico (la data sotto il grafico compare solo lì).
// È una finestrella che non prende il focus, così il mouse resta dove lo metti; sparisce prima dello scatto.
async function countdownNotice(display, seconds, title) {
  const b = display.bounds, w = 560, h = 120;
  const win = new BrowserWindow({
    x: Math.round(b.x + (b.width - w) / 2), y: b.y + 50, width: w, height: h, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: true, backgroundColor: '#1c1f26',
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);                      // il mouse "passa attraverso": il grafico sotto lo riceve come sempre
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1c1f26;color:#e6e8ec;font:15px/1.4 'Segoe UI',system-ui,sans-serif;display:flex;align-items:center;gap:18px;padding:0 24px;height:100vh;box-sizing:border-box;border:2px solid #2f6bff;overflow:hidden"><div id="n" style="font:700 44px 'Segoe UI',system-ui;color:#8fb0ff;min-width:56px;text-align:center">${seconds}</div><div><b style="font-size:17px">${title}</b><br>Metti il <b>mouse sul grafico</b> (così sotto il grafico compare la data) e lascialo fermo.</div></body>`;
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.showInactive();
    for (let n = seconds; n > 0; n--) {
      status(`Calibrazione: fotografo lo schermo tra ${n}…`);
      if (!win.isDestroyed()) win.webContents.executeJavaScript(`document.getElementById('n').textContent='${n}'`).catch(() => {});
      await sleep(1000);
    }
  } finally { if (!win.isDestroyed()) win.close(); }
  await sleep(250);                                     // il tempo che la finestrella sparisca davvero dallo schermo
}

async function openCalibration(layout = 'normal', hintDisplay = null) {
  if (layout === 'full') {
    const r = await dialog.showMessageBox({ type: 'info', buttons: ['Parti (10 secondi)', 'Annulla'], defaultId: 0, cancelId: 1, message: 'Calibrazione a schermo intero',
      detail: 'Dopo aver premuto "Parti" hai 10 secondi per:\n\n1. Mettere la piattaforma a schermo intero (di solito il tasto F11).\n2. Avere un trade aperto, con TP e SL ben visibili sul grafico.\n3. Mettere il mouse sul grafico (così compare la data).\n\nAllo scadere fotografo lo schermo così com\'è. Una finestrella mostra il conto alla rovescia.' });
    if (r.response !== 0) return;
  }
  layoutNow = layout === 'full' ? 'full' : 'normal';
  // si calibra lo schermo dove si trova la barra: è lo stesso che la barra fotografa quando registri un trade (non quello salvato la volta scorsa)
  const disp = alive(toolbar) ? screen.getDisplayMatching(toolbar.getBounds()) : (hintDisplay || screen.getPrimaryDisplay());
  await countdownNotice(disp, layout === 'full' ? 10 : 6, layout === 'full' ? 'Schermo intero: calibro tra poco' : 'Sto per fotografare lo schermo');
  status('Preparo la calibrazione…');
  const { img, displayId } = await capture(disp.id);
  calib = { img, displayId, layout: layoutNow };
  if (alive(calibWin)) calibWin.close();
  calibWin = new BrowserWindow({
    x: disp.bounds.x + 40, y: disp.bounds.y + 40, width: 1200, height: 800, show: false, backgroundColor: '#000000', title: 'Calibrazione', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  calibWin.setMenuBarVisibility(false);
  calibWin.loadFile('ui/calibrate.html');
  // finestra ingrandita (non "schermo intero" vero: su Windows poteva coprire tutto e non lasciare cliccare niente); la pagina adatta lo screenshot alla finestra
  const showCalib = () => { if (alive(calibWin) && !calibWin.isVisible()) { calibWin.maximize(); calibWin.show(); calibWin.focus(); } };
  calibWin.once('ready-to-show', showCalib);
  setTimeout(showCalib, 4000);                                // se per qualche motivo non parte da solo, la mostro comunque
  status('Pronto');
}


// ---------- salvataggio rapido: se tutto è stato letto bene non serve la finestra di conferma ----------
const quickOn = () => !!getConfig().quickSave;
const nz = (x) => x !== null && x !== undefined && x !== '';
function quickOpenOk(d) {
  return quickOn() && nz(d.symbol) && (d.direction === 'LONG' || d.direction === 'SHORT') && nz(d.entry) && nz(d.tp) && nz(d.sl) && nz(d.balance)
    && !d.priceHint && !d.moneyCheck && !d.priceFixed && !d.dateHint && nz(d.tradeDate) && (d.backtest ? nz(d.tradeTime) : true);
}
function quickCloseOk(d) { return quickOn() && nz(d.balanceAfter) && nz(d.pnl) && !d.pnlHint; }
function saveQuick(data) {
  pending = data;
  if (data.mode === 'open') {
    applyConfirm({ mode: 'open', symbol: data.symbol, direction: data.direction, entry: data.entry, sl: data.sl, tp: data.tp, contracts: data.contracts,
      balanceBefore: data.balance, note: data.note || '', tpUsd: data.tpUsd, slUsd: data.slUsd, tradeDate: data.tradeDate, tradeTime: data.tradeTime, setup: data.setup || '' });
    status(`Salvato: ${data.symbol} ${data.direction} ✓`);
  } else {
    applyConfirm({ mode: 'close', tradeId: data.tradeId, outcome: data.outcome, balanceAfter: data.balanceAfter, pnl: data.pnl, note: '' });
    status(`Chiuso: ${data.outcome} ${data.pnl >= 0 ? '+' : ''}${data.pnl} ✓`);
  }
  setTimeout(() => status('Pronto'), 4000);
}
ipcMain.handle('settings:quicksave', (_e, on) => { const c = getConfig(); c.quickSave = !!on; saveConfig(c); return !!on; });

function openConfirm(data) {
  data.setups = [...lists.setups];
  data.allTags = [...(lists.tags || [])];
  pending = data;
  if (alive(confirmWin)) confirmWin.close();
  confirmWin = new BrowserWindow({
    width: 460, height: data.mode === 'open' ? 840 : 700, alwaysOnTop: true, resizable: true,
    backgroundColor: '#14161b', title: data.mode === 'open' ? 'Nuovo trade' : 'Chiusura trade',
    icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  confirmWin.setMenuBarVisibility(false);
  confirmWin.loadFile('ui/confirm.html');
  confirmWin.on('closed', () => { confirmWin = null; status('Pronto'); });
}

function openJournal() {
  if (alive(journalWin)) { journalWin.show(); journalWin.focus(); return; }
  journalWin = new BrowserWindow({
    width: 1150, height: 720, backgroundColor: '#14161b', title: 'Journal',
    icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  journalWin.setMenuBarVisibility(false);
  journalWin.loadFile('ui/journal.html');
}

function createToolbar() {
  toolbar = new BrowserWindow({
    width: 300, height: 40, frame: false, resizable: false, alwaysOnTop: true,
    transparent: true, backgroundColor: '#00000000', hasShadow: false, title: 'Trade Logger',
    icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  if (process.platform === 'darwin') {
    toolbar.setAlwaysOnTop(true, 'screen-saver');                                   // sopra anche alle app a schermo intero
    toolbar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else toolbar.setAlwaysOnTop(true, 'floating');
  const pos = getConfig().toolbarPos;
  if (pos && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return pos[0] >= a.x && pos[1] >= a.y && pos[0] < a.x + a.width && pos[1] < a.y + a.height;
  })) toolbar.setPosition(pos[0], pos[1]);
  toolbar.on('moved', () => { const c = getConfig(); c.toolbarPos = toolbar.getPosition(); saveConfig(c); });
  toolbar.loadFile('ui/toolbar.html');
  toolbar.webContents.on('did-finish-load', refreshToolbar);
  toolbar.on('closed', () => app.quit());
}

// ---------- finestra "Novità" dopo un aggiornamento ----------
let novitaWin = null;
function openNovita() {
  if (alive(novitaWin)) { novitaWin.show(); novitaWin.focus(); return; }
  novitaWin = new BrowserWindow({
    width: 560, height: 640, backgroundColor: '#14161b', title: 'Novità', icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  novitaWin.setMenuBarVisibility(false);
  novitaWin.loadFile('ui/novita.html');
  novitaWin.on('closed', () => { novitaWin = null; const c = getConfig(); c.lastSeenVersion = app.getVersion(); saveConfig(c); });
}
ipcMain.handle('novita:get', () => ({ current: app.getVersion(), since: getConfig().lastSeenVersion || '' }));
ipcMain.handle('novita:close', () => { if (alive(novitaWin)) novitaWin.close(); });

// ---------- configurazione guidata (primo avvio) ----------
let wizardWin = null;
function openWizard() {
  if (alive(wizardWin)) { wizardWin.show(); wizardWin.focus(); return; }
  wizardWin = new BrowserWindow({
    width: 600, height: 740, backgroundColor: '#14161b', title: 'Configurazione guidata',
    icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  wizardWin.setMenuBarVisibility(false);
  wizardWin.loadFile('ui/wizard.html');
  wizardWin.on('closed', () => { wizardWin = null; const c = getConfig(); if (!c.wizardDone) { c.wizardDone = true; saveConfig(c); } registerShortcuts(); });
}
ipcMain.handle('wizard:finish', (_e, withTour) => {
  const c = getConfig(); c.wizardDone = true; saveConfig(c);
  if (alive(wizardWin)) wizardWin.close();
  if (withTour) setTimeout(startTour, 400);
});

// ---------- tutorial guidato ----------
// Una finestra trasparente a tutto schermo (sullo schermo della barra) scurisce tutto e lascia in luce il pezzo spiegato.
let tourWin = null, tourBounds = null;
function startTour() {
  if (alive(tourWin)) { tourWin.focus(); return; }
  if (!alive(toolbar)) return;
  const c = getConfig();
  if (c.tourPrevMode === undefined) c.tourPrevMode = barModeOf(c);   // il tutorial mostra la barra estesa; alla fine torna com'era
  c.barMode = 'estesa'; saveConfig(c); refreshToolbar();
  globalShortcut.unregisterAll();                                    // durante il giro le scorciatoie non devono registrare trade
  const d = screen.getDisplayMatching(toolbar.getBounds());
  tourBounds = d.bounds;
  tourWin = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, transparent: true,
    backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Tutorial',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  tourWin.setAlwaysOnTop(true, 'screen-saver');
  tourWin.setMenu(null);
  tourWin.loadFile('ui/tour.html');
  tourWin.once('ready-to-show', () => { if (alive(tourWin)) { tourWin.show(); tourWin.focus(); } });
  tourWin.on('closed', endTour);
}
function endTour() {
  tourWin = null;
  const c = getConfig();
  if (c.tourPrevMode !== undefined) { c.barMode = c.tourPrevMode; delete c.tourPrevMode; }
  c.tourDone = true; saveConfig(c); refreshToolbar();
  registerShortcuts();
}
ipcMain.handle('tour:get', () => ({ keys: getKeys() }));
ipcMain.handle('tour:rect', async (_e, ids) => {
  if (!alive(toolbar) || !tourBounds || !Array.isArray(ids)) return null;
  const r = await toolbar.webContents.executeJavaScript(`(${JSON.stringify(ids)}).map((id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [r.left, r.top, r.right, r.bottom] : null; }).filter(Boolean)`).catch(() => []);
  if (!r || !r.length) return null;
  const b = toolbar.getBounds();
  const l = Math.min(...r.map((x) => x[0])), t = Math.min(...r.map((x) => x[1])), rr = Math.max(...r.map((x) => x[2])), bb = Math.max(...r.map((x) => x[3]));
  return { x: b.x + l - tourBounds.x, y: b.y + t - tourBounds.y, w: rr - l, h: bb - t };
});
ipcMain.handle('tour:close', () => { if (alive(tourWin)) tourWin.close(); });

// ---------- spostamento della barra (trascinando la maniglia) ----------
let dragStart = null;
ipcMain.on('toolbar:drag-start', (_e, p) => { const [x, y] = toolbar.getPosition(); dragStart = { x, y, sx: p.x, sy: p.y }; });
ipcMain.on('toolbar:drag', (_e, p) => {
  if (!dragStart) return;
  toolbar.setPosition(Math.round(dragStart.x + p.x - dragStart.sx), Math.round(dragStart.y + p.y - dragStart.sy));
});
ipcMain.on('toolbar:resize', (_e, w) => {
  if (!alive(toolbar) || !Number.isFinite(w)) return;
  const width = Math.max(200, Math.min(820, Math.round(w)));
  const [x, y] = toolbar.getPosition();
  toolbar.setResizable(true); toolbar.setBounds({ x, y, width, height: 40 }); toolbar.setResizable(false);
});
ipcMain.on('toolbar:drag-end', () => {
  dragStart = null;
  const c = getConfig(); c.toolbarPos = toolbar.getPosition(); saveConfig(c);
});

// ---------- comunicazione con le finestre ----------
ipcMain.handle('toolbar:new', () => guarded(newTrade));
ipcMain.handle('toolbar:close', (_e, outcome) => guarded(() => closeTrade(outcome)));
ipcMain.handle('toolbar:calibrate', () => guarded(openCalibration));
// Il Journal è un programma a parte: lo apro se è installato, ma la barra funziona anche senza.
function journalExePath() {
  const c = getConfig();
  if (process.platform === 'darwin') {
    const home = process.env.HOME || '';
    const m = [c.journalExe, '/Applications/Journal.app', home && path.join(home, 'Applications', 'Journal.app')].filter(Boolean);
    return m.find((f) => { try { return fs.existsSync(f); } catch { return false; } }) || null;
  }
  const cands = [c.journalExe, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Journal', 'Journal.exe'), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Journal', 'Journal.exe')].filter(Boolean);
  return cands.find((f) => { try { return fs.existsSync(f); } catch { return false; } }) || null;
}
function launchJournal() {
  const exe = journalExePath();
  if (!exe) return false;
  try { if (process.platform === 'darwin') require('child_process').spawn('open', [exe], { detached: true, stdio: 'ignore' }).unref(); else require('child_process').spawn(exe, [], { detached: true, stdio: 'ignore' }).unref(); return true; } catch { return false; }
}
// ordine: programma Journal se è installato, altrimenti l'indirizzo del journal online (se c'è), altrimenti il visualizzatore semplice
function openJournalApp() {
  if (launchJournal()) return;
  const l = getConfig().link || {};
  if (l.siteUrl) shell.openExternal(l.siteUrl); else openJournal();
}
ipcMain.handle('toolbar:journal', () => openJournalApp());
ipcMain.handle('toolbar:link', () => openLink());
function accountMenu() {
  const act = activeAccount();
  return [
    ...store.readAccounts().filter((x) => !x.shared).map((a) => ({ label: a.name + (a.kind === 'backtest' ? '  (backtest)' : ''), type: 'radio', checked: !!act && a.id === act.id, click: () => selectAccount(a) })),
    { type: 'separator' },
    { label: 'Nuovo conto o backtest…', click: () => openSettings() },
  ];
}
function setLayoutMode(mode) {
  const raw = migrate(readJSON(CONFIG_FILE, {})), p = raw.platforms[raw.activePlatform] || {};
  if (mode === 'auto') delete p.layoutMode; else p.layoutMode = mode;
  raw.platforms[raw.activePlatform] = p; writeJSON(CONFIG_FILE, raw);
  status(mode === 'auto' ? 'Layout: automatico' : `Layout: sempre ${layoutName(mode)}`);
}
function platformMenu() {
  const { platforms, activePlatform } = platformList();
  const mode = (platforms.find((p) => p.id === activePlatform) || {}).layoutMode;
  return [
    ...platforms.map((p) => ({ label: p.name + (p.calibrated ? '' : '  (da calibrare)'), type: 'radio', checked: p.id === activePlatform, click: () => switchPlatform(p.id) })),
    { type: 'separator' },
    { label: 'Calibra: layout normale', click: () => guarded(() => openCalibration('normal')) },
    { label: 'Calibra: schermo intero', click: () => guarded(() => openCalibration('full')) },
    { label: 'Layout in uso', submenu: [
      { label: 'Automatico (lo riconosce da solo)', type: 'radio', checked: !mode || mode === 'auto', click: () => setLayoutMode('auto') },
      { label: 'Sempre normale', type: 'radio', checked: mode === 'normal', click: () => setLayoutMode('normal') },
      { label: 'Sempre schermo intero', type: 'radio', checked: mode === 'full', click: () => setLayoutMode('full') },
    ] },
    { label: 'Nuova piattaforma…', click: async () => {
      const v = await openPrompt({ title: 'Nuova piattaforma', label: 'Nome della piattaforma (es. TradeSea)', value: '' });
      if (!v || !v.trim()) return;
      createPlatform(v);
      const r = await dialog.showMessageBox({ type: 'question', buttons: ['Calibra adesso', 'Più tardi'], defaultId: 0, message: `Piattaforma "${v.trim()}" creata`, detail: 'Per calibrarla apri il suo grafico con un trade aperto (TP e SL visibili), poi premi Calibra adesso.' });
      if (r.response === 0) guarded(openCalibration);
    } },
  ];
}
ipcMain.handle('toolbar:menu', () => {
  const l = getConfig().link || {};
  const pl = platformList(), pname = (pl.platforms.find((p) => p.id === pl.activePlatform) || {}).name || '';
  Menu.buildFromTemplate([
    { label: `Conto: ${(activeAccount() || {}).name || 'nessuno'}`, submenu: accountMenu() },
    { label: `Piattaforma: ${pname}`, submenu: platformMenu() },
    { type: 'separator' },
    { label: 'Registra il replay dei trade (beta)', type: 'checkbox', checked: replayOn(), click: (mi) => setReplay(mi.checked) },
    { label: 'Impostazioni…', click: () => openSettings() },
    { label: 'Novità di questa versione…', click: () => openNovita() },
    { label: 'Configurazione guidata…', click: () => openWizard() },
    { label: 'Tutorial…', click: () => startTour() },
    { type: 'separator' },
    { label: 'Apri il Journal', click: () => openJournalApp() },
    { label: 'Journal semplice (dentro la barra)', click: () => openJournal() },
    { type: 'separator' },
    { label: 'Barra minimal', type: 'radio', checked: barModeOf(getConfig()) === 'minimal', click: () => { const c = getConfig(); c.barMode = 'minimal'; saveConfig(c); refreshToolbar(); } },
    { label: 'Barra estesa', type: 'radio', checked: getConfig().barMode === 'estesa', click: () => { const c = getConfig(); c.barMode = 'estesa'; saveConfig(c); refreshToolbar(); } },
    { label: 'Barra Tasti rapidi (solo Setup e Tag)', type: 'radio', checked: barModeOf(getConfig()) === 'tasti', click: () => { const c = getConfig(); c.barMode = 'tasti'; saveConfig(c); refreshToolbar(); } },
    { type: 'separator' },
    { label: 'Copia online (facoltativa)…', click: () => openLink() },
    { label: 'Copia link ultimo screenshot', enabled: localApi.isRunning(), click: () => copyLastShotLink() },
    { label: `Aggiorna notizie economiche${getConfig().newsLastOk ? `  (ultime: ${hhmm(getConfig().newsLastOk)})` : ''}`, click: () => runNewsFetch() },
    { type: 'separator' },
    { label: 'Chiudi Trade Logger', click: () => app.quit() },
  ]).popup({ window: toolbar });
});
ipcMain.handle('toolbar:local', () => openJournal());

// gli screenshot di un trade eliminato vanno nel cestino (non si perdono per sempre)
function trashShots(t) {
  try { const rd = store.replayDir(t.id); if (fs.existsSync(rd)) shell.trashItem(rd).catch(() => {}); } catch { /* niente */ }
  for (const rel of [t.shotOpen, t.shotClose, ...((t.images || []).map((i) => i.file))]) {
    const f = store.shotAbs(rel);
    if (f && fs.existsSync(f)) shell.trashItem(f).catch(() => {});
  }
}
// elimina un trade aperto per sbaglio (prove), anche dal journal online
async function deleteOpenTrade(t) {
  const when = t.tradeDate ? `${t.tradeDate.split('-').reverse().join('/')} ${t.tradeTime || ''}` : '';
  const r = await dialog.showMessageBox({ type: 'warning', buttons: ['Elimina', 'Annulla'], defaultId: 1, cancelId: 1,
    message: `Eliminare il trade ${t.symbol || ''} ${t.direction || ''} ${when}?`, detail: t.remoteId ? 'Viene tolto anche dal journal online, insieme ai suoi screenshot.' : 'Non era ancora stato inviato al journal online.' });
  if (r.response !== 0) return;
  if (t.remoteId) {
    try {
      const s = getSb(), user = await linkedUser();
      if (s && user) {
        const folder = `${user.id}/${t.remoteId}`;
        const { data: files } = await s.storage.from('trade-images').list(folder);
        if (files && files.length) await s.storage.from('trade-images').remove(files.map((f) => `${folder}/${f.name}`));
        const { error } = await s.from('trades').delete().eq('id', t.remoteId);
        if (error) throw error;
      }
    } catch (e) {
      dialog.showMessageBox({ type: 'error', message: 'Non riesco a toglierlo dal journal online', detail: `${String(e.message || e)}\nLo elimino solo dalla barra: nel sito puoi cancellarlo dalla finestra del giorno.` });
    }
  }
  const gone = store.deleteTrade(t.id);
  if (gone) trashShots(gone);
  tradesChanged();
  status('Trade eliminato');
}
ipcMain.handle('toolbar:open-trades', (_e, at) => {
  const opens = getTrades().filter((t) => t.status === 'aperto').reverse();
  if (!opens.length) return;
  const items = opens.map((t) => {
    const when = t.tradeDate ? `${t.tradeDate.split('-').reverse().join('/')} ${t.tradeTime || ''}` : '';
    return { label: `${t.symbol || '—'} ${t.direction === 'SHORT' ? '▼' : '▲'} ${t.direction || ''}   ${when}`.trim(), submenu: [
      { label: 'Chiudi a take profit', click: () => guarded(() => closeTrade('TP', t.id)) },
      { label: 'Chiudi a stop loss', click: () => guarded(() => closeTrade('SL', t.id)) },
      { label: 'Chiudi a mano', click: () => guarded(() => closeTrade('MANUALE', t.id)) },
      { type: 'separator' },
      { label: 'Elimina (era una prova o un errore)…', click: () => deleteOpenTrade(t) },
    ] };
  });
  Menu.buildFromTemplate([{ label: opens.length === 1 ? 'Trade aperto' : `${opens.length} trade aperti (il primo è il più recente)`, enabled: false }, ...items])
    .popup({ window: toolbar, x: Math.round(at.x), y: Math.round(at.y) });
});
ipcMain.handle('app:quit', () => app.quit());

ipcMain.handle('confirm:get', () => pending);
ipcMain.handle('confirm:cancel', () => { pending = null; if (alive(confirmWin)) confirmWin.close(); });
function applyConfirm(d) {
  const num = (x) => parseNumber(x);
  if (d.mode === 'open') {
    const t = {
      id: Date.now().toString(36),
      status: 'aperto',
      symbol: (d.symbol || '').trim().toUpperCase(),
      direction: d.direction,
      entry: num(d.entry), sl: num(d.sl), tp: num(d.tp),
      contracts: num(d.contracts),
      slUsd: num(d.slUsd), tpUsd: num(d.tpUsd),
      balanceBefore: num(d.balanceBefore),
      openedAt: new Date().toISOString(),
      tradeDate: /^\d{4}-\d{2}-\d{2}$/.test(d.tradeDate || '') ? d.tradeDate : new Date().toISOString().slice(0, 10),
      tradeTime: d.tradeTime || '',
      setup: (d.setup || '').trim(),
      shotOpen: pending && store.shotRel(pending.shot),
      note: d.note || '',
      tags: [...getDraft().tags],
      rev: 1,
      accountId: (activeAccount() || {}).id || null,
      source: 'trade-logger', createdAt: new Date().toISOString(),
    };
    if (t.entry != null && t.sl != null && t.tp != null && t.entry !== t.sl) {
      t.rrPlanned = round2(Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl));
    }
    store.addTrade(t);
    const c = getConfig(); c.lastSymbol = t.symbol; if (t.symbol) c.knownSymbols = [...new Set([...(c.knownSymbols || []), t.symbol])].slice(-60); c.draft = { setup: t.setup, tags: [], note: '' };
    if (activeKind() === 'backtest' && c.link && c.link.accountId) c.btDate = { ...(c.btDate || {}), [c.link.accountId]: t.tradeDate };
    if (t.setup) { c.setups = [...new Set([...(c.setups || []), t.setup])]; store.updateSettings((st) => { st.setups = [...new Set([...(st.setups || []), t.setup])]; }); if (!lists.setups.includes(t.setup)) lists.setups.push(t.setup); setTimeout(pushSetups, 500); }
    saveConfig(c);
  } else {
    let changedSetup = null;
    store.patchTrade(d.tradeId, (t) => {          // calcolato sulla copia più recente: se nel frattempo il Journal l'ha modificato non si perde nulla
      const u = { status: 'chiuso', outcome: d.outcome, balanceAfter: num(d.balanceAfter), pnl: num(d.pnl), closedAt: new Date().toISOString() };
      if (typeof d.setup === 'string' && d.setup !== (t.setup || '')) { u.setup = d.setup.trim(); changedSetup = u.setup; }
      u.shotClose = pending && store.shotRel(pending.shot);
      if (Array.isArray(d.tags)) u.tags = [...new Set(d.tags.map((g) => String(g).trim()).filter(Boolean))].slice(0, 30);
      if (d.note) u.note = t.note ? `${t.note}\n${d.note}` : d.note;
      u.rResult = d.outcome === 'TP' && t.rrPlanned != null ? t.rrPlanned : d.outcome === 'SL' ? -1 : null;
      return u;
    }, { bump: true });
    if (changedSetup) {
      const c = getConfig(); c.setups = [...new Set([...(c.setups || []), changedSetup])]; saveConfig(c);
      store.updateSettings((st) => { st.setups = [...new Set([...(st.setups || []), changedSetup])]; });
      if (!lists.setups.includes(changedSetup)) lists.setups.push(changedSetup);
      setTimeout(pushSetups, 500);
    }
  }
  tradesChanged();
  pending = null;
  if (alive(confirmWin)) confirmWin.close();
  syncAll();
  return true;
}
ipcMain.handle('confirm:save', (_e, d) => applyConfirm(d));

ipcMain.handle('calib:get', () => { if (!calib) return null; layoutNow = calib.layout || 'normal'; const c = getConfig(); return { image: calib.img.toDataURL(), current: c, platform: ((c.platforms[c.activePlatform] || {}).name || '') + (layoutNow === 'full' ? ' (schermo intero)' : '') }; });
ipcMain.handle('calib:save', async (_e, rects) => {
  stashBeforeCalib(calib.img.getSize());
  layoutNow = calib.layout || 'normal';
  const c = getConfig();
  c.priceRect = rects.priceRect;
  c.balanceRect = rects.balanceRect;
  if (rects.clockRect) c.clockRect = rects.clockRect; else delete c.clockRect;
  if (rects.axisRect) c.axisRect = rects.axisRect; else delete c.axisRect;
  if (rects.symbolRect) c.symbolRect = rects.symbolRect; else delete c.symbolRect;
  if (rects.shotRect) c.shotRect = rects.shotRect; else delete c.shotRect;
  // colori cliccati sulle etichette; se un colore non è stato insegnato resta quello standard
  const hues = {};
  for (const k of ['TP', 'SL', 'ENTRY']) if (rects.hues && Number.isFinite(rects.hues[k])) hues[k] = { h: rects.hues[k], tol: 16 };
  if (Object.keys(hues).length) c.hues = hues; else delete c.hues;
  c.displayId = calib.displayId;
  c.calibSize = calib.img.getSize();
  c.readLog = [];
  saveConfig(c);
  const res = await analyze(calib.img, c);  // prova subito la lettura sullo stesso screenshot
  const rp = await readReplay(calib.img, c);
  return { ...res, replayTime: rp.time, replayDate: rp.date, hasClock: !!c.clockRect, hasAxis: !!c.axisRect, hasSymbol: !!c.symbolRect, hasShot: !!c.shotRect };
});
// calibrazione automatica: trova da sola colonna dei prezzi, saldo, orologio e riga della data (vedi autocal.js)
ipcMain.handle('calib:auto', async () => {
  if (!calib) return null;
  try {
    const img = calib.img, c = getConfig(), size = img.getSize();
    const col = autocal.findPriceColumn(img, c.hues);
    const w = await getWorker();
    await w.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    const { data } = await w.recognize(img.toPNG());
    const words = (data.words || []).map((x) => ({ t: x.text, x0: x.bbox.x0, y0: x.bbox.y0, x1: x.bbox.x1, y1: x.bbox.y1 }));
    const r = autocal.buildRects(size, col, words);
    const hues = {}; if (c.hues) for (const k of ['TP', 'SL', 'ENTRY']) if (c.hues[k]) hues[k] = c.hues[k].h;   // i colori già insegnati restano
    return { ...r, hues, size, multiple: !!(col && col.multiple) };
  } catch (e) { return { rects: {}, found: {}, notes: ['Non sono riuscito a leggere lo schermo: ' + (e.message || e)], hues: {}, size: calib.img.getSize() }; }
});
ipcMain.handle('calib:close', () => { if (alive(calibWin)) calibWin.close(); calib = null; });

ipcMain.handle('link:get', async () => {
  const l = getConfig().link || {};
  let user = null, accounts = null, error = null;
  try { user = await linkedUser(); if (user) accounts = await listAccounts(); } catch (e) { error = String(e.message || e); }
  return { link: { url: l.url || '', key: l.key || '', siteUrl: l.siteUrl || '', accountId: (activeAccount() || {}).remoteId || '' }, email: user ? user.email : null, accounts, error, localAccount: (activeAccount() || {}).name || '' };
});
ipcMain.handle('link:login', async (_e, d) => {
  const c = getConfig();
  c.link = { ...(c.link || {}), url: (d.url || '').replace(/[\s'"`]/g, '').replace(/\/+$/, ''), key: (d.key || '').replace(/[\s'"`]/g, ''), siteUrl: (d.siteUrl || '').trim() };
  saveConfig(c);
  const s = getSb();
  if (!s) throw new Error('Inserisci indirizzo e chiave di Supabase.');
  const { error } = await s.auth.signInWithPassword({ email: d.email.trim(), password: d.password });
  if (error) throw new Error(/Invalid login/i.test(error.message) ? 'Email o password non corretti.' : error.message);
  const c3 = getConfig(); c3.link = { ...(c3.link || {}), email: d.email.trim() }; saveConfig(c3);
  refreshToolbar();
  return listAccounts();
});
ipcMain.handle('link:save', async (_e, d) => {
  // il conto attivo resta quello locale: qui si sceglie a quale conto ONLINE corrisponde (se non lo scegli ne viene creato uno)
  const c = getConfig();
  c.link = { ...(c.link || {}), siteUrl: (d.siteUrl || '').trim() };
  saveConfig(c);
  const act = activeAccount();
  if (act && d.accountId) store.patchAccount(act.id, { remoteId: d.accountId });
  refreshToolbar();
  syncAll();
  pushSetups().then(refreshLists);
  return true;
});
ipcMain.handle('link:logout', async () => {
  const s = getSb(); if (s) await s.auth.signOut();
  const c = getConfig(); if (c.link) delete c.link.email; saveConfig(c);
  refreshToolbar();
  return true;
});
ipcMain.handle('link:sync', () => syncAll());

ipcMain.handle('journal:list', () => getTrades());
ipcMain.handle('journal:delete', async (_e, id) => {
  const r = await dialog.showMessageBox(journalWin, { type: 'warning', buttons: ['Elimina', 'Annulla'], defaultId: 1, message: 'Eliminare questo trade?' });
  if (r.response !== 0) return false;
  const gone = store.deleteTrade(id);
  if (gone) trashShots(gone);
  tradesChanged();
  return true;
});
ipcMain.handle('journal:export', async () => {
  const r = await dialog.showSaveDialog(journalWin, { defaultPath: 'journal.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return false;
  const cols = ['openedAt', 'closedAt', 'symbol', 'direction', 'entry', 'sl', 'tp', 'contracts', 'rrPlanned', 'outcome', 'pnl', 'rResult', 'balanceBefore', 'balanceAfter', 'status', 'note'];
  const head = ['Apertura', 'Chiusura', 'Simbolo', 'Direzione', 'Ingresso', 'Stop loss', 'Take profit', 'Contratti', 'RR pianificato', 'Esito', 'P&L', 'R', 'Saldo prima', 'Saldo dopo', 'Stato', 'Note'];
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(';'), ...getTrades().map((t) => cols.map((k) => cell(t[k])).join(';'))];
  fs.writeFileSync(r.filePath, '\uFEFF' + lines.join('\r\n'));
  return true;
});
ipcMain.handle('journal:folder', () => shell.openPath(store.dataDir()));

// ---------- cartella degli screenshot ----------
const shotsInfo = () => { const d = store.shotsDir(); return { dir: d, isDefault: path.resolve(d) === path.resolve(path.join(store.dataDir(), 'screenshot')), dataDir: store.dataDir() }; };
ipcMain.handle('shots:get', () => shotsInfo());
ipcMain.handle('shots:open', () => { const { dir } = store.ensureShotsDir(); return shell.openPath(dir); });
ipcMain.handle('shots:choose', async () => {
  const parent = alive(settingsWin) ? settingsWin : undefined;
  const r = await dialog.showOpenDialog(parent, { title: 'Scegli la cartella degli screenshot', defaultPath: store.shotsDir(), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const ch = await dialog.showMessageBox(parent, { type: 'question', buttons: ['Sposta gli screenshot', 'Lascia dove sono', 'Annulla'], defaultId: 0, cancelId: 2,
    message: 'Cambiare la cartella degli screenshot?', detail: `Nuova cartella:\n${r.filePaths[0]}\n\n"Sposta" porta nella nuova cartella gli screenshot già salvati. "Lascia dove sono" li tiene dov'erano (i trade ne ricordano il percorso); da ora i nuovi vanno nella cartella nuova.` });
  if (ch.response === 2) return null;
  const res = store.setShotsDir(r.filePaths[0], { move: ch.response === 0 });
  tradesChanged();
  return { ...res, ...shotsInfo() };
});
ipcMain.handle('file:open', async (_e, p) => {
  const f = p && store.shotAbs(p);                    // gli screenshot sono salvati con percorso relativo alla cartella screenshot
  if (!f || !fs.existsSync(f)) return 'File non trovato';
  return shell.openPath(f);
});


// ---------- Replay del trade (beta) ----------
// Finché un trade è aperto, ogni pochi secondi salvo un fotogramma ridotto del grafico (la stessa area degli screenshot).
// Nel Journal il tasto "Replay" li fa scorrere dall'apertura alla chiusura. Si attiva dal menu della barra o dalle Impostazioni.
const REPLAY_MAX = 900;                       // massimo di fotogrammi per trade (circa 30 minuti a 2 secondi)
let rec = null;                               // { id, dir, n, last, timer, busy }
const replayOn = () => !!getConfig().replayRec;
const replayEvery = () => Math.min(10, Math.max(1, Number(getConfig().replayEvery) || 2));
function stopRec() {
  if (!rec) return;
  clearInterval(rec.timer); rec = null;
  try { if (alive(toolbar)) toolbar.setContentProtection(false); } catch { /* non supportato */ }
  refreshToolbar();
}
async function recTick() {
  const r = rec;
  if (!r || r.busy || captureBusy || !alive(toolbar)) return;
  r.busy = true;
  try {
    const cur = getTrades().find((x) => x.id === r.id);
    if (!cur || cur.status !== 'aperto') { stopRec(); replaySync(); return; }     // chiuso o eliminato (anche dal Journal)
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') return;
    const display = screen.getDisplayMatching(toolbar.getBounds());
    const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    if (!src || rec !== r) return;
    let img = forJournal(src.thumbnail, getConfig());
    if (img.getSize().width > 1000) img = img.resize({ width: 1000, quality: 'good' });
    const buf = img.toJPEG(60);
    const sig = require('crypto').createHash('md5').update(buf).digest('hex');
    if (sig === r.last) return;                       // grafico fermo (pausa): non serve un fotogramma uguale
    r.last = sig;
    if (r.n >= REPLAY_MAX) { status('Replay: raggiunto il massimo di fotogrammi per questo trade'); stopRec(); return; }
    r.n += 1;
    await fs.promises.writeFile(path.join(r.dir, String(r.n).padStart(5, '0') + '.jpg'), buf);
  } catch (e) {
    try { fs.appendFileSync(path.join(store.dataDir() || __dirname, 'errori.log'), `${new Date().toISOString()} (replay) ${e && e.stack || e}\n`); } catch { /* niente */ }
  } finally { r.busy = false; }
}
// da richiamare quando cambia qualcosa (trade aperto/chiuso, interruttore): avvia, ferma o lascia com'è
function replaySync() {
  try {
    const open = replayOn() ? getTrades().filter((t) => t.status === 'aperto').pop() : null;
    if (!open) return stopRec();
    if (rec && rec.id === open.id) return;
    stopRec();
    const dir = store.replayDir(open.id);
    store.mkdirp(dir);
    rec = { id: open.id, dir, n: store.replayFiles(open.id).length, last: '', timer: null, busy: false };
    rec.timer = setInterval(recTick, replayEvery() * 1000);
    try { toolbar.setContentProtection(true); } catch { /* la barra potrebbe comparire nei fotogrammi */ }
    refreshToolbar();
  } catch (e) { status('Replay non disponibile: ' + (e && e.message || e)); stopRec(); }
}
function setReplay(on, every) {
  const c = getConfig(); c.replayRec = !!on; if (every != null) c.replayEvery = Math.min(10, Math.max(1, Number(every) || 2)); saveConfig(c);
  stopRec(); replaySync();
  return { on: replayOn(), every: replayEvery() };
}
ipcMain.handle('settings:replay', (_e, on, every) => setReplay(on, every));

// ---------- avvio ----------
// un errore inatteso non deve bloccare il programma con una finestra di errore: lo scrivo in errori.log e lo segnalo sulla barra
process.on('uncaughtException', (e) => {
  try { fs.appendFileSync(path.join(store.dataDir() || __dirname, 'errori.log'), `${new Date().toISOString()} ${e && e.stack || e}\n`); } catch { /* niente */ }
  try { status('Errore interno (vedi errori.log)'); } catch { /* niente */ }
});
process.on('unhandledRejection', (e) => { try { fs.appendFileSync(path.join(store.dataDir() || __dirname, 'errori.log'), `${new Date().toISOString()} (promessa) ${e && e.stack || e}\n`); } catch { /* niente */ } });
// una sola barra: se il programma è già aperto, il secondo avvio mostra quella esistente
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (alive(toolbar)) { toolbar.show(); toolbar.focus(); } });

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();               // la barra vive come utility, senza icona nel Dock
  DATA = store.init(path.join(app.getPath('documents'), 'TradeLogger'));
  CONFIG_FILE = store.file('config');
  store.ensureAccounts({ link: getConfig().link });            // primo avvio / dati di versioni vecchie: conti locali e trade assegnati
  ensureActiveAccount();
  updater = updaterLib.create({ app, dialog, dataDir: () => store.dataDir(), name: 'Trade Logger' });
  setTimeout(() => updater.check({ silent: true }), 20000);   // controllo in silenzio, solo se hai indicato dove cercare
  { const c0 = getConfig(); if (c0.tourPrevMode !== undefined) { c0.barMode = c0.tourPrevMode; delete c0.tourPrevMode; saveConfig(c0); } }   // chiuso a metà tutorial: la barra torna com'era
  createToolbar();
  setTimeout(() => {              // primo avvio: configurazione guidata e poi il giro; chi ha già una piattaforma calibrata va diretto al giro
    const c = getConfig();
    if (!c.wizardDone && !platformList().platforms.some((p) => p.calibrated)) { c.lastSeenVersion = app.getVersion(); saveConfig(c); openWizard(); }   // installazione nuova: niente novità
    else {
      if (!c.wizardDone) { c.wizardDone = true; saveConfig(c); }
      if (!c.tourDone) startTour();
      else if (c.lastSeenVersion !== app.getVersion()) openNovita();   // dopo un aggiornamento: cosa è cambiato
    }
  }, 2500);
  getWorker().catch((e) => console.error('OCR non pronto:', e)); // prepara l'OCR in anticipo
  setTimeout(replaySync, 1500);              // trade rimasto aperto con il replay attivo: riprende a registrare
  setTimeout(syncAll, 3000);                 // invia eventuali trade rimasti indietro
  setTimeout(() => pushSetups().then(refreshLists), 4000);          // consegna al database i setup creati finora solo sul PC
  applyLocalApi();
  setTimeout(() => fetchNews(false), 15000);                 // notizie economiche: all'avvio e poi ogni 3 ore
  setInterval(() => fetchNews(false), 3 * 3600e3);
  registerShortcuts();
  setInterval(syncAll, 2 * 60 * 1000);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { localApi.stop(); globalShortcut.unregisterAll(); if (worker) worker.terminate(); });
