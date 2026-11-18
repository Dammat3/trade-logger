const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NAMES = { new: '+ Trade (apri)', tp: 'TP (chiudi a take profit)', sl: 'SL (chiudi a stop loss)', man: 'Man (chiudi a mano)' };
let keys = {}, defaults = {}, failed = [], recording = null;

const pretty = (acc) => acc ? acc.replace('CommandOrControl', /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl').replace('Super', /Mac/i.test(navigator.platform) ? '⌘' : 'Win').split('+').join(' + ') : 'Nessuna';

function renderKeys() {
  $('keys').innerHTML = Object.keys(NAMES).map((k) => `
    <span class="name">${NAMES[k]}</span>
    <button class="combo ${recording === k ? 'rec' : ''} ${failed.includes(k) ? 'bad' : ''} ${!keys[k] && recording !== k ? 'none' : ''}" data-rec="${k}">${recording === k ? 'Premi i tasti…' : esc(pretty(keys[k]))}</button>
    <button class="small-btn" data-clear="${k}" title="Nessuna scorciatoia">Togli</button>
    <button class="small-btn" data-def="${k}" title="${esc(pretty(defaults[k]))}">Predefinita</button>`).join('');
}
function keyMsg(text, cls = '') { $('keyMsg').textContent = text; $('keyMsg').className = 'msg ' + cls; }

async function saveKeys() {
  const used = {};
  for (const [k, v] of Object.entries(keys)) {
    if (!v) continue;
    if (used[v]) { failed = [k]; renderKeys(); keyMsg(`${pretty(v)} è già usata per "${NAMES[used[v]]}".`, 'err'); return; }
    used[v] = k;
  }
  failed = await api.settingsSaveKeys(keys);
  renderKeys();
  if (failed.length) keyMsg(`Non riesco a usare: ${failed.map((k) => pretty(keys[k])).join(', ')}. Probabilmente la usa già un altro programma: scegline un'altra.`, 'err');
  else keyMsg('Scorciatoie salvate ✓', 'ok');
}

// trasforma il tasto premuto nel formato di Electron (es. CommandOrControl+Alt+T)
function accelerator(e) {
  const c = e.code; let key = null;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else if (/^Numpad\d$/.test(c)) key = 'num' + c.slice(6);
  else key = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' }[c] || null;
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (!mods.length && !/^F\d/.test(key)) return 'NOMOD';
  return [...mods, key].join('+');
}

document.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  if (e.key === 'Escape') { recording = null; renderKeys(); saveKeys(); return; }
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return;   // aspetto il tasto vero
  const acc = accelerator(e);
  if (acc === 'NOMOD') { keyMsg('Usa almeno uno tra Ctrl, Alt o Shift insieme al tasto (oppure un tasto F1–F12).', 'err'); return; }
  if (!acc) { keyMsg('Questo tasto non si può usare: scegline un altro.', 'err'); return; }
  keys[recording] = acc; recording = null;
  saveKeys();
});

$('keys').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.rec) { recording = b.dataset.rec; failed = []; keyMsg('Premi la combinazione, oppure Esc per annullare.'); api.settingsPauseKeys(); renderKeys(); }
  if (b.dataset.clear) { keys[b.dataset.clear] = ''; saveKeys(); }
  if (b.dataset.def) { keys[b.dataset.def] = defaults[b.dataset.def]; saveKeys(); }
});

