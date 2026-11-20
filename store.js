'use strict';
// Archivio dati condiviso da Trade Logger e dal Journal. I due programmi sono indipendenti: si parlano solo
// attraverso questi file, in una cartella (Documenti\TradeLogger). Ogni scrittura è atomica (file temporaneo +
// rinomina) e protetta da un blocco, così se entrambi salvano nello stesso istante non si perde nulla.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DATA = '';
const NAMES = { trades: 'trades.json', accounts: 'accounts.json', settings: 'settings.json', days: 'days.json', news: 'news.json', newsmeta: 'newsmeta.json', paths: 'paths.json', config: 'config.json' };

const file = (n) => path.join(DATA, NAMES[n] || n);
const dataDir = () => DATA;
const newId = (p = '') => p + crypto.randomBytes(6).toString('hex');
const nowIso = () => new Date().toISOString();

// crea una cartella un livello per volta (la creazione ricorsiva di Node può andare in ciclo su percorsi impossibili)
function mkdirp(dir) {
  const missing = [];
  let d = path.resolve(dir);
  while (!fs.existsSync(d)) { missing.unshift(d); const up = path.dirname(d); if (up === d) throw new Error('Percorso non disponibile: ' + dir); d = up; }
  for (const m of missing) fs.mkdirSync(m);
}
function init(dir) {
  DATA = dir;
  mkdirp(DATA);
  try { mkdirp(shotsDir()); } catch { /* disco scollegato o percorso non valido: si userà la cartella predefinita (vedi ensureShotsDir) */ }
  return DATA;
}

