/* Journal v0.11 */
'use strict';

// =====================================================================
//  Utilità
// =====================================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const itDate = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[^0-9.,\-]/g, '');
  if (!/\d/.test(s)) return null;
  const neg = s.startsWith('-'); s = s.replace(/-/g, '');
  const hasDot = s.includes('.'), hasCom = s.includes(',');
  let dec = null;
  if (hasDot && hasCom) dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  else if (hasDot || hasCom) { const sep = hasDot ? '.' : ','; const p = s.split(sep); if (p.length === 2 && p[1].length !== 3) dec = sep; }
  let n;
  if (dec) { const k = s.lastIndexOf(dec); n = parseFloat(s.slice(0, k).replace(/[.,]/g, '') + '.' + s.slice(k + 1)); }
  else n = parseFloat(s.replace(/[.,]/g, ''));
  return isNaN(n) ? null : (neg ? -n : n);
};
const fmt = (n, dec = 2) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: 'always' });
const cur = () => (typeof S !== 'undefined' && S.settings && S.settings.currency) || 'USD';
const money = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n || 0))} ${cur()}`;
const moneyPlain = (n) => `${n < 0 ? '−' : ''}${fmt(Math.abs(n || 0))} ${cur()}`;
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const DOW = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

// tag disponibili: quelli predefiniti (meno quelli nascosti) + quelli personalizzati
const tagsAvailable = () => [...PRESET_TAGS.filter((g) => !(S.settings.hiddenTags || []).includes(g)), ...(S.settings.customTags || [])];
const PRESET_TAGS = ['Da manuale', 'Entrata in anticipo', 'Entrata in ritardo', 'Uscita anticipata', 'Uscita in ritardo',
  'Stop spostato', 'Size eccessiva', 'Revenge trade', 'Fuori piano', 'Mercato laterale'];
const EMOTIONS = ['Calmo', 'Fiducioso', 'Concentrato', 'Paziente', 'Ansioso', 'Impaziente', 'FOMO', 'Frustrato', 'Euforico', 'Stanco'];

function toast(msg, err = false) {
  $$('.toast').forEach((x) => x.remove());   // un avviso alla volta
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), err ? 6000 : 2600);
}
function errMsg(e) { return (e && (e.message || e.error_description)) || String(e); }

// =====================================================================
//  Temi: cambiano solo l'aspetto (i colori e lo stile stanno in style.css e themes.css)
// =====================================================================
const THEMES = {
  classico: { name: 'Classico', desc: 'Scuro e sobrio, con il blu e il verde di sempre.', meta: '#0d0f12' },
  neon: { name: 'Neon', desc: 'Strumentazione da cockpit: ciano e magenta, cifre che emettono luce.', meta: '#05060d' },
  aurora: { name: 'Aurora', desc: 'Vetro e luce: indaco profondo con riflessi viola e verde acqua.', meta: '#070a1c' },
  ghiaccio: { name: 'Ghiaccio', desc: 'Chiaro e nitido: bianco ghiaccio e blu elettrico.', meta: '#e9eff8' },
  olografico: { name: 'Olografico', desc: 'Bordi iridescenti come una pellicola olografica, su fondo scuro.', meta: '#08080f' },
  ambra: { name: 'Ambra', desc: 'Terminale di trading: ambra su nero, caratteri a spaziatura fissa. Riposa gli occhi la sera.', meta: '#050403' },
  plasma: { name: 'Plasma', desc: 'Tramonto retro-futurista: viola, magenta e arancio con orizzonte a griglia.', meta: '#0a0316' },
};
function applyTheme(id, remember = true) {
  if (!THEMES[id]) id = 'classico';
  document.documentElement.dataset.theme = id;
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
  m.content = THEMES[id].meta;
  if (remember) { try { localStorage.setItem('journal.theme', id); } catch { /* niente */ } }
  return id;
}
try { applyTheme(localStorage.getItem('journal.theme'), false); } catch { applyTheme('classico', false); }
const currentTheme = () => document.documentElement.dataset.theme || 'classico';

const LOGO = `<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--logo-bg)"/><path d="M7 22l6-7 5 4 7-9" stroke="var(--profit)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// =====================================================================
//  Dati: Supabase
// =====================================================================
const BUCKET = 'trade-images';
const TRADE_SELECT = '*, trade_images(*)';

class SupaDB {
  constructor(url, key) { this.sb = window.supabase.createClient(url, key); this.uid = null; }
  async q(p) { const { data, error } = await p; if (error) throw error; return data; }
  async currentUser() { const { data } = await this.sb.auth.getSession(); this.uid = data.session?.user?.id || null; return data.session?.user || null; }
  async signIn(email, password) { const { data, error } = await this.sb.auth.signInWithPassword({ email, password }); if (error) throw error; this.uid = data.user.id; return data.user; }
  async signUp(email, password) {
    const { data, error } = await this.sb.auth.signUp({ email, password });
    if (error) throw error;
    if (!data.session) throw new Error('Account creato. Apri l\'email di conferma che ti è arrivata, clicca il link e poi accedi.');
    this.uid = data.user.id; return data.user;
  }
  async signOut() { await this.sb.auth.signOut(); }
  listAccounts() { return this.q(this.sb.from('accounts').select('*').order('created_at')); }
  async createAccount(name, kind) { return (await this.q(this.sb.from('accounts').insert({ name, kind }).select()))[0]; }
  updateAccount(id, patch) { return this.q(this.sb.from('accounts').update(patch).eq('id', id)); }
  async deleteAccount(id) {
    const imgs = await this.q(this.sb.from('trade_images').select('path, trades!inner(account_id)').eq('trades.account_id', id));
    const paths = imgs.map((i) => i.path);
    for (let i = 0; i < paths.length; i += 100) await this.sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    return this.q(this.sb.from('accounts').delete().eq('id', id));
  }
  renameSetup(from, to) { return this.q(this.sb.from('trades').update({ setup: to }).eq('setup', from)); }
  async replaceTag(from, to) {
    const rows = await this.q(this.sb.from('trades').select('id, tags').contains('tags', [from]));
    for (const r of rows) {
      const tags = [...new Set(r.tags.map((g) => (g === from ? to : g)).filter(Boolean))];
      await this.q(this.sb.from('trades').update({ tags }).eq('id', r.id));
    }
    return rows.length;
  }
  async insertTrades(rows) {
    const out = [];
    for (let i = 0; i < rows.length; i += 200) out.push(...(await this.q(this.sb.from('trades').insert(rows.slice(i, i + 200)).select(TRADE_SELECT))));
    return out;
  }
  listTrades(accountId) { return this.q(this.sb.from('trades').select(TRADE_SELECT).eq('account_id', accountId).order('trade_date').order('trade_time').order('created_at')); }
  async createTrade(t) { return (await this.q(this.sb.from('trades').insert(t).select(TRADE_SELECT)))[0]; }
  updateTrade(id, patch) { return this.q(this.sb.from('trades').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)); }
  async deleteTrade(t) {
    const paths = (t.trade_images || []).map((i) => i.path);
    if (paths.length) await this.sb.storage.from(BUCKET).remove(paths);
    return this.q(this.sb.from('trades').delete().eq('id', t.id));
  }
  async uploadImage(trade, blob, timeframe = '') {
    const ext = ((blob.type || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
    const path = `${this.uid}/${trade.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await this.sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/png' });
    if (error) throw error;
    return (await this.q(this.sb.from('trade_images').insert({ trade_id: trade.id, path, timeframe }).select()))[0];
  }
  updateImage(id, patch) { return this.q(this.sb.from('trade_images').update(patch).eq('id', id)); }
  async deleteImage(img) { await this.sb.storage.from(BUCKET).remove([img.path]); return this.q(this.sb.from('trade_images').delete().eq('id', img.id)); }
  async imageUrls(paths) {
    if (!paths.length) return {};
    const { data, error } = await this.sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (error) throw error;
    const m = {}; data.forEach((d) => { if (d.signedUrl) m[d.path] = d.signedUrl; }); return m;
  }
  async hasMoneyCols() { const { error } = await this.sb.from('trades').select('sl_usd, tp_usd').limit(1); return !error; }
  async hasNews() { const { error } = await this.sb.from('news_events').select('event_key').limit(1); return !error; }
  // setup usati in tutti i conti (non solo in quello aperto): nome -> numero di trade
  async setupCounts() {
    const rows = await this.q(this.sb.from('trades').select('setup').neq('setup', '').limit(20000));
    const m = {}; rows.forEach((r) => { m[r.setup] = (m[r.setup] || 0) + 1; }); return m;
  }
  listNews(fromIso, toIso) { return this.q(this.sb.from('news_events').select('event_time, currency, title, impact, forecast, previous, actual').gte('event_time', fromIso).lt('event_time', toIso).order('event_time').limit(3000)); }
  listDayNotes(accountId) { return this.q(this.sb.from('day_notes').select('day, notes').eq('account_id', accountId)); }
  saveDayNote(accountId, day, notes) { return this.q(this.sb.from('day_notes').upsert({ account_id: accountId, day, notes }, { onConflict: 'account_id,day' })); }
  deleteDayNote(accountId, day) { return this.q(this.sb.from('day_notes').delete().eq('account_id', accountId).eq('day', day)); }
  async getSettings() { const r = await this.q(this.sb.from('user_settings').select('data').maybeSingle()); return (r && r.data) || {}; }
  saveSettings(data) { return this.q(this.sb.from('user_settings').upsert({ data }, { onConflict: 'user_id' })); }
}

// =====================================================================
//  Dati: modalità prova (in memoria, si apre con ?demo)
// =====================================================================
class DemoDB {
  constructor() {
    this.uid = 'demo'; this.accounts = [{ id: 'a1', name: 'Personale', kind: 'conto', note: '' }, { id: 'a2', name: 'Backtest NQ', kind: 'backtest', note: '' }];
    this.trades = []; this.notes = []; this.settings = {};
    const today = new Date(); const base = new Date(today.getFullYear(), today.getMonth(), 1);
    const sample = [[2, '15:35', 'NQ', 'LONG', 520, 'Reversal sequence', ['Da manuale'], ['Calmo']], [3, '15:45', 'MNQ', 'SHORT', 575, 'Reversal sequence', [], ['Fiducioso']],
      [4, '15:55', 'ES', 'LONG', -450, 'Breakout', ['Entrata in anticipo', 'Fuori piano'], ['Impaziente']], [5, '15:40', 'MES', 'LONG', 600, 'Continuation', [], []],
      [6, '15:50', 'NQ', 'SHORT', 540, 'Reversal sequence', [], ['Concentrato']], [9, '16:05', 'NQ', 'LONG', -310, 'Breakout', ['Revenge trade'], ['Frustrato']],
      [9, '16:40', 'NQ', 'SHORT', 280, 'Reversal sequence', [], []], [10, '15:32', 'MNQ', 'LONG', 0, 'Continuation', ['Uscita anticipata'], []]];
    sample.forEach(([d, time, symbol, direction, pnl, setup, tags, emotions], i) => {
      const dt = new Date(base); dt.setDate(d);
      if (dt > today) return;
      this.trades.push({ id: 't' + i, account_id: 'a1', trade_date: ymd(dt), trade_time: time, symbol, direction, pnl, setup, tags, emotions,
        entry: null, sl: null, tp: null, contracts: null, outcome: pnl > 0 ? 'TP' : pnl < 0 ? 'SL' : 'MANUALE', status: 'chiuso',
        notes: pnl > 0 ? 'Ingresso sulla conferma, gestione pulita.' : '', starred: i === 0, source: i % 2 ? 'trade-logger' : 'manuale', trade_images: [] });
    });
    // un anno di trade finti (sempre uguali) per provare Reports e Progress
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const setups = ['Reversal sequence', 'Breakout', 'Continuation'], syms = ['NQ', 'MNQ', 'ES', 'MES'];
    const tagPool = ['Da manuale', 'Entrata in anticipo', 'Uscita anticipata', 'Revenge trade', 'Fuori piano', 'Stop spostato'];
    const emoPool = ['Calmo', 'Fiducioso', 'Impaziente', 'FOMO', 'Frustrato', 'Concentrato'];
    for (let d = new Date(today.getFullYear(), 0, 2); d < base; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || d.getDay() === 6 || rnd() < 0.35) continue;
      const n = rnd() < 0.7 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const su = setups[Math.floor(rnd() * 3)], dir = rnd() < 0.55 ? 'LONG' : 'SHORT';
        const edge = su === 'Reversal sequence' ? 0.62 : su === 'Breakout' ? 0.42 : 0.52;
        const win = rnd() < edge + (d.getDay() === 2 ? 0.08 : d.getDay() === 5 ? -0.1 : 0);
        const pnl = Math.round(win ? 250 + rnd() * 450 : -(200 + rnd() * 250));
        const tags = []; if (!win && rnd() < 0.4) tags.push(tagPool[1 + Math.floor(rnd() * 5)]); if (win && rnd() < 0.4) tags.push('Da manuale');
        this.trades.push({ id: 'g' + this.trades.length, account_id: 'a1', trade_date: ymd(d), trade_time: `${15 + Math.floor(rnd() * 2)}:${pad(Math.floor(rnd() * 60))}`, symbol: syms[Math.floor(rnd() * 4)],
          direction: dir, pnl, setup: su, tags, emotions: rnd() < 0.6 ? [emoPool[win ? Math.floor(rnd() * 2) + (rnd() < 0.5 ? 0 : 5) : 2 + Math.floor(rnd() * 3)]] : [],
          entry: null, sl: null, tp: null, contracts: null, sl_usd: win ? -350 : pnl, tp_usd: win ? pnl : 600, outcome: pnl > 0 ? 'TP' : 'SL', status: 'chiuso', notes: '', starred: false, source: 'trade-logger', trade_images: [] });
      }
      if (rnd() < 0.3) this.notes.push({ account_id: 'a1', day: ymd(d), notes: rnd() < 0.5 ? 'Mercato pulito in apertura, ho rispettato il piano.' : 'Troppa fretta nel primo trade, il secondo era quello giusto.' });
    }
    this.trades.push({ id: 'b-or', account_id: 'a2', trade_date: '2025-04-04', trade_time: '09:50', symbol: 'MNQ', direction: 'LONG', pnl: 210, setup: 'Opening range', tags: [], emotions: [], entry: null, sl: null, tp: null, contracts: 10, sl_usd: -350, tp_usd: 600, outcome: 'TP', status: 'chiuso', notes: '', starred: false, source: 'trade-logger', trade_images: [] });
    // una sessione di backtest indietro nel tempo (marzo-aprile 2025)
    [['2025-03-11', 420], ['2025-03-12', -300], ['2025-03-18', 510], ['2025-03-26', -280], ['2025-04-02', 640], ['2025-04-03', 380]].forEach(([d, pnl], i) => {
      this.trades.push({ id: 'b' + i, account_id: 'a2', trade_date: d, trade_time: '10:05', symbol: 'MNQ', direction: i % 2 ? 'SHORT' : 'LONG', pnl, setup: 'Reversal sequence', tags: [], emotions: [],
        entry: null, sl: null, tp: null, contracts: 10, sl_usd: -350, tp_usd: 600, outcome: pnl > 0 ? 'TP' : 'SL', status: 'chiuso', notes: '', starred: false, source: 'trade-logger', trade_images: [] });
    });
    this.trades.sort((x, y) => (x.trade_date + x.trade_time).localeCompare(y.trade_date + y.trade_time));
  }
  async currentUser() { return { email: 'prova@demo' }; }
  async signIn() { return this.currentUser(); } async signUp() { return this.currentUser(); } async signOut() { location.href = location.pathname; }
  async listAccounts() { return structuredClone(this.accounts); }
  async createAccount(name, kind) { const a = { id: 'a' + Date.now(), name, kind, note: '' }; this.accounts.push(a); return { ...a }; }
  async updateAccount(id, patch) { Object.assign(this.accounts.find((a) => a.id === id), patch); }
  async deleteAccount(id) { this.accounts = this.accounts.filter((a) => a.id !== id); this.trades = this.trades.filter((t) => t.account_id !== id); }
  async renameSetup(from, to) { this.trades.forEach((t) => { if (t.setup === from) t.setup = to; }); }
  async replaceTag(from, to) { let n = 0; this.trades.forEach((t) => { if (t.tags.includes(from)) { n++; t.tags = [...new Set(t.tags.map((g) => (g === from ? to : g)).filter(Boolean))]; } }); return n; }
  async insertTrades(rows) { return Promise.all(rows.map((r) => this.createTrade(r))); }
  async listTrades(accountId) { return structuredClone(this.trades.filter((t) => t.account_id === accountId)); }
  async createTrade(t) { const n = { id: 't' + Date.now() + Math.random(), tags: [], emotions: [], notes: '', starred: false, status: 'chiuso', source: 'manuale', setup: '', symbol: '', direction: '', trade_time: '', pnl: 0, outcome: '', trade_images: [], ...t }; this.trades.push(n); return structuredClone(n); }
  async updateTrade(id, patch) { Object.assign(this.trades.find((t) => t.id === id) || {}, structuredClone(patch)); }
  async deleteTrade(t) { this.trades = this.trades.filter((x) => x.id !== t.id); }
  async uploadImage(trade, blob, timeframe = '') { const img = { id: 'i' + Date.now() + Math.random(), trade_id: trade.id, path: URL.createObjectURL(blob), timeframe }; this.trades.find((t) => t.id === trade.id).trade_images.push(img); return { ...img }; }
  async updateImage(id, patch) { this.trades.forEach((t) => t.trade_images.forEach((i) => { if (i.id === id) Object.assign(i, patch); })); }
  async deleteImage(img) { this.trades.forEach((t) => { t.trade_images = t.trade_images.filter((i) => i.id !== img.id); }); }
  async imageUrls(paths) { const m = {}; paths.forEach((p) => { m[p] = p; }); return m; }
  async hasMoneyCols() { return true; }
  async hasNews() { return true; }
  async setupCounts() { const m = {}; this.trades.forEach((t) => { if (t.setup) m[t.setup] = (m[t.setup] || 0) + 1; }); return m; }
  // notizie finte (sempre uguali) per provare la pagina News senza dati veri
  async listNews(fromIso, toIso) {
    const T = [['USD', 'CPI m/m', 'High', '0.3%', '0.2%'], ['USD', 'Core PCE Price Index m/m', 'High', '0.2%', '0.3%'], ['USD', 'ISM Manufacturing PMI', 'High', '49.8', '49.2'], ['USD', 'Unemployment Claims', 'Medium', '225K', '227K'],
      ['USD', 'FOMC Member Speaks', 'Medium', '', ''], ['USD', 'Crude Oil Inventories', 'Low', '-1.2M', '0.8M'], ['EUR', 'German Ifo Business Climate', 'Medium', '87.5', '87.1'], ['GBP', 'BOE Gov Bailey Speaks', 'Medium', '', ''], ['JPY', 'Monetary Policy Statement', 'High', '', '']];
    const out = []; const from = new Date(fromIso), to = new Date(toIso);
    for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d < to; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const seed = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
      const n = 2 + (seed % 3);
      for (let k = 0; k < n; k++) {
        const t = T[(seed * 7 + k * 5) % T.length], h = [14, 15, 16, 20, 9, 10][(seed + k) % 6], m = [0, 30, 0, 30, 45, 15][(seed * 3 + k) % 6];
        out.push({ event_time: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString(), currency: t[0], title: t[1], impact: t[2], forecast: t[3], previous: t[4], actual: '' });
      }
    }
    return out.filter((e) => e.event_time >= fromIso && e.event_time < toIso).sort((a, b) => a.event_time.localeCompare(b.event_time));
  }
  async listDayNotes(accountId) { return this.notes.filter((n) => n.account_id === accountId); }
  async saveDayNote(accountId, day, notes) { const n = this.notes.find((x) => x.account_id === accountId && x.day === day); if (n) n.notes = notes; else this.notes.push({ account_id: accountId, day, notes }); }
  async deleteDayNote(accountId, day) { this.notes = this.notes.filter((x) => !(x.account_id === accountId && x.day === day)); }
  async getSettings() { return structuredClone(this.settings); }
  async saveSettings(d) { this.settings = structuredClone(d); }
}

// =====================================================================
//  Stato
// =====================================================================
const S = {
  db: null, demo: false, user: null,
  accounts: [], accountId: null,
  trades: [], notes: {}, settings: { customTags: [] },
  month: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
  page: 'dashboard', logAll: false,
  newsCache: {}, newsOk: null, newsWeek: null, setupCounts: null,
};
const account = () => S.accounts.find((a) => a.id === S.accountId);

// setup di tutti i conti, tenuti in memoria e riletti quando serve
async function refreshSetupCounts() { try { S.setupCounts = await S.db.setupCounts(); } catch { /* resta quello di prima */ } }
async function loadAccountData() {
  const [trades, notes] = await Promise.all([S.db.listTrades(S.accountId), S.db.listDayNotes(S.accountId)]);
  S.trades = trades.map(normalizeTrade);
  S.notes = {}; notes.forEach((n) => { if (n.notes) S.notes[n.day] = n.notes; });
}
function normalizeTrade(t) {
  t.pnl = num(t.pnl) || 0;
  ['entry', 'sl', 'tp', 'contracts', 'sl_usd', 'tp_usd'].forEach((k) => { t[k] = num(t[k]); });
  t.tags = t.tags || []; t.emotions = t.emotions || []; t.trade_images = (t.trade_images || []).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return t;
}
// R: risultato diviso per quanto avresti perso andando a stop
const rOf = (t) => (t.sl_usd != null && t.sl_usd < 0 && t.status !== 'aperto' ? t.pnl / -t.sl_usd : null);
const fmtR = (r) => (r == null ? '' : `${r > 0 ? '+' : r < 0 ? '−' : ''}${fmt(Math.abs(r))} R`);
const sortTrades = (a, b) => (a.trade_date + (a.trade_time || '')).localeCompare(b.trade_date + (b.trade_time || ''));

// =====================================================================
//  Finestre di dialogo semplici
// =====================================================================
function dialog({ title, fields = [], text = '', okText = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal small" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2></div>
      <form class="modal-body">
        ${text ? `<p class="muted" style="margin:0">${esc(text)}</p>` : ''}
        ${fields.map((f) => f.options
          ? `<label class="field"><span>${esc(f.label)}</span><select class="input" name="${f.name}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`
          : `<label class="field"><span>${esc(f.label)}</span><input class="input" name="${f.name}" type="${esc(f.type || 'text')}" value="${esc(f.value || '')}" autocomplete="off" ${f.required ? 'required' : ''}></label>`).join('')}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
          <button type="button" class="btn ghost" data-x>Annulla</button>
          <button class="btn ${danger ? 'danger' : 'primary'}">${esc(okText)}</button>
        </div>
      </form></div>`;
    const close = (v) => { ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(null); });
    $('[data-x]', ov).onclick = () => close(null);
    $('form', ov).onsubmit = (e) => { e.preventDefault(); close(Object.fromEntries(new FormData(e.target))); };
    document.body.appendChild(ov);
    const first = $('input, select', ov) || $('.btn:last-child', ov); first && first.focus();
  });
}
const confirmBox = (title, text, okText = 'Elimina') => dialog({ title, text, okText, danger: true }).then((r) => r !== null);

// =====================================================================
//  Accesso
// =====================================================================
function renderSetupNeeded() {
  $('#root').innerHTML = `<div class="auth"><div class="card box setup-box">
    <h1>${LOGO} Journal</h1>
    <p>Manca il collegamento al database. Apri il file <code>config.js</code> e incolla il Project URL e la chiave anon di Supabase, come spiegato nelle istruzioni.</p>
    <p>Intanto puoi vedere com'è fatto con dati di prova:</p>
    <a class="btn primary" href="?demo" style="align-self:flex-start;text-decoration:none">Apri la versione di prova</a>
  </div></div>`;
}

function renderAuth(mode = 'in', msg = '') {
  $('#root').innerHTML = `<div class="auth"><form class="card box" novalidate>
    <h1>${LOGO} Journal</h1>
    <p>${mode === 'in' ? 'Accedi al tuo journal.' : 'Crea il tuo account. Ti basta farlo una volta.'}</p>
    <label class="field"><span>Email</span><input class="input" type="email" name="email" autocomplete="email" required></label>
    <label class="field"><span>Password</span><input class="input" type="password" name="password" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" minlength="6" required></label>
    <div class="err" role="alert">${esc(msg)}</div>
    <button class="btn primary">${mode === 'in' ? 'Accedi' : 'Crea account'}</button>
    <button type="button" class="switch">${mode === 'in' ? 'Non hai un account? Creane uno' : 'Hai già un account? Accedi'}</button>
  </form></div>`;
  const f = $('form');
  $('.switch', f).onclick = () => renderAuth(mode === 'in' ? 'up' : 'in');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const { email, password } = Object.fromEntries(new FormData(f));
    if (!email || !password || password.length < 6) { $('.err', f).textContent = 'Inserisci email e una password di almeno 6 caratteri.'; return; }
    const b = $('.btn', f); b.disabled = true; $('.err', f).textContent = '';
    try { S.user = mode === 'in' ? await S.db.signIn(email, password) : await S.db.signUp(email, password); await start(); }
    catch (err) { $('.err', f).textContent = translateAuth(errMsg(err)); b.disabled = false; }
  };
  $('input', f).focus();
}
function translateAuth(m) {
  if (/Invalid login credentials/i.test(m)) return 'Email o password non corretti.';
  if (/Email not confirmed/i.test(m)) return 'Devi prima confermare l\'email: apri il link che ti è arrivato.';
  if (/already registered/i.test(m)) return 'Esiste già un account con questa email: accedi.';
  if (/Signups not allowed/i.test(m)) return 'La creazione di nuovi account è disattivata.';
  return m;
}

// =====================================================================
//  Struttura della pagina
// =====================================================================
const ICONS = {
  news: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h13a1 1 0 0 1 1 1v13H6a2 2 0 0 1-2-2V5z"/><path d="M18 9h2v8a2 2 0 0 1-2 2M8 9h6M8 13h6M8 16h3"/></svg>',
  set: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  dash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  rep: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V4M9 20v-8M14 20V8M19 20v-5"/></svg>',
  prog: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 4h8v5a4 4 0 0 1-8 0zM6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3M12 13v4M8 21h8M10 17h4"/></svg>',
  user: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};

function renderShell() {
  const a = account();
  $('#root').innerHTML = `
    ${S.demo ? '<div class="demo-bar">Versione di prova: i dati sono finti e spariscono quando ricarichi la pagina.</div>' : ''}
    <div class="app">
      <nav class="side" aria-label="Menu">
        <div class="brand">${LOGO} Journal</div>
        <button class="nav ${S.page === 'dashboard' ? 'active' : ''}" data-page="dashboard">${ICONS.dash} Dashboard</button>
        <button class="nav ${S.page === 'reports' ? 'active' : ''}" data-page="reports">${ICONS.rep} Reports</button>
        <button class="nav ${S.page === 'progress' ? 'active' : ''}" data-page="progress">${ICONS.prog} Progress</button>
        <button class="nav ${S.page === 'news' ? 'active' : ''}" data-page="news">${ICONS.news} News</button>
        <button class="nav ${S.page === 'settings' ? 'active' : ''}" data-page="settings">${ICONS.set} Impostazioni</button>
        <div class="spacer"></div>
      </nav>
      <div class="main">
        <header class="top">
          <h1>${{ dashboard: 'Dashboard', reports: 'Reports', progress: 'Progress Tracker', news: 'News', settings: 'Impostazioni' }[S.page]}</h1>
          <div class="acc">
            <button class="acc-btn" id="accBtn" aria-haspopup="true"><span class="dot ${a && a.kind === 'backtest' ? 'backtest' : ''}"></span>${esc(a ? a.name : '')}${a && a.shared ? ' (condiviso)' : ''} <span aria-hidden="true">▾</span></button>
          </div>
          <div class="grow"></div>
          <div class="acc">
            <button class="btn ghost icon" id="userBtn" title="${esc(S.user && S.user.email)}" aria-label="Profilo">${ICONS.user}</button>
          </div>
        </header>
        <main class="content" id="page"></main>
      </div>
    </div>`;
  $('#accBtn').onclick = (e) => { e.stopPropagation(); toggleAccountMenu(); };
  $$('[data-page]').forEach((b) => { b.onclick = () => goPage(b.dataset.page); });
  $('#userBtn').onclick = (e) => { e.stopPropagation(); toggleUserMenu(); };
  renderPage();
}

async function chooseTheme(id) {
  applyTheme(id);
  S.settings.theme = currentTheme();
  if (S.page === 'settings') renderSettings();
  try { await S.db.saveSettings(S.settings); toast(`Tema ${THEMES[currentTheme()].name} ✓`); } catch (e) { toast(errMsg(e), true); }
}
function closeMenus() { $$('.menu').forEach((m) => m.remove()); }
document.addEventListener('click', closeMenus);

function toggleAccountMenu() {
  const host = $('#accBtn').parentElement;
  if ($('.menu', host)) return closeMenus();
  closeMenus();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = `<div class="label">Conti e backtest</div>
    ${S.accounts.map((a) => `<button data-acc="${a.id}">${a.id === S.accountId ? '✓' : '<span style="width:12px"></span>'} ${esc(a.name)}${a.shared ? ' (condiviso)' : ''}<span class="kind">${a.kind === 'backtest' ? 'backtest' : 'conto'}</span></button>`).join('')}
    <hr><button data-act="new">+ Nuovo conto o backtest</button><button data-act="rename">Rinomina questo</button>`;
  m.addEventListener('click', async (e) => {
    e.stopPropagation();
    const b = e.target.closest('button'); if (!b) return;
    closeMenus();
    if (b.dataset.acc) return switchAccount(b.dataset.acc);
    if (b.dataset.act === 'new') {
      const r = await dialog({ title: 'Nuovo spazio', okText: 'Crea', fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'kind', label: 'Tipo', value: 'conto', options: [{ value: 'conto', label: 'Conto' }, { value: 'backtest', label: 'Backtest' }] }] });
      if (!r || !r.name.trim()) return;
      try { const a = await S.db.createAccount(r.name.trim(), r.kind); S.accounts.push(a); switchAccount(a.id); } catch (err) { toast(errMsg(err), true); }
    }
    if (b.dataset.act === 'rename') {
      const a = account();
      const r = await dialog({ title: 'Rinomina', okText: 'Salva', fields: [{ name: 'name', label: 'Nome', value: a.name, required: true }] });
      if (!r || !r.name.trim()) return;
      try { await S.db.updateAccount(a.id, { name: r.name.trim() }); a.name = r.name.trim(); renderShell(); } catch (err) { toast(errMsg(err), true); }
    }
  });
  host.appendChild(m);
}

function toggleUserMenu() {
  const host = $('#userBtn').parentElement;
  if ($('.menu', host)) return closeMenus();
  closeMenus();
  const m = document.createElement('div');
  m.className = 'menu right';
  m.innerHTML = `<div class="label">${esc(S.local ? 'Dati sul tuo PC' : (S.user && S.user.email))}</div><hr>
    <div class="label">Tema</div>
    ${Object.entries(THEMES).map(([id, t]) => `<button data-theme-pick="${id}" role="menuitemradio" aria-checked="${id === currentTheme()}">${id === currentTheme() ? '✓' : '<span style="width:12px"></span>'} ${t.name}</button>`).join('')}
    ${S.local ? '' : '<hr><button data-act="out">Esci</button>'}`;
  m.addEventListener('click', async (e) => {
    e.stopPropagation();
    const tp = e.target.closest('[data-theme-pick]');
    if (tp) { closeMenus(); chooseTheme(tp.dataset.themePick); return; }
    if (e.target.closest('[data-act="out"]')) { await S.db.signOut(); location.reload(); }
  });
  host.appendChild(m);
}

async function switchAccount(id) {
  S.accountId = id;
  try { localStorage.setItem('journal.account', id); } catch { /* niente */ }
  try { await loadAccountData(); } catch (err) { toast(errMsg(err), true); }
  startPoint();
  renderShell();
}
// date con trade: primo e ultimo giorno
function tradeRange() {
  if (!S.trades.length) return null;
  const d = S.trades.map((t) => t.trade_date).sort();
  return { first: d[0], last: d[d.length - 1] };
}
const monthOf = (key) => { const x = parseYmd(key); return new Date(x.getFullYear(), x.getMonth(), 1); };
// dove partono calendario, Reports e Progress: per un backtest dall'ultimo trade (dov'eri arrivato), altrimenti da oggi
function startPoint() {
  const a = account(), r = tradeRange(), now = new Date();
  const from = a && a.kind === 'backtest' && r ? parseYmd(r.last) : now;
  S.month = new Date(from.getFullYear(), from.getMonth(), 1);
  S.year = null; S.repMonth = null;
  S.pYear = from.getFullYear();
}

// selettore rapido di mese e anno: anno con le frecce, 12 mesi, salti a primo e ultimo trade
function openMonthPicker(anchor, { year, month = null, yearOnly = false, onPick }) {
  closeMenus();
  const pop = document.createElement('div');
  pop.className = 'menu picker';
  let y = year;
  const r = tradeRange();
  const years = [...new Set(S.trades.map((t) => Number(t.trade_date.slice(0, 4))))].sort();
  const monthPnl = (yy, m) => { const k = `${yy}-${pad(m + 1)}`; const l = S.trades.filter((t) => t.trade_date.startsWith(k) && t.status !== 'aperto'); return l.length ? { n: l.length, pnl: l.reduce((a, t) => a + t.pnl, 0) } : null; };
  const draw = () => {
    pop.innerHTML = yearOnly
      ? `<div class="label">Scegli l'anno</div><div class="pk-years">${(years.length ? years : [year]).map((yy) => `<button data-py="${yy}" class="${yy === year ? 'cur' : ''}">${yy}</button>`).join('')}</div>`
      : `<div class="pk-head"><button data-yy="-1" aria-label="Anno precedente">‹</button><b>${y}</b><button data-yy="1" aria-label="Anno successivo">›</button></div>
        <div class="pk-grid">${MONTHS_SHORT.map((n, m) => { const p = monthPnl(y, m); return `<button data-pm="${m}" class="${p ? 'has' : ''} ${y === year && m === month ? 'cur' : ''}" title="${MONTHS[m]} ${y}${p ? `: ${p.n} trade, ${moneyPlain(p.pnl)}` : ''}"><span>${n}</span>${p ? `<small class="${cls(p.pnl)}">${fmt(p.pnl, 0)}</small>` : '<small>&nbsp;</small>'}</button>`; }).join('')}</div>`;
    pop.innerHTML += `<hr><div class="pk-jump">
        ${r ? `<button data-jump="first">Primo trade <small>${itDate(r.first)}</small></button><button data-jump="last">Ultimo trade <small>${itDate(r.last)}</small></button>` : '<span class="muted small" style="padding:6px 10px">Ancora nessun trade</span>'}
        <button data-jump="today">Oggi</button></div>`;
  };
  draw();
  pop.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.yy) { y += Number(b.dataset.yy); draw(); return; }
    let target = null;
    if (b.dataset.pm) target = new Date(y, Number(b.dataset.pm), 1);
    if (b.dataset.py) target = new Date(Number(b.dataset.py), month ?? 0, 1);
    if (b.dataset.jump === 'first') target = monthOf(r.first);
    if (b.dataset.jump === 'last') target = monthOf(r.last);
    if (b.dataset.jump === 'today') target = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if (target) { closeMenus(); onPick(target); }
  });
  // posizione calcolata sullo spazio visibile: sotto il pulsante, mai fuori dallo schermo
  document.body.appendChild(pop);
  const ar = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, ar.left + ar.width / 2 - w / 2));
  const top = ar.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, ar.top - h - 6) : ar.bottom + 6;
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
  window.addEventListener('scroll', closeMenus, { once: true });
}

