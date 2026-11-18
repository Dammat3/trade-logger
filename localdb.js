/* Journal locale: accesso ai dati sul PC. Ha gli stessi metodi del database online (SupaDB),
   quindi tutta l'interfaccia funziona uguale; i dati stanno in file nella cartella del programma
   e Trade Logger (un altro programma) li legge e scrive allo stesso modo. */
class LocalDB {
  constructor() { this.uid = 'locale'; this._base = null; }
  async call(method, args) {
    try { return await window.localStore.invoke(method, args || {}); }
    catch (e) { throw new Error(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  }
  async currentUser() { return { email: 'Dati sul tuo PC' }; }
  async signIn() { return this.currentUser(); }
  async signUp() { return this.currentUser(); }
  async signOut() { /* niente accesso: nessuna uscita */ }
  listAccounts() { return this.call('listAccounts'); }
  createAccount(name, kind) { return this.call('createAccount', { name, kind }); }
  updateAccount(id, patch) { return this.call('updateAccount', { id, patch }); }
  deleteAccount(id) { return this.call('deleteAccount', { id }); }
  renameSetup(from, to) { return this.call('renameSetup', { from, to }); }
  replaceTag(from, to) { return this.call('replaceTag', { from, to }); }
  insertTrades(rows) { return this.call('insertTrades', { rows, accountId: rows[0] && rows[0].account_id }); }
  listTrades(accountId) { return this.call('listTrades', { accountId }); }
  createTrade(t) { return this.call('createTrade', { row: t, accountId: t.account_id }); }
  updateTrade(id, patch) { return this.call('updateTrade', { id, patch }); }
  deleteTrade(t) { return this.call('deleteTrade', { id: t.id }); }
  async uploadImage(trade, blob, timeframe = '') {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return this.call('uploadImage', { tradeId: trade.id, bytes, mime: blob.type || 'image/png', timeframe });
  }
  updateImage(id, patch) { return this.call('updateImage', { id, patch }); }
  deleteImage(img) { return this.call('deleteImage', { id: img.id }); }
  imageUrls(paths) { return this.call('imageUrls', { paths }); }
  async hasMoneyCols() { return true; }
  async hasNews() { return true; }
  setupCounts() { return this.call('setupCounts'); }
  listNews(from, to) { return this.call('listNews', { from, to }); }
  listDayNotes(accountId) { return this.call('listDayNotes', { accountId }); }
  saveDayNote(accountId, day, notes) { return this.call('saveDayNote', { accountId, day, notes }); }
  deleteDayNote(accountId, day) { return this.call('deleteDayNote', { accountId, day }); }
  async getSettings() { const s = await this.call('getSettings'); this._base = JSON.parse(JSON.stringify(s)); return s; }
  // le liste (setup, tag…) si fondono con quelle scritte nel frattempo da Trade Logger; il risultato torna nell'oggetto passato
  async saveSettings(data) {
    const merged = await this.call('saveSettings', { data, base: this._base });
    this._base = JSON.parse(JSON.stringify(merged));
    if (data && typeof data === 'object') Object.assign(data, merged);
    return merged;
  }
}
window.LocalDB = LocalDB;
