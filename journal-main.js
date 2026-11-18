'use strict';
// Journal: programma sul PC, indipendente da Trade Logger. Legge e scrive i dati in Documenti\TradeLogger
// (gli stessi file di Trade Logger), quindi si possono aprire insieme o uno senza l'altro.
const { app, BrowserWindow, ipcMain, dialog, shell, net, Menu, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const updaterLib = require('./updater');
const { createCore } = require('./journalcore');
const { fetchEvents } = require('./newsfetch');

app.setName('Journal');
if (process.platform === 'win32') app.setAppUserModelId('it.tradelogger.journal');
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
const alive = (w) => w && !w.isDestroyed();
const THEME_BG = { classico: '#0d0f12', neon: '#05060d', aurora: '#070a1c', ghiaccio: '#e9eff8', olografico: '#08080f', ambra: '#050403', plasma: '#0a0316' };

function loadSupabase() { try { return require('@supabase/supabase-js').createClient; } catch { return null; } }

function makeCore() {
  return createCore({
    store, version: app.getVersion(), fetchEvents, fetchFn: (u, o) => net.fetch(u, o), createClient: loadSupabase(),
    // gli screenshot eliminati vanno nel cestino, non spariscono per sempre
    trash: async (f) => { try { await shell.trashItem(f); } catch { try { fs.unlinkSync(f); } catch { /* già tolto */ } } },
    openPath: (p) => shell.openPath(p),
    copyText: (t) => clipboard.writeText(t),
    copyImage: (buf) => { const img = nativeImage.createFromBuffer(buf); if (img.isEmpty()) throw new Error('Immagine non valida.'); clipboard.writeImage(img); },
    showItem: (f) => shell.showItemInFolder(f),
    // foto del pacchetto condiviso: JPEG ridotti, così il file resta leggero
    encodeImage: async (file, { maxWidth, quality }) => {
      let img = nativeImage.createFromPath(file);
      if (img.isEmpty()) return null;
      const w = img.getSize().width;
      if (maxWidth && w > maxWidth) img = img.resize({ width: maxWidth, quality: 'best' });
      return img.toJPEG(quality || 80);
    },
    onProgress: (t) => { if (alive(win)) win.webContents.send('import-progress', t); },
    dialogs: {
      pickFolder: async (title, def) => {
        const r = await dialog.showOpenDialog(win, { title, defaultPath: def, properties: ['openDirectory', 'createDirectory'] });
        return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
      },
      saveFile: async (defaultName) => {
        const r = await dialog.showSaveDialog(win, { title: 'Salva il pacchetto da condividere', defaultPath: path.join(app.getPath('documents'), defaultName), filters: [{ name: 'Pacchetto Journal', extensions: ['journalshare'] }] });
        return r.canceled || !r.filePath ? null : r.filePath;
      },
      pickFile: async (title, filters) => {
        const r = await dialog.showOpenDialog(win, { title, filters, properties: ['openFile'] });
        return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
      },
      askMove: async (dir) => {
        const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Sposta gli screenshot', 'Lascia dove sono', 'Annulla'], defaultId: 0, cancelId: 2,
          message: 'Cambiare la cartella degli screenshot?',
          detail: `Nuova cartella:\n${dir}\n\n"Sposta" porta nella nuova cartella gli screenshot già salvati. "Lascia dove sono" li tiene dov'erano (i trade ne ricordano il percorso); da ora i nuovi vanno nella cartella nuova.` });
        return r.response === 0 ? 'move' : r.response === 1 ? 'keep' : null;
      },
    },
  });
}

function createWindow() {
  const theme = (store.readSettings() || {}).theme;
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 560, title: 'Journal', autoHideMenuBar: true,
    backgroundColor: THEME_BG[theme] || THEME_BG.classico,
    icon: path.join(__dirname, 'build', 'journal-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload-journal.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // menu nascosto (Alt lo mostra): serve per copia/incolla e zoom con la tastiera
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'viewMenu' }]));
  win.loadFile(path.join('journal-ui', 'index.html'));
  // la pagina non può aprire altre finestre né andare altrove; i link esterni si aprono nel browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => { if (alive(win)) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  store.init(path.join(app.getPath('documents'), 'TradeLogger'));
  store.ensureAccounts({});            // se Trade Logger non è mai stato aperto: nasce il conto "Personale"
  const core = makeCore();
  let upd = null;
  try { upd = updaterLib.create({ app, dialog, dataDir: () => store.dataDir(), name: 'Journal', channel: 'journal' }); upd.check({ silent: true }); } catch { /* gli aggiornamenti non devono bloccare l'avvio */ }
  try { core.autoBackup(); } catch { /* la copia automatica non deve mai bloccare l'avvio */ }
  ipcMain.handle('core', async (_e, method, args) => {
    if (method === 'updateCheck') { if (!upd) throw new Error('Aggiornamenti non disponibili'); return upd.check({ silent: false }); }
    if (!Object.prototype.hasOwnProperty.call(core, method)) throw new Error('Operazione sconosciuta');
    return core[method](args || {});
  });
  createWindow();
  // quando Trade Logger (o un'altra finestra) cambia i file, la vista si aggiorna da sola
  try { store.watch(() => { if (alive(win)) win.webContents.send('store-changed'); }); } catch { /* si aggiorna comunque ogni 15 secondi */ }
  app.on('activate', () => { if (!alive(win)) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