function renderPage() {
  if (S.page === 'settings') { renderSettings(); refreshSetupCounts().then(() => { if (S.page === 'settings') renderSettings(); }); }
  else if (S.page === 'news') renderNews();
  else if (S.page === 'reports') renderReports();
  else if (S.page === 'progress') renderProgress();
  else renderDashboard();
}
const PAGES = ['dashboard', 'reports', 'progress', 'news', 'settings'];
function goPage(p) {
  if (!PAGES.includes(p)) p = 'dashboard';
  if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p);
  S.page = p; if (p === 'news') S.newsCache = {}; renderShell(); window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => { const p = location.hash.slice(1); if (PAGES.includes(p) && p !== S.page && S.accountId) goPage(p); });

// =====================================================================
//  Dashboard
// =====================================================================
function stats(trades) {
  const closed = trades.filter((t) => t.status !== 'aperto');
  const wins = closed.filter((t) => t.pnl > 0), losses = closed.filter((t) => t.pnl < 0), be = closed.filter((t) => t.pnl === 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  return {
    n: closed.length, net: gw - gl, wins: wins.length, losses: losses.length, be: be.length,
    winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : null,
    expectancy: closed.length ? (gw - gl) / closed.length : null,
    avgWin: wins.length ? gw / wins.length : null, avgLoss: losses.length ? gl / losses.length : null,
    pf: gl ? gw / gl : (gw ? Infinity : null), gw, gl,
  };
}

function gauge(frac) {
  const r = 30, cx = 36, cy = 36, len = Math.PI * r;
  const f = frac == null ? 0 : frac;
  return `<svg width="72" height="42" viewBox="0 0 72 42" aria-hidden="true">
    <path d="M6 36 A30 30 0 0 1 66 36" fill="none" stroke="var(--track-loss)" stroke-width="7" stroke-linecap="round"/>
    <path class="arc-glow" style="color:var(--profit)" d="M6 36 A30 30 0 0 1 66 36" fill="none" stroke="var(--profit)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(len * f).toFixed(1)} ${len.toFixed(1)}" ${frac == null ? 'opacity="0"' : ''}/>
  </svg>`;
}
function ring(frac) {
  const r = 17, c = 2 * Math.PI * r, f = frac == null ? 0 : frac;
  return `<svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
    <circle cx="23" cy="23" r="${r}" fill="none" stroke="${frac == null ? 'var(--line-2)' : 'var(--ring-loss)'}" stroke-width="6"/>
    <circle class="arc-glow" style="color:var(--profit)" cx="23" cy="23" r="${r}" fill="none" stroke="var(--profit)" stroke-width="6" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 23 23)" ${frac == null ? 'opacity="0"' : ''}/>
  </svg>`;
}

function renderDashboard() {
  const page = $('#page');
  const open = S.trades.filter((t) => t.status === 'aperto');
  page.innerHTML = `
    ${open.length ? `<div class="card" style="padding:12px 18px;border-color:var(--open-line)">Trade aperto: ${open.map((t) => `<b>${esc(t.symbol || '—')} ${esc(t.direction)}</b> del ${itDate(t.trade_date)}`).join(', ')}. Si chiude dalla barra di Trade Logger o aprendo il giorno.</div>` : ''}
    ${kpisHTML(S.trades)}
    <section class="card" id="calCard"></section>
    <section class="card" id="logCard"></section>
    <section class="card" id="eqCard"></section>`;
  renderCalendar(); renderLog(); renderEquity();
}

function dayMap() {
  const m = {};
  S.trades.forEach((t) => { const d = (m[t.trade_date] = m[t.trade_date] || { pnl: 0, n: 0 }); if (t.status !== 'aperto') d.pnl += t.pnl; d.n++; });
  return m;
}

function renderCalendar() {
  const card = $('#calCard');
  const y = S.month.getFullYear(), mo = S.month.getMonth();
  const first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const rows = Math.ceil((offset + days) / 7);
  const dm = dayMap();
  const inMonth = Object.entries(dm).filter(([d]) => d.startsWith(`${y}-${pad(mo + 1)}`));
  const maxAbs = Math.max(1, ...inMonth.map(([, v]) => Math.abs(v.pnl)));
  const today = ymd(new Date());
  const monthTotal = inMonth.reduce((s, [, v]) => s + v.pnl, 0);
  let cells = DOW.map((d) => `<div class="dow">${d}</div>`).join('') + '<div class="dow wk">Settimana</div>';
  for (let r = 0; r < rows; r++) {
    let wPnl = 0, wN = 0;
    for (let c = 0; c < 7; c++) {
      const date = new Date(y, mo, 1 - offset + r * 7 + c);
      const key = ymd(date), out = date.getMonth() !== mo, d = dm[key];
      if (!out && d) { wPnl += d.pnl; wN += d.n; }
      let bg = '';
      if (!out && d && d.pnl !== 0) {
        const a = (0.12 + 0.42 * Math.abs(d.pnl) / maxAbs).toFixed(2);
        bg = `background:${d.pnl > 0 ? `rgba(var(--rgb-profit),${a})` : `rgba(var(--rgb-loss),${a})`}`;
      } else if (!out && d) bg = 'background:rgba(var(--rgb-neutral),.12)';
      cells += out
        ? `<div class="day out"><span class="n">${date.getDate()}</span></div>`
        : `<button class="day ${key === today ? 'today' : ''}" data-day="${key}" style="${bg}" aria-label="${date.getDate()} ${MONTHS[mo]}${d ? ', ' + money(d.pnl) : ''}">
            <span class="n">${date.getDate()}</span>
            ${(() => { const nm = (newsByDay(y, mo)[key] || []); return nm.length ? `<span class="nw" title="${esc(nm.map((e) => `${timeOf(e)} ${e.currency} ${e.title}`).join('\n'))}"><i></i>${nm.length}</span>` : ''; })()}
            ${(() => { const h = holidayOf(key); return h ? `<span class="hol ${h.closed ? 'closed' : ''}" title="${esc(h.name)}: ${h.closed ? 'borsa USA chiusa' : 'banche USA chiuse, borsa aperta'}">${h.closed ? 'Borsa chiusa' : 'Bank holiday'}</span>` : ''; })()}
            ${d ? `<span class="p ${cls(d.pnl)}"><span class="full">${moneyPlain(d.pnl)}</span><span class="short">${d.pnl < 0 ? '−' : ''}${fmt(Math.abs(d.pnl), 0)}</span></span>` : ''}
            <span class="c">${d ? `${d.n} <span class="t">trade</span>` : ''}${S.notes[key] ? '<i class="note-dot" title="Analisi della giornata"></i>' : ''}</span>
          </button>`;
    }
    cells += `<div class="wk"><span class="t">Sett. ${r + 1}</span><span class="v ${cls(wPnl)}">${moneyPlain(wPnl)}</span><span class="c">${wN} trade</span></div>`;
  }
  card.innerHTML = `
    <div class="card-head"><h2>Calendario P/L</h2><div class="grow"></div>
      <span class="muted" style="font-size:13px">Mese: <b class="${cls(monthTotal)}">${moneyPlain(monthTotal)}</b></span>
      <div class="cal-nav"><button class="btn ghost icon" data-m="-1" aria-label="Mese precedente">‹</button><button class="month-btn" data-pick title="Scegli mese e anno">${MONTHS[mo]} ${y} <span aria-hidden="true">▾</span></button><button class="btn ghost icon" data-m="1" aria-label="Mese successivo">›</button></div>
      ${tradeRange() ? '<button class="btn" data-last title="Vai al mese dell\'ultimo trade">Ultimo trade</button>' : ''}
      <button class="btn" data-m="0" title="Torna al mese corrente">Oggi</button>
    </div>
    <div class="cal">${cells}</div>
    <div class="legend"><span><i style="background:var(--profit)"></i>Positivo</span><span><i style="background:var(--loss)"></i>Negativo</span><span><i style="background:var(--accent)"></i>Analisi scritta</span><span><i style="background:var(--gold)"></i>Festivo USA (passa sopra per il nome)</span><span><i style="background:var(--loss)"></i>Notizie ad alto impatto (passa sopra per l'elenco)</span><span>Più il colore è intenso, più il giorno è stato grande nel mese.</span></div>`;
  // notizie del mese: se non sono ancora in memoria le leggo e ridisegno il calendario una volta sola
  if (!S.newsCache[`${y}-${pad(mo + 1)}`]) ensureNews(y, mo).then((ev) => { if (ev.length && S.page === 'dashboard' && S.month.getFullYear() === y && S.month.getMonth() === mo) renderCalendar(); });
  card.onclick = (e) => {
    const m = e.target.closest('[data-m]');
    if (m) { const k = Number(m.dataset.m); S.month = k === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(y, mo + k, 1); renderCalendar(); return; }
    if (e.target.closest('[data-last]')) { S.month = monthOf(tradeRange().last); renderCalendar(); return; }
    const pk = e.target.closest('[data-pick]');
    if (pk) { e.stopPropagation(); openMonthPicker(pk, { year: y, month: mo, onPick: (t) => { S.month = t; renderCalendar(); } }); return; }
    const d = e.target.closest('[data-day]'); if (d) openDay(d.dataset.day);
  };
}

function renderLog() {
  const card = $('#logCard');
  const list = [...S.trades].sort(sortTrades).reverse();
  const shown = S.logAll ? list : list.slice(0, 10);
  card.innerHTML = `<div class="card-head"><h2>Trade log</h2><div class="grow"></div><span class="muted" style="font-size:13px">${list.length} trade</span></div>
    ${list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Orario</th><th>Simbolo</th><th>Direzione</th><th>Setup</th><th class="r">P&amp;L</th><th class="r">R</th><th>Note</th><th></th></tr></thead>
      <tbody>${shown.map((t) => `<tr>
        <td>${itDate(t.trade_date)}${t.starred ? ' <span class="star on" title="Preferito">★</span>' : ''}</td>
        <td>${esc(t.trade_time)}</td><td><b>${esc(t.symbol)}</b></td>
        <td class="dir-${esc(t.direction)}">${t.direction === 'LONG' ? 'Long' : t.direction === 'SHORT' ? 'Short' : ''}</td>
        <td>${esc(t.setup)}</td>
        <td class="r ${cls(t.pnl)}"><b>${t.status === 'aperto' ? '<span class="muted">aperto</span>' : money(t.pnl)}</b></td>
        <td class="r ${cls(rOf(t))}">${fmtR(rOf(t))}</td>
        <td class="note" title="${esc(t.notes)}">${esc(t.notes)}</td>
        <td class="r"><button class="btn" data-open="${t.id}" data-day="${t.trade_date}">Apri</button></td></tr>`).join('')}</tbody></table></div>
      ${list.length > 10 ? `<div class="table-foot"><span>Mostrati ${shown.length} di ${list.length}</span><button class="btn ghost" data-all>${S.logAll ? 'Mostra meno' : 'Mostra tutti'}</button></div>` : ''}`
    : '<div class="empty">Ancora nessun trade. Clicca un giorno nel calendario per aggiungerne uno, oppure usa Trade Logger.</div>'}`;
  card.onclick = (e) => {
    if (e.target.closest('[data-all]')) { S.logAll = !S.logAll; renderLog(); return; }
    const b = e.target.closest('[data-open]'); if (b) openDay(b.dataset.day, b.dataset.open);
  };
}

function niceStep(range) { const raw = range / 4, p = 10 ** Math.floor(Math.log10(raw || 1)), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

function renderEquity() {
  const card = $('#eqCard');
  const list = S.trades.filter((t) => t.status !== 'aperto').sort(sortTrades);
  const final = list.reduce((a, t) => a + t.pnl, 0);
  card.innerHTML = `<div class="card-head"><h2>Curva equity</h2><div class="grow"></div>${list.length ? `<b class="${cls(final)}">${moneyPlain(final)}</b>` : ''}</div>${equityBody(list)}`;
  card.onclick = (e) => { const c = e.target.closest('[data-open]'); if (c) openDay(c.dataset.day, c.dataset.open); };
}

// curva equity: P&L cumulato trade dopo trade (usata in Dashboard e Reports)
function equityBody(list) {
  if (!list.length) return '<div class="empty">Nessun trade chiuso per disegnare la curva.</div>';
  let cum = 0;
  const pts = [{ v: 0, t: null }, ...list.map((t) => ({ v: (cum += t.pnl), t }))];
  const W = 1000, H = 280, L = 64, R = 16, T = 16, B = 34;
  let lo = Math.min(0, ...pts.map((p) => p.v)), hi = Math.max(0, ...pts.map((p) => p.v));
  if (hi === lo) hi = lo + 100;
  const step = niceStep(hi - lo); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = (i) => L + (W - L - R) * (pts.length === 1 ? 0 : i / (pts.length - 1));
  const yv = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${yv(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${yv(lo).toFixed(1)} L${x(0).toFixed(1)} ${yv(lo).toFixed(1)} Z`;
  const final = pts[pts.length - 1].v, col = final >= 0 ? 'var(--profit)' : 'var(--loss)';
  const gid = 'eqg' + Math.random().toString(36).slice(2, 7);
  let grid = '';
  for (let v = lo; v <= hi + 1e-9; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${yv(v)}" y2="${yv(v)}" stroke="${v === 0 ? 'var(--grid-strong)' : 'var(--grid)'}" stroke-dasharray="${v === 0 ? '' : '3 4'}"/><text x="${L - 8}" y="${yv(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="12">${fmt(v, 0)}</text>`;
  const labelsN = Math.min(6, pts.length - 1);
  let xl = `<text x="${x(0)}" y="${H - 10}" fill="var(--muted)" font-size="12" text-anchor="start">Inizio</text>`;
  for (let k = 1; k <= labelsN; k++) { const i = Math.round(k * (pts.length - 1) / labelsN); const t = pts[i].t; xl += `<text x="${x(i)}" y="${H - 10}" fill="var(--muted)" font-size="12" text-anchor="${k === labelsN ? 'end' : 'middle'}">${itDate(t.trade_date).slice(0, 5)}</text>`; }
  const dots = pts.slice(1).map((p, j) => `<circle cx="${x(j + 1)}" cy="${yv(p.v)}" r="${pts.length > 60 ? 5 : 4}" fill="${p.t.pnl >= 0 ? 'var(--profit)' : 'var(--loss)'}" ${pts.length > 60 ? 'fill-opacity="0"' : 'stroke="var(--panel)" stroke-width="2"'} data-open="${p.t.id}" data-day="${p.t.trade_date}" style="cursor:pointer"><title>${itDate(p.t.trade_date)} ${esc(p.t.symbol)}: ${money(p.t.pnl)} (totale ${moneyPlain(p.v)})</title></circle>`).join('');
  return `<div class="equity"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Curva equity">
      <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${final >= 0 ? 'var(--profit)' : 'var(--loss)'}" stop-opacity=".28"/><stop offset="1" stop-color="${final >= 0 ? 'var(--profit)' : 'var(--loss)'}" stop-opacity="0"/></linearGradient></defs>
      ${grid}<path d="${area}" fill="url(#${gid})"/><path class="eq-line" style="color:${col}" d="${line}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>${dots}${xl}
    </svg><div class="hint">Passa sopra un punto per i dettagli, cliccalo per aprire il trade.</div></div>`;
}

// barre con segno (P&L per mese, per giorno): verdi sopra lo zero, rosse sotto
function barsSVG(items, { height = 240, labelEvery = 1, cumulative = false, w = 1000 } = {}) {
  // items: [{ label, value, title, day? }]
  const W = w, H = height, L = 64, R = 12, T = 14, B = 30;
  const vals = items.map((i) => i.value || 0);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi === lo) hi = lo + 100;
  const step = niceStep(hi - lo); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const yv = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const slot = (W - L - R) / Math.max(1, items.length), bw = Math.max(3, Math.min(46, slot * 0.62));
  let g = '';
  for (let v = lo; v <= hi + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${yv(v)}" y2="${yv(v)}" stroke="${v === 0 ? 'var(--grid-strong)' : 'var(--grid)'}" stroke-dasharray="${v === 0 ? '' : '3 4'}"/><text x="${L - 8}" y="${yv(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="12">${fmt(v, 0)}</text>`;
  items.forEach((it, i) => {
    const cx = L + slot * i + slot / 2, v = it.value || 0;
    if (it.value !== null && it.value !== undefined && (v !== 0 || cumulative)) {
      const y0 = yv(0), y1 = yv(v);
      g += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" rx="3" fill="${v >= 0 ? 'var(--profit)' : 'var(--loss)'}" ${it.day ? `data-day="${it.day}" style="cursor:pointer"` : ''}><title>${esc(it.title || it.label)}: ${moneyPlain(v)}</title></rect>`;
    }
    if (i % labelEvery === 0) g += `<text x="${cx.toFixed(1)}" y="${H - 9}" text-anchor="middle" fill="var(--muted)" font-size="12">${esc(it.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" style="display:block;width:100%;height:auto">${g}</svg>`;
}

// =====================================================================
//  Finestra del giorno
// =====================================================================
let D = null;   // stato della finestra aperta
const dayTrades = () => S.trades.filter((t) => t.trade_date === D.day);
const tradeById = (id) => S.trades.find((t) => t.id === id);

// tutti i setup noti: quelli dell'elenco, quelli già usati nei trade e quello del trade stesso
function allSetups(extra) {
  const set = new Set([...(S.settings.setups || []), ...Object.keys(S.setupCounts || {})]);
  S.trades.forEach((t) => { if (t.setup) set.add(t.setup); });
  if (extra) set.add(extra);
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, 'it'));
}
function setupOptions(cur) {
  return `<option value="">— nessuno —</option>${allSetups(cur).map((x) => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('')}<option value="__new">+ Nuovo setup…</option>`;
}
function lists() {
  const sym = new Set(['NQ', 'MNQ', 'ES', 'MES', 'YM', 'EURUSD', 'GBPUSD', 'XAUUSD']);
  const set = new Set([...(S.settings.setups || []), ...Object.keys(S.setupCounts || {})]);
  S.trades.forEach((t) => { if (t.symbol) sym.add(t.symbol); if (t.setup) set.add(t.setup); });
  return `<datalist id="symList">${[...sym].map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    <datalist id="setupList">${[...set].map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`;
}

function outcomeValue(t) { return t.status === 'aperto' ? 'APERTO' : (t.outcome || ''); }

function cardHTML(t, i) {
  const allTags = [...new Set([...tagsAvailable(), ...t.tags])];
  const hasPrices = t.entry != null || t.sl != null || t.tp != null || t.contracts != null || t.sl_usd != null || t.tp_usd != null || t.outcome || t.status === 'aperto';
  const v = (x) => (x == null ? '' : String(x).replace('.', ','));
  return `<article class="tcard ${D.active === t.id ? 'active' : ''}" data-id="${t.id}">
    <div class="tcard-head">
      <span class="title">Trade ${i + 1}</span>
      ${t.source === 'trade-logger' ? '<span class="src" title="Registrato in automatico dalla barra">da Trade Logger</span>' : ''}
      ${t.status === 'aperto' ? '<span class="src" style="color:var(--accent);border-color:var(--accent)">aperto</span>' : ''}
      ${rOf(t) != null ? `<span class="rchip ${cls(rOf(t))}" title="Risultato diviso per il rischio a stop">${fmtR(rOf(t))}</span>` : ''}
      <span class="grow"></span>
      <button class="btn ghost icon" data-share title="Condividi come post (Instagram e altri social)" aria-label="Condividi come post"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg></button>
      <button class="btn ghost icon star ${t.starred ? 'on' : ''}" data-star title="Segna come preferito" aria-pressed="${t.starred}">★</button>
      <button class="btn ghost icon" data-deltrade title="Elimina il trade" aria-label="Elimina il trade">🗑</button>
    </div>
    <div class="tcard-body">
      <div class="grid5">
        <label class="field"><span>P&amp;L ($)</span><input class="input pnl ${cls(t.pnl)}" data-f="pnl" inputmode="decimal" value="${t.pnl ? v(t.pnl) : ''}" placeholder="0"></label>
        <label class="field"><span>Simbolo</span><input class="input" data-f="symbol" list="symList" value="${esc(t.symbol)}" placeholder="NQ" autocapitalize="characters"></label>
        <label class="field"><span>Direzione</span><select class="input" data-f="direction"><option value="">—</option><option value="LONG" ${t.direction === 'LONG' ? 'selected' : ''}>Long</option><option value="SHORT" ${t.direction === 'SHORT' ? 'selected' : ''}>Short</option></select></label>
        <label class="field"><span>Orario</span><input class="input" type="time" data-f="trade_time" value="${esc(t.trade_time)}"></label>
        <label class="field setup"><span>Setup</span><select class="input" data-f="setup">${setupOptions(t.setup)}</select><input class="input" data-newsetup placeholder="Nome del nuovo setup (Invio)" hidden></label>
      </div>
      <details class="more" ${hasPrices ? 'open' : ''}><summary>Prezzi ed esito</summary>
        <div class="grid5b">
          <label class="field"><span>Ingresso</span><input class="input" data-f="entry" inputmode="decimal" value="${v(t.entry)}"></label>
          <label class="field"><span>Stop loss</span><input class="input" data-f="sl" inputmode="decimal" value="${v(t.sl)}"></label>
          <label class="field"><span>Take profit</span><input class="input" data-f="tp" inputmode="decimal" value="${v(t.tp)}"></label>
          <label class="field"><span>Contratti / lotti</span><input class="input" data-f="contracts" inputmode="decimal" value="${v(t.contracts)}"></label>
          ${S.money ? `<label class="field"><span>Valore TP ($)</span><input class="input" data-f="tp_usd" inputmode="decimal" value="${v(t.tp_usd)}" placeholder="+728"></label>
          <label class="field"><span>Valore SL ($)</span><input class="input" data-f="sl_usd" inputmode="decimal" value="${v(t.sl_usd)}" placeholder="−496"></label>` : ''}
          <label class="field"><span>Esito</span><select class="input" data-f="outcome">
            ${[['', '—'], ['TP', 'Take profit'], ['SL', 'Stop loss'], ['MANUALE', 'Chiuso a mano'], ['APERTO', 'Ancora aperto']].map(([k, l]) => `<option value="${k}" ${outcomeValue(t) === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
        </div>
      </details>
      <div>
        <div class="sec-t">Grafici e screenshot</div>
        <div class="shots">
          ${t.trade_images.map((img) => `<div class="shot">
            <img src="${esc(D.urls[img.path] || '')}" alt="${esc(img.timeframe || 'Screenshot')}" data-img="${img.id}" loading="lazy">
            <div class="tf"><input data-imgtf="${img.id}" value="${esc(img.timeframe)}" placeholder="Timeframe o nota" aria-label="Timeframe"><button class="del" data-imgdel="${img.id}" title="Elimina immagine" aria-label="Elimina immagine">✕</button></div>
          </div>`).join('')}
          <div class="drop" data-drop tabindex="0" role="button" aria-label="Aggiungi immagine">
            <span>📷</span><span class="pc"><b>Incolla con Ctrl+V</b>, trascina qui un'immagine oppure clicca per sceglierla</span><span class="phone"><b>Tocca per aggiungere una foto</b></span>
            <span class="uploading" data-uploading hidden>Caricamento…</span>
          </div>
        </div>
      </div>
      <div>
        <div class="sec-t">Tag</div>
        <div class="chips">${allTags.map((g) => `<button class="chip ${t.tags.includes(g) ? 'on' : ''}" data-tag="${esc(g)}" aria-pressed="${t.tags.includes(g)}">${esc(g)}</button>`).join('')}</div>
        <div class="chip-add"><input class="input" data-newtag placeholder="Nuovo tag personalizzato" aria-label="Nuovo tag"><button class="btn" data-addtag>Aggiungi</button></div>
      </div>
      <div>
        <div class="sec-t">Emozioni</div>
        <div class="chips">${EMOTIONS.map((g) => `<button class="chip emo ${t.emotions.includes(g) ? 'on' : ''}" data-emo="${esc(g)}" aria-pressed="${t.emotions.includes(g)}">${esc(g)}</button>`).join('')}</div>
      </div>
      <label class="field"><span>Note</span><textarea class="input" data-f="notes" placeholder="Perché sei entrato, come l'hai gestito, cosa rifaresti">${esc(t.notes)}</textarea></label>
    </div>
  </article>`;
}

function renderDayBody() {
  const body = $('#dayBody', D.el);
  const trades = dayTrades();
  body.innerHTML = '<div id="dayNews"></div>' + lists() + (trades.length ? trades.map(cardHTML).join('')
    : `<div class="empty" style="padding:28px">Nessun trade in questo giorno.<br><br><button class="btn primary" data-add>+ Aggiungi trade</button></div>`)
    + `<div class="daynote"><div class="review"><span class="muted small">Revisione guidata</span><span class="rv-q">Hai rispettato le tue regole?</span>${['Sì', 'In parte', 'No'].map((a) => `<button class="btn rv" data-review="${a}">${a}</button>`).join('')}</div><label class="field"><span>Analisi della giornata</span><textarea class="input" data-daynote placeholder="Com'è andata la giornata nel complesso, cosa hai visto sul mercato">${esc(S.notes[D.day] || '')}</textarea></label></div>`;
  updateDaySum();
  fillDayNews();
}
async function fillDayNews() {
  const box = D && $('#dayNews', D.el); if (!box) return;
  const day = D.day, d = parseYmd(day);
  const ev = (await ensureNews(d.getFullYear(), d.getMonth())).filter((e) => e.day === day && e.impact === 'High' && newsCurrencies().includes(e.currency));
  if (!D || D.day !== day || !$('#dayNews', D.el)) return;
  $('#dayNews', D.el).innerHTML = ev.length ? `<div class="daynews"><span class="muted small">Notizie ad alto impatto (${esc(newsCurrencies().join(', '))})</span>${ev.map((e) => `<div class="dn-row"><span class="dn-t">${timeOf(e)}</span><b>${esc(e.currency)}</b><span>${esc(e.title)}</span><span class="muted small">${e.previous ? 'precedente ' + esc(e.previous) : ''}${e.forecast ? ' · previsto ' + esc(e.forecast) : ''}${e.actual ? ' · effettivo ' + esc(e.actual) : ''}</span></div>`).join('')}</div>` : '';
}
function renderCard(id) {
  const el = $(`.tcard[data-id="${id}"]`, D.el), t = tradeById(id);
  if (!el || !t) return renderDayBody();
  const i = dayTrades().indexOf(t);
  const tmp = document.createElement('div'); tmp.innerHTML = cardHTML(t, i);
  el.replaceWith(tmp.firstElementChild);
}
function updateDaySum() {
  const tot = dayTrades().filter((t) => t.status !== 'aperto').reduce((s, t) => s + t.pnl, 0);
  const n = dayTrades().length;
  $('#daySum', D.el).innerHTML = n ? `<span class="${cls(tot)}">${moneyPlain(tot)}</span> <span class="muted" style="font-weight:400">${n} trade</span>` : '';
}
function setSave(text, err = false) { const s = D && $('#saveState', D.el); if (s) { s.textContent = text; s.classList.toggle('err', err); } }
function setActive(id) {
  if (D.active === id) return;
  D.active = id;
  $$('.tcard', D.el).forEach((c) => c.classList.toggle('active', c.dataset.id === id));
}

let behindTimer = null;
function refreshBehind() { clearTimeout(behindTimer); behindTimer = setTimeout(() => { if ($('#page')) renderPage(); }, 250); }

const TRADE_FIELDS_BASE = ['pnl', 'symbol', 'direction', 'trade_time', 'setup', 'entry', 'sl', 'tp', 'contracts', 'outcome', 'status', 'tags', 'emotions', 'notes', 'starred'];
function schedule(id, delay = 600) {
  clearTimeout(D.timers[id]);
  setSave('Salvataggio…');
  D.timers[id] = setTimeout(() => flushTrade(id), delay);
}
async function flushTrade(id) {
  if (!D) return;
  clearTimeout(D.timers[id]); delete D.timers[id];
  const t = tradeById(id); if (!t) return;
  const patch = {}; [...TRADE_FIELDS_BASE, ...(S.money ? ['sl_usd', 'tp_usd'] : [])].forEach((k) => { patch[k] = t[k]; });
  patch.pnl = patch.pnl || 0;
  try { await S.db.updateTrade(id, patch); if (D) setSave('Salvato ✓'); refreshBehind(); }
  catch (e) { if (D) setSave('Errore nel salvataggio: ' + errMsg(e), true); }
}
function scheduleNote() {
  clearTimeout(D.noteTimer); setSave('Salvataggio…');
  D.noteTimer = setTimeout(flushNote, 700);
}
async function flushNote() {
  if (!D || D.noteValue === undefined) return;
  clearTimeout(D.noteTimer);
  const v = D.noteValue; delete D.noteValue;
  try {
    if (v.trim()) { await S.db.saveDayNote(S.accountId, D.day, v); S.notes[D.day] = v; }
    else { await S.db.deleteDayNote(S.accountId, D.day); delete S.notes[D.day]; }
    if (D) setSave('Salvato ✓'); refreshBehind();
  } catch (e) { if (D) setSave('Errore nel salvataggio: ' + errMsg(e), true); }
}

async function loadUrls(trades) {
  const paths = trades.flatMap((t) => t.trade_images.map((i) => i.path)).filter((p) => !D.urls[p]);
  if (!paths.length) return;
  try { Object.assign(D.urls, await S.db.imageUrls(paths)); } catch (e) { toast('Non riesco a caricare le immagini: ' + errMsg(e), true); }
}

// =====================================================================
//  Vista a colpo d'occhio di un trade: screenshot grandi, dati, setup, tag e note in una sola finestra, senza scorrere.
//  Frecce ai lati per passare da un trade all'altro dello stesso giorno. "Modifica" apre la finestra di modifica.
// =====================================================================
let V = null;   // stato della vista aperta: { day, id, urls, el }
const outcomeLabel = (t) => (t.status === 'aperto' ? 'Aperto' : ({ TP: 'Take profit', SL: 'Stop loss', MANUALE: 'Chiuso a mano' }[t.outcome] || ''));
const vTrades = () => S.trades.filter((t) => t.trade_date === V.day);
const vnum = (x) => (x == null ? '' : String(x).replace('.', ','));

async function openDay(day, focusId) {            // punto d'ingresso unico: chi apre un giorno vede prima la vista, la modifica è un passo in più
  closeMenus();
  if (V) closeTradeView();
  if (D) await closeDay();
  if (S.trades.some((t) => t.trade_date === day)) return openTradeView(day, focusId);
  return openDayEdit(day, focusId);               // giorno vuoto: si parte dalla finestra di modifica per aggiungere un trade
}

function tradeViewHTML() {
  const list = vTrades(), n = list.length, i = Math.max(0, list.findIndex((t) => t.id === V.id)), t = list[i];
  const imgs = t.trade_images, shown = imgs.slice(0, 4), more = imgs.length - shown.length;
  const date = parseYmd(V.day).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const r = rOf(t), oc = outcomeLabel(t);
  const row = (k, v) => (v === '' || v == null ? '' : `<div class="tv-kv"><span>${k}</span><b>${esc(v)}</b></div>`);
  const prices = [row('Ingresso', vnum(t.entry)), row('Stop loss', vnum(t.sl)), row('Take profit', vnum(t.tp)), row('Contratti', vnum(t.contracts)),
    S.money ? row('Valore TP', t.tp_usd != null ? moneyPlain(t.tp_usd) : '') : '', S.money ? row('Valore SL', t.sl_usd != null ? moneyPlain(t.sl_usd) : '') : ''].join('');
  const chips = (arr, extra = '') => (arr.length ? arr.map((x) => `<span class="chip on ${extra}">${esc(x)}</span>`).join('') : '<span class="muted small">—</span>');
  return `<button class="tv-arrow prev" data-tvmove="-1" aria-label="Trade precedente" ${n > 1 ? '' : 'hidden'}>‹</button>
  <button class="tv-arrow next" data-tvmove="1" aria-label="Trade successivo" ${n > 1 ? '' : 'hidden'}>›</button>
  <div class="tv-win" role="dialog" aria-modal="true" aria-label="Trade">
    <div class="tv-head">
      <div class="tv-title"><b>${esc(date)}</b><span class="muted">Trade ${i + 1} di ${n}${t.status === 'aperto' ? ' · aperto' : ''}${t.source === 'trade-logger' ? ' · da Trade Logger' : ''}</span></div>
      <span class="grow"></span>
      ${S.local && V.replay && V.replay[t.id] ? '<button class="btn" data-tvreplay title="Rivedi le candele dall\'apertura alla chiusura">▶ Replay <span class="beta">beta</span></button>' : ''}
      <button class="btn primary" data-tvedit>✎ Modifica</button>
      <button class="btn ghost icon" data-tvclose aria-label="Chiudi">✕</button>
    </div>
    <div class="tv-info">
      <div class="tv-row">
        <div class="tv-result">
          <div class="tv-pnl ${t.status === 'aperto' ? '' : cls(t.pnl)}">${t.status === 'aperto' ? 'Aperto' : money(t.pnl)}</div>
          <div class="tv-pills">${oc && t.status !== 'aperto' ? `<span class="pill ${esc(t.outcome || '')}">${esc(oc)}</span>` : ''}${r != null ? `<span class="rchip ${cls(r)}">${fmtR(r)}</span>` : ''}${t.starred ? '<span class="tv-star" title="Preferito">★</span>' : ''}</div>
        </div>
        <div class="tv-line"><b>${esc(t.symbol || '—')}</b>${t.direction ? `<span class="dir ${t.direction === 'LONG' ? 'long' : 'short'}">${t.direction === 'LONG' ? 'Long' : 'Short'}</span>` : ''}<span class="muted">${esc(t.trade_time || '')}</span></div>
        ${prices ? `<div class="tv-kvs">${prices}</div>` : ''}
      </div>
      <div class="tv-row tv-row2">
        <div class="tv-sec"><div class="sec-t">Setup</div>${t.setup ? `<span class="chip on">${esc(t.setup)}</span>` : '<span class="muted small">—</span>'}</div>
        <div class="tv-sec"><div class="sec-t">Tag</div><div class="chips">${chips(t.tags)}</div></div>
        ${t.emotions.length ? `<div class="tv-sec"><div class="sec-t">Emozioni</div><div class="chips">${chips(t.emotions, 'emo')}</div></div>` : ''}
        <div class="tv-sec tv-notes"><div class="sec-t">Note</div>${t.notes ? `<p>${esc(t.notes)}</p>` : '<p class="muted">Nessuna nota. Premi Modifica per scriverne una.</p>'}</div>
      </div>
    </div>
    <div class="tv-shots n${Math.max(1, shown.length)}">
      ${shown.length ? shown.map((im) => `<figure class="tv-shot"><img src="${esc(V.urls[im.path] || '')}" alt="${esc(im.timeframe || 'Screenshot')}" data-tvimg="${esc(im.id)}">${im.timeframe ? `<figcaption>${esc(im.timeframe)}</figcaption>` : ''}</figure>`).join('')
        : '<div class="tv-noshot"><span>📷</span>Nessuno screenshot per questo trade.<br><span class="muted small">Premi Modifica per aggiungerne.</span></div>'}
      ${more > 0 ? `<button class="tv-more" data-tvimg="${esc(imgs[4].id)}">+${more} altre</button>` : ''}
    </div>
  </div>`;
}
function renderTradeView() { V.el.innerHTML = tradeViewHTML(); }
async function openTradeView(day, focusId) {
  const list = S.trades.filter((t) => t.trade_date === day); if (!list.length) return openDayEdit(day, focusId);
  if (V) closeTradeView();
  V = { day, id: (list.find((t) => t.id === focusId) || list[0]).id, urls: {}, replay: {}, el: null };
  const ov = document.createElement('div'); ov.className = 'overlay tv'; ov.id = 'tvOverlay'; V.el = ov;
  document.body.appendChild(ov); document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onTvKey);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeTradeView(); });
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('button, img[data-tvimg]'); if (!b) return;
    if (b.matches('[data-tvclose]')) return closeTradeView();
    if (b.matches('[data-tvmove]')) return tvMove(Number(b.dataset.tvmove));
    if (b.matches('[data-tvedit]')) return tvEdit();
    if (b.matches('[data-tvreplay]')) return openReplay(tradeById(V.id));
    if (b.dataset.tvimg) { const t = tradeById(V.id); if (t) openViewer(t, b.dataset.tvimg); }
  });
  const paths = list.flatMap((t) => (t.trade_images || []).map((x) => x.path)).filter(Boolean);
  renderTradeView();
  if (S.local) S.db.call('replayInfo', { ids: list.map((t) => t.id) }).then((m) => { if (V && V.el === ov) { V.replay = m || {}; renderTradeView(); } }).catch(() => {});
  if (paths.length) {
    try { Object.assign(V.urls, await S.db.imageUrls(paths)); } catch (e) { toast('Non riesco a caricare le immagini: ' + errMsg(e), true); }
    if (V && V.el === ov) renderTradeView();
  }
}

// ---------- Replay (beta): i fotogrammi registrati da Trade Logger, in sequenza ----------
async function openReplay(t) {
  if (!t || $('.rp')) return;
  let urls = [];
  try { urls = await S.db.call('replayFrames', { id: t.id }); } catch (e) { return toast('Non riesco a caricare il replay: ' + errMsg(e), true); }
  if (!urls.length) return toast('Questo trade non ha fotogrammi registrati.', true);
  const ov = document.createElement('div'); ov.className = 'overlay rp';
  ov.innerHTML = `<div class="rp-win" role="dialog" aria-modal="true" aria-label="Replay del trade">
    <div class="rp-head"><b>${esc(t.symbol || 'Trade')}${t.direction ? ' ' + (t.direction === 'LONG' ? 'Long' : 'Short') : ''}</b><span class="muted">Replay <span class="beta">beta</span></span><span class="grow"></span>
      <button class="btn ghost icon" data-rpclose aria-label="Chiudi">✕</button></div>
    <div class="rp-stage"><img alt="Fotogramma del replay"></div>
    <div class="rp-bar">
      <button class="btn" data-rpplay aria-label="Avvia o metti in pausa">⏸</button>
      <input type="range" min="0" max="${urls.length - 1}" value="0" data-rpseek aria-label="Posizione">
      <span class="rp-count muted small"></span>
      <select data-rpspeed aria-label="Velocità"><option value="3">0,5×</option><option value="6" selected>1×</option><option value="12">2×</option><option value="24">4×</option><option value="48">8×</option></select>
    </div></div>`;
  document.body.appendChild(ov);
  const img = ov.querySelector('img'), seek = ov.querySelector('[data-rpseek]'), cnt = ov.querySelector('.rp-count'), pb = ov.querySelector('[data-rpplay]'), sp = ov.querySelector('[data-rpspeed]');
  let i = 0, playing = true, timer = null;
  urls.forEach((u) => { const p = new Image(); p.src = u; });           // li carico in anticipo per una riproduzione fluida
  const show = (k) => { i = Math.max(0, Math.min(urls.length - 1, k)); img.src = urls[i]; seek.value = i; cnt.textContent = `${i + 1} / ${urls.length}`; };
  const stop = () => { playing = false; clearInterval(timer); pb.textContent = '▶'; };
  const play = () => {
    if (i >= urls.length - 1) show(0);
    playing = true; pb.textContent = '⏸'; clearInterval(timer);
    timer = setInterval(() => { if (i >= urls.length - 1) return stop(); show(i + 1); }, 1000 / Number(sp.value));
  };
  const close = () => { clearInterval(timer); document.removeEventListener('keydown', onKey, true); ov.remove(); };
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === ' ') { e.preventDefault(); playing ? stop() : play(); }
    else if (e.key === 'ArrowLeft') { stop(); show(i - 1); }
    else if (e.key === 'ArrowRight') { stop(); show(i + 1); }
  }
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.matches('[data-rpclose]')) close(); else if (b.matches('[data-rpplay]')) { playing ? stop() : play(); } });
  seek.addEventListener('input', () => { stop(); show(Number(seek.value)); });
  sp.addEventListener('change', () => { if (playing) play(); });
  show(0); play();
}
function tvMove(k) {
  const list = vTrades(); if (list.length < 2) return;
  const i = list.findIndex((t) => t.id === V.id);
  V.id = list[(i + k + list.length) % list.length].id; renderTradeView();
}
function tvEdit() { const day = V.day, id = V.id; closeTradeView(); openDayEdit(day, id, true); }
function closeTradeView() {
  if (!V) return;
  V.el.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onTvKey); V = null;
}
function onTvKey(e) {
  if (!V || $('.viewer') || $('.rp') || $('.modal.small') || e.target.closest?.('input, textarea, select')) return;
  if (e.key === 'Escape') closeTradeView();
  else if (e.key === 'ArrowLeft') tvMove(-1);
  else if (e.key === 'ArrowRight') tvMove(1);
  else if (e.key === 'e' || e.key === 'E') tvEdit();
}

async function openDayEdit(day, focusId, back = false) {
  closeMenus();
  if (D) await closeDay();
  D = { day, active: focusId || null, timers: {}, urls: {}, back };
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'dayOverlay';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="dayTitle">
    <div class="modal-head"><h2 id="dayTitle">${parseYmd(day).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2><span class="sum" id="daySum"></span><span style="flex:1"></span>
      <button class="btn ghost icon" data-close aria-label="Chiudi">✕</button></div>
    <div class="modal-body" id="dayBody"></div>
    <div class="modal-foot"><button class="btn danger" data-delday>Elimina giorno</button><span class="grow"></span>
      <span class="save-state" id="saveState">Le modifiche si salvano da sole</span>
      <button class="btn" data-add>+ Aggiungi trade</button><button class="btn primary" data-close>Fatto</button></div>
  </div><input type="file" accept="image/*" multiple hidden id="fileIn">`;
  D.el = ov;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  bindDay(ov);
  await loadUrls(dayTrades());
  if (!D) return;
  renderDayBody();
  const target = focusId && $(`.tcard[data-id="${focusId}"]`, ov);
  if (target) target.scrollIntoView({ block: 'start' });
  else if (!dayTrades().length) $('[data-add]', $('#dayBody', ov))?.focus();
}

async function closeDay() {
  if (!D) return;
  const pending = Object.keys(D.timers);
  await Promise.all(pending.map(flushTrade));
  if (D.noteValue !== undefined) await flushNote();
  const back = D.back ? { day: D.day, id: D.active } : null;
  D.el.remove(); document.body.style.overflow = ''; D = null;
  document.removeEventListener('paste', onPaste);
  document.removeEventListener('keydown', onDayKey);
  renderPage();
  if (back && S.trades.some((t) => t.trade_date === back.day)) openTradeView(back.day, back.id);   // finita la modifica si torna alla vista a colpo d'occhio
}

async function addTrade() {
  const now = new Date();
  try {
    const t = normalizeTrade(await S.db.createTrade({ account_id: S.accountId, trade_date: D.day, trade_time: D.day === ymd(now) ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : '' }));
    S.trades.push(t); D.active = t.id;
    renderDayBody(); refreshBehind();
    const c = $(`.tcard[data-id="${t.id}"]`, D.el); c.scrollIntoView({ block: 'start', behavior: 'smooth' }); $('[data-f="pnl"]', c).focus();
    return t;
  } catch (e) { toast(errMsg(e), true); return null; }
}

// Riduce le immagini grandi per risparmiare spazio (resta nitida per rivederla)
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2560 / bmp.width);
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.88));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

async function uploadFiles(files, tradeId) {
  files = [...files].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  let t = tradeById(tradeId || D.active) || (dayTrades().length === 1 ? dayTrades()[0] : null);
  if (!t && dayTrades().length) t = dayTrades()[dayTrades().length - 1];
  if (!t) t = await addTrade();
  if (!t) return;
  setActive(t.id);
  const ind = $(`.tcard[data-id="${t.id}"] [data-uploading]`, D.el); if (ind) ind.hidden = false;
  setSave('Carico l\'immagine…');
  try {
    for (const f of files) {
      const img = await S.db.uploadImage(t, await shrink(f), '');
      t.trade_images.push(img);
    }
    await loadUrls([t]);
    setSave('Salvato ✓');
  } catch (e) { setSave('Errore nel caricamento: ' + errMsg(e), true); }
  if (D) renderCard(t.id);
}

function onPaste(e) {
  if (!D || $('.modal.small') || $('.viewer')) return;
  const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile());
  if (!files.length) return;            // testo normale: lascio fare al browser
  e.preventDefault();
  const card = document.activeElement && document.activeElement.closest && document.activeElement.closest('.tcard');
  uploadFiles(files, card ? card.dataset.id : D.active);
}
function onDayKey(e) {
  if (e.key !== 'Escape' || $('.viewer') || $('.modal.small')) return;
  if (e.target.closest && e.target.closest('[data-newtag]') && e.target.value) return;
  closeDay();
}

