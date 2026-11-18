// Aggiornamenti automatici (usato da Trade Logger e da Journal).
// L'indirizzo dove cercare le nuove versioni sta in Documenti\TradeLogger\aggiornamenti.json ({"url": "..."}):
// se non c'è, non succede niente. Senza firma digitale Windows lo permette lo stesso (installazione per utente).
const fs = require('fs');
const path = require('path');

function create({ app, dialog, dataDir, name, channel }) {
  let autoUpdater = null, busy = false;
  const file = () => path.join(dataDir(), 'aggiornamenti.json');
  const getUrl = () => { try { return String(JSON.parse(fs.readFileSync(file(), 'utf8')).url || '').trim(); } catch { return ''; } };
  const setUrl = (url) => {
    url = String(url || '').trim();
    if (url && !/^https:\/\/[^\s]+$/.test(url)) throw new Error('L\'indirizzo deve iniziare con https://');
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ url: url.replace(/\/+$/, '') }, null, 2));
    return getUrl();
  };
  function init() {
    if (autoUpdater) return autoUpdater;
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    if (channel) autoUpdater.channel = channel;   // Journal usa journal.yml, così le due app non si confondono
    return autoUpdater;
  }
  // silent = all'avvio: niente messaggi se non c'è nulla di nuovo o se manca internet
  async function check({ silent = true } = {}) {
    if (busy) return { state: 'busy' };
    const url = getUrl();
    if (!app.isPackaged) return { state: 'dev' };
    if (!url) { if (!silent) await dialog.showMessageBox({ type: 'info', message: 'Aggiornamenti non configurati', detail: 'Inserisci l\'indirizzo degli aggiornamenti nelle impostazioni di Trade Logger.' }); return { state: 'nourl' }; }
    busy = true;
    try {
      const u = init();
      u.setFeedURL({ provider: 'generic', url });
      const r = await u.checkForUpdates();
      const info = r && r.updateInfo;
      if (!info || info.version === app.getVersion()) {
        if (!silent) await dialog.showMessageBox({ type: 'info', message: `${name} è aggiornato`, detail: `Versione ${app.getVersion()}.` });
        return { state: 'uptodate' };
      }
      await r.downloadPromise;
      const a = await dialog.showMessageBox({ type: 'question', buttons: ['Riavvia e aggiorna', 'Più tardi'], defaultId: 0, cancelId: 1,
        message: `Nuova versione di ${name}: ${info.version}`, detail: 'È già scaricata. Se scegli "Più tardi" si installa da sola alla prossima chiusura.' });
      if (a.response === 0) u.quitAndInstall();
      return { state: 'downloaded', version: info.version };
    } catch (e) {
      if (!silent) await dialog.showMessageBox({ type: 'warning', message: 'Non riesco a controllare gli aggiornamenti', detail: String(e && e.message || e).slice(0, 300) });
      return { state: 'error', error: String(e && e.message || e) };
    } finally { busy = false; }
  }
  return { getUrl, setUrl, check };
}
module.exports = { create };