// ---------- basi: lettura, scrittura atomica, blocco ----------
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function readJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } }
function writeAtomic(f, data) {
  const tmp = `${f}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  for (let i = 0; i < 8; i++) {
    try { fs.renameSync(tmp, f); return; }
    catch (e) { if (i === 7) { try { fs.unlinkSync(tmp); } catch { /* niente */ } throw e; } sleep(15 + i * 10); }   // su Windows un lettore può tenere il file per un attimo
  }
}
function withLock(fn) {
  const lock = path.join(DATA, '.lock'), t0 = Date.now();
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
      if (age > 10000 || Date.now() - t0 > 6000) { try { fs.rmdirSync(lock); } catch { /* niente */ } continue; }   // blocco rimasto da un programma chiuso male
      sleep(6);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch { /* niente */ } }
}
const update = (name, def, fn) => withLock(() => { const d = readJSON(file(name), def); const r = fn(d); writeAtomic(file(name), d); return r; });

// ---------- trade ----------
const readTrades = () => readJSON(file('trades'), []);
const addTrade = (t) => update('trades', [], (a) => { a.push(t); return t; });
const updateTrades = (fn) => update('trades', [], fn);
// patch: oggetto, oppure funzione (trade) => oggetto calcolata sulla copia più recente
function patchTrade(id, patch, { bump = false } = {}) {
  return update('trades', [], (a) => {
    const x = a.find((t) => t.id === id);
    if (!x) return null;
    Object.assign(x, typeof patch === 'function' ? patch(x) : patch);
    if (bump) { x.rev = (x.rev || 0) + 1; x.updatedAt = nowIso(); }
    return x;
  });
}
const deleteTrade = (id) => update('trades', [], (a) => { const i = a.findIndex((t) => t.id === id); return i < 0 ? null : a.splice(i, 1)[0]; });

// ---------- conti ----------
const readAccounts = () => readJSON(file('accounts'), []);
const updateAccounts = (fn) => update('accounts', [], fn);
function addAccount({ name, kind = 'conto', id, remoteId, note = '' }) {
  return updateAccounts((a) => { const x = { id: id || newId('a'), name, kind: kind === 'backtest' ? 'backtest' : 'conto', note, created_at: nowIso(), ...(remoteId ? { remoteId } : {}) }; a.push(x); return x; });
}
function patchAccount(id, patch) { return updateAccounts((a) => { const x = a.find((y) => y.id === id); if (x) Object.assign(x, patch); return x || null; }); }
// elimina il conto con trade, analisi dei giorni; restituisce i trade tolti (per cancellare gli screenshot)
function deleteAccount(id) {
  return withLock(() => {
    const accts = readJSON(file('accounts'), []).filter((a) => a.id !== id);
    const trades = readTrades();
    const gone = trades.filter((t) => t.accountId === id);
    writeAtomic(file('accounts'), accts);
    writeAtomic(file('trades'), trades.filter((t) => t.accountId !== id));
    const days = readJSON(file('days'), {});
    for (const k of Object.keys(days)) if (k.startsWith(id + '|')) delete days[k];
    writeAtomic(file('days'), days);
    return gone;
  });
}
// primo avvio (o aggiornamento da una versione vecchia): servono almeno un conto e ogni trade deve averne uno
function ensureAccounts({ link } = {}) {
  return withLock(() => {
    let accts = readJSON(file('accounts'), []);
    const trades = readTrades();
    if (!accts.length) {
      if (link && link.accountId) accts.push({ id: link.accountId, name: link.accountName || 'Personale', kind: link.accountKind === 'backtest' ? 'backtest' : 'conto', note: '', created_at: nowIso(), remoteId: link.accountId });
      else accts.push({ id: newId('a'), name: 'Personale', kind: 'conto', note: '', created_at: nowIso() });
    }
    let changed = !fs.existsSync(file('accounts')) || !readJSON(file('accounts'), []).length, n = accts.length;
    // trade di conti online diversi da quello attivo: il conto esiste in locale con lo stesso identificativo
    for (const t of trades) {
      if (!t.accountId) continue;
      if (!accts.some((a) => a.id === t.accountId)) { accts.push({ id: t.accountId, name: `Conto ${++n}`, kind: 'conto', note: '', created_at: nowIso(), remoteId: t.accountId }); changed = true; }
    }
    // se il Journal è partito per primo, il conto ereditato ha un nome generico: la barra conosce quello vero
    if (link && link.accountId && link.accountName) {
      const g = accts.find((x) => x.id === link.accountId);
      if (g && /^Conto \d+$/.test(g.name)) { g.name = link.accountName; if (link.accountKind === 'backtest') g.kind = 'backtest'; changed = true; }
    }
    let tch = false;
    for (const t of trades) if (!t.accountId) { t.accountId = accts[0].id; tch = true; }
    if (changed) writeAtomic(file('accounts'), accts);
    if (tch) writeAtomic(file('trades'), trades);
    return accts;
  });
}

// ---------- impostazioni, analisi dei giorni, notizie ----------
const readSettings = () => readJSON(file('settings'), {});
const updateSettings = (fn) => update('settings', {}, fn);
const readDays = () => readJSON(file('days'), {});
const dayKey = (accountId, day) => `${accountId}|${day}`;
function setDay(accountId, day, notes) { return update('days', {}, (d) => { if (notes) d[dayKey(accountId, day)] = notes; else delete d[dayKey(accountId, day)]; }); }
const listDays = (accountId) => Object.entries(readDays()).filter(([k]) => k.startsWith(accountId + '|')).map(([k, notes]) => ({ day: k.slice(accountId.length + 1), notes }));
const readNews = () => readJSON(file('news'), []);
function mergeNews(events) {
  return update('news', [], (a) => {
    const m = new Map(a.map((e) => [e.event_key, e]));
    for (const e of events) m.set(e.event_key, e);
    a.length = 0; a.push(...m.values());
    return m.size;
  });
}
const readNewsMeta = () => readJSON(file('newsmeta'), {});
const updateNewsMeta = (fn) => update('newsmeta', {}, fn);
const listNews = (fromIso, toIso) => readNews().filter((e) => e.event_time >= fromIso && e.event_time < toIso).sort((x, y) => x.event_time.localeCompare(y.event_time));

// ---------- cartella degli screenshot (impostabile) ----------
function shotsDir() {
  const p = readJSON(file('paths'), {}).screenshotsDir;
  return p && String(p).trim() ? String(p).trim() : path.join(DATA, 'screenshot');
}
// nei trade il file è salvato come nome semplice (relativo alla cartella): così i dati si possono spostare di PC
// cartella utilizzabile per salvare un nuovo screenshot: quella scelta, oppure (se non è disponibile) quella predefinita
function ensureShotsDir() {
  const want = shotsDir();
  try { mkdirp(want); fs.accessSync(want, fs.constants.W_OK); return { dir: want, fallback: false }; }
  catch {
    const def = path.join(DATA, 'screenshot');
    mkdirp(def);
    return { dir: def, fallback: true, wanted: want };
  }
}
const shotAbs = (name) => (!name ? null : path.isAbsolute(name) ? name : path.join(shotsDir(), name));
function shotRel(abs) {
  if (!abs) return abs;
  const rel = path.relative(shotsDir(), abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep) ? rel : abs;
}
function uniqueName(dir, base) {
  let n = base, i = 1; const ext = path.extname(base), stem = path.basename(base, ext);
  while (fs.existsSync(path.join(dir, n))) n = `${stem}_${i++}${ext}`;
  return n;
}
function moveFile(src, destDir) {
  const name = uniqueName(destDir, path.basename(src)), dest = path.join(destDir, name);
  try { fs.renameSync(src, dest); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(src, dest); fs.unlinkSync(src); }   // altro disco: copio e poi tolgo
  return name;
}
// Cambia la cartella. move=true: sposta gli screenshot già salvati; false: restano dove sono (i trade ne ricordano il percorso).
function setShotsDir(newDir, { move = true } = {}) {
  if (!String(newDir || '').trim()) throw new Error('Cartella non valida.');
  newDir = path.resolve(String(newDir));
  try { mkdirp(newDir); } catch { throw new Error('Non riesco a creare questa cartella: il disco è collegato?'); }
  const probe = path.join(newDir, `.prova-${process.pid}`);
  try { fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe); } catch { throw new Error('Non riesco a scrivere in questa cartella: sceglierne un\'altra.'); }
  const oldDir = path.resolve(shotsDir());
  if (oldDir === newDir) return { dir: newDir, moved: 0, kept: 0, failed: 0 };
  let moved = 0, kept = 0, failed = 0;
  withLock(() => {
    const trades = readTrades();
    const handle = (name) => {
      if (!name) return name;
      const src = shotAbs(name);                                   // con la cartella ancora quella vecchia
      if (!src || !fs.existsSync(src)) return name;                // file mancante: lascio com'è
      if (!move || path.dirname(path.resolve(src)) !== oldDir) { kept++; return path.isAbsolute(name) ? name : src; }   // non lo sposto: ne ricordo il percorso
      try { const n = moveFile(src, newDir); moved++; return n; } catch { failed++; return name; }
    };
    for (const t of trades) {
      if (t.shotOpen) t.shotOpen = handle(t.shotOpen);
      if (t.shotClose) t.shotClose = handle(t.shotClose);
      for (const im of t.images || []) if (im.file) im.file = handle(im.file);
    }
    writeAtomic(file('trades'), trades);
    const p = readJSON(file('paths'), {}); p.screenshotsDir = newDir; writeAtomic(file('paths'), p);
  });
  return { dir: newDir, moved, kept, failed };
}
// torna alla cartella predefinita (dentro i dati)
function resetShotsDir(opts) { return setShotsDir(path.join(DATA, 'screenshot'), opts); }

// ---------- novità: avvisa quando i file cambiano (per aggiornare la finestra) ----------
function watch(cb) {
  let timer = null;
  const w = fs.watch(DATA, { persistent: false }, (_ev, name) => {
    if (!name || !/^(trades|accounts|settings|days|news|paths)\.json$/.test(name)) return;
    clearTimeout(timer); timer = setTimeout(() => cb(name), 350);
  });
  return () => { clearTimeout(timer); w.close(); };
}

// ---------- replay (beta): fotogrammi del grafico registrati mentre un trade è aperto ----------
const replayRoot = () => path.join(DATA, 'replay');
const replayDir = (id) => path.join(replayRoot(), String(id).replace(/[^\w-]/g, '_'));
function replayFiles(id) {
  try { return fs.readdirSync(replayDir(id)).filter((f) => /^\d{5}\.jpg$/.test(f)).sort().map((f) => path.join(replayDir(id), f)); } catch { return []; }
}

module.exports = {
  replayRoot, replayDir, replayFiles,
  init, dataDir, file, newId, nowIso, readJSON, writeAtomic, withLock,
  readTrades, addTrade, updateTrades, patchTrade, deleteTrade,
  readAccounts, updateAccounts, addAccount, patchAccount, deleteAccount, ensureAccounts,
  readSettings, updateSettings, readDays, setDay, listDays, readNews, mergeNews, listNews, readNewsMeta, updateNewsMeta,
  shotsDir, ensureShotsDir, shotAbs, shotRel, setShotsDir, resetShotsDir, mkdirp, watch,
};
