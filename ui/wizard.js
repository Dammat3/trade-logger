const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const err = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const LAST = 5;
let step = 0, data = null;

function msg(id, text, cls = '') { $(id).textContent = text; $(id).className = 'msg ' + cls; }

function renderDots() {
  $('dots').innerHTML = Array.from({ length: LAST + 1 }, (_, i) => `<i class="${i === step ? 'on' : i < step ? 'done' : ''}"></i>`).join('');
}
function show(n) {
  step = Math.max(0, Math.min(LAST, n));
  document.querySelectorAll('section[data-step]').forEach((s) => { s.hidden = Number(s.dataset.step) !== step; });
  $('back').hidden = step === 0;
  $('skip').hidden = step === LAST;
  $('next').textContent = step === 0 ? 'Iniziamo' : step === LAST ? 'Fai il giro della barra' : 'Avanti';
  renderDots();
}

function fillPlatforms(d) {
  data = d;
  $('platform').innerHTML = d.platforms.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.calibrated ? '' : ' (da calibrare)'}</option>`).join('');
  $('platform').value = d.activePlatform;
  const cur = d.platforms.find((p) => p.id === d.activePlatform);
  const ok = cur && (cur.calibrated || cur.fullCalibrated);
  msg('calMsg', ok ? `${cur.name}: calibrata ✓` : 'Non ancora calibrata.', ok ? 'ok' : 'err');
  $('calibrate').textContent = ok ? 'Ricalibra' : 'Calibra ora';
}
async function refresh() { fillPlatforms(await api.settingsGet()); }

$('platform').addEventListener('change', async (e) => fillPlatforms(await api.settingsPlatform(e.target.value)));
$('showNewPl').onclick = () => { $('newPlBox').hidden = false; $('newPlName').focus(); };
$('cancelPl').onclick = () => { $('newPlBox').hidden = true; $('newPlName').value = ''; };
$('createPl').onclick = async () => {
  try { fillPlatforms(await api.settingsCreatePlatform($('newPlName').value)); $('newPlBox').hidden = true; $('newPlName').value = ''; msg('plMsg', 'Piattaforma aggiunta ✓', 'ok'); }
  catch (e) { msg('plMsg', err(e), 'err'); }
};
$('newPlName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('createPl').click(); });

$('calibrate').onclick = () => api.settingsCalibrate('normal');
$('testRead').onclick = async () => {
  const out = $('testOut'); $('testRead').disabled = true; out.hidden = true;
  const row = (k, v) => `<div class="row"><b>${k}</b><span>${v === null || v === undefined || v === '' ? '<span class="muted">non letto</span>' : esc(v)}</span></div>`;
  try {
    const r = await api.settingsTestRead();
    out.innerHTML = row('Entrata', r.entry) + row('Take profit', r.tp) + row('Stop loss', r.sl) + row('Simbolo', r.symbol) + row('Saldo', r.balance)
      + (r.hint ? `<p class="msg err">${esc(r.hint)}</p>` : '');
    out.hidden = false;
  } catch (e) { msg('calMsg', err(e), 'err'); }
  $('testRead').disabled = false;
};

async function applyKeys() {
  const kind = document.querySelector('input[name="keys"]:checked').value;
  const keys = kind === 'simple' ? { new: 'F1', tp: 'F2', sl: 'F3', man: 'F4' } : { ...data.defaults };
  const failed = await api.settingsSaveKeys(keys);
  if (failed.length) { msg('keyMsg', 'Qualche tasto è già usato da un altro programma: scegli le combinazioni con Ctrl+Alt oppure cambialo dalle Impostazioni.', 'err'); return false; }
  return true;
}
async function applyBar() {
  await api.settingsMode(document.querySelector('input[name="mode"]:checked').value);
  await api.settingsQuick($('quickSave').checked);
}

$('next').onclick = async () => {
  $('next').disabled = true;
  try {
    if (step === 3 && !(await applyKeys())) return;
    if (step === 4) await applyBar();
    if (step === LAST) { await api.wizardFinish(true); return; }
    show(step + 1);
  } catch (e) { msg('keyMsg', err(e), 'err'); }
  finally { $('next').disabled = false; }
};
$('back').onclick = () => show(step - 1);
$('skip').onclick = () => api.wizardFinish(false);

api.on('wizard:refresh', refresh);
api.settingsGet().then((d) => {
  fillPlatforms(d);
  document.querySelector(`input[name="mode"][value="${d.mode === 'minimal' || d.mode === 'tasti' ? d.mode : 'estesa'}"]`).checked = true;
  show(0);
});