function openViewer(t, imgId) {
  let i = Math.max(0, t.trade_images.findIndex((x) => x.id === imgId));
  const v = document.createElement('div'); v.className = 'viewer'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-label', 'Immagine');
  const show = () => {
    const img = t.trade_images[i];
    v.innerHTML = `<img src="${esc(((D && D.urls) || (V && V.urls) || {})[img.path] || '')}" alt="${esc(img.timeframe || 'Screenshot')}">
      <div class="cap">${esc(img.timeframe || '')}${t.trade_images.length > 1 ? ` (${i + 1} di ${t.trade_images.length})` : ''}</div>
      ${t.trade_images.length > 1 ? '<button class="prev" aria-label="Precedente">‹</button><button class="next" aria-label="Successiva">›</button>' : ''}
      <button class="x" aria-label="Chiudi">✕</button>`;
  };
  const close = () => { v.remove(); document.removeEventListener('keydown', key, true); };
  const move = (k) => { i = (i + k + t.trade_images.length) % t.trade_images.length; show(); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } if (e.key === 'ArrowLeft') move(-1); if (e.key === 'ArrowRight') move(1); };
  v.addEventListener('click', (e) => { if (e.target.closest('.prev')) move(-1); else if (e.target.closest('.next')) move(1); else if (e.target.tagName !== 'IMG') close(); });
  document.addEventListener('keydown', key, true);
  show(); document.body.appendChild(v);
}

