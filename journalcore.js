'use strict';
// Motore dati del Journal (programma locale). Non dipende da Electron: lo usa journal-main.js e lo si può provare da solo.
// L'interfaccia (la stessa del journal online) chiama questi metodi come se fossero il database.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const zlib = require('zlib');

const LIST_KEYS = ['setups', 'customTags', 'hiddenTags', 'newsCur', 'newsImp'];   // liste: si uniscono le modifiche invece di sovrascrivere
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (v === '' || v == null ? null : (isFinite(Number(v)) ? Number(v) : null)));

function createCore(deps) {
  const { store } = deps;
  const dialogs = deps.dialogs || {};
  const trash = deps.trash || (async (f) => { try { fs.unlinkSync(f); } catch { /* già tolto */ } });
  const log = deps.log || (() => {});

  // ----- trade: formato condiviso (quello di Trade Logger) <-> righe dell'interfaccia -----
  function imagesOf(rec) {
    const out = [];
    const open = store.shotAbs(rec.shotOpen), close = store.shotAbs(rec.shotClose);
    if (open) out.push({ id: `${rec.id}:open`, trade_id: rec.id, path: open, timeframe: 'Apertura', created_at: rec.openedAt || rec.createdAt || '' });
    if (close) out.push({ id: `${rec.id}:close`, trade_id: rec.id, path: close, timeframe: 'Chiusura', created_at: rec.closedAt || rec.updatedAt || '' });
    for (const im of rec.images || []) out.push({ id: im.id, trade_id: rec.id, path: store.shotAbs(im.file), timeframe: im.timeframe || '', created_at: im.created_at || '' });
    return out.filter((i) => i.path);
  }
  function toRow(rec) {
    return {
      id: rec.id, account_id: rec.accountId,
      trade_date: rec.tradeDate || (rec.openedAt ? String(rec.openedAt).slice(0, 10) : ''), trade_time: rec.tradeTime || '',
      symbol: rec.symbol || '', direction: rec.direction || '', pnl: rec.pnl == null ? 0 : rec.pnl, setup: rec.setup || '',
      entry: rec.entry ?? null, sl: rec.sl ?? null, tp: rec.tp ?? null, contracts: rec.contracts ?? null,
      sl_usd: rec.slUsd ?? null, tp_usd: rec.tpUsd ?? null, outcome: rec.outcome || '', status: rec.status || 'chiuso',
      tags: rec.tags || [], emotions: rec.emotions || [], notes: rec.note || '', starred: !!rec.starred,
      source: rec.source || (rec.shotOpen || rec.openedAt ? 'trade-logger' : 'manuale'),
      created_at: rec.createdAt || rec.openedAt || '', updated_at: `${rec.updatedAt || rec.closedAt || rec.openedAt || rec.createdAt || ''}#${rec.rev || 0}`,
      trade_images: imagesOf(rec),
    };
  }
  const FIELD = { trade_date: 'tradeDate', trade_time: 'tradeTime', notes: 'note', sl_usd: 'slUsd', tp_usd: 'tpUsd', account_id: 'accountId', created_at: 'createdAt' };
  const SAME = ['symbol', 'direction', 'pnl', 'setup', 'entry', 'sl', 'tp', 'contracts', 'outcome', 'status', 'tags', 'emotions', 'starred', 'source'];
  function patchFromRow(row) {
    const p = {};
    for (const [k, v] of Object.entries(row)) {
      if (FIELD[k]) p[FIELD[k]] = v;
      else if (SAME.includes(k)) p[k] = v;
    }
    return p;
  }
  function recFromRow(row, accountId) {
    const now = store.nowIso();
    const rec = { id: row.id || store.newId('j'), accountId: row.account_id || accountId, rev: 1, createdAt: now, updatedAt: now, ...patchFromRow(row) };
    rec.accountId = rec.accountId || accountId;
    rec.status = rec.status || 'chiuso'; rec.tags = rec.tags || []; rec.emotions = rec.emotions || [];
    rec.source = rec.source || 'manuale';
    return rec;
  }

  const A = {};   // metodi

  // ----- conti -----
  A.listAccounts = () => store.ensureAccounts({}).map((a) => ({ id: a.id, name: a.name, kind: a.kind, note: a.note || '', created_at: a.created_at, shared: !!a.shared }));
  A.createAccount = ({ name, kind }) => { const a = store.addAccount({ name, kind }); return { id: a.id, name: a.name, kind: a.kind, note: '', created_at: a.created_at }; };
  A.updateAccount = ({ id, patch }) => { const p = {}; for (const k of ['name', 'kind', 'note']) if (patch[k] !== undefined) p[k] = patch[k]; store.patchAccount(id, p); return true; };
  A.deleteAccount = async ({ id }) => {
    const gone = store.deleteAccount(id);
    for (const t of gone) await trashShotsOf(t);
    return true;
  };

  // ----- trade -----
  A.listTrades = ({ accountId }) => store.readTrades().filter((t) => t.accountId === accountId).map(toRow)
    .sort((a, b) => (a.trade_date + a.trade_time + a.created_at).localeCompare(b.trade_date + b.trade_time + b.created_at));
  A.createTrade = ({ row, accountId }) => { const rec = recFromRow(row, accountId); store.addTrade(rec); return toRow(rec); };
  A.insertTrades = ({ rows, accountId }) => rows.map((r) => A.createTrade({ row: r, accountId }));
  A.updateTrade = ({ id, patch }) => { const x = store.patchTrade(id, patchFromRow(patch), { bump: true }); return !!x; };
  async function trashShotsOf(t) {
    for (const rel of [t.shotOpen, t.shotClose, ...(t.images || []).map((i) => i.file)]) { const f = store.shotAbs(rel); if (f && fs.existsSync(f)) await trash(f); }
  }
  A.deleteTrade = async ({ id }) => { const gone = store.deleteTrade(id); if (gone) await trashShotsOf(gone); return !!gone; };

  // ----- immagini -----
  A.uploadImage = ({ tradeId, bytes, mime, timeframe }) => {
    const ext = ((mime || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'png';
    const { dir } = store.ensureShotsDir();
    const name = `journal_${tradeId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`.replace(/[^\w.-]/g, '_');
    fs.writeFileSync(path.join(dir, name), Buffer.from(bytes));
    const img = { id: store.newId('i'), file: store.shotRel(path.join(dir, name)), timeframe: timeframe || '', created_at: store.nowIso() };
    const x = store.patchTrade(tradeId, (cur) => ({ images: [...(cur.images || []), img] }), { bump: true });
    if (!x) { try { fs.unlinkSync(path.join(dir, name)); } catch { /* niente */ } throw new Error('Trade non trovato'); }
    return { id: img.id, trade_id: tradeId, path: path.join(dir, name), timeframe: img.timeframe, created_at: img.created_at };
  };
  A.updateImage = ({ id, patch }) => {
    if (/:(open|close)$/.test(id)) return true;                    // gli screenshot della barra hanno l'etichetta fissa
    store.updateTrades((all) => { for (const t of all) for (const im of t.images || []) if (im.id === id && patch.timeframe !== undefined) { im.timeframe = patch.timeframe; t.rev = (t.rev || 0) + 1; } });
    return true;
  };
  A.deleteImage = async ({ id }) => {
    let file = null;
    store.updateTrades((all) => {
      for (const t of all) {
        if (id === `${t.id}:open` && t.shotOpen) { file = store.shotAbs(t.shotOpen); t.shotOpen = null; t.rev = (t.rev || 0) + 1; return; }
        if (id === `${t.id}:close` && t.shotClose) { file = store.shotAbs(t.shotClose); t.shotClose = null; t.rev = (t.rev || 0) + 1; return; }
        const i = (t.images || []).findIndex((im) => im.id === id);
        if (i >= 0) { file = store.shotAbs(t.images[i].file); t.images.splice(i, 1); t.rev = (t.rev || 0) + 1; return; }
      }
    });
    if (file && fs.existsSync(file)) await trash(file);
    return true;
  };
  A.imageUrls = ({ paths }) => { const m = {}; for (const p of paths) if (p && fs.existsSync(p)) m[p] = pathToFileURL(p).href; return m; };

  // ----- analisi dei giorni -----
  A.listDayNotes = ({ accountId }) => store.listDays(accountId);
  A.saveDayNote = ({ accountId, day, notes }) => { store.setDay(accountId, day, notes); return true; };
  A.deleteDayNote = ({ accountId, day }) => { store.setDay(accountId, day, ''); return true; };

  // ----- impostazioni (tag, setup, tema…) -----
  A.getSettings = () => { const s = { ...store.readSettings() }; delete s.screenshotsDir; return s; };
  // le liste si fondono (tre vie): se la barra ha aggiunto un setup mentre il Journal era aperto, non si perde
  A.saveSettings = ({ data, base }) => store.updateSettings((cur) => {
    for (const [k, v] of Object.entries(data || {})) {
      if (k === 'screenshotsDir') continue;
      if (LIST_KEYS.includes(k) && Array.isArray(v)) {
        const b = base && Array.isArray(base[k]) ? base[k] : [], theirs = Array.isArray(cur[k]) ? cur[k] : [];
        const removed = b.filter((x) => !v.includes(x)), added = v.filter((x) => !b.includes(x));
        cur[k] = [...new Set([...theirs, ...added])].filter((x) => !removed.includes(x));
      } else cur[k] = v;
    }
    const out = { ...cur }; return out;
  }) && A.getSettings();
  A.renameSetup = ({ from, to }) => { store.updateTrades((all) => { for (const t of all) if (t.setup === from) { t.setup = to; t.rev = (t.rev || 0) + 1; } }); return true; };
  A.replaceTag = ({ from, to }) => {
    let n = 0;
    store.updateTrades((all) => { for (const t of all) if ((t.tags || []).includes(from)) { n++; t.tags = [...new Set(t.tags.map((g) => (g === from ? to : g)).filter(Boolean))]; t.rev = (t.rev || 0) + 1; } });
    return n;
  };
  const sharedIds = () => new Set(store.readAccounts().filter((a) => a.shared).map((a) => a.id));
  A.setupCounts = () => { const m = {}, sh = sharedIds(); for (const t of store.readTrades()) if (t.setup && !sh.has(t.accountId)) m[t.setup] = (m[t.setup] || 0) + 1; return m; };

  // ----- notizie -----
  A.hasNews = () => true;
  A.listNews = ({ from, to }) => store.listNews(from, to);
  A.refreshNews = async ({ manual } = {}) => {
    const now = Date.now(), meta = store.readNewsMeta();
    if (!manual && meta.lastTry && now - meta.lastTry < 3 * 3600e3) return { skipped: true, lastOk: meta.lastOk || null };
    if (manual && meta.lastTry && now - meta.lastTry < 120e3) return { error: 'Appena aggiornate: riprova tra un paio di minuti.' };
    const { events, ok, lastErr } = await deps.fetchEvents(deps.fetchFn);
    store.updateNewsMeta((m) => { m.lastTry = now; });
    if (!ok) return { error: `Non riesco a scaricare il calendario (${lastErr || 'nessuna risposta'}). Serve internet; il servizio limita le richieste troppo frequenti.` };
    store.mergeNews(events);
    store.updateNewsMeta((m) => { m.lastOk = now; m.count = events.length; });
    return { count: events.length, lastOk: now };
  };

  // ----- cartelle, copia di sicurezza -----
  A.info = () => {
    const d = store.shotsDir();
    return { dataDir: store.dataDir(), shotsDir: d, isDefaultShots: path.resolve(d) === path.resolve(path.join(store.dataDir(), 'screenshot')), version: deps.version || '', newsLastOk: store.readNewsMeta().lastOk || null };
  };
  A.chooseShotsDir = async () => {
    const dir = await dialogs.pickFolder('Scegli la cartella degli screenshot', store.shotsDir());
    if (!dir) return null;
    const how = await dialogs.askMove(dir);
    if (!how) return null;
    const res = store.setShotsDir(dir, { move: how === 'move' });
    return { ...res, ...A.info() };
  };
  A.openFolder = ({ which }) => { const p = which === 'data' ? store.dataDir() : store.ensureShotsDir().dir; if (deps.openPath) deps.openPath(p); return p; };

  function stamp() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }
  // copia di sicurezza: dati + screenshot in una cartella con la data (si ripristina copiando i file indietro)
  A.backup = async ({ dest } = {}) => {
    dest = dest || await dialogs.pickFolder('Dove salvare la copia dei dati?', path.dirname(store.dataDir()));
    if (!dest) return null;
    const out = path.join(dest, `Journal_copia_${stamp()}`);
    store.mkdirp(out); store.mkdirp(path.join(out, 'screenshot'));
    let files = 0, shots = 0, missing = 0;
    store.withLock(() => {
      for (const n of ['trades', 'accounts', 'settings', 'days', 'news']) { const f = store.file(n); if (fs.existsSync(f)) { fs.copyFileSync(f, path.join(out, path.basename(f))); files++; } }
    });
    const used = new Set();
    for (const t of store.readTrades()) for (const rel of [t.shotOpen, t.shotClose, ...(t.images || []).map((i) => i.file)]) {
      const f = store.shotAbs(rel); if (!f) continue;
      if (!fs.existsSync(f)) { missing++; continue; }
      let name = path.basename(f), i = 1; while (used.has(name)) name = `${path.basename(f, path.extname(f))}_${i++}${path.extname(f)}`;
      used.add(name); fs.copyFileSync(f, path.join(out, 'screenshot', name)); shots++;
    }
    fs.writeFileSync(path.join(out, 'LEGGIMI.txt'), 'Copia dei dati del Journal.\nPer ripristinarla: chiudi Journal e Trade Logger, copia i file .json in Documenti\\TradeLogger (sostituendo quelli presenti) e la cartella "screenshot" dove tieni gli screenshot.\n');
    return { dir: out, files, shots, missing };
  };

  // copia automatica dei dati (solo i file .json, pochi KB): una al giorno, tengo le ultime 14. Gli screenshot sono già file nella loro cartella.
  A.autoBackup = () => {
    try {
      const root = path.join(store.dataDir(), 'copie-automatiche'), day = new Date().toISOString().slice(0, 10), out = path.join(root, day);
      if (fs.existsSync(out)) return null;
      store.mkdirp(out);
      store.withLock(() => { for (const n of ['trades', 'accounts', 'settings', 'days', 'news']) { const f = store.file(n); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(out, path.basename(f))); } });
      const old = fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(0, -14);
      for (const d of old) fs.rmSync(path.join(root, d), { recursive: true, force: true });
      return out;
    } catch (e) { return null; }
  };

  // ----- importazione dal journal online (sola lettura: non cambia nulla online) -----
  A.importOnline = async ({ url, key, email, password }) => {
    if (!deps.createClient) throw new Error('Importazione non disponibile.');
    const progress = (t) => { if (deps.onProgress) deps.onProgress(t); };
    url = String(url || '').replace(/[\s'"`]/g, '').replace(/\/+$/, ''); key = String(key || '').replace(/[\s'"`]/g, '');
    if (!url || !key) throw new Error('Inserisci indirizzo e chiave di Supabase.');
    const sb = deps.createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    progress('Accedo…');
    const { error: e0 } = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password });
    if (e0) throw new Error(/Invalid login/i.test(e0.message) ? 'Email o password non corretti.' : e0.message);
    const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
    // prima di toccare qualcosa: copia di sicurezza dei dati locali (solo file di dati, senza screenshot)
    const safe = path.join(store.dataDir(), `copia-prima-importazione-${stamp()}`); store.mkdirp(safe);
    for (const n of ['trades', 'accounts', 'settings', 'days', 'news']) { const f = store.file(n); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(safe, path.basename(f))); }
    progress('Leggo conti e trade…');
    const rAcc = await q(sb.from('accounts').select('*'));
    const rTr = []; for (let from = 0; ; from += 1000) { const part = await q(sb.from('trades').select('*').order('created_at').range(from, from + 999)); rTr.push(...part); if (part.length < 1000) break; }
    const rImg = []; for (let from = 0; ; from += 1000) { const part = await q(sb.from('trade_images').select('*').order('created_at').range(from, from + 999)); rImg.push(...part); if (part.length < 1000) break; }
    const rDays = await q(sb.from('day_notes').select('*'));
    const rSet = await q(sb.from('user_settings').select('data').maybeSingle());
    const res = { accounts: 0, trades: 0, skipped: 0, images: 0, imagesFailed: 0, days: 0, safeDir: safe };
    // conti: stesso identificativo online e locale (così si può rifare senza doppioni)
    const accMap = {};
    const local = store.readAccounts();
    for (const r of rAcc) {
      const found = local.find((a) => a.remoteId === r.id || a.id === r.id);
      if (found) { accMap[r.id] = found.id; if (!found.remoteId) store.patchAccount(found.id, { remoteId: r.id }); continue; }
      store.addAccount({ id: r.id, name: r.name, kind: r.kind, note: r.note || '', remoteId: r.id }); accMap[r.id] = r.id; res.accounts++;
    }
    const have = new Set(); for (const t of store.readTrades()) { have.add(t.id); if (t.remoteId) have.add(t.remoteId); }
    const imported = new Map();
    for (const r of rTr) {
      if (have.has(r.id)) { res.skipped++; continue; }
      const rec = {
        id: r.id, remoteId: r.id, accountId: accMap[r.account_id] || r.account_id, status: r.status || 'chiuso',
        tradeDate: r.trade_date, tradeTime: r.trade_time || '', symbol: r.symbol || '', direction: r.direction || '', pnl: num(r.pnl) || 0, setup: r.setup || '',
        entry: num(r.entry), sl: num(r.sl), tp: num(r.tp), contracts: num(r.contracts), slUsd: num(r.sl_usd), tpUsd: num(r.tp_usd),
        outcome: r.outcome || '', tags: r.tags || [], emotions: r.emotions || [], note: r.notes || '', starred: !!r.starred, source: r.source || 'manuale',
        createdAt: r.created_at, updatedAt: r.updated_at || r.created_at, rev: 1, syncedRev: 1, images: [],
      };
      store.addTrade(rec); imported.set(r.id, rec); res.trades++;
    }
    // foto: le scarico nella cartella degli screenshot
    const { dir } = store.ensureShotsDir();
    let n = 0;
    for (const im of rImg) {
      if (!imported.has(im.trade_id)) continue;
      n++; if (n % 5 === 0) progress(`Scarico le foto… ${n} di ${rImg.filter((x) => imported.has(x.trade_id)).length}`);
      try {
        const { data, error } = await sb.storage.from('trade-images').download(im.path);
        if (error) throw error;
        const buf = Buffer.from(await data.arrayBuffer());
        const ext = (path.extname(im.path) || '.jpg').replace(/[^.\w]/g, '') || '.jpg';
        const name = `online_${String(im.id).slice(0, 8)}_${Date.now().toString(36)}${ext}`;
        fs.writeFileSync(path.join(dir, name), buf);
        const entry = { id: im.id, file: store.shotRel(path.join(dir, name)), timeframe: im.timeframe || '', created_at: im.created_at };
        store.patchTrade(im.trade_id, (cur) => ({ images: [...(cur.images || []), entry] }));
        res.images++;
      } catch { res.imagesFailed++; }
    }
    // analisi dei giorni (non sovrascrivo quelle già scritte qui)
    for (const d of rDays) { const acc = accMap[d.account_id] || d.account_id; if (!store.listDays(acc).some((x) => x.day === d.day) && d.notes) { store.setDay(acc, d.day, d.notes); res.days++; } }
    // impostazioni: le liste si uniscono; il resto solo se qui non c'è già
    const remote = (rSet && rSet.data) || {};
    store.updateSettings((cur) => {
      for (const [k, v] of Object.entries(remote)) {
        if (LIST_KEYS.includes(k) && Array.isArray(v)) cur[k] = [...new Set([...(Array.isArray(cur[k]) ? cur[k] : []), ...v])];
        else if (cur[k] === undefined && k !== 'screenshotsDir') cur[k] = v;
      }
    });
    progress('Fatto');
    return res;
  };

  // ----- post per i social: la card viene disegnata dall'interfaccia; qui si salva, si copia, si mostra -----
  const postDir = () => path.join(store.dataDir(), 'post');
  A.postSave = ({ bytes, name }) => {
    store.mkdirp(postDir());
    const safe = String(name || 'post.jpg').replace(/[^\w.-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[._]+/, '').slice(0, 80) || 'post.jpg';
    const ext = path.extname(safe), stem = path.basename(safe, ext);
    let f = path.join(postDir(), safe), i = 1;
    while (fs.existsSync(f)) f = path.join(postDir(), `${stem}_${i++}${ext}`);
    fs.writeFileSync(f, Buffer.from(bytes));
    return { file: f, folder: postDir() };
  };
  A.postCopyImage = ({ bytes }) => { if (!deps.copyImage) throw new Error('Copia non disponibile.'); deps.copyImage(Buffer.from(bytes)); return true; };
  A.postCopyText = ({ text }) => { if (!deps.copyText) throw new Error('Copia non disponibile.'); deps.copyText(String(text || '')); return true; };
  A.postReveal = ({ file }) => {
    const f = path.resolve(String(file || ''));
    if (!f.startsWith(path.resolve(postDir()) + path.sep)) throw new Error('File non valido.');
    if (deps.showItem) deps.showItem(f);
    return true;
  };
  // uno screenshot di un trade, per disegnarlo sulla card (solo file che appartengono ai trade o alla cartella degli screenshot)
  A.readImage = ({ path: p }) => {
    const f = path.resolve(String(p || ''));
    const mine = new Set();
    for (const t of store.readTrades()) for (const rel of [t.shotOpen, t.shotClose, ...(t.images || []).map((i) => i.file)]) { const a = store.shotAbs(rel); if (a) mine.add(path.resolve(a)); }
    if (!mine.has(f) || !fs.existsSync(f) || fs.statSync(f).size > 40e6) throw new Error('Immagine non disponibile.');
    return fs.readFileSync(f);
  };

  // ----- pacchetto condiviso: un file che un'altra persona importa nel suo Journal come conto separato -----
  // Formato: "JSHARE1\n" + lunghezza (4 byte) + descrizione dei trade compressa + le foto una dopo l'altra.
  const MAGIC = Buffer.from('JSHARE1\n');
  const median = (a) => { const v = a.slice().sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : 0; };
  const cleanStr = (v, max = 400) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
  const okDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const okImg = (b) => (b.length > 8 && ((b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP')));
  const extOf = (b) => (b[0] === 0xff ? 'jpg' : b[0] === 0x89 ? 'png' : 'webp');

  A.exportShare = async (o) => {
    const acc = store.readAccounts().find((a) => a.id === o.accountId);
    if (!acc) throw new Error('Conto non trovato.');
    let trades = store.readTrades().filter((t) => t.accountId === acc.id && t.status !== 'aperto');
    if (okDate(o.from)) trades = trades.filter((t) => (t.tradeDate || '') >= o.from);
    if (okDate(o.to)) trades = trades.filter((t) => (t.tradeDate || '') <= o.to);
    if (!trades.length) throw new Error('Nessun trade chiuso nel periodo scelto.');
    trades.sort((a, b) => ((a.tradeDate || '') + (a.tradeTime || '')).localeCompare((b.tradeDate || '') + (b.tradeTime || '')));
    const hide = !!o.hideAmounts;
    // importi nascosti: tutto in "100 = rischio tipico" (la mediana del rischio in dollari dei trade), niente saldi né contratti
    const risks = trades.map((t) => Math.abs(t.slUsd)).filter((x) => x > 0), pn = trades.map((t) => Math.abs(t.pnl)).filter((x) => x > 0);
    const unit = hide ? (median(risks) || median(pn) || 1) : null;
    const sc = (v) => (v == null ? null : Math.round((v / unit) * 10000) / 100);
    const days = o.includeDays ? store.listDays(acc.id).filter((d) => (!okDate(o.from) || d.day >= o.from) && (!okDate(o.to) || d.day <= o.to)) : [];
    const outTrades = trades.map((t) => ({
      tradeDate: t.tradeDate || '', tradeTime: t.tradeTime || '', symbol: t.symbol || '', direction: t.direction || '',
      entry: t.entry ?? null, sl: t.sl ?? null, tp: t.tp ?? null, contracts: hide ? null : (t.contracts ?? null),
      tpUsd: hide ? sc(t.tpUsd) : (t.tpUsd ?? null), slUsd: hide ? sc(t.slUsd) : (t.slUsd ?? null), pnl: hide ? sc(t.pnl) : (t.pnl ?? 0),
      outcome: t.outcome || '', setup: t.setup || '', tags: t.tags || [], emotions: o.includeEmotions ? (t.emotions || []) : [],
      note: o.includeNotes ? (t.note || '') : '', starred: !!t.starred, rrPlanned: t.rrPlanned ?? null, rResult: t.rResult ?? null,
    }));
    // foto: JPEG ridotti (se disponibile), nell'ordine dei trade
    const imgMeta = [], blobs = []; let total = 0;
    if (o.includeScreens) {
      for (let i = 0; i < trades.length; i++) {
        const t = trades[i];
        const list = [[t.shotOpen, 'Apertura'], [t.shotClose, 'Chiusura'], ...(t.images || []).map((im) => [im.file, im.timeframe || ''])];
        for (const [rel, label] of list) {
          const f = store.shotAbs(rel); if (!f || !fs.existsSync(f)) continue;
          let buf; try { buf = deps.encodeImage ? await deps.encodeImage(f, { maxWidth: 1600, quality: 80 }) : fs.readFileSync(f); } catch { continue; }
          if (!buf || !okImg(buf)) continue;
          total += buf.length; if (total > 1.5e9) throw new Error('Gli screenshot sono troppi per un solo pacchetto: scegli un periodo più breve o escludili.');
          imgMeta.push({ trade: i, timeframe: cleanStr(label, 40), len: buf.length }); blobs.push(buf);
        }
      }
    }
    const manifest = { v: 1, id: store.newId('p'), createdAt: store.nowIso(), app: `Journal ${deps.version || ''}`.trim(), from: cleanStr(o.fromName, 60),
      account: { name: cleanStr(acc.name, 60), kind: acc.kind === 'backtest' ? 'backtest' : 'conto' }, period: { from: okDate(o.from) ? o.from : null, to: okDate(o.to) ? o.to : null },
      hideAmounts: hide, scaleNote: hide ? 'Importi nascosti: 100 = rischio tipico (1R).' : '', trades: outTrades, images: imgMeta, days };
    const dest = o.dest || await dialogs.saveFile(`Journal_${cleanStr(acc.name, 30).replace(/[^\w.-]+/g, '_')}_${stamp()}.journalshare`);
    if (!dest) return null;
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(manifest)));
    const head = Buffer.alloc(4); head.writeUInt32BE(gz.length);
    const fd = fs.openSync(dest, 'w');
    try { fs.writeSync(fd, MAGIC); fs.writeSync(fd, head); fs.writeSync(fd, gz); for (const b of blobs) fs.writeSync(fd, b); } finally { fs.closeSync(fd); }
    return { file: dest, trades: outTrades.length, images: blobs.length, bytes: fs.statSync(dest).size, hideAmounts: hide, unit };
  };

  A.importShare = async ({ file } = {}) => {
    file = file || await dialogs.pickFile('Scegli il pacchetto condiviso', [{ name: 'Pacchetto Journal', extensions: ['journalshare'] }]);
    if (!file) return null;
    const bad = () => new Error('Questo file non è un pacchetto del Journal (o è danneggiato).');
    const st = fs.statSync(file); if (st.size < 20 || st.size > 3e9) throw bad();
    const fd = fs.openSync(file, 'r');
    try {
      const rd = (n, pos) => { const b = Buffer.alloc(n); const r = fs.readSync(fd, b, 0, n, pos); if (r !== n) throw bad(); return b; };
      if (!rd(MAGIC.length, 0).equals(MAGIC)) throw bad();
      const glen = rd(4, MAGIC.length).readUInt32BE(0);
      if (glen < 10 || glen > 200e6 || MAGIC.length + 4 + glen > st.size) throw bad();
      let m;
      try { m = JSON.parse(zlib.gunzipSync(rd(glen, MAGIC.length + 4), { maxOutputLength: 300e6 }).toString('utf8')); } catch { throw bad(); }
      if (!m || m.v !== 1 || !Array.isArray(m.trades) || !m.trades.length || m.trades.length > 200000 || typeof m.id !== 'string') throw bad();
      const dup = store.readAccounts().find((a) => a.shared && a.shared.packageId === m.id);
      if (dup) throw new Error(`Questo pacchetto è già stato importato come «${dup.name}». Per rifarlo elimina prima quel conto.`);
      const from = cleanStr(m.from, 60), accName = cleanStr(m.account && m.account.name, 60) || 'Conto';
      const acc = store.addAccount({ name: `${from ? from + ' – ' : ''}${accName}`.slice(0, 80), kind: m.account && m.account.kind === 'backtest' ? 'backtest' : 'conto',
        note: `Pacchetto condiviso${from ? ' da ' + from : ''}, creato il ${cleanStr(m.createdAt, 10)}.${m.scaleNote ? ' ' + cleanStr(m.scaleNote, 120) : ''}` });
      store.patchAccount(acc.id, { shared: { packageId: m.id, from, at: store.nowIso(), hideAmounts: !!m.hideAmounts } });
      const n = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
      const recs = m.trades.map((t) => ({
        id: store.newId('s'), accountId: acc.id, status: 'chiuso', source: 'condiviso', rev: 1, syncedRev: 1, createdAt: store.nowIso(), updatedAt: store.nowIso(),
        tradeDate: okDate(t.tradeDate) ? t.tradeDate : '1970-01-01', tradeTime: cleanStr(t.tradeTime, 8), symbol: cleanStr(t.symbol, 16).toUpperCase(),
        direction: t.direction === 'LONG' || t.direction === 'SHORT' ? t.direction : '', entry: n(t.entry), sl: n(t.sl), tp: n(t.tp), contracts: n(t.contracts),
        tpUsd: n(t.tpUsd), slUsd: n(t.slUsd), pnl: n(t.pnl) || 0, outcome: ['TP', 'SL', 'MANUALE'].includes(t.outcome) ? t.outcome : '', setup: cleanStr(t.setup, 80),
        tags: (Array.isArray(t.tags) ? t.tags : []).slice(0, 30).map((x) => cleanStr(x, 60)).filter(Boolean), emotions: (Array.isArray(t.emotions) ? t.emotions : []).slice(0, 30).map((x) => cleanStr(x, 60)).filter(Boolean),
        note: cleanStr(t.note, 20000), starred: !!t.starred, rrPlanned: n(t.rrPlanned), rResult: n(t.rResult), images: [],
      }));
      // foto, una dopo l'altra dopo la descrizione
      let pos = MAGIC.length + 4 + glen, imported = 0, skipped = 0;
      const { dir } = store.ensureShotsDir();
      const metas = Array.isArray(m.images) ? m.images.slice(0, 20000) : [];
      for (let i = 0; i < metas.length; i++) {
        const im = metas[i], len = Number(im && im.len);
        if (!Number.isInteger(len) || len <= 0 || len > 60e6 || pos + len > st.size) { skipped += metas.length - i; break; }
        const buf = rd(len, pos); pos += len;
        const ti = Number(im.trade);
        if (!okImg(buf) || !Number.isInteger(ti) || !recs[ti]) { skipped++; continue; }
        const name = `condiviso_${m.id.slice(0, 8)}_${i}.${extOf(buf)}`.replace(/[^\w.-]/g, '_');
        fs.writeFileSync(path.join(dir, name), buf);
        recs[ti].images.push({ id: store.newId('i'), file: store.shotRel(path.join(dir, name)), timeframe: cleanStr(im.timeframe, 40), created_at: store.nowIso() });
        imported++;
      }
      store.updateTrades((all) => { all.push(...recs); });
      let days = 0;
      for (const d of Array.isArray(m.days) ? m.days.slice(0, 5000) : []) if (d && okDate(d.day) && d.notes) { store.setDay(acc.id, d.day, cleanStr(d.notes, 20000)); days++; }
      return { accountId: acc.id, name: acc.name, trades: recs.length, images: imported, skippedImages: skipped, days, from, hideAmounts: !!m.hideAmounts, scaleNote: cleanStr(m.scaleNote, 120) };
    } finally { fs.closeSync(fd); }
  };

  return A;
}
module.exports = { createCore, LIST_KEYS };