// ----- conto -----
function accMsg(text, cls = '') { $('accMsg').textContent = text; $('accMsg').className = 'msg ' + cls; }
function fillAccounts(list, current) {
  $('account').innerHTML = (current ? '' : '<option value="" selected disabled>Scegli il conto…</option>')
    + list.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} — ${a.kind === 'backtest' ? 'backtest' : 'conto live'}</option>`).join('');
  if (current) $('account').value = current;
}
$('account').addEventListener('change', async (e) => {
  try { await api.settingsAccount(e.target.value); accMsg('Conto cambiato ✓', 'ok'); fillPlatforms(await api.settingsGet()); }
  catch (err) { accMsg(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'); }
});
$('showNew').onclick = () => { $('newBox').hidden = false; $('newName').focus(); };
$('cancelNew').onclick = () => { $('newBox').hidden = true; $('newName').value = ''; };
$('createNew').onclick = async () => {
  $('createNew').disabled = true;
  try {
    const r = await api.settingsCreateAccount({ name: $('newName').value, kind: $('newKind').value });
    fillAccounts(r.accounts, r.accountId);
    $('newBox').hidden = true; $('newName').value = '';
    accMsg('Conto creato e selezionato ✓ (lo trovi anche nel sito)', 'ok');
  } catch (err) { accMsg(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'); }
  finally { $('createNew').disabled = false; }
};
$('newName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('createNew').click(); });
$('goLink').onclick = () => api.settingsLink();

// ----- piattaforma -----
function plMsg(text, cls = '') { $('plMsg').textContent = text; $('plMsg').className = 'msg ' + cls; }
function fillPlatforms(d) {
  $('platform').innerHTML = d.platforms.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.calibrated ? '' : ' (da calibrare)'}</option>`).join('');
  $('platform').value = d.activePlatform;
  const cur = d.platforms.find((p) => p.id === d.activePlatform);
  $('layoutMode').value = (cur && cur.layoutMode) || 'auto';
  $('calibrateFull').textContent = cur && cur.fullCalibrated ? 'Ricalibra a schermo intero' : 'Calibra a schermo intero';
  if (cur && !cur.calibrated && !cur.fullCalibrated) plMsg('Questa piattaforma non è ancora calibrata: apri il grafico con un trade e premi Calibra.', 'err');
  else plMsg(`Normale: ${cur.calibrated ? 'calibrato' : 'non calibrato'}. Schermo intero: ${cur.fullCalibrated ? 'calibrato' : 'non calibrato'}. ${cur.customColors ? 'Colori insegnati da te.' : 'Colori standard.'}`, cur.calibrated || cur.fullCalibrated ? 'ok' : 'err');
}
$('platform').addEventListener('change', async (e) => fillPlatforms(await api.settingsPlatform(e.target.value)));
$('showNewPl').onclick = () => { $('newPlBox').hidden = false; $('newPlName').focus(); };
$('cancelPl').onclick = () => { $('newPlBox').hidden = true; $('newPlName').value = ''; };
$('createPl').onclick = async () => {
  try { fillPlatforms(await api.settingsCreatePlatform($('newPlName').value)); $('newPlBox').hidden = true; $('newPlName').value = ''; plMsg('Piattaforma creata: ora apri il suo grafico con un trade e premi Calibra.', 'ok'); }
  catch (err) { plMsg(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'); }
};
$('newPlName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('createPl').click(); });
$('calibrate').onclick = () => api.settingsCalibrate('normal');
$('testRead').onclick = async () => {
  const out = $('testOut'); $('testRead').disabled = true; out.hidden = true;
  const row = (k, v) => `<div class="row"><b>${k}</b><span>${v === null || v === undefined || v === '' ? '<span class="muted">non letto</span>' : String(v).replace(/[<>&]/g, '')}</span></div>`;
  try {
    const r = await api.settingsTestRead();
    out.innerHTML = row('Entrata', r.entry) + row('Take profit', r.tp) + row('Stop loss', r.sl) + row('Simbolo', r.symbol) + row('Saldo', r.balance) + row('Data', r.date) + row('Ora', r.time) + row('Schermo', r.size)
      + (r.layout ? `<p class="muted small">${r.layout.replace(/[<>&]/g, '')}</p>` : '') + (r.hint ? `<p class="msg err">${r.hint.replace(/[<>&]/g, '')}</p>` : '');
    out.hidden = false;
  } catch (err) { plMsg(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'); }
  $('testRead').disabled = false;
};
$('calibrateFull').onclick = () => api.settingsCalibrate('full');
$('layoutMode').addEventListener('change', async (e) => fillPlatforms(await api.settingsLayoutMode(e.target.value)));

// ----- barra -----
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', (e) => api.settingsMode(e.target.value)));

api.settingsGet().then((d) => {
  keys = { ...d.keys }; defaults = d.defaults;
  renderKeys();
  fillPlatforms(d);
  document.querySelector(`input[name="mode"][value="${d.mode}"]`).checked = true;
  if (d.accounts) { $('linked').hidden = false; fillAccounts(d.accounts, d.accountId); if (!d.accountId) accMsg('Scegli un conto dalla tendina.', 'err'); }
  else $('notLinked').hidden = false;
});

// ----- condivisione locale -----
function locMsg(text, cls = '') { $('locMsg').textContent = text; $('locMsg').className = 'msg ' + cls; }
function locFill(st) {
  $('locOn').checked = st.enabled; $('locAddr').value = st.address; $('locKey').value = st.key;
  $('locOrigins').value = (st.origins || []).join('\n'); $('locPort').value = st.port;
  $('locOpen').hidden = !st.running;
  $('locPill').textContent = st.running ? 'Attiva' : 'Spenta'; $('locPill').className = 'pill' + (st.running ? ' on' : '');
  if (st.error) locMsg(st.error, 'err');
  else if (st.running) locMsg(`Attiva su ${st.address}`, 'ok');
  else locMsg(st.enabled ? 'Non attiva.' : 'Spenta.');
}
$('locSave').onclick = async () => {
  locMsg('Salvo…');
  try { locFill(await api.localSet({ enabled: $('locOn').checked, port: $('locPort').value, origins: $('locOrigins').value.split(/\r?\n/) })); }
  catch (err) { locMsg(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'); }
};
$('locCopyAddr').onclick = async () => { await api.localCopy($('locAddr').value); locMsg('Indirizzo copiato ✓', 'ok'); };
$('locCopyKey').onclick = async () => { await api.localCopy($('locKey').value); locMsg('Chiave copiata ✓', 'ok'); };
$('locRegen').onclick = async () => { locFill(await api.localRegen()); locMsg('Nuova chiave creata: i siti già collegati dovranno riceverla di nuovo.', 'ok'); };
$('locOpen').onclick = () => api.localOpen();
api.localGet().then(locFill);

// ----- cartella degli screenshot -----
function shotMsg(t, c = '') { $('shotMsg').textContent = t; $('shotMsg').className = 'msg ' + c; }
function shotFill(i) { $('shotDir').value = i.dir; $('shotDir').title = i.dir; shotMsg(i.isDefault ? 'Cartella predefinita (dentro i dati del programma).' : ''); }
$('shotChange').onclick = async () => {
  try {
    const r = await api.shotsChoose();
    if (!r) return;
    shotFill(r);
    shotMsg(`Fatto: ${r.moved} screenshot spostati${r.kept ? `, ${r.kept} lasciati dove sono` : ''}${r.failed ? `, ${r.failed} non spostati` : ''}.`, r.failed ? 'err' : 'ok');
  } catch (e) { shotMsg(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'); }
};
$('shotOpen').onclick = () => api.shotsOpen();
api.shotsGet().then(shotFill);

// ----- aggiornamenti -----
const updMsg = (t, c = '') => { $('updMsg').textContent = t; $('updMsg').className = 'msg ' + c; };
const cleanErr = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
api.updateGet().then((u) => { $('ver').textContent = u.version; $('updUrl').value = u.url; });
$('updSave').onclick = async () => { try { await api.updateSet($('updUrl').value); updMsg('Salvato ✓', 'ok'); } catch (e) { updMsg(cleanErr(e), 'err'); } };
$('updCheck').onclick = async () => {
  try { await api.updateSet($('updUrl').value); updMsg('Controllo…'); $('updCheck').disabled = true; const r = await api.updateCheck(); updMsg(r.state === 'dev' ? 'Funziona solo nel programma installato.' : '', ''); }
  catch (e) { updMsg(cleanErr(e), 'err'); }
  $('updCheck').disabled = false;
};