function bindDay(ov) {
  document.addEventListener('paste', onPaste);
  document.addEventListener('keydown', onDayKey);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeDay(); });
  ov.addEventListener('focusin', (e) => { const c = e.target.closest('.tcard'); if (c) setActive(c.dataset.id); });
  ov.addEventListener('pointerdown', (e) => { const c = e.target.closest('.tcard'); if (c) setActive(c.dataset.id); });

  ov.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('[data-daynote]')) { D.noteValue = el.value; scheduleNote(); return; }
    if (el.matches('[data-imgtf]')) {
      const id = el.dataset.imgtf, t = dayTrades().find((x) => x.trade_images.some((i) => i.id === id));
      const img = t.trade_images.find((i) => i.id === id); img.timeframe = el.value;
      clearTimeout(D['img' + id]); setSave('Salvataggio…');
      D['img' + id] = setTimeout(() => S.db.updateImage(id, { timeframe: img.timeframe }).then(() => setSave('Salvato ✓')).catch((er) => setSave(errMsg(er), true)), 600);
      return;
    }
    const f = el.dataset.f; if (!f || el.tagName === 'SELECT') return;
    const t = tradeById(el.closest('.tcard').dataset.id);
    if (['pnl', 'entry', 'sl', 'tp', 'contracts', 'sl_usd', 'tp_usd'].includes(f)) t[f] = num(el.value) ?? (f === 'pnl' ? 0 : null);
    else if (f === 'symbol') t[f] = el.value.toUpperCase().trim();
    else t[f] = el.value;
    if (f === 'pnl') { el.classList.toggle('pos', t.pnl > 0); el.classList.toggle('neg', t.pnl < 0); updateDaySum(); }
    schedule(t.id);
  });
  ov.addEventListener('change', (e) => {
    const el = e.target, f = el.dataset.f;
    if (!f || el.tagName !== 'SELECT') return;
    const t = tradeById(el.closest('.tcard').dataset.id);
    if (f === 'outcome') {
      if (el.value === 'APERTO') { t.status = 'aperto'; t.outcome = ''; }
      else { t.status = 'chiuso'; t.outcome = el.value; }
      updateDaySum(); schedule(t.id, 0); renderCard(t.id);
    } else if (f === 'setup' && el.value === '__new') {
      const ni = $('[data-newsetup]', el.closest('.field')); ni.hidden = false; ni.focus();
    } else { t[f] = el.value; schedule(t.id, 0); }
  });
  const applyNewSetup = (ni) => {
    if (ni.dataset.done) return; ni.dataset.done = '1';
    const t = tradeById(ni.closest('.tcard').dataset.id), v = ni.value.trim();
    if (!v) { ni.hidden = true; const sel = $('select', ni.closest('.field')); sel.value = t.setup || ''; return; }
    t.setup = v; schedule(t.id, 0);
    if (!(S.settings.setups || []).includes(v)) { S.settings.setups = [...(S.settings.setups || []), v]; saveSettings('Setup aggiunto ✓').catch(() => {}); }
    renderCard(t.id);
  };
  ov.addEventListener('focusout', (e) => { if (e.target.matches('[data-newsetup]') && !e.target.hidden) applyNewSetup(e.target); });

  ov.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-newsetup]')) { e.preventDefault(); applyNewSetup(e.target); }
    if (e.key === 'Enter' && e.target.matches('[data-newtag]')) { e.preventDefault(); addCustomTag(e.target.closest('.tcard').dataset.id); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-drop]')) { e.preventDefault(); e.target.click(); }
  });
  ov.addEventListener('dragover', (e) => { const d = e.target.closest('[data-drop]'); if (d) { e.preventDefault(); d.classList.add('over'); } });
  ov.addEventListener('dragleave', (e) => { const d = e.target.closest('[data-drop]'); if (d) d.classList.remove('over'); });
  ov.addEventListener('drop', (e) => {
    const d = e.target.closest('[data-drop]'); if (!d) return;
    e.preventDefault(); d.classList.remove('over');
    uploadFiles(e.dataTransfer.files, d.closest('.tcard').dataset.id);
  });
  $('#fileIn', ov).addEventListener('change', (e) => { uploadFiles(e.target.files, D.uploadTarget); e.target.value = ''; });

  ov.addEventListener('click', async (e) => {
    const b = e.target.closest('button, [data-drop], img[data-img]'); if (!b) return;
    const card = b.closest('.tcard'), t = card && tradeById(card.dataset.id);
    if (b.matches('[data-close]')) return closeDay();
    if (b.matches('[data-add]')) return addTrade();
    if (b.matches('[data-review]')) {
      const ta = $('[data-daynote]', D.el); if (!ta) return;
      const line = `Regole rispettate: ${b.dataset.review}`;
      let v = ta.value.replace(/^Regole rispettate:.*\n?/m, '').replace(/^\n+/, '');
      const tpl = /Cosa è andato bene:|Cosa cambierei:/.test(v) ? '' : 'Cosa è andato bene:\n\nCosa cambierei:\n';
      ta.value = `${line}\n${v}${v && !v.endsWith('\n') ? '\n' : ''}${tpl}`;
      D.noteValue = ta.value; scheduleNote(); ta.focus();
      if (tpl) { const i = ta.value.indexOf('Cosa è andato bene:') + 'Cosa è andato bene:'.length; ta.setSelectionRange(i + 1, i + 1); }
      return;
    }
    if (b.matches('[data-delday]')) {
      if (!dayTrades().length && !S.notes[D.day]) return closeDay();
      if (!(await confirmBox('Eliminare il giorno?', 'Vengono cancellati tutti i trade, le foto e l\'analisi di questo giorno.'))) return;
      try {
        for (const x of dayTrades()) { await S.db.deleteTrade(x); S.trades = S.trades.filter((y) => y.id !== x.id); }
        await S.db.deleteDayNote(S.accountId, D.day); delete S.notes[D.day]; D.noteValue = undefined;
        D.timers = {}; closeDay();
      } catch (er) { toast(errMsg(er), true); }
      return;
    }
    if (!t) return;
    if (b.matches('[data-share]')) { openPostDialog(t); return; }
    if (b.matches('[data-star]')) { t.starred = !t.starred; b.classList.toggle('on', t.starred); b.setAttribute('aria-pressed', t.starred); schedule(t.id, 0); return; }
    if (b.matches('[data-deltrade]')) {
      if (!(await confirmBox('Eliminare questo trade?', 'Vengono cancellate anche le sue foto.'))) return;
      try { clearTimeout(D.timers[t.id]); delete D.timers[t.id]; await S.db.deleteTrade(t); S.trades = S.trades.filter((x) => x.id !== t.id); renderDayBody(); refreshBehind(); setSave('Trade eliminato'); }
      catch (er) { toast(errMsg(er), true); }
      return;
    }
    if (b.matches('[data-tag]')) { toggleIn(t.tags, b.dataset.tag); b.classList.toggle('on'); b.setAttribute('aria-pressed', t.tags.includes(b.dataset.tag)); schedule(t.id, 0); return; }
    if (b.matches('[data-emo]')) { toggleIn(t.emotions, b.dataset.emo); b.classList.toggle('on'); b.setAttribute('aria-pressed', t.emotions.includes(b.dataset.emo)); schedule(t.id, 0); return; }
    if (b.matches('[data-addtag]')) return addCustomTag(t.id);
    if (b.matches('[data-drop]')) { D.uploadTarget = t.id; $('#fileIn', ov).click(); return; }
    if (b.matches('img[data-img]')) return openViewer(t, b.dataset.img);
    if (b.matches('[data-imgdel]')) {
      const img = t.trade_images.find((i) => i.id === b.dataset.imgdel);
      if (!(await confirmBox('Eliminare l\'immagine?', ''))) return;
      try { await S.db.deleteImage(img); t.trade_images = t.trade_images.filter((i) => i.id !== img.id); renderCard(t.id); setSave('Immagine eliminata'); }
      catch (er) { toast(errMsg(er), true); }
    }
  });
}
function toggleIn(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }

async function addCustomTag(id) {
  const t = tradeById(id), input = $(`.tcard[data-id="${id}"] [data-newtag]`, D.el);
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  const known = [...PRESET_TAGS, ...(S.settings.customTags || [])];
  if (!known.some((k) => k.toLowerCase() === name.toLowerCase())) {
    S.settings.customTags = [...(S.settings.customTags || []), name];
    S.db.saveSettings(S.settings).catch((e) => toast(errMsg(e), true));
  }
  const real = known.find((k) => k.toLowerCase() === name.toLowerCase()) || name;
  if (!t.tags.includes(real)) t.tags.push(real);
  schedule(t.id, 0); renderCard(t.id);
  $(`.tcard[data-id="${id}"] [data-newtag]`, D.el).focus();
}

// =====================================================================
//  Avvio
// =====================================================================
async function start() {
  $('#root').innerHTML = '<div class="auth"><p class="muted">Carico il journal…</p></div>';
  try {
    S.settings = { customTags: [], ...(await S.db.getSettings()) };
    S.setupCounts = await S.db.setupCounts().catch(() => null);
    if (S.local) { S.localInfo = await S.db.call('info'); try { S.updUrl = (await S.db.call('updateGet')).url; } catch (e) { S.updUrl = ''; } }
    if (S.settings.theme && THEMES[S.settings.theme] && S.settings.theme !== currentTheme()) applyTheme(S.settings.theme);
    S.money = await S.db.hasMoneyCols().catch(() => false);
    S.accounts = await S.db.listAccounts();
    if (!S.accounts.length) S.accounts = [await S.db.createAccount('Personale', 'conto')];
    let saved = null; try { saved = localStorage.getItem('journal.account'); } catch { /* niente */ }
    S.accountId = (S.accounts.find((a) => a.id === saved) || S.accounts[0]).id;
    await loadAccountData();
    startPoint();
    const hp = location.hash.slice(1); if (PAGES.includes(hp)) S.page = hp;
    renderShell();
  } catch (e) {
    $('#root').innerHTML = `<div class="auth"><div class="card box setup-box"><h1>${LOGO} Journal</h1>
<p class="neg">Non riesco a leggere i dati: ${esc(errMsg(e))}</p>
      ${S.local ? '<p>Controlla che la cartella dei dati esista e che nessun altro programma la stia bloccando.</p>' : '<p>Se è la prima volta, controlla di aver eseguito lo script <code>setup.sql</code> in Supabase.</p>'}
      <button class="btn" id="retry">Riprova</button></div></div>`;
    $('#retry').onclick = () => location.reload();
  }
}

// Aggiornamento automatico: quando torni sulla pagina e ogni minuto,
// così i trade inviati da Trade Logger compaiono senza ricaricare.
let refreshing = false;
async function autoRefresh() {
  if (refreshing || document.hidden || !S.accountId || D || $('.modal.small') || !$('#page')) return;
  refreshing = true;
  try {
    const before = JSON.stringify(S.trades.map((t) => [t.id, t.updated_at, t.trade_images.length]));
    await loadAccountData();
    const after = JSON.stringify(S.trades.map((t) => [t.id, t.updated_at, t.trade_images.length]));
    if (before !== after && !D) renderPage();
  } catch { /* riprovo al prossimo giro */ } finally { refreshing = false; }
}
// Conti creati o cambiati da Trade Logger (o da un'altra finestra): aggiorno l'elenco e il menu del conto
async function refreshAccounts() {
  if (!S.local || !S.accountId || !$('#page')) return;
  try {
    const list = await S.db.listAccounts();
    const key = (a) => JSON.stringify(a.map((x) => [x.id, x.name, x.kind, !!x.shared]));
    if (key(list) === key(S.accounts)) return;
    if (D || V) { S.accounts = list; return; }               // con una finestra aperta aggiorno i dati e ridisegno alla chiusura/al prossimo giro
    S.accounts = list;
    if (!S.accounts.some((x) => x.id === S.accountId)) { S.accountId = S.accounts[0] && S.accounts[0].id; await loadAccountData(); }
    renderShell();
  } catch { /* riprovo al prossimo giro */ }
}
document.addEventListener('visibilitychange', () => { refreshAccounts(); autoRefresh(); });
setInterval(() => { refreshAccounts(); autoRefresh(); }, 60 * 1000);

(async function boot() {
  const params = new URLSearchParams(location.search);
  if (window.localStore && window.LocalDB) {            // programma sul PC: nessun accesso, i dati sono in cartelle
    S.local = true; S.db = new LocalDB(); S.user = await S.db.currentUser(); localHooks();
    return start();
  }
  if (params.has('demo')) { S.demo = true; S.db = new DemoDB(); S.user = await S.db.currentUser(); return start(); }
  const c = window.JOURNAL_CONFIG || {};
  if (!c.supabaseUrl || /INCOLLA/.test(c.supabaseUrl) || !c.supabaseAnonKey || /INCOLLA/.test(c.supabaseAnonKey) || !window.supabase) return renderSetupNeeded();
  S.db = new SupaDB(c.supabaseUrl, c.supabaseAnonKey);
  S.user = await S.db.currentUser();
  if (S.user) start(); else renderAuth('in');
})();

// =====================================================================
//  Reports
// =====================================================================
const MONTHS_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const closedOf = (list) => list.filter((t) => t.status !== 'aperto');
const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');

// raggruppa i trade: chiave -> numeri utili (un trade può stare in più gruppi, es. i tag)
const hourLabel = (time) => { const h = String(time).split(':')[0].padStart(2, '0'); return `${h}:00–${h}:59`; };
function groupBy(list, keysOf) {
  const m = new Map();
  for (const t of list) {
    for (const k of keysOf(t)) {
      if (k === null || k === undefined || k === '') continue;
      const g = m.get(k) || { key: k, n: 0, wins: 0, losses: 0, pnl: 0, gw: 0, gl: 0 };
      g.n++; g.pnl += t.pnl;
      if (t.pnl > 0) { g.wins++; g.gw += t.pnl; } else if (t.pnl < 0) { g.losses++; g.gl -= t.pnl; }
      m.set(k, g);
    }
  }
  return [...m.values()].map((g) => ({ ...g, winRate: g.wins + g.losses ? g.wins / (g.wins + g.losses) : null, avg: g.n ? g.pnl / g.n : 0 }));
}

function kpisHTML(list) {
  const st = stats(list);
  const wl = st.avgWin != null || st.avgLoss != null ? (st.avgWin || 0) / ((st.avgWin || 0) + (st.avgLoss || 0) || 1) : null;
  return `<section class="kpis" aria-label="Statistiche principali">
      <div class="card kpi"><div class="l">P&amp;L netto</div><div class="v ${cls(st.net)}">${moneyPlain(st.net)}</div><span class="pill">${st.n} trade</span></div>
      <div class="card kpi"><div class="l">Win rate</div><div class="v">${pct(st.winRate)}</div>
        <div class="viz">${gauge(st.winRate)}<div class="counts"><span class="pos" title="Vincenti">${st.wins}</span><span title="Pareggi">${st.be}</span><span class="neg" title="Perdenti">${st.losses}</span></div></div></div>
      <div class="card kpi"><div class="l">Aspettativa per trade</div><div class="v ${cls(st.expectancy)}">${st.expectancy == null ? '—' : moneyPlain(st.expectancy)}</div>
        ${wl == null ? '' : `<div class="bar2"><i style="width:${(wl * 100).toFixed(1)}%;background:var(--profit)"></i><i style="flex:1;background:var(--loss)"></i></div>
        <div class="bar2-l"><span class="pos" title="Media vincita">${fmt(st.avgWin || 0)}</span><span class="neg" title="Media perdita">${fmt(st.avgLoss || 0)}</span></div>`}</div>
      <div class="card kpi"><div class="l">Profit factor</div><div class="v">${st.pf == null ? '—' : st.pf === Infinity ? '∞' : fmt(st.pf)}</div>
        <div class="viz">${ring(st.gw + st.gl ? st.gw / (st.gw + st.gl) : null)}</div></div>
    </section>`;
}

function groupTable(rows, first, empty) {
  if (!rows.length) return `<div class="empty small">${empty}</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>${first}</th><th class="r">Trade</th><th class="r">Win rate</th><th class="r">P&amp;L</th><th class="r">Media</th></tr></thead><tbody>
    ${rows.map((g) => `<tr><td><b>${esc(g.key)}</b></td><td class="r">${g.n}</td><td class="r">${pct(g.winRate)}</td><td class="r ${cls(g.pnl)}"><b>${money(g.pnl)}</b></td><td class="r ${cls(g.avg)}">${money(g.avg)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function histSVG(list, W = 1000) {
  if (list.length < 2) return '<div class="empty small">Servono almeno 2 trade chiusi.</div>';
  const vals = list.map((t) => t.pnl);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const raw = ((hi - lo) || 100) / 12, p10 = 10 ** Math.floor(Math.log10(raw)), r = raw / p10;
  const w = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p10;
  lo = Math.floor(lo / w) * w; hi = Math.ceil((hi + 1e-9) / w) * w; if (hi === lo) hi = lo + w;
  const n = Math.max(1, Math.min(30, Math.round((hi - lo) / w))), bins = Array.from({ length: n }, (_, i) => ({ a: lo + i * w, b: lo + (i + 1) * w, c: 0 }));
  vals.forEach((v) => { const i = Math.min(n - 1, Math.floor((v - lo) / w)); bins[i].c++; });
  const H = W < 1000 ? 300 : 240, L = 40, R = 10, T = 16, B = 30, max = Math.max(...bins.map((b) => b.c));
  const slot = (W - L - R) / n;
  let g = `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--grid-strong)"/>`;
  bins.forEach((b, i) => {
    const h = (H - T - B) * b.c / max, x = L + i * slot + 2, mid = (b.a + b.b) / 2;
    if (b.c) g += `<rect x="${x.toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${(slot - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${mid >= 0 ? 'var(--profit)' : 'var(--loss)'}" opacity=".85"><title>da ${fmt(b.a, 0)} a ${fmt(b.b, 0)} USD: ${b.c} trade</title></rect><text x="${(x + (slot - 4) / 2).toFixed(1)}" y="${(H - B - h - 4).toFixed(1)}" text-anchor="middle" fill="var(--text-2)" font-size="12">${b.c}</text>`;
    if (i % Math.ceil(n / 8) === 0) g += `<text x="${(L + i * slot).toFixed(1)}" y="${H - 9}" text-anchor="middle" fill="var(--muted)" font-size="12">${fmt(b.a, 0)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribuzione dei risultati" style="display:block;width:100%;height:auto">${g}</svg>`;
}

function insights(list) {
  const out = [];
  if (list.length < 5) return ['Registra almeno 5 trade in questo anno per ricevere osservazioni sul tuo andamento.'];
  const st = stats(list);
  if (st.avgWin && st.avgLoss) {
    const r = st.avgWin / st.avgLoss;
    out.push(r >= 1 ? `In media un trade vincente vale ${fmt(r)} volte un perdente (${moneyPlain(st.avgWin)} contro ${moneyPlain(st.avgLoss)}).`
      : `Le perdite medie (${moneyPlain(st.avgLoss)}) sono più grandi delle vincite medie (${moneyPlain(st.avgWin)}): con questo rapporto ti serve un win rate sopra il ${Math.round(100 / (1 + r))}%.`);
  }
  const wd = groupBy(list, (t) => [parseYmd(t.trade_date).getDay()]).filter((g) => g.n >= 2).sort((a, b) => b.pnl - a.pnl);
  if (wd.length >= 2) {
    const best = wd[0], worst = wd[wd.length - 1];
    out.push(`Il giorno migliore è il ${WEEKDAYS[best.key].toLowerCase()} (${money(best.pnl)} in ${best.n} trade)${worst.pnl < 0 ? `, il peggiore il ${WEEKDAYS[worst.key].toLowerCase()} (${money(worst.pnl)})` : ''}.`);
  }
  const hr = groupBy(list, (t) => [/^\d{1,2}:/.test(t.trade_time || '') ? hourLabel(t.trade_time) : null]).filter((g) => g.n >= 3).sort((a, b) => b.pnl - a.pnl);
  if (hr.length >= 2) { const b = hr[0], w = hr[hr.length - 1]; out.push(`La fascia oraria migliore è ${b.key} (${money(b.pnl)} in ${b.n} trade)${w.pnl < 0 ? `, la peggiore ${w.key} (${money(w.pnl)})` : ''}.`); }
  const su = groupBy(list, (t) => [t.setup]).filter((g) => g.n >= 2).sort((a, b) => b.pnl - a.pnl);
  if (su.length) {
    out.push(`Il setup che rende di più è "${su[0].key}": ${money(su[0].pnl)} in ${su[0].n} trade, win rate ${pct(su[0].winRate)}.`);
    const w = su[su.length - 1]; if (su.length > 1 && w.pnl < 0) out.push(`Il setup "${w.key}" è in perdita: ${money(w.pnl)} in ${w.n} trade.`);
  }
  const ls = groupBy(list, (t) => [t.direction]).filter((g) => g.key === 'LONG' || g.key === 'SHORT');
  if (ls.length === 2 && ls[0].n >= 3 && ls[1].n >= 3) {
    const [a, b] = ls[0].pnl >= ls[1].pnl ? ls : [ls[1], ls[0]];
    out.push(`Vai meglio ${a.key === 'LONG' ? 'in long' : 'in short'} (${money(a.pnl)}, win rate ${pct(a.winRate)}) che ${b.key === 'LONG' ? 'in long' : 'in short'} (${money(b.pnl)}, win rate ${pct(b.winRate)}).`);
  }
  const tg = groupBy(list, (t) => t.tags).filter((g) => g.pnl < 0).sort((a, b) => a.pnl - b.pnl);
  if (tg.length) out.push(`I trade con il tag "${tg[0].key}" ti sono costati ${moneyPlain(-tg[0].pnl)} in ${tg[0].n} trade.`);
  const em = groupBy(list, (t) => t.emotions).filter((g) => g.n >= 2).sort((a, b) => a.avg - b.avg);
  if (em.length && em[0].avg < 0) out.push(`Quando ti senti "${em[0].key.toLowerCase()}" il risultato medio è ${money(em[0].avg)} a trade.`);
  const rs = list.map(rOf).filter((r) => r != null);
  if (rs.length >= 5) out.push(`Su ${rs.length} trade con il rischio registrato, il risultato medio è ${fmtR(rs.reduce((a, b) => a + b, 0) / rs.length)} a trade.`);
  let run = 0, maxRun = 0; [...list].sort(sortTrades).forEach((t) => { run = t.pnl < 0 ? run + 1 : 0; maxRun = Math.max(maxRun, run); });
  if (maxRun >= 3) out.push(`La serie più lunga di perdite consecutive è di ${maxRun} trade.`);
  return out;
}


// ---------- Correzioni (beta): regole semplici sui tuoi numeri, niente AI ----------
// Ogni regola guarda un comportamento preciso, si attiva solo con abbastanza trade e dice quanti ne ha usati.
function corrections(list) {
  const out = [], T = [...closedOf(list)].sort(sortTrades);
  if (T.length < 10) return { items: [], few: true, n: T.length };
  const st = stats(T);
  const sum = (a) => a.reduce((s, t) => s + t.pnl, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : 0);
  const mins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t.trade_time || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const conf = (n) => (n >= 30 ? 'buona' : n >= 12 ? 'media' : 'bassa');
  const add = (sev, title, text, tip, n) => out.push({ sev, title, text, tip, n, conf: conf(n) });
  const days = new Map(); T.forEach((t) => { (days.get(t.trade_date) || days.set(t.trade_date, []).get(t.trade_date)).push(t); });

  // 1. trade presi subito dopo una perdita (stesso giorno, entro 30 minuti)
  const quick = [];
  days.forEach((ts) => { for (let i = 1; i < ts.length; i++) { const p = ts[i - 1], c = ts[i], a = mins(p), b = mins(c); if (p.pnl < 0 && a != null && b != null && b - a >= 0 && b - a <= 30) quick.push(c); } });
  if (quick.length >= 5 && sum(quick) < 0 && avg(quick) < st.expectancy) {
    add('warn', 'Rientri veloci dopo una perdita', `Dopo una perdita hai riaperto entro 30 minuti ${quick.length} volte: risultato ${money(sum(quick))}, media ${money(avg(quick))} a trade (la tua media generale è ${money(st.expectancy)}).`, 'Prova una pausa fissa dopo ogni stop (per esempio 30 minuti) e riguarda il trade prima di rientrare.', quick.length);
  }
  // 2. continuare dopo 2 perdite nello stesso giorno
  const after2 = [];
  days.forEach((ts) => { let l = 0; for (const t of ts) { if (l >= 2) after2.push(t); l = t.pnl < 0 ? l + 1 : 0; } });
  if (after2.length >= 5 && sum(after2) < 0) {
    add('warn', 'Dopo due perdite di fila nello stesso giorno', `I trade presi dopo 2 perdite consecutive nello stesso giorno sono ${after2.length} e valgono ${money(sum(after2))} in totale (win rate ${pct(after2.filter((t) => t.pnl > 0).length / after2.length)}).`, 'Valuta una regola semplice: dopo 2 stop consecutivi, chiudi la giornata.', after2.length);
  }
  // 3. troppi trade in un giorno
  const dv = [...days.values()].filter((d) => d.length >= 1);
  if (dv.length >= 8) {
    const counts = dv.map((d) => d.length).sort((x, y) => x - y), med = counts[Math.floor(counts.length / 2)], lim = Math.max(med * 2, med + 2);
    const many = dv.filter((d) => d.length >= lim), few = dv.filter((d) => d.length < lim);
    if (many.length >= 3 && few.length >= 3 && avg(many.map((d) => ({ pnl: sum(d) }))) < 0 && avg(many.map((d) => ({ pnl: sum(d) }))) < avg(few.map((d) => ({ pnl: sum(d) })))) {
      add('warn', 'Giornate con troppi trade', `Nei giorni con ${lim} o più trade (${many.length} giorni) il risultato medio è ${money(avg(many.map((d) => ({ pnl: sum(d) }))))} al giorno, contro ${money(avg(few.map((d) => ({ pnl: sum(d) }))))} negli altri.`, `Metti un limite di trade giornalieri (per esempio ${Math.max(1, lim - 1)}).`, many.reduce((s, d) => s + d.length, 0));
    }
  }
  // 4. posizione più grande dopo una perdita
  const cs = T.map((t) => t.contracts).filter((c) => c > 0);
  if (cs.length >= 10) {
    const mc = cs.reduce((s, c) => s + c, 0) / cs.length, big = [];
    days.forEach((ts) => { for (let i = 1; i < ts.length; i++) if (ts[i - 1].pnl < 0 && ts[i].contracts > mc * 1.3) big.push(ts[i]); });
    if (big.length >= 4 && sum(big) < 0) add('warn', 'Più contratti dopo una perdita', `Per ${big.length} volte, dopo un trade in perdita hai aperto con molti più contratti del solito (oltre il 30% in più): risultato ${money(sum(big))}.`, 'Tieni la stessa size dopo una perdita: aumentare per "recuperare" è la strada più rapida per un conto in rosso.', big.length);
  }
  // 5. rischio per trade irregolare
  const rk = T.map((t) => (t.sl_usd != null && t.sl_usd < 0 ? -t.sl_usd : null)).filter((x) => x != null);
  if (rk.length >= 10) {
    const m = rk.reduce((s, x) => s + x, 0) / rk.length, sd = Math.sqrt(rk.reduce((s, x) => s + (x - m) ** 2, 0) / rk.length);
    if (sd / m > 0.5) add('info', 'Rischio per trade molto variabile', `Lo stop vale in media ${moneyPlain(m)}, ma varia molto (da ${moneyPlain(Math.min(...rk))} a ${moneyPlain(Math.max(...rk))}).`, 'Un rischio costante rende i risultati confrontabili e le statistiche più affidabili.', rk.length);
  }
  // 6. vincenti chiusi a mano molto prima del target
  const man = T.filter((t) => t.outcome === 'MANUALE' && t.pnl > 0 && t.tp_usd > 0);
  if (man.length >= 4) {
    const ratio = man.reduce((s, t) => s + t.pnl / t.tp_usd, 0) / man.length;
    if (ratio < 0.6) add('warn', 'Vincenti chiusi troppo presto', `Hai chiuso a mano ${man.length} trade in guadagno, in media al ${Math.round(ratio * 100)}% del target.`, 'Se il piano prevedeva il target, chiudere prima riduce il guadagno medio senza ridurre le perdite. Controlla nel replay cosa è successo dopo.', man.length);
  }
  // 7. perdita enorme rispetto alle altre
  const losses = T.filter((t) => t.pnl < 0);
  if (losses.length >= 8) {
    const worst = losses.reduce((a, b) => (b.pnl < a.pnl ? b : a)), others = losses.filter((t) => t !== worst), mo = -avg(others);
    if (-worst.pnl > mo * 2.5) add('warn', 'Una perdita molto più grande delle altre', `La perdita peggiore (${money(worst.pnl)} il ${worst.trade_date}) è ${fmt(-worst.pnl / mo)} volte la perdita media.`, 'Guarda quel trade: stop spostato, nessuno stop o size sbagliata? Evitare un caso così pesa più di tutto il resto.', losses.length);
  }
  // 8. orari, giorni, setup, emozioni, long/short in perdita
  const hr = groupBy(T, (t) => [/^\d{1,2}:/.test(t.trade_time || '') ? hourLabel(t.trade_time) : null]).filter((g) => g.n >= 5 && g.pnl < 0).sort((a, b) => a.pnl - b.pnl)[0];
  if (hr) add('warn', 'Una fascia oraria in perdita', `Tra le ${hr.key.replace('–', ' e le ')} hai ${hr.n} trade con ${money(hr.pnl)} in totale (win rate ${pct(hr.winRate)}).`, 'Prova a non operare in quella fascia per qualche settimana e confronta.', hr.n);
  const wd = groupBy(T, (t) => [parseYmd(t.trade_date).getDay()]).filter((g) => g.n >= 5 && g.pnl < 0).sort((a, b) => a.pnl - b.pnl)[0];
  if (wd) add('warn', 'Un giorno della settimana in perdita', `Il ${WEEKDAYS[wd.key].toLowerCase()} hai ${wd.n} trade con ${money(wd.pnl)} in totale.`, 'Chiediti se quel giorno operi con meno attenzione o in condizioni diverse.', wd.n);
  const su = groupBy(T, (t) => [t.setup]).filter((g) => g.n >= 5 && g.pnl < 0 && g.gl > g.gw).sort((a, b) => a.pnl - b.pnl)[0];
  if (su) add('warn', 'Un setup che perde', `Il setup "${su.key}" ha ${su.n} trade, ${money(su.pnl)} in totale e win rate ${pct(su.winRate)}.`, 'Riguarda i trade di questo setup: le regole sono chiare? Se non lo sono, mettilo in pausa.', su.n);
  const em = groupBy(T, (t) => t.emotions).filter((g) => g.n >= 4 && g.avg < 0 && g.avg < st.expectancy).sort((a, b) => a.avg - b.avg)[0];
  if (em) add('warn', 'Un\'emozione che costa', `Quando segni "${em.key.toLowerCase()}" (${em.n} trade) perdi in media ${moneyPlain(-em.avg)} a trade.`, 'Se ti accorgi di quell\'emozione prima di entrare, salta il trade o dimezza la size.', em.n);
  const ls = groupBy(T, (t) => [t.direction]).filter((g) => (g.key === 'LONG' || g.key === 'SHORT') && g.n >= 8 && g.pnl < 0)[0];
  if (ls) add('info', ls.key === 'LONG' ? 'I long non funzionano' : 'Gli short non funzionano', `${ls.key === 'LONG' ? 'In long' : 'In short'} hai ${ls.n} trade con ${money(ls.pnl)} in totale.`, 'Puoi provare a operare solo l\'altro lato per un periodo e vedere come cambia.', ls.n);
  // 9. rapporto vincita/perdita rispetto al win rate
  if (st.avgWin && st.avgLoss && st.avgLoss > st.avgWin && st.winRate != null && st.winRate < 1 / (1 + st.avgWin / st.avgLoss)) {
    add('warn', 'Le perdite sono troppo grandi per il tuo win rate', `Vincita media ${moneyPlain(st.avgWin)}, perdita media ${moneyPlain(st.avgLoss)}: ti servirebbe un win rate sopra il ${Math.round(100 / (1 + st.avgWin / st.avgLoss))}%, ma sei al ${pct(st.winRate)}.`, 'Per riequilibrare, avvicina lo stop o allontana il target.', st.n);
  }
  // cosa funziona
  const g1 = groupBy(T, (t) => [t.setup]).filter((g) => g.n >= 5 && g.pnl > 0 && g.gw > g.gl).sort((a, b) => b.pnl - a.pnl)[0];
  if (g1) add('ok', 'Un setup che funziona', `Il setup "${g1.key}": ${g1.n} trade, ${money(g1.pnl)}, win rate ${pct(g1.winRate)}.`, 'Valuta di concentrarti su questo.', g1.n);
  const h1 = groupBy(T, (t) => [/^\d{1,2}:/.test(t.trade_time || '') ? hourLabel(t.trade_time) : null]).filter((g) => g.n >= 5 && g.pnl > 0).sort((a, b) => b.pnl - a.pnl)[0];
  if (h1) add('ok', 'Una fascia oraria che funziona', `Tra le ${h1.key.replace('–', ' e le ')}: ${h1.n} trade, ${money(h1.pnl)}.`, 'Sono i tuoi orari migliori: proteggili.', h1.n);
  return { items: out, few: false, n: T.length };
}
function correctionsHTML(list) {
  const c = corrections(list);
  const head = '<div class="card-head"><h2>Correzioni <span class="beta">beta</span></h2></div>';
  if (c.few) return `<section class="card">${head}<div class="empty small">Servono almeno 10 trade chiusi in questo anno per avere delle correzioni (ora ${c.n}).</div></section>`;
  const body = c.items.length ? c.items.map((i) => `<div class="corr ${i.sev}"><div class="corr-t"><b>${esc(i.title)}</b><span class="corr-c" title="Quanti trade hanno usato le regole: con pochi trade il risultato può essere casuale">${i.n} trade · affidabilità ${i.conf}</span></div><div>${esc(i.text)}</div><div class="corr-tip">→ ${esc(i.tip)}</div></div>`).join('')
    : '<div class="empty small">Nessun comportamento da correggere trovato in questi dati. Continua a segnare setup ed emozioni per avere analisi più precise.</div>';
  return `<section class="card" id="repCorr">${head}<div class="corr-list">${body}</div><div class="foot-note">Sono regole semplici applicate ai tuoi numeri, senza intelligenza artificiale: segnalano dove guardare, non sono consigli finanziari. Con pochi trade possono dipendere dal caso.</div></section>`;
}

function renderReports() {
  const page = $('#page');
  const years = [...new Set(S.trades.map((t) => Number(t.trade_date.slice(0, 4))))];
  if (!S.year) S.year = years.length ? Math.max(...years) : new Date().getFullYear();
  const y = S.year;
  const all = S.trades.filter((t) => t.trade_date.startsWith(String(y)));
  const list = closedOf(all).sort(sortTrades);
  if (S.repMonth == null) {
    S.repMonth = list.length ? Number(list[list.length - 1].trade_date.slice(5, 7)) - 1 : new Date().getMonth();
  }

  // mesi
  const monthRows = MONTHS.map((name, m) => {
    const lm = list.filter((t) => Number(t.trade_date.slice(5, 7)) - 1 === m);
    const st = stats(lm);
    const days = {}; lm.forEach((t) => { days[t.trade_date] = (days[t.trade_date] || 0) + t.pnl; });
    const dv = Object.entries(days);
    const best = dv.length ? dv.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
    const worst = dv.length ? dv.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
    return { m, name, st, n: lm.length, posDays: dv.length ? dv.filter((d) => d[1] > 0).length / dv.length : null, best, worst };
  });

  // giorni del mese scelto
  const rm = S.repMonth, dim = new Date(y, rm + 1, 0).getDate();
  const dayItems = []; let cum = 0; const cumItems = [];
  for (let d = 1; d <= dim; d++) {
    const key = `${y}-${pad(rm + 1)}-${pad(d)}`;
    const v = list.filter((t) => t.trade_date === key).reduce((a, t) => a + t.pnl, 0);
    cum += v;
    const future = key > ymd(new Date());
    dayItems.push({ label: String(d), value: future ? null : v, title: itDate(key), day: key });
    cumItems.push({ label: String(d), value: future ? null : cum, title: `Fino al ${itDate(key)}`, day: key });
  }

  const wdOrder = [1, 2, 3, 4, 5, 6, 0];
  const wd = groupBy(list, (t) => [parseYmd(t.trade_date).getDay()]);
  const wdShown = wdOrder.filter((k) => k >= 1 && k <= 5 || wd.some((g) => g.key === k));
  const setups = groupBy(list, (t) => [t.setup || 'Senza setup']).sort((a, b) => b.pnl - a.pnl);
  const dirs = groupBy(list, (t) => [t.direction === 'LONG' ? 'Long' : t.direction === 'SHORT' ? 'Short' : null]).sort((a, b) => b.pnl - a.pnl);
  const tags = groupBy(list, (t) => t.tags).sort((a, b) => b.pnl - a.pnl);
  const emos = groupBy(list, (t) => t.emotions).sort((a, b) => b.pnl - a.pnl);
  const hours = groupBy(list, (t) => [/^\d{1,2}:/.test(t.trade_time || '') ? hourLabel(t.trade_time) : null]).sort((a, b) => a.key.localeCompare(b.key));

  page.innerHTML = `
    <div class="page-head"><div><h2 class="ph-title">Analisi ${y}</h2><div class="muted">${list.length} trade chiusi${all.length > list.length ? `, ${all.length - list.length} aperti` : ''}</div></div>
      <div class="cal-nav"><button class="btn ghost icon" data-y="-1" aria-label="Anno precedente">‹</button><button class="month-btn" data-pick-year title="Scegli l'anno">${y} <span aria-hidden="true">▾</span></button><button class="btn ghost icon" data-y="1" aria-label="Anno successivo">›</button></div></div>
    ${kpisHTML(list)}
    <section class="card"><div class="card-head"><h2>Cosa dicono i tuoi dati</h2></div>
      <ul class="insights">${insights(list).map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>
    ${correctionsHTML(list)}
    <section class="card" id="repEq"><div class="card-head"><h2>Curva equity ${y}</h2></div>${equityBody(list)}</section>
    <div class="grid2">
      <section class="card"><div class="card-head"><h2>P&amp;L mensile</h2></div><div class="chart">${list.length ? barsSVG(monthRows.map((r) => ({ label: MONTHS_SHORT[r.m], value: r.st.net, title: `${r.name} ${y}` })), { w: 560, height: 300 }) : '<div class="empty small">Nessun trade.</div>'}</div></section>
      <section class="card"><div class="card-head"><h2>Distribuzione dei risultati</h2></div><div class="chart">${histSVG(list, 560)}</div><div class="foot-note">Quanti trade sono finiti in ciascuna fascia di risultato (USD).</div></section>
    </div>
    <section class="card"><div class="card-head"><h2>Mese per mese</h2><div class="grow"></div><span class="muted small">Clicca un mese per aprirlo nel calendario</span></div>
      <div class="table-wrap"><table class="months"><thead><tr><th>Mese</th><th class="r">P&amp;L netto</th><th class="r">Trade</th><th class="r">Win rate</th><th class="r">Giorni positivi</th><th class="r">Vincita / perdita media</th><th class="r">Giorno migliore</th><th class="r">Giorno peggiore</th></tr></thead><tbody>
      ${monthRows.map((r) => r.n ? `<tr class="click" data-month="${r.m}"><td><b style="text-transform:capitalize">${r.name}</b></td><td class="r ${cls(r.st.net)}"><b>${money(r.st.net)}</b></td><td class="r">${r.n}</td><td class="r">${pct(r.st.winRate)}</td><td class="r">${pct(r.posDays)}</td><td class="r">${r.st.avgWin && r.st.avgLoss ? fmt(r.st.avgWin / r.st.avgLoss) : '—'}</td><td class="r pos">${r.best && r.best[1] > 0 ? `${itDate(r.best[0]).slice(0, 5)} ${money(r.best[1])}` : '—'}</td><td class="r neg">${r.worst && r.worst[1] < 0 ? `${itDate(r.worst[0]).slice(0, 5)} ${money(r.worst[1])}` : '—'}</td></tr>`
        : `<tr class="none"><td style="text-transform:capitalize">${r.name}</td><td class="r" colspan="7">—</td></tr>`).join('')}
      </tbody></table></div></section>
    <section class="card"><div class="card-head"><h2>Giorno della settimana</h2></div>
      <div class="wd">${wdShown.map((k) => { const g = wd.find((x) => x.key === k); return `<div class="wd-c"><div class="l">${WEEKDAYS[k]}</div><div class="v ${cls(g ? g.pnl : 0)}">${g ? money(g.pnl) : '—'}</div><div class="muted small">${g ? `${g.n} trade, win rate ${pct(g.winRate)}` : 'nessun trade'}</div></div>`; }).join('')}</div></section>
    <div class="grid2">
      <section class="card"><div class="card-head"><h2>Per setup</h2></div>${groupTable(setups, 'Setup', 'Nessun trade.')}</section>
      <section class="card"><div class="card-head"><h2>Long e short</h2></div>${groupTable(dirs, 'Direzione', 'Nessun trade con la direzione indicata.')}</section>
    </div>
    <section class="card" id="repDays"><div class="card-head"><h2>Giorno per giorno</h2><div class="grow"></div>
      <div class="cal-nav"><button class="btn ghost icon" data-rm="-1" aria-label="Mese precedente">‹</button><button class="month-btn" data-pick-month title="Scegli mese e anno">${MONTHS[rm]} ${y} <span aria-hidden="true">▾</span></button><button class="btn ghost icon" data-rm="1" aria-label="Mese successivo">›</button></div></div>
      <div class="grid2 inner">
        <div><div class="sub-t">P&amp;L netto giornaliero</div><div class="chart">${barsSVG(dayItems, { labelEvery: 3, w: 560, height: 280 })}</div></div>
        <div><div class="sub-t">P&amp;L cumulativo del mese</div><div class="chart">${barsSVG(cumItems, { labelEvery: 3, cumulative: true, w: 560, height: 280 })}</div></div>
      </div><div class="foot-note">Clicca una barra per aprire quel giorno.</div></section>
    <section class="card"><div class="card-head"><h2>Fascia oraria</h2></div>${groupTable(hours, 'Ora', 'Nessun orario registrato quest\'anno.')}<div class="foot-note">Con i backtest vale l'ora del replay, non quella del PC.</div></section>
    <div class="grid2">
      <section class="card"><div class="card-head"><h2>Tag</h2></div>${groupTable(tags, 'Tag', 'Nessun tag usato quest\'anno.')}</section>
      <section class="card"><div class="card-head"><h2>Emozioni</h2></div>${groupTable(emos, 'Emozione', 'Nessuna emozione registrata quest\'anno.')}</section>
    </div>`;

  page.onclick = (e) => {
    const yb = e.target.closest('[data-y]'); if (yb) { S.year = y + Number(yb.dataset.y); S.repMonth = null; renderReports(); return; }
    const py = e.target.closest('[data-pick-year]');
    if (py) { e.stopPropagation(); openMonthPicker(py, { year: y, yearOnly: true, onPick: (t) => { S.year = t.getFullYear(); S.repMonth = null; renderReports(); } }); return; }
    const pm = e.target.closest('[data-pick-month]');
    if (pm) { e.stopPropagation(); openMonthPicker(pm, { year: y, month: rm, onPick: (t) => { S.year = t.getFullYear(); S.repMonth = t.getMonth(); renderReports(); $('#repDays').scrollIntoView({ block: 'nearest' }); } }); return; }
    const mb = e.target.closest('[data-rm]'); if (mb) { S.repMonth = (rm + Number(mb.dataset.rm) + 12) % 12; renderReports(); $('#repDays').scrollIntoView({ block: 'nearest' }); return; }
    const mr = e.target.closest('[data-month]'); if (mr) { S.month = new Date(y, Number(mr.dataset.month), 1); goPage('dashboard'); return; }
    const o = e.target.closest('[data-open]'); if (o) { openDay(o.dataset.day, o.dataset.open); return; }
    const d = e.target.closest('rect[data-day]'); if (d) openDay(d.dataset.day);
  };
}

// =====================================================================
//  Progress Tracker
// =====================================================================
const isWeekday = (d) => d.getDay() !== 0 && d.getDay() !== 6;
function activityMap() {
  const m = {};   // giorno -> { pnl, n, note }
  S.trades.forEach((t) => { const d = (m[t.trade_date] = m[t.trade_date] || { pnl: 0, n: 0, note: false }); d.n++; if (t.status !== 'aperto') d.pnl += t.pnl; });
  Object.keys(S.notes).forEach((k) => { (m[k] = m[k] || { pnl: 0, n: 0, note: false }).note = true; });
  return m;
}
// serie: giorni di borsa (lun-ven) di fila con un trade o un'analisi; sabato e domenica non la interrompono
function streaks(act) {
  const days = Object.keys(act).sort();
  let longest = 0, run = 0, prev = null;
  for (const k of days) {
    const d = parseYmd(k);
    if (!isWeekday(d)) continue;
    if (prev) {
      const nx = new Date(prev); do { nx.setDate(nx.getDate() + 1); } while (!isWeekday(nx));
      run = ymd(nx) === k ? run + 1 : 1;
    } else run = 1;
    longest = Math.max(longest, run); prev = d;
  }
  let cur = 0; const d = new Date(); d.setHours(0, 0, 0, 0);
  if (!isWeekday(d) || !act[ymd(d)]) { do { d.setDate(d.getDate() - 1); } while (!isWeekday(d)); }   // oggi non ancora attivo: non rompe la serie
  while (act[ymd(d)]) { cur++; do { d.setDate(d.getDate() - 1); } while (!isWeekday(d)); }
  return { cur, longest };
}

function heatmapSVG(y, act) {
  const first = new Date(y, 0, 1), last = new Date(y, 11, 31);
  const start = new Date(first); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));   // lunedì
  const C = 14, G = 3, L = 34, T = 22;
  const weeks = Math.ceil(((last - start) / 864e5 + 1) / 7);
  const W = L + weeks * (C + G), H = T + 7 * (C + G);
  const maxAbs = Math.max(1, ...Object.entries(act).filter(([k]) => k.startsWith(String(y))).map(([, v]) => Math.abs(v.pnl)));
  const today = ymd(new Date());
  let g = '', lastMonth = -1;
  ['Lun', '', 'Mer', '', 'Ven', '', ''].forEach((l, r) => { if (l) g += `<text x="0" y="${T + r * (C + G) + 11}" fill="var(--muted)" font-size="11">${l}</text>`; });
  for (let w = 0; w < weeks; w++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(start); d.setDate(start.getDate() + w * 7 + r);
      if (d.getFullYear() !== y) continue;
      if (d.getDate() <= 7 && r === 0 && d.getMonth() !== lastMonth) { lastMonth = d.getMonth(); g += `<text x="${L + w * (C + G)}" y="12" fill="var(--muted)" font-size="11">${MONTHS_SHORT[d.getMonth()]}</text>`; }
      const k = ymd(d), a = act[k];
      let fill = 'var(--cell-empty)', title = `${itDate(k)}: nessuna attività`;
      if (a && a.n) {
        const al = (0.35 + 0.65 * Math.abs(a.pnl) / maxAbs).toFixed(2);
        fill = a.pnl > 0 ? `rgba(var(--rgb-profit),${al})` : a.pnl < 0 ? `rgba(var(--rgb-loss),${al})` : 'var(--faint)';
        title = `${itDate(k)}: ${a.n} trade, ${money(a.pnl)}${a.note ? ', analisi scritta' : ''}`;
      } else if (a && a.note) { fill = 'rgba(var(--rgb-accent),.7)'; title = `${itDate(k)}: analisi scritta`; }
      g += `<rect x="${L + w * (C + G)}" y="${T + r * (C + G)}" width="${C}" height="${C}" rx="3" ${k === today ? 'stroke="var(--text-2)" stroke-width="1.5"' : ''} data-day="${k}" style="fill:${fill};cursor:pointer"><title>${esc(title)}</title></rect>`;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Attività dell'anno" style="display:block;width:100%;min-width:640px;height:auto">${g}</svg>`;
}

function renderProgress() {
  const page = $('#page');
  if (!S.pYear) S.pYear = new Date().getFullYear();
  const y = S.pYear, act = activityMap(), sk = streaks(act);
  const inYear = Object.entries(act).filter(([k]) => k.startsWith(String(y)));
  const activeDays = inYear.length, tradeDays = inYear.filter(([, v]) => v.n).length;
  const noteDays = Object.keys(S.notes).sort().reverse();
  const m0 = ymd(new Date()).slice(0, 7);
  const missing = Object.entries(act).filter(([k, v]) => k.startsWith(m0) && v.n && !v.note).map(([k]) => k).sort();
  page.innerHTML = `
    <section class="kpis">
      <div class="card kpi"><div class="l">Serie attuale</div><div class="v">${sk.cur} ${sk.cur === 1 ? 'giorno' : 'giorni'}</div><div class="sub">Giorni di borsa di fila con un trade o un'analisi</div></div>
      <div class="card kpi"><div class="l">Serie più lunga</div><div class="v">${sk.longest} ${sk.longest === 1 ? 'giorno' : 'giorni'}</div><div class="sub">Il tuo record</div></div>
      <div class="card kpi"><div class="l">Giorni attivi nel ${y}</div><div class="v">${activeDays}</div><div class="sub">Con un trade o un'analisi</div></div>
      <div class="card kpi"><div class="l">Giorni con trade nel ${y}</div><div class="v">${tradeDays}</div><div class="sub">Giorni in cui hai operato</div></div>
    </section>
    <section class="card"><div class="card-head"><h2>Costanza</h2><div class="grow"></div>
      <div class="cal-nav"><button class="btn ghost icon" data-py="-1" aria-label="Anno precedente">‹</button><button class="month-btn" data-pick-year title="Scegli l'anno">${y} <span aria-hidden="true">▾</span></button><button class="btn ghost icon" data-py="1" aria-label="Anno successivo">›</button></div></div>
      <div class="heat">${heatmapSVG(y, act)}</div>
      <div class="legend"><span><i style="background:var(--cell-empty);border:1px solid var(--cell-empty-line)"></i>Nessuna attività</span><span><i style="background:var(--profit)"></i>Giorno positivo</span><span><i style="background:var(--loss)"></i>Giorno negativo</span><span><i style="background:var(--accent)"></i>Solo analisi</span><span>Clicca un giorno per aprirlo.</span></div></section>
    <div class="grid2">
      <section class="card"><div class="card-head"><h2>Analisi da scrivere</h2><div class="grow"></div><span class="muted small">${MONTHS[new Date().getMonth()]}</span></div>
        ${missing.length ? `<ul class="daylist">${missing.map((k) => `<li><button data-day="${k}"><span>${parseYmd(k).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</span><span class="${cls(act[k].pnl)}">${money(act[k].pnl)}</span></button></li>`).join('')}</ul>`
          : '<div class="empty small">Tutti i giorni con trade di questo mese hanno la loro analisi.</div>'}</section>
      <section class="card"><div class="card-head"><h2>Ultime analisi scritte</h2></div>
        ${noteDays.length ? `<ul class="daylist notes">${noteDays.slice(0, 8).map((k) => `<li><button data-day="${k}"><span><b>${itDate(k)}</b> ${esc(S.notes[k].slice(0, 110))}${S.notes[k].length > 110 ? '…' : ''}</span></button></li>`).join('')}</ul>`
          : '<div class="empty small">Nessuna analisi ancora. Si scrive in fondo alla finestra del giorno.</div>'}</section>
    </div>`;
  page.onclick = (e) => {
    const pk = e.target.closest('[data-pick-year]');
    if (pk) { e.stopPropagation(); openMonthPicker(pk, { year: y, yearOnly: true, onPick: (t) => { S.pYear = t.getFullYear(); renderProgress(); } }); return; }
    const yb = e.target.closest('.cal-nav [data-py]'); if (yb) { S.pYear = y + Number(yb.dataset.py); renderProgress(); return; }
    const d = e.target.closest('[data-day]'); if (d) openDay(d.dataset.day);
  };
}

// =====================================================================
//  Festività USA (bank holiday e borsa chiusa), calcolate qui
// =====================================================================
function usHolidays(y) {
  const out = {};
  const nth = (m, wd, n) => { const d = new Date(y, m, 1); d.setDate(1 + ((wd - d.getDay() + 7) % 7) + (n - 1) * 7); return d; };
  const last = (m, wd) => { const d = new Date(y, m + 1, 0); d.setDate(d.getDate() - ((d.getDay() - wd + 7) % 7)); return d; };
  const fixed = (m, d, noFriday = false) => { const x = new Date(y, m, d); if (x.getDay() === 0) x.setDate(x.getDate() + 1); else if (x.getDay() === 6 && !noFriday) x.setDate(x.getDate() - 1); return x.getDay() === 6 ? null : x; };
  // Pasqua (calendario gregoriano) per il Venerdì santo
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const em = Math.floor((h + l - 7 * m + 114) / 31) - 1, ed = ((h + l - 7 * m + 114) % 31) + 1;
  const goodFriday = new Date(y, em, ed - 2);
  const add = (dt, name, closed) => { if (dt) out[ymd(dt)] = { name, closed }; };
  add(fixed(0, 1, true), 'Capodanno', true);
  add(nth(0, 1, 3), 'Martin Luther King Day', true);
  add(nth(1, 1, 3), 'Presidents Day', true);
  add(goodFriday, 'Venerdì santo', true);
  add(last(4, 1), 'Memorial Day', true);
  add(fixed(5, 19), 'Juneteenth', true);
  add(fixed(6, 4), 'Independence Day', true);
  add(nth(8, 1, 1), 'Labor Day', true);
  add(nth(9, 1, 2), 'Columbus Day', false);
  add(fixed(10, 11), 'Veterans Day', false);
  add(nth(10, 4, 4), 'Thanksgiving', true);
  add(fixed(11, 25), 'Natale', true);
  return out;
}
const holidayOf = (key) => usHolidays(Number(key.slice(0, 4)))[key] || null;

// =====================================================================
//  CSV: esportazione e importazione
// =====================================================================
const CSV_COLS = [
  ['trade_date', 'Data'], ['trade_time', 'Ora'], ['symbol', 'Simbolo'], ['direction', 'Direzione'], ['pnl', 'P&L'], ['setup', 'Setup'],
  ['entry', 'Ingresso'], ['sl', 'Stop loss'], ['tp', 'Take profit'], ['contracts', 'Contratti'], ['tp_usd', 'Valore TP'], ['sl_usd', 'Valore SL'],
  ['outcome', 'Esito'], ['status', 'Stato'], ['tags', 'Tag'], ['emotions', 'Emozioni'], ['notes', 'Note'],
];
function toCSV(trades, withAccount = false) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) v = v.join(' | ');
    if (typeof v === 'number') return String(v).replace('.', ',');
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [...(withAccount ? ['Conto'] : []), ...CSV_COLS.map((c) => c[1])].join(';');
  const rows = trades.map((t) => [...(withAccount ? [cell(t._account)] : []), ...CSV_COLS.map(([k]) => cell(k === 'trade_date' ? itDate(t[k]) : t[k]))].join(';'));
  return '\uFEFF' + [head, ...rows].join('\r\n');
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
// nomi di colonna accettati (anche in inglese e quelli della copia di Trade Logger)
const CSV_ALIASES = {
  trade_date: ['data', 'date', 'giorno', 'apertura', 'opened', 'open date'], trade_time: ['ora', 'orario', 'time'], symbol: ['simbolo', 'symbol', 'asset', 'strumento', 'instrument', 'ticker'],
  direction: ['direzione', 'direction', 'side', 'lato', 'tipo'], pnl: ['p&l', 'pnl', 'p/l', 'risultato', 'profit', 'profitto', 'net p&l', 'p&l netto'], setup: ['setup', 'strategia', 'strategy'],
  entry: ['ingresso', 'entry', 'entry price', 'prezzo ingresso'], sl: ['stop loss', 'stop', 'sl'], tp: ['take profit', 'target', 'tp'], contracts: ['contratti', 'lotti', 'contracts', 'qty', 'quantity', 'size', 'quantita'],
  tp_usd: ['valore tp', 'tp usd', 'tp_usd'], sl_usd: ['valore sl', 'sl usd', 'sl_usd', 'rischio'], outcome: ['esito', 'outcome', 'exit'], status: ['stato', 'status'],
  tags: ['tag', 'tags'], emotions: ['emozioni', 'emotions', 'emozione'], notes: ['note', 'notes', 'commento', 'comment'],
};
function csvToTrades(text, accountId) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('Il file non contiene righe di trade.');
  const norm = (h) => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const head = rows[0].map(norm), map = {};
  for (const [k, al] of Object.entries(CSV_ALIASES)) { const i = head.findIndex((h) => al.includes(h)); if (i >= 0) map[k] = i; }
  if (map.trade_date === undefined) throw new Error('Manca la colonna con la data (Data / Date).');
  const date = (v) => {
    v = String(v || '').trim();
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
    return null;
  };
  const time = (v, d) => { const m = String(v || d || '').match(/(\d{1,2}):(\d{2})/); return m ? `${pad(m[1])}:${m[2]}` : ''; };
  const dir = (v) => { v = String(v || '').toLowerCase(); return /long|buy|acquist|lungo/.test(v) ? 'LONG' : /short|sell|vend|corto/.test(v) ? 'SHORT' : ''; };
  const list = (v) => String(v || '').split(/\s*[|,]\s*/).map((x) => x.trim()).filter(Boolean);
  const out = [], bad = [];
  rows.slice(1).forEach((r, i) => {
    const g = (k) => (map[k] === undefined ? '' : r[map[k]]);
    const d = date(g('trade_date'));
    if (!d) { bad.push(i + 2); return; }
    const outc = String(g('outcome') || '').toUpperCase();
    const st = /apert|open/i.test(g('status')) ? 'aperto' : 'chiuso';
    const t = { account_id: accountId, trade_date: d, trade_time: time(g('trade_time'), g('trade_date')), symbol: String(g('symbol') || '').toUpperCase().trim().replace(/^.*:/, '').replace(/^([A-Z]{1,4})[FGHJKMNQUVXZ]\d{1,2}$/, '$1').replace(/\d!$/, ''),
      direction: dir(g('direction')), pnl: num(g('pnl')) || 0, setup: String(g('setup') || '').trim(), entry: num(g('entry')), sl: num(g('sl')), tp: num(g('tp')),
      contracts: num(g('contracts')), outcome: ['TP', 'SL', 'MANUALE'].includes(outc) ? outc : '', status: st, tags: list(g('tags')), emotions: list(g('emotions')), notes: String(g('notes') || ''), source: 'importato' };
    if (S.money) { t.tp_usd = num(g('tp_usd')); t.sl_usd = num(g('sl_usd')); }
    out.push(t);
  });
  return { trades: out, bad, columns: Object.keys(map) };
}

// =====================================================================
//  Impostazioni
// =====================================================================
async function saveSettings(msg = 'Salvato ✓') {
  try { await S.db.saveSettings(S.settings); toast(msg); } catch (e) { toast(errMsg(e), true); }
}
function renderSettings() {
  const page = $('#page');
  const used = S.setupCounts || {}; if (!S.setupCounts) S.trades.forEach((t) => { if (t.setup) used[t.setup] = (used[t.setup] || 0) + 1; });
  const setups = [...new Set([...(S.settings.setups || []), ...Object.keys(used)])].sort((a, b) => a.localeCompare(b, 'it'));
  const tagUse = {}; S.trades.forEach((t) => t.tags.forEach((g) => { tagUse[g] = (tagUse[g] || 0) + 1; }));
  const hidden = S.settings.hiddenTags || [], custom = S.settings.customTags || [];
  const currencies = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'AUD', 'CAD'];
  const th = currentTheme();
  const preview = (id) => `<div class="tp" data-theme="${id}" aria-hidden="true"><div class="tp-side"><i></i><i></i><i></i><i></i></div>
      <div class="tp-main"><div class="tp-card"><small>P&amp;L netto</small><b>+1.785</b></div>
      <svg class="tp-line" viewBox="0 0 120 30" preserveAspectRatio="none"><path d="M0 26 L16 21 L32 24 L50 13 L68 17 L88 7 L120 3" fill="none" stroke="var(--profit)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>
      <div class="tp-cells"><i class="p"></i><i class="p"></i><i class="n"></i><i class="p"></i><i></i><i class="p"></i><i class="n"></i></div></div></div>`;
  page.innerHTML = `
    <section class="card"><div class="card-head"><h2>Aspetto</h2></div>
      <div class="theme-grid" role="radiogroup" aria-label="Tema">${Object.entries(THEMES).map(([id, t]) => `
        <button class="theme-opt ${id === th ? 'on' : ''}" data-theme-pick="${id}" role="radio" aria-checked="${id === th}">${preview(id)}
          <span class="tp-name">${t.name}${id === th ? '<span class="chk">✓</span>' : ''}</span><span class="muted small">${t.desc}</span></button>`).join('')}</div>
      <div class="foot-note">Il tema cambia solo l'aspetto: le funzioni sono identiche. Si ricorda su questo dispositivo e sugli altri dove accedi con lo stesso account. Lo trovi anche nel menu del profilo, in alto a destra.</div></section>
    ${S.local ? `<section class="card"><div class="card-head"><h2>Aggiornamenti</h2></div>
      <div class="pad-box"><label class="field"><span>Versione del Journal installata</span><input class="input" readonly value="${esc((S.localInfo && S.localInfo.version) || 'sconosciuta')}"></label>
        <label class="field"><span>Indirizzo degli aggiornamenti</span><input class="input" id="updUrl" spellcheck="false" value="${esc(S.updUrl || '')}" placeholder="https://github.com/NOME/trade-logger/releases/latest/download"></label>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="upd-check">Cerca aggiornamenti</button><button class="btn" data-act="upd-save">Salva indirizzo</button></div>
        <p class="muted small" style="margin:8px 0 0">Il Journal controlla da solo all'avvio se c'è una versione nuova. L'indirizzo è già impostato: cambialo solo se le versioni le pubblichi altrove. Se lo svuoti, torna quello predefinito.</p></div></section>` : ''}
    ${S.local ? localCard() : ''}
    <section class="card"><div class="card-head"><h2>Conti e backtest</h2><div class="grow"></div><button class="btn" data-act="newacc">+ Nuovo</button></div>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Tipo</th><th></th></tr></thead><tbody>
      ${S.accounts.map((a) => `<tr><td><b>${esc(a.name)}</b>${a.shared ? ' <span class="muted small">(condiviso con te)</span>' : ''}${a.id === S.accountId ? ' <span class="muted small">(aperto ora)</span>' : ''}</td>
        <td><select class="input sel-sm" data-kind="${a.id}"><option value="conto" ${a.kind !== 'backtest' ? 'selected' : ''}>Conto live</option><option value="backtest" ${a.kind === 'backtest' ? 'selected' : ''}>Backtest</option></select></td>
        <td class="r"><button class="btn" data-ren-acc="${a.id}">Rinomina</button> <button class="btn danger" data-del-acc="${a.id}" ${S.accounts.length < 2 ? 'disabled title="Serve almeno un conto"' : ''}>Elimina</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="foot-note">Il tipo decide da dove partono calendario e Reports (backtest: dall'ultimo trade) e come Trade Logger prende data e ora.</div></section>

    <div class="grid2">
      <section class="card"><div class="card-head"><h2>Setup</h2></div>
        <div class="set-list">${setups.length ? setups.map((x) => `<div class="set-row"><span>${esc(x)}</span><span class="muted small">${used[x] ? `${used[x]} trade` : 'non usato'}</span>
          <button class="btn ghost" data-ren-setup="${esc(x)}">Rinomina</button>${(S.settings.setups || []).includes(x) ? `<button class="btn ghost" data-del-setup="${esc(x)}" title="Togli dall'elenco dei suggerimenti">Togli</button>` : '<span></span>'}</div>`).join('') : '<div class="empty small">Nessun setup ancora.</div>'}</div>
        <div class="chip-add pad"><input class="input" id="newSetup" placeholder="Nuovo setup"><button class="btn" data-act="addsetup">Aggiungi</button></div>
        <div class="foot-note">L'elenco comprende i setup usati in tutti i tuoi conti e quelli creati da Trade Logger. Rinominando un setup cambia anche in tutti i trade già registrati.</div></section>

      <section class="card"><div class="card-head"><h2>Tag</h2></div>
        <div class="set-list">
          ${PRESET_TAGS.map((g) => `<div class="set-row ${hidden.includes(g) ? 'off' : ''}"><span>${esc(g)}</span><span class="muted small">predefinito${tagUse[g] ? `, ${tagUse[g]} trade` : ''}</span><button class="btn ghost" data-toggle-tag="${esc(g)}">${hidden.includes(g) ? 'Mostra' : 'Nascondi'}</button><span></span></div>`).join('')}
          ${custom.map((g) => `<div class="set-row"><span>${esc(g)}</span><span class="muted small">${tagUse[g] ? `${tagUse[g]} trade` : 'non usato'}</span><button class="btn ghost" data-ren-tag="${esc(g)}">Rinomina</button><button class="btn ghost" data-del-tag="${esc(g)}">Elimina</button></div>`).join('')}
        </div>
        <div class="chip-add pad"><input class="input" id="newTag" placeholder="Nuovo tag"><button class="btn" data-act="addtag">Aggiungi</button></div>
        <div class="foot-note">I tag nascosti non compaiono più tra le scelte ma restano sui trade che li hanno. Eliminando un tag personalizzato viene tolto anche dai trade.</div></section>
    </div>

    <div class="grid2">
      <section class="card"><div class="card-head"><h2>Valuta</h2></div>
        <div class="pad-box"><label class="field"><span>Valuta con cui mostrare risultati e statistiche</span>
          <select class="input" id="currency">${currencies.map((c) => `<option ${cur() === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <p class="muted small" style="margin:8px 0 0">Cambia solo la scritta accanto ai numeri: i valori non vengono convertiti.</p></div></section>
      <section class="card"><div class="card-head"><h2>Dati</h2></div>
        <div class="pad-box data-btns">
          <button class="btn" data-act="exp-one">Esporta questo conto (CSV)</button>
          <button class="btn" data-act="exp-all">Esporta tutti i conti (CSV)</button>
          <button class="btn primary" data-act="imp">Importa CSV in questo conto…</button>
          <input type="file" id="csvIn" accept=".csv,text/csv,.txt" hidden>
          <p class="muted small" style="margin:4px 0 0">Il CSV si apre con Excel. Per importare servono almeno le colonne Data e P&amp;L; vanno bene anche i nomi in inglese e il file esportato da Trade Logger.</p>
        </div></section>
    </div>
`;

  page.onchange = async (e) => {
    const k = e.target.closest('[data-kind]');
    if (k) {
      const a = S.accounts.find((x) => x.id === k.dataset.kind);
      try { await S.db.updateAccount(a.id, { kind: k.value }); a.kind = k.value; toast('Tipo aggiornato ✓'); if (a.id === S.accountId) { startPoint(); renderShell(); } }
      catch (er) { toast(errMsg(er), true); }
    }
    if (e.target.id === 'currency') { S.settings.currency = e.target.value; await saveSettings('Valuta aggiornata ✓'); }
    if (e.target.id === 'csvIn' && e.target.files[0]) { importCSV(e.target.files[0]); e.target.value = ''; }
  };
  page.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'newSetup') $('[data-act="addsetup"]').click();
    if (e.target.id === 'newTag') $('[data-act="addtag"]').click();
  };
  page.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    try {
      if (d.themePick) { chooseTheme(d.themePick); return; }
      if (S.local && await localAction(d)) return;
      if (d.act === 'newacc') {
        const r = await dialog({ title: 'Nuovo spazio', okText: 'Crea', fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'kind', label: 'Tipo', value: 'conto', options: [{ value: 'conto', label: 'Conto live' }, { value: 'backtest', label: 'Backtest' }] }] });
        if (!r || !r.name.trim()) return;
        S.accounts.push(await S.db.createAccount(r.name.trim(), r.kind)); renderSettings(); toast('Creato ✓');
      }
      if (d.renAcc) {
        const a = S.accounts.find((x) => x.id === d.renAcc);
        const r = await dialog({ title: 'Rinomina', okText: 'Salva', fields: [{ name: 'name', label: 'Nome', value: a.name, required: true }] });
        if (!r || !r.name.trim()) return;
        await S.db.updateAccount(a.id, { name: r.name.trim() }); a.name = r.name.trim(); renderShell();
      }
      if (d.delAcc) {
        const a = S.accounts.find((x) => x.id === d.delAcc);
        const ok = await confirmBox(`Eliminare "${a.name}"?`, 'Vengono cancellati per sempre tutti i suoi trade, le foto e le analisi. Non si può annullare.', 'Elimina per sempre');
        if (!ok) return;
        await S.db.deleteAccount(a.id);
        S.accounts = S.accounts.filter((x) => x.id !== a.id);
        if (S.accountId === a.id) await switchAccount(S.accounts[0].id); else renderSettings();
        toast('Conto eliminato');
      }
      if (d.act === 'addsetup') {
        const v = $('#newSetup').value.trim(); if (!v) return;
        S.settings.setups = [...new Set([...(S.settings.setups || []), v])]; await saveSettings('Setup aggiunto ✓'); renderSettings();
      }
      if (d.renSetup) {
        const r = await dialog({ title: 'Rinomina setup', okText: 'Rinomina', fields: [{ name: 'name', label: 'Nuovo nome', value: d.renSetup, required: true }] });
        const to = r && r.name.trim(); if (!to || to === d.renSetup) return;
        await S.db.renameSetup(d.renSetup, to);
        S.trades.forEach((t) => { if (t.setup === d.renSetup) t.setup = to; });
        if (S.setupCounts && S.setupCounts[d.renSetup] != null) { S.setupCounts[to] = (S.setupCounts[to] || 0) + S.setupCounts[d.renSetup]; delete S.setupCounts[d.renSetup]; }
        S.settings.setups = [...new Set((S.settings.setups || []).map((x) => (x === d.renSetup ? to : x)))]; await saveSettings('Setup rinominato ✓'); renderSettings();
      }
      if (d.delSetup) { S.settings.setups = (S.settings.setups || []).filter((x) => x !== d.delSetup); await saveSettings('Tolto dall\'elenco'); renderSettings(); }
      if (d.act === 'addtag') {
        const v = $('#newTag').value.trim(); if (!v) return;
        if ([...PRESET_TAGS, ...custom].some((x) => x.toLowerCase() === v.toLowerCase())) { toast('Esiste già un tag con questo nome.', true); return; }
        S.settings.customTags = [...custom, v]; await saveSettings('Tag aggiunto ✓'); renderSettings();
      }
      if (d.toggleTag) {
        S.settings.hiddenTags = hidden.includes(d.toggleTag) ? hidden.filter((x) => x !== d.toggleTag) : [...hidden, d.toggleTag];
        await saveSettings(); renderSettings();
      }
      if (d.renTag) {
        const r = await dialog({ title: 'Rinomina tag', okText: 'Rinomina', fields: [{ name: 'name', label: 'Nuovo nome', value: d.renTag, required: true }] });
        const to = r && r.name.trim(); if (!to || to === d.renTag) return;
        const n = await S.db.replaceTag(d.renTag, to);
        S.trades.forEach((t) => { t.tags = [...new Set(t.tags.map((g) => (g === d.renTag ? to : g)))]; });
        S.settings.customTags = custom.map((x) => (x === d.renTag ? to : x)); await saveSettings(`Tag rinominato in ${n} trade ✓`); renderSettings();
      }
      if (d.delTag) {
        if (!(await confirmBox(`Eliminare il tag "${d.delTag}"?`, tagUse[d.delTag] ? `Viene tolto anche da ${tagUse[d.delTag]} trade di questo conto (e dagli altri conti).` : ''))) return;
        await S.db.replaceTag(d.delTag, null);
        S.trades.forEach((t) => { t.tags = t.tags.filter((g) => g !== d.delTag); });
        S.settings.customTags = custom.filter((x) => x !== d.delTag); await saveSettings('Tag eliminato'); renderSettings();
      }
      if (d.act === 'exp-one') {
        const a = account();
        download(`journal-${a.name.replace(/[^\w-]+/g, '_')}-${ymd(new Date())}.csv`, toCSV([...S.trades].sort(sortTrades)));
      }
      if (d.act === 'exp-all') {
        b.disabled = true; b.textContent = 'Preparo il file…';
        const all = [];
        for (const a of S.accounts) (await S.db.listTrades(a.id)).forEach((t) => all.push({ ...normalizeTrade(t), _account: a.name }));
        download(`journal-tutti-${ymd(new Date())}.csv`, toCSV(all.sort(sortTrades), true));
        b.disabled = false; b.textContent = 'Esporta tutti i conti (CSV)';
      }
      if (d.act === 'imp') $('#csvIn').click();
    } catch (er) { toast(errMsg(er), true); }
  };
}

async function importCSV(file) {
  try {
    const text = await file.text();
    const { trades, bad, columns } = csvToTrades(text, S.accountId);
    // salto i trade già presenti (stessa data, ora, simbolo e P&L)
    const key = (t) => [t.trade_date, t.trade_time, t.symbol, Number(t.pnl).toFixed(2)].join('|');
    const have = new Set(S.trades.map(key));
    const fresh = trades.filter((t) => !have.has(key(t)));
    const msg = `${trades.length} trade trovati, ${fresh.length} nuovi${trades.length - fresh.length ? `, ${trades.length - fresh.length} già presenti (saltati)` : ''}${bad.length ? `, ${bad.length} righe senza data valida (saltate)` : ''}. Colonne riconosciute: ${columns.length}.`;
    if (!fresh.length) { await dialog({ title: 'Niente da importare', text: msg, okText: 'OK' }); return; }
    if (!(await dialog({ title: `Importare in "${account().name}"?`, text: msg, okText: `Importa ${fresh.length} trade` }))) return;
    toast('Importo…');
    const created = await S.db.insertTrades(fresh);
    S.trades.push(...created.map(normalizeTrade));
    toast(`${created.length} trade importati ✓`);
    renderShell();
  } catch (e) { toast(errMsg(e), true); }
}

// =====================================================================
//  Notizie economiche (le scarica Trade Logger e le salva nel database)
// =====================================================================
const IMPACT = { High: ['Alto', 'high'], Medium: ['Medio', 'med'], Low: ['Basso', 'low'], Holiday: ['Festivo', 'hol'] };
const timeOf = (e) => new Date(e.event_time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const newsCurrencies = () => (S.settings.newsCur && S.settings.newsCur.length ? S.settings.newsCur : ['USD']);
const newsImpacts = () => (S.settings.newsImp && S.settings.newsImp.length ? S.settings.newsImp : ['High', 'Medium']);

// notizie di un mese (con un giorno di margine per i fusi orari), tenute in memoria
async function ensureNews(y, m) {
  const key = `${y}-${pad(m + 1)}`;
  if (S.newsCache[key]) return S.newsCache[key];
  if (S.newsOk === null) S.newsOk = await S.db.hasNews().catch(() => false);
  if (!S.newsOk) return (S.newsCache[key] = []);
  try {
    const rows = await S.db.listNews(new Date(y, m, 1).toISOString(), new Date(y, m + 1, 1).toISOString());
    S.newsCache[key] = rows.map((e) => ({ ...e, day: ymd(new Date(e.event_time)) }));
  } catch { S.newsCache[key] = []; }
  return S.newsCache[key];
}
// giorno -> notizie ad alto impatto delle valute scelte (per i marchi nel calendario)
function newsByDay(y, m) {
  const ev = S.newsCache[`${y}-${pad(m + 1)}`] || [], cur = newsCurrencies(), out = {};
  ev.filter((e) => e.impact === 'High' && cur.includes(e.currency)).forEach((e) => { (out[e.day] = out[e.day] || []).push(e); });
  return out;
}

function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }

async function renderNews() {
  const page = $('#page');
  if (!S.newsWeek) S.newsWeek = mondayOf(new Date());
  const mon = S.newsWeek, sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  const monthsNeeded = [...new Set([`${mon.getFullYear()}-${mon.getMonth()}`, `${sun.getFullYear()}-${sun.getMonth()}`])].map((k) => k.split('-').map(Number));
  page.innerHTML = '<div class="empty">Carico le notizie…</div>';
  const all = (await Promise.all(monthsNeeded.map(([y, m]) => ensureNews(y, m)))).flat();
  if (S.page !== 'news') return;
  const from = ymd(mon), to = ymd(sun);
  const week = all.filter((e) => e.day >= from && e.day <= to);
  const curs = [...new Set([...week.map((e) => e.currency).filter(Boolean), ...newsCurrencies()])].sort((a, b) => (a === 'USD' ? -1 : b === 'USD' ? 1 : a.localeCompare(b)));
  const selC = newsCurrencies(), selI = newsImpacts();
  const shown = week.filter((e) => (e.impact === 'Holiday' ? selI.includes('Holiday') : selI.includes(e.impact)) && (e.impact === 'Holiday' || selC.includes(e.currency) || !e.currency));
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const title = `${mon.getDate()} ${mon.getMonth() === sun.getMonth() ? '' : MONTHS[mon.getMonth()] + ' '}– ${sun.getDate()} ${MONTHS[sun.getMonth()]} ${sun.getFullYear()}`;
  const today = ymd(new Date());
  let body;
  if (S.newsOk === false) body = `<div class="empty">La tabella delle notizie non c'è ancora nel database.<br><br>Su Supabase apri <b>SQL Editor</b>, poi <b>New query</b>, incolla il contenuto del file <code>aggiornamento-0.7.sql</code> e premi <b>Run</b>. Poi, da Trade Logger: tre puntini, <b>Aggiorna notizie economiche</b>.</div>`;
  else if (!week.length && S.local) body = `<div class="empty">Nessuna notizia salvata per questa settimana.<br><br>Premi <b>Aggiorna notizie</b> (serve internet): si scaricano quelle della settimana in corso e della prossima, e col tempo si accumula lo storico anche delle settimane passate. Si aggiornano anche da sole ogni 3 ore mentre il Journal è aperto.</div>`;
  else if (!week.length) body = `<div class="empty">Nessuna notizia salvata per questa settimana.<br><br>Le notizie le scarica <b>Trade Logger</b> (all'avvio e ogni 3 ore, oppure dai tre puntini, <b>Aggiorna notizie economiche</b>) e valgono per la settimana in corso e la prossima. Col tempo si accumula lo storico anche delle settimane passate.</div>`;
  else if (!shown.length) body = '<div class="empty">Nessun evento con questi filtri: prova ad aggiungere altre valute o un altro livello di impatto.</div>';
  else {
    const days = {}; shown.forEach((e) => { (days[e.day] = days[e.day] || []).push(e); });
    body = Object.keys(days).sort().map((k) => `<div class="nd ${k === today ? 'today' : ''}">
      <div class="nd-h">${parseYmd(k).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}${k === today ? ' <span class="tag-today">oggi</span>' : ''}</div>
      ${days[k].map((e) => `<div class="nr ${IMPACT[e.impact] ? IMPACT[e.impact][1] : 'low'}">
        <span class="nt">${e.impact === 'Holiday' ? '' : timeOf(e)}</span><span class="nc">${esc(e.currency)}</span>
        <span class="ni" title="Impatto ${IMPACT[e.impact] ? IMPACT[e.impact][0] : ''}"><i></i></span>
        <span class="ne">${esc(e.title)}</span>
        <span class="nv"><span><small>Precedente</small>${esc(e.previous) || '—'}</span><span><small>Previsto</small>${esc(e.forecast) || '—'}</span><span><small>Effettivo</small>${esc(e.actual) || '—'}</span></span></div>`).join('')}</div>`).join('');
  }
  page.innerHTML = `
    <section class="card"><div class="card-head"><h2>News</h2><div class="grow"></div>
      <div class="cal-nav"><button class="btn ghost icon" data-nw="-1" aria-label="Settimana precedente">‹</button><strong style="min-width:190px">${title}</strong><button class="btn ghost icon" data-nw="1" aria-label="Settimana successiva">›</button></div>
      <button class="btn" data-nw="0">Questa settimana</button>${S.local ? '<button class="btn" data-news-refresh>Aggiorna notizie</button>' : ''}</div>
      <div class="nfilters">
        <div class="chips"><span class="muted small">Impatto</span>${Object.entries(IMPACT).map(([k, [l]]) => `<button class="chip ${selI.includes(k) ? 'on' : ''}" data-imp="${k}" aria-pressed="${selI.includes(k)}">${l}</button>`).join('')}</div>
        <div class="chips"><span class="muted small">Valuta</span>${curs.map((c) => `<button class="chip ${selC.includes(c) ? 'on' : ''}" data-cur="${c}" aria-pressed="${selC.includes(c)}">${c}</button>`).join('')}</div>
      </div>
      <div class="nlist">${body}</div>
      <div class="foot-note">${shown.length ? `${shown.length} eventi · ` : ''}Orari nel fuso del tuo dispositivo (${esc(tz)}). Fonte: calendario pubblico di Forex Factory, scaricato ${S.local ? 'da questo programma (o da Trade Logger)' : 'da Trade Logger'}. Il calendario della dashboard segna con un puntino rosso i giorni con notizie ad alto impatto delle valute scelte qui.</div></section>`;
  page.onclick = async (e) => {
    if (e.target.closest('[data-news-refresh]')) {
      toast('Scarico le notizie…');
      try { const r = await S.db.call('refreshNews', { manual: true }); if (r.error) toast(r.error, true); else { S.newsCache = {}; toast(`Notizie aggiornate: ${r.count} eventi ✓`); renderNews(); } }
      catch (er) { toast(errMsg(er), true); }
      return;
    }
    const n = e.target.closest('[data-nw]');
    if (n) { const k = Number(n.dataset.nw); S.newsWeek = k === 0 ? mondayOf(new Date()) : new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7 * k); renderNews(); return; }
    const im = e.target.closest('[data-imp]');
    if (im) { const cur = newsImpacts(); S.settings.newsImp = cur.includes(im.dataset.imp) ? cur.filter((x) => x !== im.dataset.imp) : [...cur, im.dataset.imp]; await saveSettings('Filtro salvato ✓'); renderNews(); return; }
    const cu = e.target.closest('[data-cur]');
    if (cu) { const cur = newsCurrencies(); S.settings.newsCur = cur.includes(cu.dataset.cur) ? cur.filter((x) => x !== cu.dataset.cur) : [...cur, cu.dataset.cur]; await saveSettings('Filtro salvato ✓'); renderNews(); }
  };
}

// =====================================================================
//  Journal locale (programma sul PC): dati, screenshot, copia di sicurezza, importazione
// =====================================================================
function localHooks() {
  // Trade Logger (un altro programma) scrive negli stessi file: quando cambiano aggiorno la vista
  window.localStore.onChange(() => { refreshAccounts(); autoRefresh(); refreshLocalSettings(); });
  setInterval(autoRefresh, 15 * 1000);
  const news = () => S.db.call('refreshNews', { manual: false }).catch(() => {});
  setTimeout(news, 4000); setInterval(news, 3 * 3600e3);       // notizie economiche: da sole, se c'è internet
}
async function refreshLocalSettings() {
  try {
    const s = await S.db.getSettings();
    for (const k of ['setups', 'customTags', 'hiddenTags']) if (Array.isArray(s[k])) S.settings[k] = s[k];
    S.setupCounts = await S.db.setupCounts();
  } catch { /* al prossimo giro */ }
}
function localCard() {
  const i = S.localInfo || {};
  return `<section class="card"><div class="card-head"><h2>Dati sul tuo PC</h2></div>
    <div class="pad-box loc-box">
      <p class="muted small" style="margin:0 0 12px">Tutto è salvato in cartelle sul tuo PC, senza internet e senza account. Trade Logger e Journal sono due programmi separati che usano gli stessi dati: puoi aprire l'uno senza l'altro.</p>
      <label class="field"><span>Cartella dei dati</span><div class="row"><input class="input" readonly value="${esc(i.dataDir || '')}" title="${esc(i.dataDir || '')}"><button class="btn" data-act="loc-open-data">Apri</button></div></label>
      <label class="field"><span>Cartella degli screenshot</span><div class="row"><input class="input" readonly value="${esc(i.shotsDir || '')}" title="${esc(i.shotsDir || '')}"><button class="btn" data-act="loc-shots-change">Cambia…</button><button class="btn" data-act="loc-shots-open">Apri</button></div></label>
      <div class="loc-actions"><button class="btn" data-act="loc-backup">Crea una copia dei dati…</button><button class="btn" data-act="loc-import">Importa dal journal online…</button></div>
      <p class="muted small" style="margin:14px 0 6px"><b>Condividere i tuoi trade per studio</b>: crea un file da mandare a un'altra persona, che lo importa nel suo Journal come conto separato (non vede il resto dei tuoi dati e tu non vedi le sue annotazioni).</p>
      <div class="loc-actions"><button class="btn" data-act="loc-share">Condividi per studio…</button><button class="btn" data-act="loc-import-share">Importa un pacchetto condiviso…</button></div>
      <p class="small ${S.locMsg && S.locMsg.err ? 'neg' : 'pos'}" id="locMsg" role="status" style="margin:10px 0 0">${esc(S.locMsg ? S.locMsg.t : '')}</p>
    </div></section>`;
}
async function localAction(d) {
  const say = (t, err = false) => { S.locMsg = { t, err }; const m = $('#locMsg'); if (m) { m.textContent = t; m.className = 'small ' + (err ? 'neg' : 'pos'); } };   // il messaggio resta anche se la pagina si ridisegna
  if (d.act === 'upd-check') { await S.db.call('updateCheck'); return true; }
  if (d.act === 'upd-save') { try { const r = await S.db.call('updateSet', { url: ($('#updUrl') || {}).value || '' }); S.updUrl = r.url; const i = $('#updUrl'); if (i) i.value = r.url; toast('Indirizzo salvato'); } catch (e) { toast(errMsg(e), true); } return true; }
  if (d.act === 'loc-open-data') { await S.db.call('openFolder', { which: 'data' }); return true; }
  if (d.act === 'loc-shots-open') { await S.db.call('openFolder', { which: 'shots' }); return true; }
  if (d.act === 'loc-shots-change') {
    const r = await S.db.call('chooseShotsDir');
    if (!r) return true;
    S.localInfo = await S.db.call('info'); await loadAccountData(); renderSettings();
    say(`Fatto: ${r.moved} screenshot spostati${r.kept ? `, ${r.kept} lasciati dove sono` : ''}${r.failed ? `, ${r.failed} non spostati` : ''}.`, !!r.failed);
    return true;
  }
  if (d.act === 'loc-backup') {
    say('Creo la copia…');
    const r = await S.db.call('backup');
    say(r ? `Copia creata: ${r.dir} (${r.files} file di dati, ${r.shots} screenshot${r.missing ? `, ${r.missing} mancanti` : ''}).` : '');
    return true;
  }
  if (d.act === 'loc-share') { await shareDialog(say); return true; }
  if (d.act === 'loc-import-share') {
    say('Scelgo il pacchetto…');
    try {
      const r = await S.db.call('importShare');
      if (!r) { say(''); return true; }
      S.accounts = await S.db.listAccounts(); S.accountId = r.accountId;
      try { localStorage.setItem('journal.account', r.accountId); } catch { /* niente */ }
      await loadAccountData(); startPoint(); renderShell();
      toast('Pacchetto importato ✓');
      say(`Importato come conto «${r.name}»: ${r.trades} trade, ${r.images} foto${r.skippedImages ? ` (${r.skippedImages} non importate)` : ''}${r.days ? `, ${r.days} analisi dei giorni` : ''}.${r.hideAmounts ? ' ' + (r.scaleNote || 'Gli importi sono nascosti.') : ''} Lo trovi nel menu dei conti, in alto, con la scritta "(condiviso)".`);
    } catch (e) { say(errMsg(e), true); toast(errMsg(e), true); }
    return true;
  }
  if (d.act === 'loc-import') {
    const r = await dialog({
      title: 'Importa dal journal online', okText: 'Importa',
      text: 'Copia qui i tuoi dati dal journal online (trade, foto, analisi dei giorni, tag e setup). Online non viene cambiato nulla, e prima dell\'importazione si fa una copia di sicurezza dei dati di qui. Rifarla non crea doppioni.',
      fields: [{ name: 'url', label: 'Project URL di Supabase', required: true }, { name: 'key', label: 'Publishable key di Supabase', required: true }, { name: 'email', label: 'Email del journal', required: true }, { name: 'password', label: 'Password del journal', required: true, type: 'password' }],
    });
    if (!r) return true;
    const off = window.localStore.onProgress((t) => say(t));
    say('Avvio l\'importazione…');
    try {
      const x = await S.db.call('importOnline', r);
      S.accounts = await S.db.listAccounts(); S.localInfo = await S.db.call('info'); await loadAccountData(); await refreshLocalSettings(); renderShell();
      const msg = `Importati: ${x.trades} trade, ${x.images} foto${x.imagesFailed ? ` (${x.imagesFailed} non scaricate)` : ''}, ${x.accounts} conti, ${x.days} analisi dei giorni. Già presenti: ${x.skipped} trade.`;
      toast('Importazione completata ✓'); say(msg);
    } catch (e) { say(errMsg(e), true); toast(errMsg(e), true); }
    finally { off && off(); }
    return true;
  }
  return false;
}

// ---- Condividi per studio: crea il pacchetto che un'altra persona importa nel suo Journal ----
function shareDialog(say) {
  const mine = S.accounts.filter((a) => !a.shared);
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal small" role="dialog" aria-modal="true" aria-label="Condividi per studio">
      <div class="modal-head"><h2>Condividi per studio</h2></div>
      <form class="modal-body">
        <p class="muted" style="margin:0">Crea un file da mandare a un'altra persona. Lo importa nel suo Journal come conto separato: non vede il resto dei tuoi dati e non cambia nulla nei tuoi.</p>
        <label class="field"><span>Conto da condividere</span><select class="input" name="accountId">${mine.map((a) => `<option value="${esc(a.id)}" ${a.id === S.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <div class="field-row"><label class="field"><span>Dal (vuoto = dall'inizio)</span><input class="input" type="date" name="from"></label><label class="field"><span>Al (vuoto = fino a oggi)</span><input class="input" type="date" name="to"></label></div>
        <label class="field"><span>Il tuo nome (lo vede chi riceve)</span><input class="input" name="fromName" maxlength="60" placeholder="Es. Davide"></label>
        <label class="chk"><input type="checkbox" name="includeNotes" checked> Includi le mie note sui trade</label>
        <label class="chk"><input type="checkbox" name="includeEmotions" checked> Includi le emozioni</label>
        <label class="chk"><input type="checkbox" name="includeDays" checked> Includi le analisi dei giorni</label>
        <label class="chk"><input type="checkbox" name="includeScreens" checked> Includi gli screenshot</label>
        <label class="chk"><input type="checkbox" name="hideAmounts"> Nascondi gli importi in dollari (tutto in scala: 100 = rischio tipico)</label>
        <p class="small neg" id="shareWarn" hidden></p>
        <p class="muted small" style="margin:0">Gli screenshot possono mostrare saldo, ordini e altre parti dello schermo: guardali prima di condividerli. Il file porta solo i trade chiusi del periodo scelto.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px"><button type="button" class="btn ghost" data-x>Annulla</button><button class="btn primary">Crea il pacchetto…</button></div>
      </form></div>`;
    const close = (v) => { ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(null); });
    $('[data-x]', ov).onclick = () => close(null);
    const f = $('form', ov), warn = $('#shareWarn', ov);
    const refresh = () => {
      const hide = f.elements.hideAmounts.checked, scr = f.elements.includeScreens.checked;
      warn.hidden = !(hide && scr);
      warn.textContent = 'Attenzione: con gli importi nascosti gli screenshot possono comunque mostrare saldo e importi. Meglio non includerli.';
    };
    f.elements.hideAmounts.onchange = () => { if (f.elements.hideAmounts.checked) f.elements.includeScreens.checked = false; refresh(); };
    f.elements.includeScreens.onchange = refresh;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const o = { accountId: f.elements.accountId.value, from: f.elements.from.value, to: f.elements.to.value, fromName: f.elements.fromName.value.trim(),
        includeNotes: f.elements.includeNotes.checked, includeEmotions: f.elements.includeEmotions.checked, includeDays: f.elements.includeDays.checked, includeScreens: f.elements.includeScreens.checked, hideAmounts: f.elements.hideAmounts.checked };
      const btn = $('.btn.primary', f); btn.disabled = true;
      try {
        const r = await S.db.call('exportShare', o);
        close(r);
        if (r) {
          const mb = (r.bytes / 1048576).toFixed(r.bytes > 10485760 ? 0 : 1);
          toast('Pacchetto creato ✓');
          say(`Pacchetto creato: ${r.file} (${r.trades} trade, ${r.images} foto, ${mb} MB${r.hideAmounts ? ', importi nascosti' : ''}). Mandalo alla persona: nel suo Journal deve aprire Impostazioni, Dati sul tuo PC, Importa un pacchetto condiviso….`);
        } else say('');
      } catch (er) { btn.disabled = false; toast(errMsg(er), true); }
    };
    document.body.appendChild(ov);
    $('select', ov).focus();
  });
}
